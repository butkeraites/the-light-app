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
# Uso:  ./scripts/measure-web-bundle.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
APP="$ROOT/app"
DIST="$APP/dist"
OUT_DIR="$ROOT/loop/perf"
OUT="$OUT_DIR/web-bundle-baseline.json"

[ -d "$APP" ] || { echo "ERRO: app/ não encontrado em $APP" >&2; exit 1; }

echo "==> [1/2] expo export --platform web (offline; só assets locais)"
rm -rf "$DIST"
( cd "$APP" && npx expo export --platform web )
[ -d "$DIST" ] || { echo "ERRO: export não gerou $DIST" >&2; exit 1; }

echo "==> [2/2] parseando $DIST -> $OUT (verificando budget)"
mkdir -p "$OUT_DIR"

DIST_DIR="$DIST" DIST_REL="app/dist" OUT_FILE="$OUT" node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST = process.env.DIST_DIR;
const DIST_REL = process.env.DIST_REL;
const OUT = process.env.OUT_FILE;

// ── ORÇAMENTO (budget) — a métrica de recorde. Valores byte-ESTÁVEIS são EXATOS;
//    o entry-JS é NOMINAL ± TOLERÂNCIA (Metro não é byte-determinístico, ver header).
//    Quando uma tarefa mudar o app de propósito, estas constantes são atualizadas. ──
const BUDGET = {
  // Assets content-addressed (byte-estáveis) — bytes crus EXATOS esperados.
  stable: {
    // F5.6: wasm agora é build RELEASE + wasm-opt -Oz (era DEBUG ~4,24 MB).
    // 4.244.884 -> 1.198.888 B (-71,8%). Byte-exato/determinístico (release+LTO+wasm-opt).
    frontierWasm: { bytes: 1198888, re: /^assets\/web\/generated\/wasm-bindgen\/index_bg\..*\.wasm$/ },
    readingDb: { bytes: 14409728, re: /^assets\/_assets\/data\/reading-sample\..*\.sqlite$/ },
    waSqliteFts5: { bytes: 666267, re: /^assets\/web\/vendor\/wa-sqlite-fts5\/wa-sqlite\..*\.wasm$/ },
    waSqliteNpm: { bytes: 558343, re: /^assets\/node_modules\/wa-sqlite\/dist\/wa-sqlite\..*\.wasm$/ },
    sampleDb: { bytes: 131072, re: /^assets\/_assets\/data\/sample\..*\.sqlite$/ },
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
  // no glue `app/web/reading.web.ts`). Efeito medido (3 exports byte-idênticos):
  //   • moduleCount  856 (dívida F5.7 `/plans` + F5.8/F5.5 i18n sobre os 854 da F5.6) → 844
  //     (12 módulos saíram do entry; os pesados agora vivem em chunks async LOCAIS);
  //   • eagerBytes   1.448.032 → 1.381.059 (−66.973 B, −4,6%);
  //   • eagerGzip      372.625 →   352.644 (−19.981 B, −5,4%).
  // O restante do entry é o baseline IRREDUTÍVEL de 1º paint (React Native Web + React +
  // expo-router + a glue wasm-bindgen da fronteira + i18n/tema) — não code-splittável sem
  // quebrar o 1º paint. Re-centramos moduleCount + nominais p/ o estado pós-split; a
  // lógica de tolerância (só p/ o entry-JS volátil, não p/ o wasm) fica intacta.
  entry: {
    glob: '_expo/static/js/web/entry-*.js',
    moduleCount: 844,
    eagerBytes: { nominal: 1381059, tolerance: 1024 },
    eagerGzipBytes: { nominal: 352644, tolerance: 2048 },
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
  // gzip -9 determinístico (zlib grava mtime=0 no header) → contagem de bytes estável.
  return { bytes: buf.length, gzipBytes: zlib.gzipSync(buf, { level: 9 }).length };
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

// ── Assets byte-estáveis: bytes+gzip EXATOS, verificados contra o budget. ──
const stableAssets = {};
let stableBytes = 0;
let stableGzip = 0;
for (const [name, spec] of Object.entries(BUDGET.stable)) {
  const abs = one(spec.re);
  const s = sizes(abs);
  stableAssets[name] = { path: relOut(abs), bytes: s.bytes, gzipBytes: s.gzipBytes };
  stableBytes += s.bytes;
  stableGzip += s.gzipBytes;
  if (s.bytes !== spec.bytes) {
    failures.push(`${name}: bytes ${s.bytes} != esperado ${spec.bytes} (conteúdo mudou? atualize a baseline)`);
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

// ── Documento gravado — SÓ valores estáveis (assets byte-estáveis + moduleCount) e
//    constantes de budget. Nenhum valor volátil (bytes/gzip/hash crus do entry-JS,
//    contagem de arquivos) entra aqui → o JSON é IDÊNTICO a cada execução. ──
const doc = {
  metric: 'web-bundle-baseline',
  task: 'F5.3',
  description:
    'Orçamento (budget) do bundle web do The Light App. HONESTO sobre determinismo: os ' +
    'assets content-addressed (wasm da fronteira, DBs, engines wa-sqlite, sample) são ' +
    'BYTE-ESTÁVEIS e gravados EXATOS; o entry-JS "eager" NÃO é byte-determinístico ' +
    '(Metro renumera os módulos em ordem de grafo não-determinística — flutter ~122 B ' +
    'raw / ~1,7 KB gzip entre runs) e é gravado como moduleCount EXATO + bytes/gzip ' +
    'NOMINAL ± TOLERÂNCIA, re-verificados a cada run. Assim este JSON é reprodutível ' +
    '(idêntico byte-a-byte a cada `scripts/measure-web-bundle.sh`) sem inchar o bundle ' +
    'enviado. Métrica de recorde para F5.6/F5.9/F5.19. Offline: assets locais (sem rede).',
  generatedBy: 'scripts/measure-web-bundle.sh',
  distDir: DIST_REL,
  determinism: {
    stableAssets: 'byte-exact (content-addressed)',
    entryJs:
      'NÃO byte-determinístico (Metro module-id em ordem de grafo async) — moduleCount ' +
      'exato + bytes/gzip nominal±tolerância, re-verificados',
  },
  // Convenience plana (bytes crus dos assets byte-estáveis).
  frontierWasmBytes: stableAssets.frontierWasm.bytes,
  readingDbBytes: stableAssets.readingDb.bytes,
  waSqliteFts5Bytes: stableAssets.waSqliteFts5.bytes,
  waSqliteNpmBytes: stableAssets.waSqliteNpm.bytes,
  sampleDbBytes: stableAssets.sampleDb.bytes,
  entryJs: {
    note:
      'Entry-JS "eager" carregado no 1º paint. moduleCount (nº de `__d(`) é EXATO e ' +
      'independe da ordem — a grandeza de budget do JS (code-split futuro a reduz de ' +
      'forma medível). eagerBytes/eagerGzipBytes são NOMINAL ± TOLERÂNCIA (Metro não é ' +
      'byte-determinístico); o script mede o valor vivo e falha se sair da faixa.',
    glob: BUDGET.entry.glob,
    moduleCount: observedModuleCount,
    eagerBytes: { nominal: BUDGET.entry.eagerBytes.nominal, tolerance: BUDGET.entry.eagerBytes.tolerance },
    eagerGzipBytes: {
      nominal: BUDGET.entry.eagerGzipBytes.nominal,
      tolerance: BUDGET.entry.eagerGzipBytes.tolerance,
    },
  },
  assets: stableAssets,
  totals: {
    // Soma EXATA dos assets byte-estáveis (reprodutível).
    stableAssetsBytes: stableBytes,
    stableAssetsGzipBytes: stableGzip,
    // Total NOMINAL do dist (estáveis + entry-JS nominal); o entry-JS oscila ±tolerância.
    nominalTotalBytes: stableBytes + BUDGET.entry.eagerBytes.nominal,
    nominalTotalGzipBytes: stableGzip + BUDGET.entry.eagerGzipBytes.nominal,
  },
};

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');

// ── Resumo (inclui o VIVO observado, p/ transparência) + PASS/FAIL. ──
const mb = (n) => (n / (1024 * 1024)).toFixed(2) + ' MB';
console.log('web-bundle-baseline — assets byte-estáveis (EXATO):');
for (const [name, a] of Object.entries(stableAssets)) {
  console.log('  ' + name.padEnd(14) + String(a.bytes).padStart(10) + '  (' + mb(a.bytes) + ')  gzip ' + String(a.gzipBytes).padStart(10));
}
console.log('entry-JS "eager" (NÃO byte-determinístico):');
console.log('  moduleCount    ' + observedModuleCount + '  (budget ' + BUDGET.entry.moduleCount + ', EXATO)');
console.log('  eagerBytes     vivo=' + observedBytes + '  budget=' + BUDGET.entry.eagerBytes.nominal + '±' + BUDGET.entry.eagerBytes.tolerance);
console.log('  eagerGzipBytes vivo=' + observedGzip + '  budget=' + BUDGET.entry.eagerGzipBytes.nominal + '±' + BUDGET.entry.eagerGzipBytes.tolerance);
console.log('totais: stableAssetsBytes=' + stableBytes + '  nominalTotalBytes=' + doc.totals.nominalTotalBytes + '  (' + mb(doc.totals.nominalTotalBytes) + ')');

if (failures.length > 0) {
  console.error('\nBUDGET FAIL:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('\nBUDGET OK — todos os assets byte-estáveis batem; entry-JS dentro da tolerância.');
NODE

echo "==> gravado $OUT"
