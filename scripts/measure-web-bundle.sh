#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/measure-web-bundle.sh — F5.3
#
# MÉTRICA DE PERFORMANCE do alvo WEB (repetível, headless, offline). Exporta o
# bundle web (`expo export --platform web`) e produz um ORÇAMENTO (budget) legível
# por máquina em `loop/perf/web-bundle-baseline.json`: bytes CRUS + gzip(-9) por
# ASSET-chave (entry JS "eager", wasm da fronteira, subset de leitura, engines
# wa-sqlite, sample DB) + o TOTAL do `dist/`. Este JSON é a MÉTRICA DE RECORDE
# contra a qual as tarefas seguintes de performance web (F5.6/F5.9/F5.19…) medem
# ganhos — "verde" passa a ser objetivo, não impressão.
#
# Determinístico: caminhos casados por PADRÃO (o hash de conteúdo do Metro é
# estável p/ o mesmo conteúdo), ordenação estável, e o gzip é `zlib.gzipSync`
# level 9 do Node (mtime=0 no header → contagem de bytes reprodutível). Nenhuma
# rede: `expo export` empacota apenas ASSETS LOCAIS (wasm/sqlite versionados);
# offline-first preservado.
#
# Uso:  ./scripts/measure-web-bundle.sh
# Saída: 0 em sucesso; grava loop/perf/web-bundle-baseline.json e imprime o resumo.
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

echo "==> [2/2] parseando $DIST -> $OUT"
mkdir -p "$OUT_DIR"

DIST_DIR="$DIST" DIST_REL="app/dist" OUT_FILE="$OUT" node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIST = process.env.DIST_DIR;
const DIST_REL = process.env.DIST_REL;
const OUT = process.env.OUT_FILE;

// Lista determinística (ordenada) de TODOS os arquivos sob dist/.
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

function relOf(abs) {
  return DIST_REL + '/' + path.relative(DIST, abs).split(path.sep).join('/');
}
function relToDist(abs) {
  return path.relative(DIST, abs).split(path.sep).join('/');
}
function sizes(abs) {
  const buf = fs.readFileSync(abs);
  // gzip -9 determinístico (zlib.gzipSync grava mtime=0 no header) → bytes estáveis.
  return { bytes: buf.length, gzipBytes: zlib.gzipSync(buf, { level: 9 }).length };
}
function match(re) {
  return all.filter((f) => re.test(relToDist(f)));
}
function assetOne(re) {
  const ms = match(re);
  if (ms.length === 0) throw new Error('nenhum asset casou ' + re);
  const abs = ms[0];
  const s = sizes(abs);
  return { path: relOf(abs), bytes: s.bytes, gzipBytes: s.gzipBytes };
}
function assetMany(re) {
  const ms = match(re);
  if (ms.length === 0) throw new Error('nenhum asset casou ' + re);
  let bytes = 0;
  let gzipBytes = 0;
  const files = ms.map((abs) => {
    const s = sizes(abs);
    bytes += s.bytes;
    gzipBytes += s.gzipBytes;
    return { path: relOf(abs), bytes: s.bytes, gzipBytes: s.gzipBytes };
  });
  return { bytes, gzipBytes, fileCount: files.length, files };
}

// JS "eager" carregado no 1º paint (soma de _expo/static/js/web/*.js).
const entryJs = assetMany(/^_expo\/static\/js\/web\/.*\.js$/);
// wasm da fronteira UniFFI — DEFERIDO do 1º paint na F5.3 (carga sob demanda).
const frontierWasm = assetOne(/^assets\/web\/generated\/wasm-bindgen\/index_bg\..*\.wasm$/);
// subset de leitura (wa-sqlite/OPFS) — carregado sob demanda pelas telas de leitura.
const readingDb = assetOne(/^assets\/_assets\/data\/reading-sample\..*\.sqlite$/);
// engine wa-sqlite (FTS5, vendored).
const waSqliteFts5 = assetOne(/^assets\/web\/vendor\/wa-sqlite-fts5\/wa-sqlite\..*\.wasm$/);
// engine wa-sqlite (npm).
const waSqliteNpm = assetOne(/^assets\/node_modules\/wa-sqlite\/dist\/wa-sqlite\..*\.wasm$/);
// sample DB legado.
const sampleDb = assetOne(/^assets\/_assets\/data\/sample\..*\.sqlite$/);

let totalBytes = 0;
let totalGzipBytes = 0;
for (const f of all) {
  const s = sizes(f);
  totalBytes += s.bytes;
  totalGzipBytes += s.gzipBytes;
}

const doc = {
  metric: 'web-bundle-baseline',
  task: 'F5.3',
  description:
    'Orçamento (budget) repetível do bundle web do The Light App: bytes crus + gzip(-9) ' +
    'por asset-chave, JS "eager" do 1º paint, e total do dist/. Métrica de recorde para ' +
    'as tarefas de performance web seguintes (F5.6/F5.9/F5.19). Regenerar com ' +
    'scripts/measure-web-bundle.sh. Offline: todos os assets são locais (sem rede).',
  generatedBy: 'scripts/measure-web-bundle.sh',
  distDir: DIST_REL,
  fileCount: all.length,
  // Campos planos (nomes da tarefa) — bytes crus, para comparação rápida.
  entryJsBytes: entryJs.bytes,
  frontierWasmBytes: frontierWasm.bytes,
  readingDbBytes: readingDb.bytes,
  waSqliteFts5Bytes: waSqliteFts5.bytes,
  waSqliteNpmBytes: waSqliteNpm.bytes,
  sampleDbBytes: sampleDb.bytes,
  totalBytes,
  // Por-asset completo (cru + gzip) — o registro autoritativo.
  assets: {
    entryJs, // JS eager parseado no 1º paint (soma de _expo/static/js/web/*.js)
    frontierWasm, // wasm da fronteira — DEFERIDO do 1º paint (F5.3); carga sob demanda
    readingDb, // subset de leitura (wa-sqlite/OPFS) — carga sob demanda
    waSqliteFts5, // engine wa-sqlite (FTS5, vendored)
    waSqliteNpm, // engine wa-sqlite (npm)
    sampleDb, // sample DB legado
  },
  totals: { bytes: totalBytes, gzipBytes: totalGzipBytes, fileCount: all.length },
};

fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');

const mb = (n) => (n / (1024 * 1024)).toFixed(2) + ' MB';
const line = (k, a) => console.log('  ' + k.padEnd(14) + String(a.bytes).padStart(10) + '  (' + mb(a.bytes) + ')  gzip ' + String(a.gzipBytes).padStart(10));
console.log('web-bundle-baseline (' + all.length + ' arquivos em ' + DIST_REL + '):');
line('entryJs', entryJs);
line('frontierWasm', frontierWasm);
line('readingDb', readingDb);
line('waSqliteFts5', waSqliteFts5);
line('waSqliteNpm', waSqliteNpm);
line('sampleDb', sampleDb);
line('TOTAL', { bytes: totalBytes, gzipBytes: totalGzipBytes });
NODE

echo "==> gravado $OUT"
