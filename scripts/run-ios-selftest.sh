#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/run-ios-selftest.sh — F0.7 (ADR-0008)
#
# PROVA HEADLESS e determinística de que `parse_reference` roda PELO RUST NATIVO
# via Turbo Module (JSI → UniFFI → the-light-core) num app Expo rodando no
# SIMULADOR iOS — sem clique manual na UI.
#
# Fluxo:
#   1) resolve/boota um iPhone 17 (iOS 26.x);
#   2) builda o app (Debug, simulador) via xcodebuild a partir do workspace gerado
#      pelo `expo prebuild` + `pod install` (app/ios/);
#   3) sobe o Metro em background com EXPO_PUBLIC_TLA_SELFTEST=1 (inlinado no
#      bundle servido) — o gancho de self-test (app/web/selftest.ts) dispara no
#      mount da HomeScreen;
#   4) instala + lança o app, capturando o log unificado do simulador
#      (`simctl spawn booted log stream`);
#   5) ASSERTA os DOIS marcadores (PT e EN). Sai 0 só se AMBOS aparecerem:
#        TLA_SELFTEST PT book=43 chapter=3 verse=16
#        TLA_SELFTEST EN book=43 chapter=3 verse=16
#   6) limpa: encerra o app, o Metro, o stream e desliga o simulador.
#
# Pré-requisito: app/ios/ já gerado (expo prebuild) com Pods instalados, e o
# módulo nativo iOS construído (scripts/gen-bindings-ios.sh). Rede só em dev/build;
# o runtime do self-test é offline (o app resolve a referência localmente, no Rust).
#
# Variáveis (opcionais):
#   DEVICE_NAME   (default "iPhone 17")
#   BUNDLE_ID     (default "com.thelight.app")
#   SKIP_BUILD=1  reusa um build existente (re-runs rápidos)
#   LAUNCH_WAIT   segundos aguardando os marcadores após o launch (default 240)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
APP_DIR="$ROOT/app"
IOS_DIR="$APP_DIR/ios"
DEVICE_NAME="${DEVICE_NAME:-iPhone 17}"
BUNDLE_ID="${BUNDLE_ID:-com.thelight.app}"
LAUNCH_WAIT="${LAUNCH_WAIT:-240}"
# DerivedData FORA do diretório do repositório: este repo está sob ~/Documents,
# que é gerenciado por um file-provider (iCloud) — todo arquivo ali ganha xattrs
# `com.apple.FinderInfo`/`fileprovider`, que o `codesign` REJEITA ("resource fork,
# Finder information, or similar detritus not allowed") ao assinar os frameworks
# embarcados. Buildar fora do file-provider produz artefatos limpos. Ver ADR-0008.
DERIVED="${DERIVED:-$HOME/Library/Developer/Xcode/DerivedData/thelight-f07-ios}"
WORKSPACE="$IOS_DIR/thelightapp.xcworkspace"
SCHEME="thelightapp"
MARK_PT="TLA_SELFTEST PT book=43 chapter=3 verse=16"
MARK_EN="TLA_SELFTEST EN book=43 chapter=3 verse=16"

export PATH="/opt/homebrew/bin:$PATH"  # cocoapods/node instalados via brew
LOG_DIR="$(mktemp -d -t f07-ios-selftest)"
STREAM_LOG="$LOG_DIR/sim.log"
METRO_LOG="$LOG_DIR/metro.log"
BUILD_LOG="$LOG_DIR/build.log"

METRO_PID=""
STREAM_PID=""
UDID=""

cleanup() {
  set +e
  [ -n "$STREAM_PID" ] && kill "$STREAM_PID" 2>/dev/null
  [ -n "$METRO_PID" ] && kill "$METRO_PID" 2>/dev/null
  [ -n "$UDID" ] && xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null
  [ -n "$UDID" ] && xcrun simctl shutdown "$UDID" 2>/dev/null
}
trap cleanup EXIT

[ -f "$WORKSPACE/contents.xcworkspacedata" ] || {
  echo "ERRO: workspace iOS ausente em $WORKSPACE — rode 'expo prebuild -p ios' + 'pod install'." >&2
  exit 1
}

# ── [1/5] Device ─────────────────────────────────────────────────────────────
UDID="$(xcrun simctl list devices available | grep "$DEVICE_NAME (" | head -1 | grep -oE '[0-9A-Fa-f-]{36}' | head -1)"
[ -n "$UDID" ] || { echo "ERRO: device '$DEVICE_NAME' não encontrado." >&2; exit 1; }
echo "==> [1/5] Device $DEVICE_NAME = $UDID — bootando"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" >/dev/null 2>&1 || true

# ── [2/5] Build (Debug, simulador) ───────────────────────────────────────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> [2/5] xcodebuild (Debug, iphonesimulator) — log: $BUILD_LOG"
  xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination "id=$UDID" \
    -derivedDataPath "$DERIVED" \
    -quiet \
    build >"$BUILD_LOG" 2>&1 || { echo "ERRO: xcodebuild falhou. Tail:" >&2; tail -40 "$BUILD_LOG" >&2; exit 1; }
else
  echo "==> [2/5] SKIP_BUILD=1 — reusando build existente"
fi

APP_PATH="$(find "$DERIVED/Build/Products" -maxdepth 2 -name '*.app' -type d 2>/dev/null | head -1)"
[ -n "$APP_PATH" ] || { echo "ERRO: .app não encontrado em $DERIVED/Build/Products" >&2; exit 1; }
echo "    app: $APP_PATH"

# ── [3/5] Metro em background (com o env de self-test) ───────────────────────
echo "==> [3/5] Metro (EXPO_PUBLIC_TLA_SELFTEST=1) em background — log: $METRO_LOG"
( cd "$APP_DIR" && EXPO_PUBLIC_TLA_SELFTEST=1 CI=1 npx expo start --port 8081 >"$METRO_LOG" 2>&1 ) &
METRO_PID=$!
for _ in $(seq 1 60); do
  curl -s "http://localhost:8081/status" 2>/dev/null | grep -q "packager-status:running" && break
  sleep 1
done
curl -s "http://localhost:8081/status" 2>/dev/null | grep -q "packager-status:running" \
  || { echo "ERRO: Metro não respondeu em :8081. Tail:" >&2; tail -20 "$METRO_LOG" >&2; exit 1; }

# ── [4/5] Install + stream + launch ──────────────────────────────────────────
echo "==> [4/5] install + log stream + launch"
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP_PATH"

# Captura o log unificado filtrando o marcador (robusto a formatação do RCTLog).
xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'eventMessage CONTAINS "TLA_SELFTEST"' >"$STREAM_LOG" 2>/dev/null &
STREAM_PID=$!
sleep 2

xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null

# ── [5/5] Asserção determinística dos DOIS marcadores ────────────────────────
echo "==> [5/5] Aguardando marcadores PT+EN (até ${LAUNCH_WAIT}s)"
found=0
for _ in $(seq 1 "$LAUNCH_WAIT"); do
  if grep -qF "$MARK_PT" "$STREAM_LOG" && grep -qF "$MARK_EN" "$STREAM_LOG"; then
    found=1
    break
  fi
  sleep 1
done

echo "----- marcadores capturados (simulador) -----"
grep -F "TLA_SELFTEST" "$STREAM_LOG" | sed 's/.*\(TLA_SELFTEST\)/\1/' | sort -u || true
echo "---------------------------------------------"

if [ "$found" != "1" ]; then
  echo "ERRO: marcadores PT e/ou EN não apareceram em ${LAUNCH_WAIT}s." >&2
  exit 1
fi

# Reemite as linhas EXATAS p/ o bloco de verificação (grep no stdout do script).
echo "$MARK_PT"
echo "$MARK_EN"
echo "==> OK — parse_reference provado pelo Rust nativo via Turbo Module (PT==EN)."
