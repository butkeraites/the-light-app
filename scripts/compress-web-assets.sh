#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/compress-web-assets.sh — F5.17 (ADR-0045)
#
# PRÉ-COMPRIME os assets grandes/compressíveis do bundle web já exportado, emitindo
# variantes `.gz` (gzip -9) e `.br` (brotli -q11) AO LADO de cada asset em `app/dist`.
# É o passo de BUILD que transforma o bundle de bytes-em-disco em TRANSFER-over-the-wire:
# um host estático com `Content-Encoding` (nginx `gzip_static`/`brotli_static`, Netlify,
# Cloudflare Pages, etc.) serve a variante pré-comprimida quando o browser aceita — e o
# browser a descomprime de forma TRANSPARENTE (o `fetch()` do app devolve os bytes
# ORIGINAIS). Ver ADR-0045 / `loop/perf/SERVING.md` p/ a estratégia de serving.
#
# ZERO-DRIFT: a compressão é LOSSLESS. Cada variante emitida é DESCOMPRIMIDA e comparada
# byte-a-byte com a origem (helper `emitVariantsVerified`) — o script JOGA se divergir.
# Offline-first: assets LOCAIS; nenhuma rede/CDN externa introduzida. brotli via `zlib`
# built-in do Node (sem dep do CLI externo).
#
# Uso:  ./scripts/compress-web-assets.sh [DIST_DIR]   (default: <repo>/app/dist)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
DIST="${1:-$ROOT/app/dist}"
LIB="$ROOT/scripts/lib/web-compress.cjs"

[ -d "$DIST" ] || { echo "ERRO: dist não encontrado: $DIST (rode 'expo export --platform web' antes)" >&2; exit 1; }
[ -f "$LIB" ] || { echo "ERRO: lib não encontrada: $LIB" >&2; exit 1; }

DIST_DIR="$DIST" LIB_PATH="$LIB" node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { emitVariantsVerified } = require(process.env.LIB_PATH);

const DIST = process.env.DIST_DIR;

// Assets a pré-comprimir. Binários já-comprimidos (png/jpg/woff2/…) NÃO entram (não
// encolhem). `.wasm`/`.sqlite` sempre; texto (js/css/html/json/svg/map/txt) a partir de
// 1 KB (abaixo disso o overhead do header não compensa).
const ALWAYS = /\.(wasm|sqlite)$/i;
const TEXT = /\.(js|css|html|json|svg|map|txt)$/i;
const MIN_TEXT = 1024;

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

const rel = (abs) => path.relative(DIST, abs).split(path.sep).join('/');
const all = walk(DIST);

let totalRaw = 0;
let totalGzip = 0;
let totalBrotli = 0;
let count = 0;
const rows = [];

for (const abs of all) {
  const r = rel(abs);
  if (r.endsWith('.gz') || r.endsWith('.br')) continue; // não re-comprimir variantes
  const isAlways = ALWAYS.test(r);
  const isText = TEXT.test(r);
  if (!isAlways && !isText) continue;
  const buf = fs.readFileSync(abs);
  if (!isAlways && buf.length < MIN_TEXT) continue;

  const s = emitVariantsVerified(abs, buf); // emite .gz/.br + PROVA zero-drift
  totalRaw += s.bytes;
  totalGzip += s.gzipBytes;
  totalBrotli += s.brotliBytes;
  count += 1;
  rows.push({ r, ...s });
}

// Tabela dos MAIORES (top por bytes crus) p/ transparência.
rows.sort((a, b) => b.bytes - a.bytes);
const pct = (n, d) => (d ? (100 * (1 - n / d)).toFixed(1) : '0.0');
const pad = (s, n) => String(s).padStart(n);
console.log(`compress-web-assets — ${count} assets pré-comprimidos (.gz gzip-9 + .br brotli-11), zero-drift OK`);
console.log('  ' + 'asset'.padEnd(52) + pad('raw', 10) + pad('gzip', 10) + pad('brotli', 10) + '  savings(br)');
for (const row of rows.slice(0, 8)) {
  console.log(
    '  ' +
      row.r.padEnd(52) +
      pad(row.bytes, 10) +
      pad(row.gzipBytes, 10) +
      pad(row.brotliBytes, 10) +
      '   -' + pct(row.brotliBytes, row.bytes) + '%',
  );
}
const mb = (n) => (n / (1024 * 1024)).toFixed(2) + ' MB';
console.log(
  `  TOTAL (${count} assets): raw ${mb(totalRaw)}  gzip ${mb(totalGzip)} (-${pct(totalGzip, totalRaw)}%)  brotli ${mb(totalBrotli)} (-${pct(totalBrotli, totalRaw)}%)`,
);
NODE

echo "==> variantes .gz/.br emitidas em $DIST (zero-drift verificado)"
