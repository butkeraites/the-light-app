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
#   5) ASSERTA os marcadores de PARSE (PT e EN), de LEITURA (F1.3/ADR-0014), de
#      LEITURA PARALELA (F1.4/ADR-0015), de BUSCA (F1.6) E de XREF (F1.9/ADR-0016).
#      Sai 0 só se TODOS aparecerem:
#        TLA_SELFTEST PT book=43 chapter=3 verse=16
#        TLA_SELFTEST EN book=43 chapter=3 verse=16
#        TLA_READ books=66 john3_v16="For God so loved the world..." john_chapters=21
#        TLA_PARALLEL kjv_john3_16="For God so loved the world..." alm_john3_16="Porque Deus amou o mundo de tal maneira..."
#        TLA_SEARCH query="God" hits=<N>=1 first_ref="John 3:16" first_text="For God so loved..."
#        TLA_XREF verse="John 3:16" count=<N>=1 first_ref="John 3:15" first_votes=439
#      (os textos de João 3:16 vêm do RETORNO de get_chapter — store local, KJV e
#       Almeida 1911 verbatim — não hardcoded; o lado a lado lê AS DUAS traduções
#       por DUAS chamadas de get_chapter. O app copia o banco bundled p/ um caminho
#       gravável no 1º boot e lê pela fronteira nativa → JSI → the-light-core.)
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
# F1.3 (ADR-0014): marcadores da PROVA DE LEITURA no device. O texto de João 3:16
# vem do RETORNO de get_chapter (store local, KJV verbatim) — não hardcoded no
# glue/selftest; aqui o script só asserta um substring esperado.
MARK_READ_BOOKS="TLA_READ books=66"          # list_books (puro, 66 livros)
MARK_READ_TEXT="For God so loved the world"  # João 3:16 KJV verbatim do store
MARK_READ_CHAP="john_chapters=21"            # chapter_count(kjv,43) DB-backed
# F1.4 (ADR-0015): PROVA DE LEITURA PARALELA. O mesmo João 3:16 é lido em DUAS
# traduções (kjv E alm1911) por DUAS chamadas de get_chapter — base do lado a
# lado. Ambos os textos vêm do RETORNO de get_chapter (store local, verbatim) —
# não hardcoded no glue/selftest; aqui o script só confere substrings esperados.
MARK_PARALLEL="TLA_PARALLEL"                              # marcador composto da leitura paralela
MARK_PARALLEL_ALM="Porque Deus amou o mundo de tal maneira"  # João 3:16 Almeida 1911 verbatim do store
# F1.6 (ADR-0014/0015): PROVA DE BUSCA no device. O app chama a fronteira `search`
# (FTS5/BM25 do core via JSI) p/ "God" na KJV e LOCALIZA João 3:16 no retorno; o
# marcador é COMPOSTO do retorno real (ref de listBooks().nameEn; texto verbatim de
# hit.text, SEM os marcadores de controle HL). Aqui o script só confere substrings.
MARK_SEARCH_QUERY='TLA_SEARCH query="God"'   # busca executada via a fronteira (query "God")
MARK_SEARCH_REF="John 3:16"                  # referência do hit (composta do retorno)
MARK_SEARCH_TEXT="For God so loved"          # texto KJV verbatim do store (sem HL markers)
# F1.9 (ADR-0016): PROVA DE XREF no device. O app chama a fronteira `cross_refs`
# (the_light_core::xref via JSI) p/ João 3:16 e compõe o marcador do RETORNO REAL: a
# ref do top por votos (listBooks().nameEn + cap:verso) e os votos (via String()).
# Filtradas as xrefs cujo destino sai do subset {Gn,Sl,Jo}, o top dentro do subset é
# um versículo de João (João 3:15, ~439 votos). Aqui o script só confere substrings/
# padrões: query de João 3:16, count>=1 e first_ref de um livro do subset.
MARK_XREF_VERSE='TLA_XREF verse="John 3:16"'  # xref de João 3:16 via a fronteira cross_refs
# F1.11 (ADR-0017): PROVA DE NOTAS/HIGHLIGHTS + PERSISTÊNCIA no device. O app exercita
# a fronteira `userdata` (the_light_core::userdata via JSI) num dir de teste ISOLADO sob
# documentDirectory: put_note → get_note/list_notes (round-trip) → add_highlight →
# list_highlights → 2ª leitura INDEPENDENTE (persistência). O marcador é COMPOSTO do
# RETORNO real: a ref da nota de João 3:16 (list_notes/get_note), o nº de highlights
# (list_highlights, >=1) e persisted=true (2ª leitura). Aqui o script só confere
# padrões: nota por ref "John 3:16", highlights>=1 e persisted=true.
MARK_NOTES_REF='TLA_NOTES note_ref="John 3:16"'  # nota de João 3:16 via a fronteira userdata

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

# ── Banco de leitura bundled (F1.3/ADR-0014) ─────────────────────────────────
# O bundle empacota o subset de leitura via o SYMLINK app/assets/data/reading-sample.sqlite
# → assets/data/reading-sample.sqlite (gerado-ignorado). Se ausente, (re)gera a
# partir do bible.sqlite (idempotente; reprodutível) p/ a prova de leitura ser
# independente. Sem isso, o Metro não resolve o asset e o marcador TLA_READ some.
if [ ! -f "$ROOT/assets/data/reading-sample.sqlite" ]; then
  echo "==> reading-sample.sqlite ausente — gerando (ADR-0014)"
  "$ROOT/scripts/gen-reading-sample-db.sh"
fi

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
# `--clear` (F1.3): reseta o cache do Metro a cada prova. A F1.3 introduz novos
# módulos (reading*/db*/selftest) e o cache persistente pode servir um bundle
# DEFASADO (sintoma: o gancho de leitura não roda e o marcador TLA_READ some).
# Limpar o cache garante que o bundle servido reflete o disco (prova determinística).
echo "==> [3/5] Metro (EXPO_PUBLIC_TLA_SELFTEST=1, --clear) em background — log: $METRO_LOG"
( cd "$APP_DIR" && EXPO_PUBLIC_TLA_SELFTEST=1 CI=1 npx expo start --port 8081 --clear >"$METRO_LOG" 2>&1 ) &
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

# Captura o log unificado filtrando os marcadores TLA_* (parse=TLA_SELFTEST e
# leitura=TLA_READ — prefixo comum "TLA_"; robusto a formatação do RCTLog).
xcrun simctl spawn "$UDID" log stream --level debug --style compact \
  --predicate 'eventMessage CONTAINS "TLA_"' >"$STREAM_LOG" 2>/dev/null &
STREAM_PID=$!
sleep 2

xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null

# ── [5/5] Asserção: parse (PT+EN) + leitura + paralela + busca + xref + notas ──
echo "==> [5/5] Aguardando marcadores PT+EN + leitura + paralela + busca + xref + notas (até ${LAUNCH_WAIT}s)"
found=0
for _ in $(seq 1 "$LAUNCH_WAIT"); do
  if grep -qF "$MARK_PT" "$STREAM_LOG" \
    && grep -qF "$MARK_EN" "$STREAM_LOG" \
    && grep -qF "$MARK_READ_BOOKS" "$STREAM_LOG" \
    && grep -qF "$MARK_READ_TEXT" "$STREAM_LOG" \
    && grep -qF "$MARK_READ_CHAP" "$STREAM_LOG" \
    && grep -qF "$MARK_PARALLEL" "$STREAM_LOG" \
    && grep -qF "$MARK_PARALLEL_ALM" "$STREAM_LOG" \
    && grep -qF "$MARK_SEARCH_QUERY" "$STREAM_LOG" \
    && grep -qE 'TLA_SEARCH .*hits=[1-9][0-9]*' "$STREAM_LOG" \
    && grep -qF "$MARK_SEARCH_REF" "$STREAM_LOG" \
    && grep -qF "$MARK_SEARCH_TEXT" "$STREAM_LOG" \
    && grep -qF "$MARK_XREF_VERSE" "$STREAM_LOG" \
    && grep -qE 'TLA_XREF .*count=[1-9][0-9]*' "$STREAM_LOG" \
    && grep -qE 'first_ref="(Genesis|Psalm|Psalms|John) ' "$STREAM_LOG" \
    && grep -qF "$MARK_NOTES_REF" "$STREAM_LOG" \
    && grep -qE 'TLA_NOTES .*highlights=[1-9][0-9]*' "$STREAM_LOG" \
    && grep -qF 'persisted=true' "$STREAM_LOG"; then
    found=1
    break
  fi
  sleep 1
done

echo "----- marcadores capturados (simulador) -----"
grep -F "TLA_" "$STREAM_LOG" | sed 's/.*\(TLA_\)/\1/' | sort -u || true
echo "---------------------------------------------"

if [ "$found" != "1" ]; then
  echo "ERRO: marcadores de parse (PT/EN), leitura (TLA_READ), leitura paralela (TLA_PARALLEL + Almeida), busca (TLA_SEARCH: query=\"God\", hits>=1, João 3:16, \"For God so loved\"), xref (TLA_XREF: verse=\"John 3:16\", count>=1, first_ref de um livro do subset Genesis/Psalm(s)/John) e/ou notas (TLA_NOTES: note_ref=\"John 3:16\", highlights>=1, persisted=true) não apareceram em ${LAUNCH_WAIT}s." >&2
  exit 1
fi

# Reemite as linhas/asserções EXATAS p/ o bloco de verificação (grep no stdout).
echo "$MARK_PT"
echo "$MARK_EN"
grep -F "TLA_READ books=66" "$STREAM_LOG" | sed 's/.*\(TLA_READ\)/\1/' | head -1
grep -F "TLA_PARALLEL" "$STREAM_LOG" | sed 's/.*\(TLA_PARALLEL\)/\1/' | head -1
grep -F 'TLA_SEARCH query="God"' "$STREAM_LOG" | sed 's/.*\(TLA_SEARCH\)/\1/' | head -1
grep -F 'TLA_XREF verse="John 3:16"' "$STREAM_LOG" | sed 's/.*\(TLA_XREF\)/\1/' | head -1
grep -F 'TLA_NOTES note_ref="John 3:16"' "$STREAM_LOG" | sed 's/.*\(TLA_NOTES\)/\1/' | head -1
echo "==> OK — parse_reference (PT==EN), leitura (books=66, João 3:16 KJV verbatim, john_chapters=21), leitura PARALELA (João 3:16 KJV|Almeida 1911, ambos do store via get_chapter), busca (TLA_SEARCH: \"God\" via a fronteira search, João 3:16 + \"For God so loved\" verbatim do store, hits>=1), xref (TLA_XREF: João 3:16 via a fronteira cross_refs, count>=1, first_ref do subset + votos do retorno) E notas/highlights (TLA_NOTES: João 3:16 via a fronteira userdata, highlights>=1, persisted=true — 2ª leitura independente do disco) provados pelo Rust nativo via Turbo Module."
