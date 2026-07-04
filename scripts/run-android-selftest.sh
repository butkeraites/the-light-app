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
#   5) ASSERTA a BATERIA COMPLETA de marcadores TLA_*, em PARIDADE com o iOS (F6.5): o
#      hook `selftest.ts` emite os MESMOS marcadores em AMBOS os alvos (aqui caem no
#      logcat ReactNativeJS). Sai 0 só se TODOS aparecerem — parse (PT+EN), guard de
#      upgrade do DB (TLA_DBUP, F6.4), leitura (TLA_READ), leitura paralela (TLA_PARALLEL),
#      busca (TLA_SEARCH), xref (TLA_XREF), notas (TLA_NOTES), estudo assistido (TLA_ASK),
#      estudo profundo (TLA_STUDY), conversa (TLA_CHAT), comparação (TLA_COMPARE), export
#      (TLA_EXPORT) e planos (TLA_PLANS) — mesmos padrões/grep do run-ios-selftest.sh:
#        TLA_SELFTEST PT book=43 chapter=3 verse=16
#        TLA_SELFTEST EN book=43 chapter=3 verse=16
#        TLA_DBUP adopted=true matt1_verses=<N>=1
#        TLA_READ books=66 john3_v16="For God so loved the world..." john_chapters=21
#        TLA_PARALLEL kjv_john3_16="For God so loved..." alm_john3_16="Porque Deus amou..."
#        TLA_SEARCH query="God" hits=<N>>=1 first_ref="John 3:16" first_text="For God so loved..."
#        TLA_XREF verse="John 3:16" count=<N>>=1 first_ref="John 3:15" ...
#        TLA_NOTES note_ref="John 3:16" highlights=<N>>=1 persisted=true
#        TLA_ASK/TLA_STUDY/TLA_CHAT/TLA_COMPARE/TLA_EXPORT ref="John 3:16" provider="mock" ...
#        TLA_PLANS plan_id="gospels" days=30 persisted=true
#      Um pré-check HEADLESS de a11y (TLA_A11Y) roda antes, como no iOS.
#   6) limpa: encerra o app, o Metro, o stream do logcat e DESLIGA o emulador.
#
# Pré-requisito: app/android/ já gerado (expo prebuild -p android) e o módulo
# nativo Android construído (scripts/gen-bindings-android.sh). Rede só em
# dev/build; o runtime do self-test é offline (o app resolve a referência
# localmente, no Rust).
#
# Variáveis (opcionais):
#   AVD_NAME      (default: "thelight_avd" se existir, senão o 1º AVD DISPONÍVEL — resolvido
#                  em [1/5]; resiliente à ausência do AVD canônico)
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

# AVD_NAME opcional: se vazio, o passo [1/5] escolhe "thelight_avd" (se existir) ou o
# 1º AVD disponível — resiliente à ausência do AVD canônico (paridade c/ DEVICE_NAME iOS).
AVD_NAME="${AVD_NAME:-}"
APP_ID="${APP_ID:-com.thelight.app}"
MAIN_ACTIVITY="${MAIN_ACTIVITY:-$APP_ID/.MainActivity}"
LAUNCH_WAIT="${LAUNCH_WAIT:-240}"
BOOT_WAIT="${BOOT_WAIT:-300}"
ABI_PROP="-PreactNativeArchitectures=arm64-v8a"

# ── Marcadores TLA_* — PARIDADE com run-ios-selftest.sh (F6.5) ────────────────
# O hook selftest.ts emite a MESMA bateria em iOS e Android (aqui no logcat ReactNativeJS).
# Os textos bíblicos vêm do RETORNO das fronteiras (store local, verbatim) — não hardcoded
# no glue/selftest; aqui o script só confere substrings/padrões esperados (anti-alucinação).
MARK_PT="TLA_SELFTEST PT book=43 chapter=3 verse=16"
MARK_EN="TLA_SELFTEST EN book=43 chapter=3 verse=16"
# F6.4: guard de staleness no upgrade do DB de leitura (adopted=true + Mateus consultável).
MARK_DBUP="TLA_DBUP adopted=true"
# F1.3 (ADR-0014): prova de leitura (66 livros, João 3:16 KJV verbatim, 21 capítulos).
MARK_READ_BOOKS="TLA_READ books=66"
MARK_READ_TEXT="For God so loved the world"
MARK_READ_CHAP="john_chapters=21"
# F1.4 (ADR-0015): leitura paralela (João 3:16 em KJV E Almeida 1911, ambos do store).
MARK_PARALLEL="TLA_PARALLEL"
MARK_PARALLEL_ALM="Porque Deus amou o mundo de tal maneira"
# F1.6 (ADR-0014/0015): busca via a fronteira `search` (FTS5/BM25), ESCOPADA ao livro 43
# (João) p/ localizar João 3:16 de forma determinística na Bíblia completa (F6.5).
MARK_SEARCH_QUERY='TLA_SEARCH query="God"'
MARK_SEARCH_REF="John 3:16"
MARK_SEARCH_TEXT="For God so loved"
# F1.9 (ADR-0016): xref via a fronteira `cross_refs` (João 3:16 → top do subset por votos).
MARK_XREF_VERSE='TLA_XREF verse="John 3:16"'
# F1.11 (ADR-0017): notas/highlights + persistência via a fronteira `userdata`.
MARK_NOTES_REF='TLA_NOTES note_ref="John 3:16"'
# F2.5 (D3/D4): estudo assistido ancorado (ask_anchored_stream) com o provedor mock (offline).
MARK_ASK='TLA_ASK ref="John 3:16" provider="mock"'
MARK_ASK_CITED='cited_prefix="For God so loved'
# F3.5 (ADR-0027): estudo profundo + léxico (deep_study/lexical_entries) com o mock.
MARK_STUDY='TLA_STUDY ref="John 3:16" provider="mock"'
MARK_STUDY_PASSAGE='passage_prefix="For God so loved'
# F3.6 (ADR-0027): conversa/follow-up ancorado (ask_session_anchored) com o mock.
MARK_CHAT='TLA_CHAT ref="John 3:16" provider="mock"'
MARK_CHAT_CITED='cited_prefix="For God so loved'
# F3.7 (ADR-0027): comparação multi-IA ancorada (ask_anchored 2×) com o mock.
MARK_COMPARE='TLA_COMPARE ref="John 3:16"'
MARK_COMPARE_CITED='cited_prefix="For God so loved'
# F3.8: export acadêmico (deep_study → Markdown SBL do core) com o mock.
MARK_EXPORT='TLA_EXPORT ref="John 3:16" provider="mock"'
# F5.7 (ADR-0039): planos de leitura via a fronteira userdata::plans (gospels=30 dias).
MARK_PLANS='TLA_PLANS plan_id="gospels"'

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

# ── AVD RESILIENTE (F6.5) — paridade com DEVICE_NAME do iOS ───────────────────
# Com AVD_NAME (env) explícito, exige aquele AVD; senão prefere "thelight_avd" (o
# canônico), ou o 1º AVD DISPONÍVEL. Evita quebrar quando o AVD canônico não existe.
AVDS="$("$ANDROID_HOME/emulator/emulator" -list-avds 2>/dev/null)"
if [ -n "$AVD_NAME" ]; then
  printf '%s\n' "$AVDS" | grep -qx "$AVD_NAME" \
    || { echo "ERRO: AVD '$AVD_NAME' não encontrado (emulator -list-avds)." >&2; exit 1; }
elif printf '%s\n' "$AVDS" | grep -qx "thelight_avd"; then
  AVD_NAME="thelight_avd"
else
  AVD_NAME="$(printf '%s\n' "$AVDS" | grep -vE '^[[:space:]]*$' | head -1)"
  [ -n "$AVD_NAME" ] || { echo "ERRO: nenhum AVD disponível (emulator -list-avds)." >&2; exit 1; }
fi

[ -x "$ANDROID_APP_DIR/gradlew" ] || {
  echo "ERRO: app/android ausente — rode 'npx expo prebuild -p android' em app/." >&2; exit 1; }

# ── [0/5] Prova de A11Y de MODAIS/DYNAMIC TYPE (F5.21/ADR-0049) — HEADLESS/ESTÁTICA ──
# Paridade com o iOS (F6.5): a11y de "dynamic type"/"semântica de modal" são propriedades
# ESTÁTICAS de React Native (props JSX), independentes do device — a prova honesta é uma
# guarda HEADLESS (node) que emite TLA_A11Y, COMPLEMENTAR aos TLA_* de fronteira no device.
echo "==> [0/5] a11y (F5.21): guarda headless de modais/dynamic-type — emite TLA_A11Y"
A11Y_OUT="$(cd "$APP_DIR" && node web/__tests__/reader-modal-a11y.test.mjs 2>&1)" || {
  echo "$A11Y_OUT" >&2
  echo "ERRO: guarda a11y (reader-modal-a11y) falhou." >&2
  exit 1
}
echo "$A11Y_OUT" | grep -E 'TLA_A11Y modal=true .*scale=ok .*focus=ok' \
  || { echo "ERRO: marcador TLA_A11Y (modal=true scale=ok focus=ok) ausente." >&2; echo "$A11Y_OUT" >&2; exit 1; }

# ── Banco de leitura bundled (F1.3/ADR-0014) ─────────────────────────────────
# O bundle empacota o subset via o SYMLINK app/assets/data/reading-sample.sqlite. Se
# ausente, (re)gera (idempotente) p/ a prova de leitura/busca ser independente.
if [ ! -f "$ROOT/assets/data/reading-sample.sqlite" ]; then
  echo "==> reading-sample.sqlite ausente — gerando (ADR-0014)"
  "$ROOT/scripts/gen-reading-sample-db.sh"
fi

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

# ── [5/5] Asserção: bateria TLA_* completa (PARIDADE iOS, F6.5) ───────────────
# Mesmos padrões/grep do run-ios-selftest.sh, aplicados ao logcat (ReactNativeJS).
echo "==> [5/5] Aguardando bateria TLA_* completa: parse (PT+EN) + guard-upgrade (TLA_DBUP) + leitura + paralela + busca + xref + notas + ask + estudo + conversa + comparação + export + planos (até ${LAUNCH_WAIT}s)"
found=0
for _ in $(seq 1 "$LAUNCH_WAIT"); do
  if grep -qF "$MARK_PT" "$LOGCAT_LOG" \
    && grep -qF "$MARK_EN" "$LOGCAT_LOG" \
    && grep -qF "$MARK_DBUP" "$LOGCAT_LOG" \
    && grep -qE 'TLA_DBUP .*matt1_verses=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qF "$MARK_READ_BOOKS" "$LOGCAT_LOG" \
    && grep -qF "$MARK_READ_TEXT" "$LOGCAT_LOG" \
    && grep -qF "$MARK_READ_CHAP" "$LOGCAT_LOG" \
    && grep -qF "$MARK_PARALLEL" "$LOGCAT_LOG" \
    && grep -qF "$MARK_PARALLEL_ALM" "$LOGCAT_LOG" \
    && grep -qF "$MARK_SEARCH_QUERY" "$LOGCAT_LOG" \
    && grep -qE 'TLA_SEARCH .*hits=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qF "$MARK_SEARCH_REF" "$LOGCAT_LOG" \
    && grep -qF "$MARK_SEARCH_TEXT" "$LOGCAT_LOG" \
    && grep -qF "$MARK_XREF_VERSE" "$LOGCAT_LOG" \
    && grep -qE 'TLA_XREF .*count=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qE 'first_ref="(Genesis|Psalm|Psalms|John) ' "$LOGCAT_LOG" \
    && grep -qF "$MARK_NOTES_REF" "$LOGCAT_LOG" \
    && grep -qE 'TLA_NOTES .*highlights=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qF 'persisted=true' "$LOGCAT_LOG" \
    && grep -qF "$MARK_ASK" "$LOGCAT_LOG" \
    && grep -qE 'TLA_ASK .*streamed=true' "$LOGCAT_LOG" \
    && grep -qF "$MARK_ASK_CITED" "$LOGCAT_LOG" \
    && grep -qE 'TLA_ASK .*interp_len=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qF "$MARK_STUDY" "$LOGCAT_LOG" \
    && grep -qF "$MARK_STUDY_PASSAGE" "$LOGCAT_LOG" \
    && grep -qE 'TLA_STUDY .*lexicon=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qE 'TLA_STUDY .*attribution_ok=true' "$LOGCAT_LOG" \
    && grep -qF "$MARK_CHAT" "$LOGCAT_LOG" \
    && grep -qF "$MARK_CHAT_CITED" "$LOGCAT_LOG" \
    && grep -qE 'TLA_CHAT .*turns=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qE 'TLA_CHAT .*interp_len=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qF "$MARK_COMPARE" "$LOGCAT_LOG" \
    && grep -qF "$MARK_COMPARE_CITED" "$LOGCAT_LOG" \
    && grep -qE 'TLA_COMPARE .*providers=[2-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qE 'TLA_COMPARE .*cited_match=true' "$LOGCAT_LOG" \
    && grep -qE 'TLA_COMPARE .*first_provider="mock"' "$LOGCAT_LOG" \
    && grep -qF "$MARK_EXPORT" "$LOGCAT_LOG" \
    && grep -qE 'TLA_EXPORT .*md_len=[1-9][0-9]*' "$LOGCAT_LOG" \
    && grep -qE 'TLA_EXPORT .*has_passage=true' "$LOGCAT_LOG" \
    && grep -qE 'TLA_EXPORT .*has_attribution=true' "$LOGCAT_LOG" \
    && grep -qF "$MARK_PLANS" "$LOGCAT_LOG" \
    && grep -qE 'TLA_PLANS .*days=30' "$LOGCAT_LOG" \
    && grep -qE 'TLA_PLANS .*persisted=true' "$LOGCAT_LOG"; then
    found=1; break
  fi
  sleep 1
done

echo "----- marcadores capturados (emulador) -----"
grep -F "TLA_" "$LOGCAT_LOG" | sed 's/.*\(TLA_\)/\1/' | sort -u || true
echo "--------------------------------------------"

if [ "$found" != "1" ]; then
  echo "ERRO: a bateria TLA_* completa não apareceu em ${LAUNCH_WAIT}s — parse (PT/EN), guard de upgrade do DB (TLA_DBUP: adopted=true, matt1_verses>=1), leitura (TLA_READ), leitura paralela (TLA_PARALLEL + Almeida), busca (TLA_SEARCH: query=\"God\", hits>=1, João 3:16, \"For God so loved\"), xref (TLA_XREF: verse=\"John 3:16\", count>=1, first_ref do subset), notas (TLA_NOTES: highlights>=1, persisted=true), estudo assistido (TLA_ASK: streamed=true, cited_prefix, interp_len>=1), estudo profundo (TLA_STUDY: passage_prefix, lexicon>=1, attribution_ok=true), conversa (TLA_CHAT: turns>=1, cited_prefix, interp_len>=1), comparação (TLA_COMPARE: providers>=2, cited_match=true, first_provider=\"mock\"), export (TLA_EXPORT: md_len>0, has_passage=true, has_attribution=true) e/ou planos (TLA_PLANS: plan_id=\"gospels\", days=30, persisted=true)." >&2
  echo "Tail do logcat:" >&2; tail -30 "$LOGCAT_LOG" >&2
  exit 1
fi

# Reemite as linhas/asserções EXATAS p/ o bloco de verificação (grep no stdout).
echo "$MARK_PT"
echo "$MARK_EN"
grep -F "TLA_DBUP adopted=true" "$LOGCAT_LOG" | sed 's/.*\(TLA_DBUP\)/\1/' | head -1
grep -F "TLA_READ books=66" "$LOGCAT_LOG" | sed 's/.*\(TLA_READ\)/\1/' | head -1
grep -F "TLA_PARALLEL" "$LOGCAT_LOG" | sed 's/.*\(TLA_PARALLEL\)/\1/' | head -1
grep -F 'TLA_SEARCH query="God"' "$LOGCAT_LOG" | sed 's/.*\(TLA_SEARCH\)/\1/' | head -1
grep -F 'TLA_XREF verse="John 3:16"' "$LOGCAT_LOG" | sed 's/.*\(TLA_XREF\)/\1/' | head -1
grep -F 'TLA_NOTES note_ref="John 3:16"' "$LOGCAT_LOG" | sed 's/.*\(TLA_NOTES\)/\1/' | head -1
grep -F 'TLA_ASK ref="John 3:16" provider="mock"' "$LOGCAT_LOG" | sed 's/.*\(TLA_ASK\)/\1/' | head -1
grep -F 'TLA_STUDY ref="John 3:16" provider="mock"' "$LOGCAT_LOG" | sed 's/.*\(TLA_STUDY\)/\1/' | head -1
grep -F 'TLA_CHAT ref="John 3:16" provider="mock"' "$LOGCAT_LOG" | sed 's/.*\(TLA_CHAT\)/\1/' | head -1
grep -F 'TLA_COMPARE ref="John 3:16"' "$LOGCAT_LOG" | sed 's/.*\(TLA_COMPARE\)/\1/' | head -1
grep -F 'TLA_EXPORT ref="John 3:16" provider="mock"' "$LOGCAT_LOG" | sed 's/.*\(TLA_EXPORT\)/\1/' | head -1
grep -F 'TLA_PLANS plan_id="gospels"' "$LOGCAT_LOG" | sed 's/.*\(TLA_PLANS\)/\1/' | head -1
echo "==> OK — bateria TLA_* completa provada pelo Rust nativo via Turbo Module Android (paridade iOS, F6.5): parse (PT==EN), guard de upgrade do DB (TLA_DBUP), leitura (TLA_READ), leitura paralela (TLA_PARALLEL), busca (TLA_SEARCH — escopada ao livro 43/João, João 3:16 + \"For God so loved\" verbatim do store), xref (TLA_XREF), notas/highlights (TLA_NOTES), estudo assistido (TLA_ASK), estudo profundo (TLA_STUDY), conversa/follow-up (TLA_CHAT), comparação multi-IA (TLA_COMPARE), export acadêmico (TLA_EXPORT) e planos de leitura (TLA_PLANS)."
