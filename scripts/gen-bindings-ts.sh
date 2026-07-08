#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/gen-bindings-ts.sh — Rodada 3 (endurecer CI: `tsc --noEmit` sem plataforma)
#
# Gera SÓ o que o `tsc --noEmit` precisa da fronteira UniFFI, SEM os artefatos de
# PLATAFORMA (xcframework iOS / .so Android) — que exigem Xcode/NDK e não cabem no
# runner ubuntu do CI. É a interseção CI-friendly de `gen-bindings-ios.sh` (cópia dos
# .ts + saneamento de JSDoc) com `gen-bindings.sh` (host/jsi) e `gen-bindings-web.sh`
# (wasm/web). Produz os DOIS diretórios gerados-ignorados que o `tsconfig` inclui:
#   • app/web/native-generated/{src,bindings}  (glue jsi + barrel, p/ os *.ts nativos)
#   • app/web/generated/wasm-bindgen/           (saída wasm-bindgen, p/ os *.web.ts)
#
# Passos (todos ubuntu-friendly; nenhum toca iOS/Android, nenhum lê/grava segredo):
#   1) scripts/gen-bindings.sh        → bindings/*.ts (host: cargo build + ubrn generate jsi)
#   2) recria app/web/native-generated/{src,bindings}: copia o barrel src/ (VERSIONADO) +
#      os bindings/*.ts (gerados), depois saneia JSDoc `**/` → `** /` (ADR-0027, idêntico
#      ao gen-bindings-ios.sh — o `**/` embutido em doc-comment fecharia o bloco cedo).
#   3) scripts/gen-bindings-web.sh    → app/web/generated/wasm-bindgen/* (wasm32 + wasm-bindgen)
#
# Rede permitida em build (resolver crates / instalar wasm-bindgen-cli); offline-first
# é regra de RUNTIME do produto, não do build. Saída: 0 em sucesso, ≠0 em qualquer erro.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "==> [1/3] bindings host (jsi) — scripts/gen-bindings.sh"
bash "$ROOT/scripts/gen-bindings.sh"

# ── [2/3] Espelha o glue JS p/ native-generated (Metro/tsc), como no gen-bindings-ios.sh,
# mas SEM construir o xcframework. `src/` (barrel) é VERSIONADO; `bindings/*.ts` é gerado.
NATIVE_JS_DIR="$ROOT/app/web/native-generated"
echo "==> [2/3] Copiando glue JS p/ $NATIVE_JS_DIR (tsc)"
rm -rf "$NATIVE_JS_DIR"
mkdir -p "$NATIVE_JS_DIR/src" "$NATIVE_JS_DIR/bindings"
cp "$ROOT/src/"*.tsx "$ROOT/src/"*.ts "$NATIVE_JS_DIR/src/" 2>/dev/null || true
cp "$ROOT/bindings/"*.ts "$NATIVE_JS_DIR/bindings/"
[ -f "$NATIVE_JS_DIR/src/index.tsx" ] || { echo "ERRO: cópia do barrel falhou" >&2; exit 1; }
[ -f "$NATIVE_JS_DIR/bindings/the_light_app_core.ts" ] || { echo "ERRO: cópia dos bindings falhou" >&2; exit 1; }

# Saneia JSDoc gerado `**/` → `** /` (ver nota extensa em gen-bindings-ios.sh).
echo "==> [2/3] Saneando JSDoc gerado (**/ -> ** /)"
find "$NATIVE_JS_DIR" -name '*.ts' -type f -print0 | xargs -0 perl -i -pe 's{\*\*/}{** /}g'
grep -qF '**/' "$NATIVE_JS_DIR/bindings/the_light_app_core.ts" \
  && { echo "ERRO: saneamento de JSDoc (**/) falhou nos bindings" >&2; exit 1; } || true

echo "==> [3/3] bindings web (wasm) — scripts/gen-bindings-web.sh"
bash "$ROOT/scripts/gen-bindings-web.sh"

echo "==> OK — bindings TS (host + web) gerados; pronto p/ tsc --noEmit"
