#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/check-web-bundle-budget.sh — F5.19 (ADR-0047)
#
# GUARDA OFICIAL de regressão de PERFORMANCE do bundle WEB (a SAÍDA do workstream
# perf). Trava o orçamento como gate wired (`test:web:perf-budget`).
#
# Faz DUAS camadas de verificação:
#   [1] ENFORCER — roda `scripts/measure-web-bundle.sh`, que EXPORTA o bundle web
#       (offline), pré-comprime (.gz/.br, zero-drift) e FALHA (exit != 0) se qualquer
#       asset byte-estável mudar de conteúdo, o entry-JS eager sair da banda
#       nominal±tolerância, o moduleCount eager mudar, ou um asset REMOVIDO reaparecer.
#   [2] LOCK CROSS-CHECK — compara a `loop/perf/web-bundle-baseline.json` recém-produzida
#       contra o CONTRATO CONGELADO `loop/perf/web-bundle-budget.json`. Detecta drift entre
#       o enforcer (const BUDGET embutida em measure-web-bundle.sh) e o contrato travado —
#       ex.: alguém re-centrou o budget SEM atualizar o lock (re-baseline não documentado).
#
# Sai 0 só se AMBAS passam. Qualquer breach → exit != 0 com o campo ofensor + delta.
#
# Modos:
#   ./scripts/check-web-bundle-budget.sh              # completo: [1] enforcer + [2] lock
#   ./scripts/check-web-bundle-budget.sh --check-only # SÓ [2] lock (reusa a baseline atual;
#                                                     # rápido, p/ re-checagem/CI sem re-export)
#   PERF_BUDGET_CHECK_ONLY=1 ./scripts/check-web-bundle-budget.sh   # idem via env
#
# Offline-first: nenhuma rede (o measure só toca assets locais). App-side/tooling.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
MEASURE="$ROOT/scripts/measure-web-bundle.sh"
BASELINE="$ROOT/loop/perf/web-bundle-baseline.json"
BUDGET="$ROOT/loop/perf/web-bundle-budget.json"

CHECK_ONLY="${PERF_BUDGET_CHECK_ONLY:-0}"
if [ "${1:-}" = "--check-only" ]; then CHECK_ONLY=1; fi

[ -f "$BUDGET" ] || { echo "ERRO: contrato travado ausente: $BUDGET" >&2; exit 1; }

if [ "$CHECK_ONLY" = "1" ]; then
  echo "==> [1/2] ENFORCER pulado (--check-only): reusando $BASELINE"
  [ -f "$BASELINE" ] || { echo "ERRO: baseline ausente ($BASELINE) — rode sem --check-only p/ gerá-la" >&2; exit 1; }
else
  echo "==> [1/2] ENFORCER — scripts/measure-web-bundle.sh (export + budget + transfer)"
  "$MEASURE"
fi

echo "==> [2/2] LOCK CROSS-CHECK — baseline vs contrato congelado (web-bundle-budget.json)"
BASELINE_FILE="$BASELINE" BUDGET_FILE="$BUDGET" node - <<'NODE'
const fs = require('node:fs');
const baseline = JSON.parse(fs.readFileSync(process.env.BASELINE_FILE, 'utf8'));
const budget = JSON.parse(fs.readFileSync(process.env.BUDGET_FILE, 'utf8'));

const failures = [];
// EXATO: bytes crus + TRANSFER (gzip/brotli) dos assets content-addressed (byte-estáveis).
for (const [field, locked] of Object.entries(budget.exact)) {
  const got = baseline[field];
  if (got !== locked) {
    failures.push(`exact.${field}: baseline ${got} != travado ${locked} (delta ${got - locked})`);
  }
}
// EXATO: headline de TRANSFER do 1º paint (over-the-wire).
for (const [field, locked] of Object.entries(budget.transferHeadline)) {
  const got = baseline[field];
  if (got !== locked) {
    failures.push(`transferHeadline.${field}: baseline ${got} != travado ${locked} (delta ${got - locked})`);
  }
}
// EXATO: moduleCount eager (estrutural, determinístico).
if (baseline.entryJs.moduleCount !== budget.entry.moduleCount) {
  const d = baseline.entryJs.moduleCount - budget.entry.moduleCount;
  failures.push(`entry.moduleCount: baseline ${baseline.entryJs.moduleCount} != travado ${budget.entry.moduleCount} (delta ${d})`);
}
// Banda nominal±tolerância do entry-JS (não byte-determinístico): os PARÂMETROS da banda
// devem casar entre o enforcer (via baseline) e o lock.
for (const band of ['eagerBytes', 'eagerGzipBytes', 'eagerBrotliBytes']) {
  const b = baseline.entryJs[band];
  const l = budget.entry[band];
  if (b.nominal !== l.nominal) {
    failures.push(`entry.${band}.nominal: baseline ${b.nominal} != travado ${l.nominal} (delta ${b.nominal - l.nominal})`);
  }
  if (b.tolerance !== l.tolerance) {
    failures.push(`entry.${band}.tolerance: baseline ${b.tolerance} != travado ${l.tolerance}`);
  }
}
// Lista de assets REMOVIDOS (dead-weight que NÃO pode reaparecer).
const bRem = JSON.stringify(baseline.removedAssets);
const lRem = JSON.stringify(budget.removedAssets);
if (bRem !== lRem) {
  failures.push(`removedAssets: baseline ${bRem} != travado ${lRem}`);
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('  frontierWasm  ' + baseline.frontierWasmBytes + ' B (locked)  transfer gzip ' + baseline.frontierWasmBytesGzip + '  br ' + baseline.frontierWasmBytesBrotli);
console.log('  readingLiteDb ' + baseline.readingLiteDbBytes + ' B  · lexiconDb ' + baseline.lexiconDbBytes + ' B  · waSqliteFts5 ' + baseline.waSqliteFts5Bytes + ' B (todos EXATOS)');
console.log('  entry moduleCount ' + baseline.entryJs.moduleCount + ' (EXATO)  · 1º paint transfer gzip ' + kb(baseline.firstPaintTransferBytes) + ' / brotli ' + kb(baseline.firstPaintTransferBytesBrotli));
console.log('  removedAssets ' + lRem);

if (failures.length > 0) {
  console.error('\nPERF BUDGET LOCK FAIL — baseline diverge do contrato congelado (web-bundle-budget.json):');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nSe a mudança do app é INTENCIONAL/aceita, re-baseline deliberado: atualize a const BUDGET em');
  console.error('scripts/measure-web-bundle.sh E loop/perf/web-bundle-budget.json + registre um ADR (ver reBaselinePolicy).');
  process.exit(1);
}
console.log('\nPERF BUDGET LOCKED OK — enforcer verde + baseline == contrato congelado. Orçamento perf TRAVADO.');
NODE
