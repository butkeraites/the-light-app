#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/gen-bindings-web.sh — F0.6b (ADR-0007)
#
# Gera os bindings WEB/WASM da fronteira UniFFI `the-light-app-core` (core/) pelo
# CAMINHO WEB do uniffi-bindgen-react-native (`ubrn build web`, alias `wasm`),
# versão FIXADA `0.31.0-3`. Produz: os .ts web + um *wasm-crate* wrapper gerado +
# a saída wasm-bindgen (index.js / index_bg.wasm / *.d.ts) que o glue de app/web/
# e o app Expo consomem. NÃO é o caminho `jsi`/nativo (esse é scripts/gen-bindings.sh,
# que NÃO se altera aqui) e NÃO é um `cargo build` cru da fronteira.
#
# Fluxo (cada passo é explícito e reproduzível):
#   1) ubrn build web --no-wasm-pack
#        cargo build do host (core/) p/ extrair a metadata UniFFI; gera os .ts web
#        (flavor wasm) e o wasm-crate wrapper em rust_modules/wasm/ (path-dep da
#        fronteira PURA no wasm32 + do runtime web `uniffi-runtime-javascript`).
#        `--no-wasm-pack` para a geração; os passos 2-4 (wasm32 + wasm-bindgen) os
#        rodamos nós, para casar a versão do CLI wasm-bindgen com o Cargo.lock.
#   2) cargo build --target wasm32-unknown-unknown do wasm-crate
#        Compila a fronteira+runtime p/ wasm (rusqlite/sqlite NÃO entram: a feature
#        `embedded` é cfg(not(wasm32)) e o wasm-crate usa resolver v2 — ver o patch
#        wasm-crate.patch.toml). Produz o .wasm e o Cargo.lock do wasm-crate.
#   3) Lê a versão EXATA de `wasm-bindgen` do Cargo.lock e garante o binário
#        `wasm-bindgen` (CLI) NESSA mesma versão (crate e CLI precisam coincidir,
#        senão o CLI aborta por mismatch). Instala fixado se faltar/divergir.
#   4) wasm-bindgen --target <web> → app/web/generated/wasm-bindgen/.
#
# ACHADO (ADR-0005/0007): um `cargo build` CRU da fronteira p/ wasm32 falha
# (uniffi_core `+Send`); o caminho web do ubrn resolve isso com o runtime web
# (`uniffi-runtime-javascript`, feature wasm32 → `wasm-unstable-single-threaded`).
# Por isso usamos `ubrn build web`, não build cru.
#
# Caminhos de saída vêm de ubrn.config.yaml (bloco `web:`), a fonte da verdade.
# Tudo é GERADO e IGNORADO pelo git (rust_modules/ e app/web/generated/). Rede é
# permitida em dev/build (instalar wasm-bindgen-cli, resolver deps); offline-first
# é regra de RUNTIME. Nenhum segredo é lido/gravado.
#
# Saída: 0 em sucesso, ≠0 em qualquer erro.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

CONFIG="$ROOT/ubrn.config.yaml"
UBRN="$ROOT/node_modules/.bin/ubrn"
# Binários instalados por `cargo install` ficam em ~/.cargo/bin; garanta no PATH.
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

[ -f "$CONFIG" ] || { echo "ERRO: ubrn.config.yaml ausente em $CONFIG" >&2; exit 1; }
[ -x "$UBRN" ] || {
  echo "ERRO: ubrn não encontrado em $UBRN — rode 'npm ci' (ou 'npm install') primeiro." >&2
  exit 1
}

# ── Caminhos do bloco `web:` de ubrn.config.yaml (fonte da verdade) ───────────
# Extrai uma chave escalar de dentro do bloco top-level `web:`.
yaml_web_get() { # $1 = chave (ex.: ts | target | manifestPath)
  awk -v k="$1" '
    /^web:/ { inb = 1; next }
    inb && /^[^[:space:]]/ { inb = 0 }
    inb && $1 == k ":" { print $2; exit }
  ' "$CONFIG"
}
TS_REL="$(yaml_web_get ts)"
TARGET="$(yaml_web_get target)"
WASM_MANIFEST_REL="$(yaml_web_get manifestPath)"
: "${TS_REL:?ubrn.config.yaml: chave web.ts ausente/ilegível}"
: "${TARGET:=web}"
: "${WASM_MANIFEST_REL:=rust_modules/wasm/Cargo.toml}"
TS_DIR="$ROOT/$TS_REL"
WASM_MANIFEST="$ROOT/$WASM_MANIFEST_REL"
WASM_CRATE_DIR="$(dirname "$WASM_MANIFEST")"

# ── Toolchain wasm ────────────────────────────────────────────────────────────
echo "==> Garantindo target rustup wasm32-unknown-unknown"
if command -v rustup >/dev/null 2>&1; then
  rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown \
    || rustup target add wasm32-unknown-unknown
fi

# ── Limpeza determinística do que é GERADO ───────────────────────────────────
echo "==> Limpando saídas geradas (rust_modules/ e $TS_REL)"
rm -rf "$ROOT/rust_modules" "$TS_DIR"

# ── [1/4] Gerar bindings web + wasm-crate (sem wasm-bindgen ainda) ────────────
echo "==> [1/4] ubrn build web --no-wasm-pack (bindings .ts + wasm-crate)"
"$UBRN" build web --config "$CONFIG" --no-wasm-pack

# ── [2/4] Compilar o wasm-crate p/ wasm32 em RELEASE (gera .wasm + Cargo.lock) ─
# F5.6: build em RELEASE (era DEBUG ~4.24 MB não-otimizado). Usa o [profile.release]
# do wasm-crate.patch.toml (opt-level="s" + lto + codegen-units=1 + strip debuginfo).
# ZERO-DRIFT: release só otimiza tamanho/velocidade; mesma fronteira/mesmos bindings.
echo "==> [2/4] cargo build --release --target wasm32-unknown-unknown ($WASM_MANIFEST_REL)"
cargo build --release --manifest-path "$WASM_MANIFEST" --target wasm32-unknown-unknown

# ── [3/4] Casar o CLI wasm-bindgen com a versão do Cargo.lock ────────────────
WB_LOCK="$WASM_CRATE_DIR/Cargo.lock"
[ -f "$WB_LOCK" ] || { echo "ERRO: Cargo.lock do wasm-crate ausente em $WB_LOCK" >&2; exit 1; }
WB_VERSION="$(awk -F'"' '
  /^name = "wasm-bindgen"$/ { f = 1; next }
  f && /^version = / { print $2; exit }
' "$WB_LOCK")"
: "${WB_VERSION:?não foi possível ler a versão de wasm-bindgen do Cargo.lock}"
echo "==> [3/4] wasm-bindgen do lock: $WB_VERSION"
CLI_VERSION=""
if command -v wasm-bindgen >/dev/null 2>&1; then
  CLI_VERSION="$(wasm-bindgen --version 2>/dev/null | awk '{print $2}')"
fi
if [ "$CLI_VERSION" != "$WB_VERSION" ]; then
  echo "    Instalando wasm-bindgen-cli =$WB_VERSION (CLI atual: '${CLI_VERSION:-ausente}')"
  cargo install wasm-bindgen-cli --version "$WB_VERSION" --locked
fi
command -v wasm-bindgen >/dev/null 2>&1 || {
  echo "ERRO: wasm-bindgen CLI indisponível após a instalação." >&2; exit 1; }

# ── [4/4] Gerar o glue wasm-bindgen (mesma invocação do ubrn web) ────────────
# F5.6: lê o artefato do dir RELEASE (era debug/).
WASM_FILE="$(find "$WASM_CRATE_DIR/target/wasm32-unknown-unknown/release" -maxdepth 1 -name '*.wasm' | sort | head -1)"
[ -n "$WASM_FILE" ] || { echo "ERRO: artefato .wasm (release) não encontrado em $WASM_CRATE_DIR/target" >&2; exit 1; }
echo "==> [4/4] wasm-bindgen --target $TARGET -> $TS_REL/wasm-bindgen"
wasm-bindgen \
  --target "$TARGET" \
  --omit-default-module-path \
  --out-name index \
  --out-dir "$TS_DIR/wasm-bindgen" \
  "$WASM_FILE"

# ── [wasm-opt] Otimização de TAMANHO pós wasm-bindgen (F5.6) ──────────────────
# Passa `wasm-opt -Oz` (otimiza agressivamente p/ tamanho) + strip de debug/producers
# sobre o index_bg.wasm emitido, IN PLACE. ZERO-DRIFT: wasm-opt preserva a semântica
# do módulo (é o mesmo otimizador que o wasm-pack/trunk usam por padrão); só reduz
# bytes. wasm-opt (binaryen) NÃO vem no PATH nem é dep de cargo do projeto — então o
# instalamos fixado se faltar (guardado como o CLI wasm-bindgen acima). Se a instalação
# FALHAR (ex.: toolchain C++ ausente), NÃO derrubamos o pipeline: emitimos um AVISO e
# seguimos com o wasm de release (que já é o maior ganho vs. o debug). offline-first é
# regra de RUNTIME; instalar ferramenta de build é permitido.
BINDGEN_WASM="$TS_DIR/wasm-bindgen/index_bg.wasm"
WASM_OPT_VERSION="0.116.1" # crate `wasm-opt` (wrapper binaryen); provê o binário `wasm-opt`
if ! command -v wasm-opt >/dev/null 2>&1; then
  echo "==> [wasm-opt] binário ausente — instalando wasm-opt =$WASM_OPT_VERSION (binaryen)"
  cargo install wasm-opt --version "$WASM_OPT_VERSION" --locked \
    || echo "AVISO: 'cargo install wasm-opt' falhou; seguindo SEM wasm-opt (wasm de release já aplicado)." >&2
fi
if command -v wasm-opt >/dev/null 2>&1 && [ -f "$BINDGEN_WASM" ]; then
  BEFORE_BYTES="$(wc -c < "$BINDGEN_WASM" | tr -d ' ')"
  echo "==> [wasm-opt] -Oz --strip-debug --strip-producers ($BEFORE_BYTES B -> ...)"
  wasm-opt -Oz --strip-debug --strip-producers -o "$BINDGEN_WASM.opt" "$BINDGEN_WASM"
  mv "$BINDGEN_WASM.opt" "$BINDGEN_WASM"
  AFTER_BYTES="$(wc -c < "$BINDGEN_WASM" | tr -d ' ')"
  echo "    wasm-opt OK: $BEFORE_BYTES B -> $AFTER_BYTES B"
else
  echo "AVISO: wasm-opt indisponível — index_bg.wasm fica só com o build de release (sem -Oz)." >&2
fi

# ── Sanear JSDoc dos bindings gerados: `**/` → `** /` (ADR-0027) ──────────────
# Mesmo saneamento do `gen-bindings-ios.sh`: o `ubrn` copia os doc-comments Rust
# (`///`) VERBATIM para blocos JSDoc `/** … */`; um `**puro**/` (negrito+barra)
# embute um `*/` que FECHA o comentário prematuramente e derruba `tsc`/Metro com
# erros de sintaxe. Como NÃO tocamos `core/src/lib.rs` e os bindings são artefatos
# GERADOS-IGNORADOS, inserimos um espaço (`**/` → `** /`) — só comentário, zero
# efeito em tipo/assinatura/comportamento; nenhum `**/` é fechamento legítimo aqui.
echo "==> Saneando JSDoc gerado (**/ -> ** /) p/ não fechar comentário prematuramente"
find "$TS_DIR" -maxdepth 1 -name '*.ts' -type f -print0 | xargs -0 perl -i -pe 's{\*\*/}{** /}g'

echo "==> OK — bindings web/wasm gerados:"
find "$TS_DIR" -maxdepth 2 -type f \( -name '*.ts' -o -name '*.js' -o -name '*.wasm' \) \
  | sort | sed "s#^$ROOT/#      #"
