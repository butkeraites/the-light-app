// scripts/run-guards.mjs — executor das GUARDAS (headless) em lote, com resumo.
//
// `node scripts/run-guards.mjs ci`  → só as guardas SEGURAS PARA CI (source-level: a11y, i18n,
//   paridade, tema, contraste, e libs puras via esbuild). NÃO precisam dos DBs sqlite grandes
//   (gitignored, 40–132MB) nem dos bindings gerados (wasm/JSI) → rodam num runner limpo.
// `node scripts/run-guards.mjs all` → CI + as guardas que DEPENDEM dos assets locais (leitura, IA,
//   busca, xref, notas, planos, etc.). Rodam localmente onde os DBs/bindings existem.
//
// (Fora daqui, por precisarem de browser/build: `test:web:smoke` e `test:web:perf-budget`.)
import { spawnSync } from 'node:child_process';

// Guardas SOURCE-LEVEL — sem DB sqlite, sem bindings gerados. Seguras em CI.
const CI = [
  'test:a11y-scan',
  'test:a11y-modals',
  'test:i18n',
  'test:i18n-coverage',
  'test:about-attr',
  'test:keystore',
  'test:web:app-const-parity',
  'test:web:contrast',
  'test:web:theme',
  'test:web:driveauth',
  'test:web:hide-on-scroll',
  'test:web:study-scope',
  'test:web:readingprefs',
  'test:web:search-smart',
  'test:web:aiproviders',
  'test:web:reminders',
  'test:web:mirror-drift',
  'test:web:verse-markers',
  'test:web:verse-of-day',
  'test:web:reading-streak',
  'test:web:share-verse',
];

// Guardas que precisam dos DBs sqlite / bindings gerados — rodam SÓ localmente (não em CI).
const EXTRA = [
  'test:web:reading',
  'test:web:search',
  'test:web:xref',
  'test:web:notes',
  'test:web:plans',
  'test:web:ai',
  'test:web:ai-stream',
  'test:web:ai-multi',
  'test:web:ai-multiprovider',
  'test:web:study',
  'test:web:lexicon',
  'test:web:interlinear',
  'test:web:export',
  'test:web:session',
  'test:web:compare',
  'test:web:research',
  'test:web:research-tavily',
  'test:web:coverage',
  'test:web:verse-of-day-data',
  'test:web:translations-data',
  'test:web:passage-query',
  'test:web:snapshot',
  'test:web:syncui',
  'test:web:drivesync',
  'test:web:firstpaint',
];

const mode = process.argv[2] === 'all' ? 'all' : 'ci';
const list = mode === 'all' ? [...CI, ...EXTRA] : CI;

console.log(`\n▶ run-guards (${mode}) — ${list.length} guardas\n`);
const failed = [];
for (const name of list) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync('npm', ['run', name, '--silent'], { encoding: 'utf8' });
  const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
  if (r.status === 0) {
    console.log(`  ✓ ${name}  (${ms}ms)`);
  } else {
    failed.push(name);
    console.log(`  ✗ ${name}  (${ms}ms)`);
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd().split('\n').slice(-12).join('\n');
    console.log(out.replace(/^/gm, '      '));
  }
}

console.log('');
if (failed.length) {
  console.log(`✗ ${failed.length}/${list.length} FALHARAM: ${failed.join(', ')}\n`);
  process.exit(1);
}
console.log(`✓ todas as ${list.length} guardas passaram\n`);
