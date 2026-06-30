#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/run-android-selftest.sh — F0.8 (ADR-0009)
#
# PROVA HEADLESS e determinística de que `parse_reference` roda PELO RUST NATIVO
# via Turbo Module (JSI/JNI → UniFFI → the-light-core) num app Expo rodando no
# EMULADOR Android — sem clique manual na UI.
#
# Fluxo:
#   1) boota o AVD `thelight_avd` HEADLESS
#      (-no-window -gpu swiftshader_indirect -no-snapshot -no-audio) e aguarda
#      `sys.boot_completed=1`;
#   2) builda+instala o app (Debug, arm64-v8a) via `gradlew :app:installDebug`
#      (CMake/JSI + Kotlin TurboModule + jniLibs do staticlib Rust) — ou, com
#      SKIP_BUILD=1, reinstala o APK já existente;
#   3) sobe o Metro em background com EXPO_PUBLIC_TLA_SELFTEST=1 (inlinado no
#      bundle servido) e `adb reverse tcp:8081` (o emulador alcança o Metro do host)
#      — o gancho de self-test (app/web/selftest.ts) dispara no mount da HomeScreen;
#   4) limpa o logcat (`adb logcat -c`), lança o app e captura
#      (`adb logcat -s ReactNativeJS:V`) — console.log/error do JS caem nessa tag;
#   5) ASSERTA os DOIS marcadores (PT e EN). Sai 0 só se AMBOS aparecerem:
#        TLA_SELFTEST PT book=43 chapter=3 verse=16
#        TLA_SELFTEST EN book=43 chapter=3 verse=16
#   6) limpa: encerra o app, o Metro, o stream do logcat e DESLIGA o emulador.
#
# Pré-requisito: app/android/ já gerado (expo prebuild -p android) e o módulo
# nativo Android construído (scripts/gen-bindings-android.sh). Rede só em
# dev/build; o runtime do self-test é offline (o app resolve a referência
# localmente, no Rust).
#
# Variáveis (opcionais):
#   AVD_NAME      (default "thelight_avd")
#   APP_ID        (default "com.thelight.app")
#   SKIP_BUILD=1  reinstala o APK existente em vez de buildar (re-runs rápidos)
#   LAUNCH_WAIT   segundos aguardando os marcadores após o launch (default 240)
#   BOOT_WAIT     segundos aguardando o boot do emulador (default 300)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
APP_DIR="$ROOT/app"
ANDROID_APP_DIR="$APP_DIR/android"

# ── Ambiente Android (defensivo; herdado de ~/.zshrc OU fallback Homebrew) ────
: "${ANDROID_HOME:=/opt/homebrew/share/android-commandlinetools}"
: "${ANDROID_NDK_HOME:=$ANDROID_HOME/ndk/27.1.12297006}"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME ANDROID_NDK_HOME JAVA_HOME
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/bin:$PATH"

AVD_NAME="${AVD_NAME:-thelight_avd}"
APP_ID="${APP_ID:-com.thelight.app}"
MAIN_ACTIVITY="${MAIN_ACTIVITY:-$APP_ID/.MainActivity}"
LAUNCH_WAIT="${LAUNCH_WAIT:-240}"
BOOT_WAIT="${BOOT_WAIT:-300}"
ABI_PROP="-PreactNativeArchitectures=arm64-v8a"
MARK_PT="TLA_SELFTEST PT book=43 chapter=3 verse=16"
MARK_EN="TLA_SELFTEST EN book=43 chapter=3 verse=16"

LOG_DIR="$(mktemp -d -t f08-android-selftest)"
LOGCAT_LOG="$LOG_DIR/logcat.log"
METRO_LOG="$LOG_DIR/metro.log"
BUILD_LOG="$LOG_DIR/build.log"

EMU_PID=""
METRO_PID=""
LOGCAT_PID=""
SERIAL=""

cleanup() {
  set +e
  [ -n "$LOGCAT_PID" ] && kill "$LOGCAT_PID" 2>/dev/null
  [ -n "$METRO_PID" ] && kill "$METRO_PID" 2>/dev/null
  if [ -n "$SERIAL" ]; then
    adb -s "$SERIAL" shell am force-stop "$APP_ID" 2>/dev/null
    adb -s "$SERIAL" reverse --remove tcp:8081 2>/dev/null
    adb -s "$SERIAL" emu kill 2>/dev/null
  fi
  [ -n "$EMU_PID" ] && kill "$EMU_PID" 2>/dev/null
}
trap cleanup EXIT

command -v adb >/dev/null 2>&1 || { echo "ERRO: adb ausente (ANDROID_HOME/platform-tools)." >&2; exit 1; }
[ -x "$ANDROID_HOME/emulator/emulator" ] || { echo "ERRO: emulator ausente em $ANDROID_HOME/emulator." >&2; exit 1; }
"$ANDROID_HOME/emulator/emulator" -list-avds | grep -qx "$AVD_NAME" \
  || { echo "ERRO: AVD '$AVD_NAME' não encontrado." >&2; exit 1; }
[ -x "$ANDROID_APP_DIR/gradlew" ] || {
  echo "ERRO: app/android ausente — rode 'npx expo prebuild -p android' em app/." >&2; exit 1; }

# ── [1/5] Boot do emulador (headless) ────────────────────────────────────────
echo "==> [1/5] Bootando AVD $AVD_NAME (headless)"
adb start-server >/dev/null 2>&1 || true
"$ANDROID_HOME/emulator/emulator" -avd "$AVD_NAME" \
  -no-window -gpu swiftshader_indirect -no-snapshot -no-audio -no-boot-anim \
  >"$LOG_DIR/emu.log" 2>&1 &
EMU_PID=$!

echo "    aguardando device no adb..."
adb wait-for-device
SERIAL="$(adb devices | awk '/emulator-.*device$/{print $1; exit}')"
[ -n "$SERIAL" ] || { echo "ERRO: serial do emulador não encontrado." >&2; exit 1; }
echo "    serial: $SERIAL — aguardando boot_completed (até ${BOOT_WAIT}s)"
booted=0
for _ in $(seq 1 "$BOOT_WAIT"); do
  if [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    booted=1; break
  fi
  sleep 1
done
[ "$booted" = "1" ] || { echo "ERRO: emulador não completou o boot em ${BOOT_WAIT}s." >&2; tail -20 "$LOG_DIR/emu.log" >&2; exit 1; }
export ANDROID_SERIAL="$SERIAL"

# ── [2/5] Build + install (Debug, arm64-v8a) ─────────────────────────────────
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> [2/5] gradlew :app:installDebug ($ABI_PROP) — log: $BUILD_LOG"
  ( cd "$ANDROID_APP_DIR" && ./gradlew :app:installDebug "$ABI_PROP" --no-daemon ) \
    >"$BUILD_LOG" 2>&1 || { echo "ERRO: installDebug falhou. Tail:" >&2; tail -40 "$BUILD_LOG" >&2; exit 1; }
else
  echo "==> [2/5] SKIP_BUILD=1 — reinstalando APK existente"
  APK="$(find "$ANDROID_APP_DIR" -path '*outputs/apk/debug*' -name '*.apk' | head -1)"
  [ -n "$APK" ] || { echo "ERRO: APK debug não encontrado (rode sem SKIP_BUILD)." >&2; exit 1; }
  adb -s "$SERIAL" install -r "$APK" >"$BUILD_LOG" 2>&1 \
    || { echo "ERRO: adb install falhou. Tail:" >&2; tail -20 "$BUILD_LOG" >&2; exit 1; }
fi

# ── [3/5] Metro em background (com o env de self-test) + adb reverse ──────────
echo "==> [3/5] Metro (EXPO_PUBLIC_TLA_SELFTEST=1) em background — log: $METRO_LOG"
adb -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null
( cd "$APP_DIR" && EXPO_PUBLIC_TLA_SELFTEST=1 CI=1 npx expo start --port 8081 >"$METRO_LOG" 2>&1 ) &
METRO_PID=$!
for _ in $(seq 1 60); do
  curl -s "http://localhost:8081/status" 2>/dev/null | grep -q "packager-status:running" && break
  sleep 1
done
curl -s "http://localhost:8081/status" 2>/dev/null | grep -q "packager-status:running" \
  || { echo "ERRO: Metro não respondeu em :8081. Tail:" >&2; tail -20 "$METRO_LOG" >&2; exit 1; }

# ── [4/5] logcat -c + launch + captura ───────────────────────────────────────
echo "==> [4/5] logcat -c + launch + captura (tag ReactNativeJS)"
adb -s "$SERIAL" shell am force-stop "$APP_ID" 2>/dev/null || true
adb -s "$SERIAL" logcat -c 2>/dev/null || true
adb -s "$SERIAL" logcat -s ReactNativeJS:V >"$LOGCAT_LOG" 2>/dev/null &
LOGCAT_PID=$!
sleep 1
adb -s "$SERIAL" shell am start -n "$MAIN_ACTIVITY" >/dev/null 2>&1 \
  || adb -s "$SERIAL" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

# ── [5/5] Asserção determinística dos DOIS marcadores ────────────────────────
echo "==> [5/5] Aguardando marcadores PT+EN (até ${LAUNCH_WAIT}s)"
found=0
for _ in $(seq 1 "$LAUNCH_WAIT"); do
  if grep -qF "$MARK_PT" "$LOGCAT_LOG" && grep -qF "$MARK_EN" "$LOGCAT_LOG"; then
    found=1; break
  fi
  sleep 1
done

echo "----- marcadores capturados (emulador) -----"
grep -F "TLA_SELFTEST" "$LOGCAT_LOG" | sed 's/.*\(TLA_SELFTEST\)/\1/' | sort -u || true
echo "--------------------------------------------"

if [ "$found" != "1" ]; then
  echo "ERRO: marcadores PT e/ou EN não apareceram em ${LAUNCH_WAIT}s." >&2
  echo "Tail do logcat:" >&2; tail -30 "$LOGCAT_LOG" >&2
  exit 1
fi

# Reemite as linhas EXATAS p/ o bloco de verificação (grep no stdout do script).
echo "$MARK_PT"
echo "$MARK_EN"
echo "==> OK — parse_reference provado pelo Rust nativo via Turbo Module Android (PT==EN)."
