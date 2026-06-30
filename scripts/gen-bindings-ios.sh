#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/gen-bindings-ios.sh — F0.7 (ADR-0008)
#
# Constrói o módulo NATIVO iOS da fronteira UniFFI `the-light-app-core` (core/)
# pelo CAMINHO iOS do uniffi-bindgen-react-native (`ubrn build ios`, versão
# FIXADA `0.31.0-3`). Produz, de forma reprodutível:
#   - <frameworkName>.xcframework — staticlib Rust (aarch64-apple-ios-sim) com a
#     UniFFI scaffolding; arrasta a feature `embedded` do core no nativo
#     (rusqlite SQLite-C + reqwest), mas só `parse_reference` é exercitado.
#   - a glue do Turbo Module (JSI): ios/ (Obj-C++), cpp/ (C++ JSI), src/ (TS:
#     NativeTheLightAppCore.ts + index.tsx), TheLightAppCore.podspec, ios/generated.
#   - os bindings TS/C++ em bindings/ (mesmo destino do host JSI — ver ADR-0004).
#
# NÃO é o caminho web (`ubrn build web` = scripts/gen-bindings-web.sh, intacto)
# nem a geração host-only (`ubrn generate jsi bindings` = scripts/gen-bindings.sh).
#
# Comando central:
#   ubrn build ios --sim-only --and-generate --config ubrn.config.yaml
#     --sim-only      → só o alvo do simulador (aarch64-apple-ios-sim) — suficiente
#                       p/ a prova no simulador; mais rápido que device+sim+lipo.
#     --and-generate  → após o cargo+xcframework, gera bindings + a glue do TM.
#
# Caminhos de saída vêm de ubrn.config.yaml (blocos ios:/turboModule:/bindings:),
# a fonte da verdade. Tudo é GERADO e IGNORADO pelo git (ver .gitignore). Rede é
# permitida em dev/build (resolver deps de cargo, compilar SQLite-C); offline-first
# é regra de RUNTIME. Nenhum segredo é lido/gravado.
#
# Saída: 0 em sucesso, ≠0 em qualquer erro.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

CONFIG="$ROOT/ubrn.config.yaml"
UBRN="$ROOT/node_modules/.bin/ubrn"
FRAMEWORK_NAME="TheLightAppCoreFramework"

[ -f "$CONFIG" ] || { echo "ERRO: ubrn.config.yaml ausente em $CONFIG" >&2; exit 1; }
[ -x "$UBRN" ] || {
  echo "ERRO: ubrn não encontrado em $UBRN — rode 'npm ci' (ou 'npm install') primeiro." >&2
  exit 1
}

# ── Ambiente iOS (determinístico) ────────────────────────────────────────────
command -v xcodebuild >/dev/null 2>&1 || { echo "ERRO: xcodebuild ausente (Xcode)." >&2; exit 1; }
xcode-select -p 2>/dev/null | grep -q "Xcode.app" \
  || { echo "ERRO: xcode-select não aponta para o Xcode completo." >&2; exit 1; }
if command -v rustup >/dev/null 2>&1; then
  rustup target list --installed 2>/dev/null | grep -qx aarch64-apple-ios-sim \
    || rustup target add aarch64-apple-ios-sim
fi

# ── Limpeza determinística do que é GERADO ───────────────────────────────────
echo "==> Limpando saídas geradas iOS (ios/ cpp/ src/ ${FRAMEWORK_NAME}.xcframework)"
rm -rf "$ROOT/ios" "$ROOT/cpp" "$ROOT/src" "$ROOT/${FRAMEWORK_NAME}.xcframework" \
       "$ROOT/TheLightAppCore.podspec"
# bindings/ é regenerado pelo --and-generate; limpa preservando .gitkeep.
if [ -d "$ROOT/bindings" ]; then
  find "$ROOT/bindings" -mindepth 1 ! -name '.gitkeep' -delete
fi

# ── Build iOS + geração da glue do Turbo Module ──────────────────────────────
echo "==> ubrn build ios --sim-only --and-generate"
"$UBRN" build ios --sim-only --and-generate --config "$CONFIG"

# ── Conferência dos artefatos esperados ──────────────────────────────────────
XCFRAMEWORK="$ROOT/${FRAMEWORK_NAME}.xcframework"
[ -d "$XCFRAMEWORK" ] || { echo "ERRO: xcframework não gerado em $XCFRAMEWORK" >&2; exit 1; }
[ -f "$ROOT/src/index.tsx" ] || { echo "ERRO: entrypoint src/index.tsx não gerado" >&2; exit 1; }
[ -f "$ROOT/TheLightAppCore.podspec" ] || { echo "ERRO: podspec não gerada" >&2; exit 1; }
[ -f "$ROOT/bindings/the_light_app_core.ts" ] || { echo "ERRO: bindings TS não gerados" >&2; exit 1; }

# ── Copiar a glue JS p/ dentro de app/ (resolução local do Metro/tsc) ─────────
# O barrel (src/index.tsx, que chama installRustCrate no JSI e reexporta os
# bindings) + os bindings TS são GERADOS na raiz, mas o Metro/tsc do app resolvem
# melhor DENTRO do projectRoot (app/) — e os bindings importam `@ubjs/core` de
# app/node_modules. Espelhamos a estrutura (src/ ao lado de bindings/) para que o
# import relativo interno do barrel (`./../bindings/...`) continue válido. Destino
# IGNORADO pelo git (.gitignore: /app/web/native-generated/). O glue NATIVO (C++)
# segue usando bindings/cpp na raiz via a podspec — independente desta cópia JS.
NATIVE_JS_DIR="$ROOT/app/web/native-generated"
echo "==> Copiando glue JS p/ $NATIVE_JS_DIR (Metro/tsc local)"
rm -rf "$NATIVE_JS_DIR"
mkdir -p "$NATIVE_JS_DIR/src" "$NATIVE_JS_DIR/bindings"
cp "$ROOT/src/"*.tsx "$ROOT/src/"*.ts "$NATIVE_JS_DIR/src/" 2>/dev/null || true
cp "$ROOT/bindings/"*.ts "$NATIVE_JS_DIR/bindings/"
[ -f "$NATIVE_JS_DIR/src/index.tsx" ] || { echo "ERRO: cópia do barrel falhou" >&2; exit 1; }
[ -f "$NATIVE_JS_DIR/bindings/the_light_app_core.ts" ] || { echo "ERRO: cópia dos bindings falhou" >&2; exit 1; }

echo "==> OK — módulo nativo iOS gerado:"
{
  find "$XCFRAMEWORK" -maxdepth 2 -name '*.a' -o -maxdepth 2 -name 'Info.plist'
  echo "$ROOT/TheLightAppCore.podspec"
  find "$ROOT/ios" "$ROOT/cpp" "$ROOT/src" -type f 2>/dev/null
} | sort | sed "s#^$ROOT/#      #"
