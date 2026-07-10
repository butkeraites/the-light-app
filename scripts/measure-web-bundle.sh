#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/measure-web-bundle.sh — F5.3 (attempt 2: honest + reproducible)
#
# MÉTRICA DE PERFORMANCE do alvo WEB (repetível, headless, offline). Exporta o
# bundle web (`expo export --platform web`) e grava um ORÇAMENTO (budget) legível
# por máquina em `loop/perf/web-bundle-baseline.json`, usado como MÉTRICA DE RECORDE
# pelas tarefas seguintes de performance web (F5.6/F5.9/F5.19).
#
# DETERMINISMO — a verdade, sem enganação (o header antigo mentia dizendo que o hash
# do Metro é estável): o bundle web do Expo/Metro NÃO é byte-determinístico. O
# `baseJSBundle` do Metro atribui os IDs de módulo na ORDEM DE ITERAÇÃO do grafo
# (`graph.dependencies`), que varia entre execuções (montagem assíncrona do grafo);
# como ele emite os módulos ordenados por esse ID, cada run renumera os ~854 módulos
# de forma diferente → o entry-JS "eager" oscila ~122 B (raw) / ~1,7 KB (gzip) e o
# hash muda. Isso é UPSTREAM (Metro) e NÃO é corrigível sem regredir o app: um
# `createModuleIdFactory` determinístico e sem colisão exige IDs-hash grandes que
# INCHAM o bundle enviado (~2%), e um `customSerializer` quebraria o export web do
# Expo. Fazer o app mais pesado para facilitar a MEDIÇÃO seria errado numa tarefa de
# PERFORMANCE.
#
# Então a métrica separa, com honestidade, o que É estável do que NÃO é:
#   • Assets CONTENT-ADDRESSED (wasm da fronteira, DBs, engines wa-sqlite, sample):
#     BYTE-ESTÁVEIS — bytes crus + gzip(-9) EXATOS, reprodutíveis, verificados.
#   • Entry-JS "eager": `moduleCount` (contagem de `__d(`) é EXATA e independente da
#     ordem — a grandeza-alvo de budget do JS; os bytes crus/gzip são gravados como
#     NOMINAL ± TOLERÂNCIA documentada e RE-VERIFICADOS a cada run (falha se saírem
#     da faixa). Nenhum valor volátil é gravado → o JSON escrito é IDÊNTICO a cada run.
#
# Reprodutível: gzip via `zlib.gzipSync` level 9 (mtime=0 no header → bytes estáveis);
# nenhuma rede (só assets locais). Sai 0 se tudo bater com o budget; ≠0 se algum asset
# byte-estável mudar de conteúdo ou o entry-JS sair da tolerância (aí a baseline
# precisa ser atualizada deliberadamente).
#
# F5.17 (ADR-0045) — TRANSFER (over-the-wire), não só bytes-em-disco: após o export, o
# passo [2/4] PRÉ-COMPRIME os assets grandes (`scripts/compress-web-assets.sh` → `.gz`
# gzip-9 + `.br` brotli-11, zero-drift verificado) e o budget passa a gravar o TAMANHO
# DE TRANSFER (gzip + brotli) dos assets byte-estáveis, além do `firstPaintTransferBytes`
# (entry-JS eager comprimido — a headline de 1º paint). Os `.gz`/`.br` são artefatos de
# BUILD; a REDUÇÃO real over-the-wire depende de um host servir a variante com
# `Content-Encoding` (nginx `gzip_static`/`brotli_static`, Netlify, Cloudflare Pages…) —
# ver ADR-0045 / `loop/perf/SERVING.md`. Não afirmamos ganho em runtime que o `expo
# export` estático (sem servidor) não entrega sozinho.
#
# Uso:  ./scripts/measure-web-bundle.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
APP="$ROOT/app"
DIST="$APP/dist"
OUT_DIR="$ROOT/loop/perf"
OUT="$OUT_DIR/web-bundle-baseline.json"
COMPRESS_LIB="$ROOT/scripts/lib/web-compress.cjs"

[ -d "$APP" ] || { echo "ERRO: app/ não encontrado em $APP" >&2; exit 1; }

echo "==> [1/3] expo export --platform web (offline; só assets locais)"
rm -rf "$DIST"
( cd "$APP" && npx expo export --platform web )
[ -d "$DIST" ] || { echo "ERRO: export não gerou $DIST" >&2; exit 1; }

echo "==> [2/3] pré-comprimindo assets (.gz/.br) + verificando zero-drift"
"$ROOT/scripts/compress-web-assets.sh" "$DIST"

echo "==> [3/3] parseando $DIST -> $OUT (verificando budget + TRANSFER)"
mkdir -p "$OUT_DIR"

DIST_DIR="$DIST" DIST_REL="app/dist" OUT_FILE="$OUT" COMPRESS_LIB="$COMPRESS_LIB" node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { gzipBytes, brotliBytes } = require(process.env.COMPRESS_LIB);

const DIST = process.env.DIST_DIR;
const DIST_REL = process.env.DIST_REL;
const OUT = process.env.OUT_FILE;

// ── ORÇAMENTO (budget) — a métrica de recorde. Valores byte-ESTÁVEIS são EXATOS;
//    o entry-JS é NOMINAL ± TOLERÂNCIA (Metro não é byte-determinístico, ver header).
//    Quando uma tarefa mudar o app de propósito, estas constantes são atualizadas. ──
const BUDGET = {
  // Assets content-addressed (byte-estáveis) — bytes crus EXATOS esperados.
  //
  // NOTA F5.12 (ADR-0041): REMOVIDOS do budget o `waSqliteNpm` (build ASYNC do npm
  // wa-sqlite, 558.343 B) e o `sampleDb` (`sample.sqlite` de 1 versículo da F0.10,
  // 131.072 B) — eram um DUPLICADO MORTO só do caminho F0.10 (home → `passage.web`
  // → `sqlite-opfs.web`). A home passou a REUSAR o store de leitura (build vendorado
  // wa-sqlite+FTS5 `waSqliteFts5`, superset, + subset `readingDb`), então esses 2
  // assets NÃO são mais emitidos no `dist` (−689.415 B). O script FALHA se
  // reaparecerem (`sanity` abaixo).
  stable: {
    // F5.6: wasm agora é build RELEASE + wasm-opt -Oz (era DEBUG ~4,24 MB).
    // 4.244.884 -> 1.198.888 B (-71,8%). Byte-exato/determinístico (release+LTO+wasm-opt).
    // F5.10 (ADR-0037/0050) — re-baseline DELIBERADO 1.198.888 -> 1.223.324 B (+24.436, +2,0%):
    // a GERAÇÃO de planos de leitura virou cfg-free/PURA e passou a compilar na wasm da
    // fronteira sob `ai-pure` (`the_light_core::userdata::plans` + o parse de data `chrono`),
    // realizando a paridade web dos planos. NÃO é regressão: é a feature entrando no grafo wasm
    // (git-provável; determinístico em 3 exports: 1.223.324 B, gzip 440.559, br 319.679). O
    // PROGRESSO segue app-side (OPFS, chunk async `plans-fs`), fora do 1º paint.
    // ADR-0061 (deepening): 1.223.324 -> 1.223.313 B (-11 B; gzip 440.679, br 319.894). Os helpers
    // privados core_err/parse_lang (cfg-livres, usados pelas fns web-prepare ai-pure) entram no wasm
    // e a de-duplicacao encolheu o binario; with_store/with_source sao cfg(not wasm32) (grafo puro).
    // Bindings .ts BYTE-IDENTICOS (nenhum simbolo exportado mudou). Espelhado em web-bundle-budget.json.
    frontierWasm: { bytes: 1223313, re: /^assets\/web\/generated\/wasm-bindgen\/index_bg\..*\.wasm$/ },
    // F5.15 (ADR-0044): o `reading-sample.sqlite` COMBINADO (14.409.728 B) SAIU do dist
    // web. A LEITURA agora usa `reading-lite.sqlite` (SEM léxico) e o DADO do léxico virou
    // `lexicon-sample.sqlite` (9.502.720 B), carregado ON-DEMAND (chunk async
    // `sqlite-lexicon-opfs`, só ao abrir estudo/léxico) — FORA do caminho de leitura.
    // Ambos byte-estáveis (derivados de forma determinística por gen-reading-sample-db.sh).
    //
    // F5.36 (ADR-0056) — re-baseline DELIBERADO/justificado 4.530.176 → 40.308.736 B
    // (+35,78 MB): o `reading-lite.sqlite` passou de um SAMPLE de dev de 3 livros
    // (Gênesis/Salmos/João) para a Bíblia COMPLETA — 66 livros × 2 traduções (KJV +
    // Almeida 1911) — corrigindo o bug "Mateus 1 indisponível" e cobrindo busca/xref na
    // Bíblia inteira. NÃO é regressão de 1º paint: este asset é carregado ON-DEMAND
    // (fetch → OPFS, F5.3), NUNCA no entry EAGER — o `moduleCount` fica 840 EXATO
    // (verificado) e os bytes/gzip/brotli do entry NÃO mudam. O léxico segue AMOSTRADO
    // ({Gn,Sl,Jo}, `lexicon-sample.sqlite` inalterado; completo = follow-up F5.38). É DADO
    // local (byte-estável, determinístico por gen-reading-sample-db.sh) — offline-first
    // preservado (download único cacheado em OPFS, sem rede em runtime para ler).
    readingLiteDb: { bytes: 40308736, re: /^assets\/_assets\/data\/reading-lite\..*\.sqlite$/ },
    // F6.9 — re-baseline DELIBERADO/justificado: SÓ este asset ON-DEMAND muda 9.502.720 →
    // 27.869.184 B (+18,37 MB). O léxico interlinear deixou de ser um SAMPLE de 3 livros
    // ({Gn,Sl,Jo}) e passou a cobrir o NOVO TESTAMENTO INTEIRO (livros 40..=66,
    // Mateus..Apocalipse) + Gn/Sl do AT amostrado — `LEXICON_BOOKS` em
    // `core/examples/gen_reading_sample_db.rs`. Dados VERBATIM do `bible.sqlite` (STEP Bible
    // CC-BY; INSERT..SELECT FROM src): +~126k `original_tokens` do NT (182.288 total) e o
    // `lexicon` referenciado (4.534 → 9.061 linhas). NÃO é regressão de 1º paint: carregado
    // ON-DEMAND (fetch → OPFS, chunk async `sqlite-lexicon-opfs`, só ao abrir estudo/léxico),
    // NUNCA no entry EAGER — moduleCount fica 842 EXATO e os bytes/gzip/brotli do entry NÃO
    // mudam. `reading-lite.sqlite` (leitura, SEM léxico) INALTERADO (40.308.736 B). Léxico
    // AT completo (~90 MB AT+NT) segue follow-up (on-demand). Espelhado em
    // `loop/perf/web-bundle-budget.json` (nota `noteF69`).
    lexiconDb: { bytes: 27869184, re: /^assets\/_assets\/data\/lexicon-sample\..*\.sqlite$/ },
    waSqliteFts5: { bytes: 666267, re: /^assets\/web\/vendor\/wa-sqlite-fts5\/wa-sqlite\..*\.wasm$/ },
  },
  // F5.12 (ADR-0041) · F5.15 (ADR-0044): assets que DEVEM ter saído do bundle (dead-weight
  // removido / substituído). O budget FALHA se qualquer um reaparecer no `dist`.
  removed: {
    waSqliteNpm: /^assets\/node_modules\/wa-sqlite\/dist\/wa-sqlite\..*\.wasm$/,
    sampleDb: /^assets\/_assets\/data\/sample\..*\.sqlite$/,
    // F5.15: o combinado (com léxico) foi substituído pelo split reading-lite+lexicon.
    readingSampleCombined: /^assets\/_assets\/data\/reading-sample\..*\.sqlite$/,
  },
  // Entry-JS "eager" (NÃO byte-determinístico). moduleCount é EXATO; bytes/gzip crus
  // são nominal ± tolerância. Tolerâncias folgadas o suficiente p/ o flutter upstream
  // do Metro, apertadas o suficiente p/ pegar regressão real (moduleCount pega mudanças
  // estruturais como code-split de forma EXATA).
  //
  // NOTA F5.9 (re-centragem pós-CODE-SPLIT + dívida F5.7/F5.8): a F5.9 moveu os
  // transportes PESADOS (a factory do wa-sqlite + store OPFS de leitura, a IA
  // `ai-anchored`, o estudo/léxico `study`, a conversa `session`, a busca/xref e o
  // userdata) do chunk EAGER de `entry` para CHUNKS ASYNC sob demanda (via `import()`
  // no glue `app/web/reading.web.ts`). Efeito medido: moduleCount 856 → 844;
  // eagerBytes 1.448.032 → 1.381.059; eagerGzip 372.625 → 352.644.
  //
  // NOTA F5.12 (ADR-0041) — re-centragem pós dead-asset removal + split de `passage.web`:
  // a F5.12 (a) removeu o DUPLICADO MORTO do caminho F0.10 (npm `wa-sqlite.wasm` 558 KB +
  // `sample.sqlite` 131 KB) apontando a home p/ o store de leitura (build vendorado FTS5
  // + subset), e (b) moveu `passage.web` (glue do getPassage, só usado no submit) do chunk
  // EAGER p/ um chunk ASYNC (`import()` em `app/app/index.tsx` + no próprio glue, molde
  // F5.9). A 2ª factory wa-sqlite (npm) que seguia EAGER via `passage.web`→`sqlite-opfs.web`
  // deixou o entry. Efeito medido (3 exports; moduleCount EXATO estável, bytes com flutter
  // upstream ~122 B raw / ~1,7 KB gzip):
  //   • moduleCount  844 → 834 (−10; `passage.web`+`sqlite.web`+glue saíram do entry);
  //   • eagerBytes   1.381.059 → 1.306.320 (−74.739 B, −5,4%; nominal = centro do flutter);
  //   • eagerGzip      352.644 →   331.038 (−21.606 B, −6,1%; nominal = centro do flutter);
  //   • assets do bundle: −689.415 B (o npm wa-sqlite async + o sample.sqlite deixaram o dist).
  // O restante do entry é o baseline de 1º paint (React Native Web + React + expo-router +
  // a glue wasm-bindgen da fronteira + i18n/tema). A lógica de tolerância (só p/ o entry-JS
  // volátil, não p/ o wasm) fica intacta.
  //
  // NOTA F5.15 (ADR-0044) — split do DADO do léxico FORA do caminho de leitura: o
  // `reading-sample.sqlite` combinado (14.409.728 B, com léxico) deixou o dist web e virou
  // DOIS assets — `reading-lite.sqlite` (4.530.176 B, leitura/busca/xref SEM léxico) +
  // `lexicon-sample.sqlite` (9.502.720 B, léxico STEP CC-BY carregado ON-DEMAND no chunk
  // async `sqlite-lexicon-opfs`, só ao abrir estudo/léxico). O entry EAGER (1º paint) não
  // referencia NENHUM dos dois (herdado do code-split F5.9 dos stores OPFS): só "descem"
  // ao abrir capítulo (reading-lite) ou estudo/léxico (lexicon-sample). moduleCount do
  // entry INALTERADO (o novo store de léxico é chunk async, não eager). A pré-compressão
  // (F5.17) segue fora do escopo.
  // F5.15 (ADR-0044): +3 módulos EAGER (837, era 834) — a glue LEVE do novo store de
  // léxico on-demand + o wiring do `import()` dinâmico de `sqlite-lexicon-opfs` em
  // `reading.web.ts`. NÃO é a factory pesada do wa-sqlite (essa segue em chunk async;
  // verificado: MemoryVFS/SQLiteESMFactory/vfs_register AUSENTES do entry).
  //
  // NOTA F5.17 (ADR-0045) — re-centragem + TRANSFER do entry: (a) o estrutural NÃO mudou
  // (moduleCount 837 EXATO; a F5.17 só adiciona build/serving/medição, não toca o app);
  // (b) re-centramos os nominais raw/gzip ao CENTRO do flutter upstream do Metro NESTE
  // ambiente (medido em 4 exports: moduleCount 837 estável; raw 1.314.209–1.314.331; gzip
  // 332.032–333.735; brotli 262.517–262.760) — o nominal antigo (1.312.001) ficara ~2,3 KB
  // abaixo por drift de versão do Metro/Expo, não por mudança do app; (c) adicionamos
  // `eagerBrotliBytes` (o entry servido com `Content-Encoding: br`). O `firstPaintTransfer`
  // (headline de 1º paint over-the-wire) = eagerGzip (piso universal) / eagerBrotli (default
  // moderno). Tolerâncias folgadas p/ o flutter, apertadas p/ pegar regressão real.
  //
  // NOTA F5.19 (ADR-0047) — LOCK do orçamento + re-baseline do moduleCount 837 → 838:
  // a F5.18 (ADR-0046) extraiu os TOKENS de cor p/ um módulo PURO novo
  // (`app/lib/themePalettes.ts`, importado por `app/lib/theme.ts`, que é EAGER no 1º
  // paint) — +1 módulo EAGER estrutural (837 → 838; verificado determinístico em 2+
  // exports). A F5.18 só rodou `expo export` (exit 0), NÃO o `measure-web-bundle.sh`, então
  // essa drift ESTRUTURAL passou sem ser vista — é EXATAMENTE a regressão que esta guarda
  // trava. Re-baseline DELIBERADO/justificado (git-provável: +1 módulo exato). Os bytes NÃO
  // mudaram de forma relevante: o wrapper `__d(...)` extra (~600 B raw) é absorvido pela
  // banda ±1024 do eagerBytes; os centros de gzip/brotli não se moveram (boilerplate
  // altamente compressível) → bandas re-verificadas, mantidas. Este é o LOCK final do
  // workstream perf: os limites abaixo são o CONTRATO congelado (espelhado em
  // `loop/perf/web-bundle-budget.json`, cross-check por `scripts/check-web-bundle-budget.sh`).
  //
  // NOTA F5.10 (ADR-0037/0050) — re-baseline DELIBERADO pós-paridade web dos planos:
  // (a) ESTRUTURAL moduleCount 838 → 839 (+1 módulo eager EXATO, determinístico em 3 exports):
  //     a tela `/plans` deixou de degradar no web (o `PlansWebNotice` saiu) e passou a montar a
  //     UI real (geração cfg-free + progresso OPFS), puxando +1 módulo eager de `plans/index`.
  //     O progresso OPFS (`plans-fs.web`) é chunk ASYNC (import() no `reading.web.ts`), NÃO
  //     eager. (b) BYTES re-centrados no centro do flutter do Metro medido em 3 exports
  //     (raw 1.324.748–1.324.870; gzip 334.428–336.118; brotli 264.620–264.644) — a +1 módulo
  //     e o glue leve de planos somam ~10,5 KB raw / ~2,4 KB gzip ao entry; tolerâncias
  //     INALTERADAS (magnitude do flutter igual). NÃO é regressão: é a feature de paridade web.
  // NOTA F5.26 (ADR-0054) — re-baseline SÓ de BYTES do entry (moduleCount INALTERADO 839):
  // a seção de SINCRONIZAÇÃO opt-in + backup (F5.26) adicionou ~40 chaves de CROMO (PT+EN)
  // ao catálogo i18n EAGER (`app/lib/i18n.ts`, no 1º paint) — aviso de privacidade
  // (o que sincroniza vs. o que nunca sai do aparelho), "funciona 100% offline sem isto",
  // rótulos/a11y dos controles. NÃO é regressão estrutural: os MOTORES pesados
  // (snapshotStore/driveAuth/driveSync/userdataSnapshot + o painel `SyncSettings`) são
  // `import()` SOB DEMANDA (chunk ASYNC) — moduleCount fica 839 EXATO (verificado em 3
  // exports). Só o TEXTO localizado cresceu no entry: +~5,6 KB raw / +~1,4 KB brotli
  // (gzip dentro da banda antiga). Nominais re-centrados no centro do flutter medido em 3
  // exports (raw 1.330.341–1.330.463; gzip 336.014–337.681; brotli 265.994–266.218);
  // tolerâncias INALTERADAS. Espelhado em `loop/perf/web-bundle-budget.json`.
  // NOTA F5.35 (ADR-0055) — re-baseline DELIBERADO/justificado: +1 rota EAGER (tela SOBRE).
  //   (a) ESTRUTURAL moduleCount 839 -> 840 (+1 modulo eager EXATO, 3 exports IDENTICOS): a nova
  //       rota `app/app/about.tsx` (creditos/licencas das 4 fontes + principios offline-first/
  //       BYOK/anti-alucinacao + provedores + atalho de backup) entra no require.context do
  //       expo-router (web output:static = todas as rotas eager). O painel `SyncSettings` que ela
  //       reusa segue `import()` SOB DEMANDA (chunk ASYNC, NAO eager). NAO e regressao: e a feature.
  //   (b) BYTES: a rota + ~18 chaves de CROMO (PT+EN, incl. 2 identificadores de licenca CC-BY
  //       verbatim) somam ~10,4 KB raw / ~1,7 KB brotli ao entry. Nominais re-centrados nos valores
  //       medidos em 3 exports DETERMINISTICOS (raw 1.340.803; gzip 338.708; brotli 267.845);
  //       tolerancias INALTERADAS. Espelhado em `loop/perf/web-bundle-budget.json` (nota `noteF535`).
  // NOTA F5.37 (ADR-0057) — re-baseline DELIBERADO: ESTRUTURAL moduleCount 840 -> 841 (+1 modulo
  //   eager EXATO). A F5.37 (clareza de UX do gating de IA) adicionou `app/components/AiProviderNotice.tsx`
  //   (aviso 'recurso usa IA — configure provedor' nos 4 paineis de IA + reassurance offline),
  //   importado pelas rotas de leitura (eager no web output:static). NAO e regressao: e a feature.
  //   BYTES do entry DENTRO da tolerancia antiga (componente + ~8 chaves i18n na banda ±; nominais
  //   re-centrados). A revisao da F5.37 nao rodou perf-budget -> drift (moduleCount E bytes);
  //   corrigida aqui c/ a F5.38. BYTES: +~4,8 KB raw / ~1,0 KB brotli (componente + ~8 chaves i18n);
  //   eagerBytes 1.340.803 -> 1.345.650; gzip 338.708 -> 339.903; brotli 267.845 -> 268.816
  //   (export deterministico; tolerancias INALTERADAS). Follow-up: AiProviderNotice lazy p/ sair do eager.
  // NOTA F6.6 (ADR-0023/0025) — re-baseline DELIBERADO: +1 rota EAGER (tela AJUSTES / chaves BYOK).
  //   (a) ESTRUTURAL moduleCount 841 -> 842 (+1 modulo eager EXATO): a nova rota `app/app/settings.tsx`
  //       (hub canonico de chave BYOK — 1 linha por provedor Claude/GPT/Gemini/Ollama com status
  //       so-nomes via `listProviders`, input secure `setKey`, remover `deleteKey` + aviso web-so-sessao
  //       ADR-0025) entra no require.context do expo-router (web output:static = todas as rotas eager).
  //       NAO e regressao: e a feature (destrava o CTA 'configurar provedor' dos 4 paineis de IA).
  //   (b) BYTES: a rota + ~14 chaves de CROMO (PT+EN) somam ~8,6 KB raw / ~1,4 KB brotli ao entry.
  //       Nominais re-centrados no centro do flutter medido em exports (raw 1.354.190-1.354.316; gzip
  //       341.813-343.587; brotli 270.160-270.371); tolerancias INALTERADAS. Espelhado em
  //       `loop/perf/web-bundle-budget.json` (nota `noteF66`).
  // NOTA F6.7+F6.8 — re-baseline SO de BYTES do entry (moduleCount INALTERADO 842): a F6.7 (seletor
  //   de provedor real em Study/Chat) + F6.8 (rotulos de capacidade + chaves settings.cap*) cresceram
  //   ~4,8 KB raw de CROMO eager sem rodar perf-budget (specs sem o gate; mesmo padrao do noteF537).
  //   eagerBytes re-centrado 1.354.253 -> 1.358.977 (centro do flutter: 1.358.914/1.359.039);
  //   gzip/brotli seguem na banda antiga (nominais inalterados). Detectado na F6.9 (lexicon on-demand,
  //   nao-eager: asset velho de 3 livros da o MESMO eager -> drift anterior a F6.9). Driver autorizado.
  // NOTA ADR-0059 — re-baseline DELIBERADO: ESTRUTURAL moduleCount 842 -> 845 (+3 modulos eager EXATOS):
  //   o seam compartilhado dos 4 paineis de IA extraiu `app/lib/errMessage.ts` + `app/lib/aiProviders.ts`
  //   + `app/components/ProviderPicker.tsx` (importados pelos paineis, que sao eager nas rotas de leitura
  //   web output:static). NAO e regressao: e a de-duplicacao (o codigo inline duplicado saiu dos 4 paineis
  //   para 3 modulos compartilhados). BYTES do entry ficam DENTRO da banda existente (o LOC liquido CAIU
  //   apesar do +3 modulos): live raw 1.358.705 / gzip 342.914 / brotli 270.989 — todos dentro dos nominais
  //   ±tolerancia atuais, entao SO o moduleCount e re-baseado. Espelhado em loop/perf/web-bundle-budget.json.
  // NOTA ADR-0060 — re-baseline DELIBERADO: ESTRUTURAL moduleCount 845 -> 847 (+2 modulos eager EXATOS):
  //   a extracao de `useChapterReader` da tela do capitulo adicionou `app/lib/useChapterReader.ts` (hook,
  //   ~230 linhas) + `app/lib/verseMarkers.ts` (reducao pura), importados por [chapter].tsx (rota eager
  //   web output:static). NAO e regressao: e a extracao dos 7 efeitos de fetching + reducao de userdata
  //   para uma seam profunda testavel. BYTES do entry re-centrados nos valores MEDIDOS (2 exports IDENTICOS
  //   -> deterministicos): raw 1.359.705 / gzip 345.110 / brotli 271.513 (a codigo do hook ~2,4 KB gzip
  //   estourou a banda antiga de gzip/brotli). Tolerancias INALTERADAS. Espelhado em web-bundle-budget.json.
  //
  // NOTA ADR-0068 Fase 5 (kit Vigil — icones reais) — re-baseline DELIBERADO/justificado:
  //   ESTRUTURAL moduleCount 847 -> 911 (+64 modulos eager EXATOS): o `Icon` do kit deixou os glifos
  //   Unicode (Fase 1) e passou a usar o set FEATHER de `@expo/vector-icons` (subpath import, so o
  //   Feather — nao o barril com todos os sets). O Icon e importado por ListRow/Button/IconButton/
  //   CitedText, eager nas rotas de leitura -> a infra do vector-icons (createIconSet + base Text-icon
  //   do react-native-vector-icons + glyphMap Feather) entra no entry. NAO e regressao: e a feature
  //   (icones profissionais no lugar de ›/❖/✧/⚇/☷). BYTES do entry re-centrados no MEDIDO (1 export;
  //   moduleCount e EXATO/deterministico; bytes dentro do flutter): raw 1.359.705 -> 1.425.377
  //   (+65.672, ~+64 KB); gzip 345.110 -> 366.056 (+20.946); brotli 271.513 -> 289.318 (+17.805).
  //   Custo de 1º paint aceito (app local-first, download unico; icones sao upgrade visual central).
  //   Tolerancias INALTERADAS. Espelhado em web-bundle-budget.json (noteADR0068Fase5).
  //
  // NOTA ADR-0070 (deepening — costura do seletor de versao + navegacao de leitura) — re-baseline
  //   DELIBERADO/justificado: ESTRUTURAL moduleCount 911 -> 914 (+3 modulos eager EXATOS). A resolucao
  //   de versao duplicada nas telas virou 3 modulos compartilhados eager: `lib/useTranslations.ts`
  //   (carregador unico), `lib/useVersionSelection.ts` (hook-costura) e `lib/readingNav.ts` (hrefs com
  //   `version` obrigatorio), importados por Home/Busca/Leitor (rotas eager, web output:static);
  //   `lib/translationDefault.ts` ganhou as funcoes puras mas NAO e modulo novo. NAO e regressao: e a
  //   DE-DUPLICACAO (o LOC liquido CAI). BYTES do entry INALTERADOS (3 modulos pequenos puros/hook,
  //   dentro da banda existente) — so o moduleCount re-baseado. Tolerancias INALTERADAS. Espelhado em
  //   web-bundle-budget.json (noteADR0070).
  //
  // NOTA ADR-0071 (deepening — costura dos gestos de virar-capítulo) — re-baseline DELIBERADO:
  //   ESTRUTURAL moduleCount 914 -> 916 (+2 modulos eager EXATOS). Os 3 efeitos de `window` (teclado/
  //   clique-lateral/swipe) da tela do capitulo viraram `lib/useChapterTurnGestures.ts` (hook) +
  //   `lib/gestureNav.ts` (decisoes puras swipeIntent/sideNavZone), importados pela rota de leitura
  //   (eager, web output:static). NAO e regressao: e a extracao (o LOC liquido cai; a cinematica do
  //   swipe/zona ganha teste headless). BYTES do entry INALTERADOS. Tolerancias INALTERADAS. Espelhado
  //   em web-bundle-budget.json (noteADR0071).
  //
  // NOTA ADR-0073 (deepening — prefs.shared / keystore.shared) — re-baseline DELIBERADO: ESTRUTURAL
  //   moduleCount 916 -> 918 (+2 modulos eager EXATOS). O corpo copiado byte-a-byte de prefs.ts/
  //   prefs.web.ts e keystore.ts/keystore.web.ts (namespacing + validacao BYOK) virou os modulos
  //   profundos `lib/prefs.shared.ts` + `lib/keystore.shared.ts`; cada leaf traz so o backend. Ambos
  //   eager (i18n usa prefs; os paineis de IA/settings usam keystore). NAO e regressao: e a DE-
  //   DUPLICACAO (o LOC liquido cai). BYTES do entry INALTERADOS. Tolerancias INALTERADAS. Espelhado
  //   em web-bundle-budget.json (noteADR0073).
  //
  // NOTA ADR-0074 (deepening — AttributionBlock CC-BY) — re-baseline DELIBERADO: ESTRUTURAL moduleCount
  //   918 -> 920 (+2 modulos eager EXATOS). A atribuicao STEP CC-BY (constante + fallback + render)
  //   duplicada em ReaderStudyPanel/ReaderInterlinearPanel (com import painel->painel de
  //   STEP_ATTRIBUTION) virou `lib/attribution.ts` (constante + attributionLinesFrom) + o kit
  //   `components/ui/AttributionBlock.tsx`, importados pelos 2 paineis (eager nas rotas de leitura).
  //   NAO e regressao: e a DE-DUPLICACAO (o LOC liquido cai; some o import painel->painel). BYTES do
  //   entry INALTERADOS. Tolerancias INALTERADAS. Espelhado em web-bundle-budget.json (noteADR0074).
  //
  // NOTA ADR-0075 (deepening — resolveDidYouMean, orquestracao do zero-path da busca) — re-baseline
  //   DELIBERADO: ESTRUTURAL moduleCount 920 -> 921 (+1 modulo eager EXATO). A montagem inline do
  //   "voce quis dizer?" (sonda + fuzzy + composicao) no efeito da tela virou `lib/searchIntent.ts`
  //   (funcao pura com ports injetados), importado por app/app/search/index.tsx (rota eager). NAO e
  //   regressao: e a extracao da orquestracao (que nao tinha teste) p/ uma costura testavel; timing/
  //   duas-fases inalterados. BYTES do entry INALTERADOS. Tolerancias INALTERADAS. Espelhado em
  //   web-bundle-budget.json (noteADR0075).
  entry: {
    glob: '_expo/static/js/web/entry-*.js',
    moduleCount: 921,
    eagerBytes: { nominal: 1425377, tolerance: 1024 },
    eagerGzipBytes: { nominal: 366056, tolerance: 2048 },
    eagerBrotliBytes: { nominal: 289318, tolerance: 1024 },
  },
};

// ── Helpers ──
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}
const all = walk(DIST).sort();
const relToDist = (abs) => path.relative(DIST, abs).split(path.sep).join('/');
const relOut = (abs) => DIST_REL + '/' + relToDist(abs);
function sizes(abs) {
  const buf = fs.readFileSync(abs);
  // gzip -9 + brotli -q11 determinísticos (mesmos parâmetros do compress-web-assets.sh,
  // via scripts/lib/web-compress.cjs) → tamanho de TRANSFER byte-estável p/ assets
  // content-addressed (F5.17).
  return { bytes: buf.length, gzipBytes: gzipBytes(buf), brotliBytes: brotliBytes(buf) };
}
function match(re) {
  return all.filter((f) => re.test(relToDist(f)));
}
function one(re) {
  const ms = match(re);
  if (ms.length === 0) throw new Error('nenhum asset casou ' + re);
  return ms[0];
}

const failures = [];

// ── Assets byte-estáveis: bytes + TRANSFER (gzip + brotli) EXATOS, verificados contra
//    o budget. Por serem content-addressed (byte-estáveis), gzip/brotli são
//    determinísticos → gravados EXATOS (F5.17). ──
const stableAssets = {};
let stableBytes = 0;
let stableGzip = 0;
let stableBrotli = 0;
for (const [name, spec] of Object.entries(BUDGET.stable)) {
  const abs = one(spec.re);
  const s = sizes(abs);
  stableAssets[name] = {
    path: relOut(abs),
    bytes: s.bytes,
    gzipBytes: s.gzipBytes,
    brotliBytes: s.brotliBytes,
  };
  stableBytes += s.bytes;
  stableGzip += s.gzipBytes;
  stableBrotli += s.brotliBytes;
  if (s.bytes !== spec.bytes) {
    failures.push(`${name}: bytes ${s.bytes} != esperado ${spec.bytes} (conteúdo mudou? atualize a baseline)`);
  }
}

// ── F5.12 (ADR-0041): assets MORTOS que devem ter saído do bundle. Se algum
//    reaparecer no `dist`, o dead-asset removal regrediu → FALHA. ──
for (const [name, re] of Object.entries(BUDGET.removed)) {
  if (match(re).length > 0) {
    failures.push(`${name}: asset REMOVIDO (F5.12) reapareceu no dist (${re}) — regressão do dead-asset removal`);
  }
}

// ── Entry-JS "eager": moduleCount EXATO; raw/gzip verificados dentro da tolerância. ──
const entryRe = new RegExp('^' + BUDGET.entry.glob.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$');
const entryAbs = one(entryRe);
const entryText = fs.readFileSync(entryAbs, 'utf8');
const observedModuleCount = (entryText.match(/__d\(/g) || []).length;
const entrySizes = sizes(entryAbs);
const observedBytes = entrySizes.bytes;
const observedGzip = entrySizes.gzipBytes;
const observedBrotli = entrySizes.brotliBytes;

if (observedModuleCount !== BUDGET.entry.moduleCount) {
  failures.push(`entryJs.moduleCount ${observedModuleCount} != esperado ${BUDGET.entry.moduleCount}`);
}
const inBand = (v, b) => Math.abs(v - b.nominal) <= b.tolerance;
if (!inBand(observedBytes, BUDGET.entry.eagerBytes)) {
  failures.push(
    `entryJs eagerBytes ${observedBytes} fora de ${BUDGET.entry.eagerBytes.nominal}±${BUDGET.entry.eagerBytes.tolerance}`,
  );
}
if (!inBand(observedGzip, BUDGET.entry.eagerGzipBytes)) {
  failures.push(
    `entryJs eagerGzipBytes ${observedGzip} fora de ${BUDGET.entry.eagerGzipBytes.nominal}±${BUDGET.entry.eagerGzipBytes.tolerance}`,
  );
}
if (!inBand(observedBrotli, BUDGET.entry.eagerBrotliBytes)) {
  failures.push(
    `entryJs eagerBrotliBytes ${observedBrotli} fora de ${BUDGET.entry.eagerBrotliBytes.nominal}±${BUDGET.entry.eagerBrotliBytes.tolerance}`,
  );
}

// ── Documento gravado — SÓ valores estáveis (assets byte-estáveis + moduleCount) e
//    constantes de budget. Nenhum valor volátil (bytes/gzip/hash crus do entry-JS,
//    contagem de arquivos) entra aqui → o JSON é IDÊNTICO a cada execução. ──
const doc = {
  metric: 'web-bundle-baseline',
  task: 'F5.3',
  description:
    'Orçamento (budget) do bundle web do The Light App. HONESTO sobre determinismo: os ' +
    'assets content-addressed (wasm da fronteira, subset de leitura, engine wa-sqlite+FTS5) ' +
    'são BYTE-ESTÁVEIS e gravados EXATOS (bytes crus + TRANSFER gzip/brotli); o entry-JS ' +
    '"eager" NÃO é byte-determinístico (Metro renumera os módulos em ordem de grafo não- ' +
    'determinística — flutter ~122 B raw / ~1,7 KB gzip entre runs) e é gravado como ' +
    'moduleCount EXATO + bytes/gzip/brotli NOMINAL ± TOLERÂNCIA, re-verificados a cada run. ' +
    'Assim este JSON é reprodutível (idêntico byte-a-byte a cada `scripts/measure-web-bundle.sh`) ' +
    'sem inchar o bundle enviado. F5.17 (ADR-0045): as colunas gzip/brotli são o TAMANHO DE ' +
    'TRANSFER (over-the-wire) — realizado quando o host serve a variante pré-comprimida com ' +
    'Content-Encoding (ver `serving`). Métrica de recorde para F5.6/F5.9/F5.19. Offline: assets ' +
    'locais (sem rede).',
  generatedBy: 'scripts/measure-web-bundle.sh',
  distDir: DIST_REL,
  determinism: {
    stableAssets: 'byte-exact (content-addressed) — bytes + gzip + brotli EXATOS',
    entryJs:
      'NÃO byte-determinístico (Metro module-id em ordem de grafo async) — moduleCount ' +
      'exato + bytes/gzip/brotli nominal±tolerância, re-verificados',
  },
  // F5.17 (ADR-0045): estratégia de serving que TORNA REAL o transfer size. Os `.gz`/`.br`
  // são artefatos de BUILD (emitidos por scripts/compress-web-assets.sh); a REDUÇÃO
  // over-the-wire só acontece quando um host serve a variante com Content-Encoding.
  serving: {
    precompressed: '.gz (gzip -9) + .br (brotli -q11) emitidos ao lado dos assets (zero-drift verificado)',
    contentEncoding:
      'transfer size REALIZADO só quando o host serve a variante pré-comprimida (nginx ' +
      'gzip_static/brotli_static, Netlify, Cloudflare Pages, Vercel…). O `expo export` ' +
      'estático (sem servidor) NÃO seta Content-Encoding sozinho — ver loop/perf/SERVING.md.',
    caching:
      'assets content-hashed (name.<hash>.ext) → seguros p/ Cache-Control: public, ' +
      'max-age=31536000, immutable. HTML/entry: cache curto/revalidação.',
    offlineFirst:
      'preservado — assets LOCAIS same-origin; o browser descomprime transparente, o ' +
      'fetch() do app devolve os bytes ORIGINAIS (byte-idênticos). Sem CDN/servidor externo.',
    docs: 'ADR-0045 · loop/perf/SERVING.md',
  },
  // Convenience plana (bytes crus + TRANSFER dos assets byte-estáveis).
  frontierWasmBytes: stableAssets.frontierWasm.bytes,
  // F5.17 (ADR-0045): TRANSFER (over-the-wire) da wasm da fronteira — gzip (piso universal)
  // e brotli (default moderno). Byte-exatos (asset content-addressed).
  frontierWasmBytesGzip: stableAssets.frontierWasm.gzipBytes,
  frontierWasmBytesBrotli: stableAssets.frontierWasm.brotliBytes,
  // F5.15 (ADR-0044): `readingDbBytes` (combinado 14.409.728) foi SUBSTITUÍDO pelo split —
  // `readingLiteDbBytes` (leitura, SEM léxico) + `lexiconDbBytes` (léxico ON-DEMAND).
  readingLiteDbBytes: stableAssets.readingLiteDb.bytes,
  lexiconDbBytes: stableAssets.lexiconDb.bytes,
  waSqliteFts5Bytes: stableAssets.waSqliteFts5.bytes,
  // F5.17 (ADR-0045): HEADLINE de 1º paint OVER-THE-WIRE — o entry-JS eager COMPRIMIDO
  // (o que realmente desce no 1º paint quando servido com Content-Encoding). gzip = piso
  // universal (todo host/browser); brotli = default moderno (menor). Nominais (o entry
  // não é byte-determinístico), re-verificados a cada run dentro da tolerância.
  firstPaintTransferBytes: BUDGET.entry.eagerGzipBytes.nominal,
  firstPaintTransferBytesBrotli: BUDGET.entry.eagerBrotliBytes.nominal,
  // F5.12 (ADR-0041): `waSqliteNpmBytes`/`sampleDbBytes` REMOVIDOS — o npm wa-sqlite
  // async (558.343 B) e o `sample.sqlite` de 1 versículo (131.072 B) deixaram o dist.
  // F5.15 (ADR-0044): o `reading-sample.sqlite` combinado também deixou o dist web.
  removedAssets: Object.keys(BUDGET.removed),
  entryJs: {
    note:
      'Entry-JS "eager" carregado no 1º paint. moduleCount (nº de `__d(`) é EXATO e ' +
      'independe da ordem — a grandeza de budget do JS (code-split futuro a reduz de ' +
      'forma medível). eagerBytes/eagerGzipBytes/eagerBrotliBytes são NOMINAL ± TOLERÂNCIA ' +
      '(Metro não é byte-determinístico); o script mede o valor vivo e falha se sair da faixa. ' +
      'O gzip/brotli é o TAMANHO DE TRANSFER do 1º paint (ver firstPaintTransferBytes).',
    glob: BUDGET.entry.glob,
    moduleCount: observedModuleCount,
    eagerBytes: { nominal: BUDGET.entry.eagerBytes.nominal, tolerance: BUDGET.entry.eagerBytes.tolerance },
    eagerGzipBytes: {
      nominal: BUDGET.entry.eagerGzipBytes.nominal,
      tolerance: BUDGET.entry.eagerGzipBytes.tolerance,
    },
    eagerBrotliBytes: {
      nominal: BUDGET.entry.eagerBrotliBytes.nominal,
      tolerance: BUDGET.entry.eagerBrotliBytes.tolerance,
    },
  },
  assets: stableAssets,
  totals: {
    // Soma EXATA dos assets byte-estáveis (reprodutível) — bytes + TRANSFER gzip/brotli.
    stableAssetsBytes: stableBytes,
    stableAssetsGzipBytes: stableGzip,
    stableAssetsBrotliBytes: stableBrotli,
    // Total NOMINAL do dist (estáveis + entry-JS nominal); o entry-JS oscila ±tolerância.
    nominalTotalBytes: stableBytes + BUDGET.entry.eagerBytes.nominal,
    nominalTotalGzipBytes: stableGzip + BUDGET.entry.eagerGzipBytes.nominal,
    nominalTotalBrotliBytes: stableBrotli + BUDGET.entry.eagerBrotliBytes.nominal,
  },
};

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');

// ── Resumo (inclui o VIVO observado, p/ transparência) + PASS/FAIL. ──
const mb = (n) => (n / (1024 * 1024)).toFixed(2) + ' MB';
console.log('web-bundle-baseline — assets byte-estáveis (EXATO): raw / gzip / brotli (TRANSFER)');
for (const [name, a] of Object.entries(stableAssets)) {
  console.log(
    '  ' + name.padEnd(14) + String(a.bytes).padStart(10) + '  (' + mb(a.bytes) + ')  gzip ' +
      String(a.gzipBytes).padStart(9) + '  br ' + String(a.brotliBytes).padStart(9),
  );
}
console.log('entry-JS "eager" (NÃO byte-determinístico):');
console.log('  moduleCount      ' + observedModuleCount + '  (budget ' + BUDGET.entry.moduleCount + ', EXATO)');
console.log('  eagerBytes       vivo=' + observedBytes + '  budget=' + BUDGET.entry.eagerBytes.nominal + '±' + BUDGET.entry.eagerBytes.tolerance);
console.log('  eagerGzipBytes   vivo=' + observedGzip + '  budget=' + BUDGET.entry.eagerGzipBytes.nominal + '±' + BUDGET.entry.eagerGzipBytes.tolerance);
console.log('  eagerBrotliBytes vivo=' + observedBrotli + '  budget=' + BUDGET.entry.eagerBrotliBytes.nominal + '±' + BUDGET.entry.eagerBrotliBytes.tolerance);
console.log(
  'TRANSFER (over-the-wire): firstPaint gzip=' + doc.firstPaintTransferBytes + '  brotli=' + doc.firstPaintTransferBytesBrotli +
    '  | stableAssets raw=' + mb(stableBytes) + ' gzip=' + mb(stableGzip) + ' brotli=' + mb(stableBrotli),
);
console.log('totais: nominalTotalBytes=' + doc.totals.nominalTotalBytes + '  (' + mb(doc.totals.nominalTotalBytes) + ')  nominalTotalBrotliBytes=' + doc.totals.nominalTotalBrotliBytes);

if (failures.length > 0) {
  console.error('\nBUDGET FAIL:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nBUDGET OK — assets byte-estáveis batem (raw+transfer); entry-JS dentro da tolerância; .gz/.br emitidos (zero-drift).');
NODE

echo "==> gravado $OUT"
