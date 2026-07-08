// readingStreak.test.mjs — Rodada 4 (engajamento): prova a lógica PURA da sequência de leitura.
//
// `lib/readingStreak.ts` é pura + persistência injetável (KV app-side). Aqui provamos: idempotência
// no mesmo dia, incremento no dia seguinte, RESET após buraco, `best` acompanhando o pico, robustez
// a relógio para trás, `effectiveStreak` (viva ontem/hoje vs quebrada), parse tolerante a corrupção,
// e o round-trip de `recordActivity` com um backend FAKE em memória. Sai 0 se tudo bater.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'readingStreak.ts');

async function load() {
  const outfile = join(tmpdir(), `streak-${randomBytes(6).toString('hex')}.mjs`);
  // `readingStreak.ts` importa `./prefs` (backend NATIVO), que puxa `expo-file-system` → `react-native`
  // (sintaxe que o esbuild não parseia). Aqui só exercitamos a LÓGICA PURA + `recordActivity` com
  // backends INJETADOS (o backend default nunca roda), então marcamos esses módulos como EXTERNAL —
  // o import fica não-resolvido mas jamais é executado.
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    external: ['expo-file-system', 'expo-file-system/legacy', 'react-native'],
  });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const { advanceStreak, effectiveStreak, parseStreak, recordActivity, localDayIndex, EMPTY_STREAK, STREAK_PREF_KEY } = await load();

  // (0) localDayIndex: dias de CALENDÁRIO LOCAL consecutivos → índices consecutivos; horas do MESMO
  // dia local → o MESMO índice. Base do streak de hábito (virada à meia-noite LOCAL, não UTC).
  const d = (y, m, day, h = 12) => new Date(y, m - 1, day, h, 0, 0); // construtor LOCAL
  assert.equal(localDayIndex(d(2026, 7, 8, 23)) - localDayIndex(d(2026, 7, 8, 1)), 0, 'mesmo dia local (horas diferentes) → mesmo índice');
  assert.equal(localDayIndex(d(2026, 7, 9)) - localDayIndex(d(2026, 7, 8)), 1, 'dia local seguinte → +1');
  assert.equal(localDayIndex(d(2026, 3, 1)) - localDayIndex(d(2026, 2, 28)), 1, 'vira o mês → +1 (índice contínuo)');

  // (1) 1º registro (dia 100) → sequência 1, best 1.
  let s = advanceStreak(EMPTY_STREAK, 100);
  assert.deepEqual(s, { lastDay: 100, current: 1, best: 1 }, '1º dia → 1');

  // (2) Mesmo dia → idempotente (não conta 2×).
  assert.deepEqual(advanceStreak(s, 100), s, 'mesmo dia → inalterado');

  // (3) Dia seguinte → +1; e de novo → +1 (best sobe).
  s = advanceStreak(s, 101);
  s = advanceStreak(s, 102);
  assert.deepEqual(s, { lastDay: 102, current: 3, best: 3 }, 'dias consecutivos → 3');

  // (4) BURACO (pula 104, volta em 105 depois de 102) → reset em 1, mas best mantém 3.
  const gap = advanceStreak(s, 105);
  assert.deepEqual(gap, { lastDay: 105, current: 1, best: 3 }, 'buraco → reset 1, best preserva 3');

  // (5) Relógio para trás (today < lastDay) → inalterado (não anda para trás).
  assert.deepEqual(advanceStreak(gap, 90), gap, 'relógio p/ trás → inalterado');

  // (6) effectiveStreak: viva se último registro foi hoje ou ontem; quebrada se ≥2 dias.
  assert.equal(effectiveStreak({ lastDay: 200, current: 5, best: 9 }, 200), 5, 'hoje → viva');
  assert.equal(effectiveStreak({ lastDay: 200, current: 5, best: 9 }, 201), 5, 'ontem → viva');
  assert.equal(effectiveStreak({ lastDay: 200, current: 5, best: 9 }, 202), 0, '2 dias → quebrada');
  assert.equal(effectiveStreak(EMPTY_STREAK, 300), 0, 'nunca registrou → 0');

  // (7) parseStreak tolerante: null e lixo → EMPTY; JSON válido → normalizado.
  assert.deepEqual(parseStreak(null), EMPTY_STREAK, 'null → EMPTY');
  assert.deepEqual(parseStreak('{{nope'), EMPTY_STREAK, 'corrupto → EMPTY');
  assert.deepEqual(parseStreak(JSON.stringify({ lastDay: 5, current: 2, best: 4 })), { lastDay: 5, current: 2, best: 4 }, 'JSON → estado');

  // (8) recordActivity round-trip com backend FAKE em memória (prova a persistência sem device).
  const store = new Map();
  const getP = async (k) => (store.has(k) ? store.get(k) : null);
  const setP = async (k, v) => void store.set(k, v);
  const r1 = await recordActivity(500, getP, setP);
  assert.deepEqual(r1, { lastDay: 500, current: 1, best: 1 }, 'record dia 500 → 1 (persistido)');
  const r2 = await recordActivity(501, getP, setP);
  assert.deepEqual(r2, { lastDay: 501, current: 2, best: 2 }, 'record dia 501 → 2');
  const r2b = await recordActivity(501, getP, setP);
  assert.deepEqual(r2b, r2, 'record mesmo dia → inalterado');
  // O que ficou no storage bate com o último estado.
  assert.deepEqual(parseStreak(store.get(STREAK_PREF_KEY)), r2, 'storage reflete o último estado');

  console.log('PASS — reading streak: idempotência, consecutivos, reset, best, relógio-p/-trás, effective, parse, round-trip.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
