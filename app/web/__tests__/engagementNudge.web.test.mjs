// engagementNudge.web.test.mjs — Rodada 5 (engajamento; molde planReminders.web.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser/rede) da DECISÃO do NUDGE devocional in-app
// (`app/lib/engagementNudge.shared.ts`). A lógica é PURA/determinística → exercitamos com
// objetos simples (sem KV/relógio real):
//   1) DESLIGADO → nunca mostra.
//   2) MANHÃ: hora local ≥ pref.hour E ainda não mostrou hoje → 'morning' (1×/dia).
//   3) VOLTOU-DEPOIS-DE-UM-TEMPO: ausência ≥ 3h, fora do cooldown de 4h, e não engajou hoje → 'idleReturn'.
//   4) Cooldown, ausência curta e "engajou hoje" BLOQUEIAM o idle.
//   5) markShown: registra dia/instante; engaged=true trava o idle pelo resto do dia.
//   6) parse* tolerante (ausência/corrupção → default/vazio; coerção de tipos).
//   7) OFFLINE-FIRST ESTRUTURAL: grep dos fontes novos garante SEM fetch/URL/push token/console.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'engagementNudge-headless-entry.ts');
const LIB = join(__dirname, '..', '..', 'lib');

// Fontes que DEVEM ser offline-only (sem rede/servidor/push token/log).
const OFFLINE_SRC_FILES = [
  'engagementNudge.shared.ts',
  'devotionalNudge.ts',
  'devotionalNudgeState.ts',
  'useDevotionalNudgeController.ts',
  'useDevotionalNudgePref.ts',
  'useAppForeground.ts',
  'useAppForeground.web.ts',
];

async function loadBundle() {
  const outfile = join(tmpdir(), `engagementNudge-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

// Um dia LOCAL fictício e horários derivados (o teste não usa relógio real).
const DAY = 20000; // índice de dia arbitrário
const H = 60 * 60 * 1000;
const noonMs = DAY * 86_400_000 + 12 * H; // "meio-dia" fictício do dia DAY

async function main() {
  const {
    DEFAULT_NUDGE_PREF,
    EMPTY_NUDGE_STATE,
    IDLE_THRESHOLD_MS,
    NUDGE_COOLDOWN_MS,
    NUDGE_HOUR_PRESETS,
    NUDGE_PREF_KEY,
    NUDGE_STATE_KEY,
    decideNudge,
    markShown,
    parseNudgePref,
    parseNudgeState,
  } = await loadBundle();

  const enabledPref = { enabled: true, hour: 7 };

  // ══ (1) DESLIGADO → nunca ════════════════════════════════════════════════════════════════
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 8, localDay: DAY, pref: { enabled: false, hour: 7 }, state: EMPTY_NUDGE_STATE, awayMs: Infinity }),
    { show: false },
    'desligado → nunca mostra',
  );

  // ══ (2) MANHÃ: hora ≥ pref.hour e não mostrou hoje ═══════════════════════════════════════
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 8, localDay: DAY, pref: enabledPref, state: EMPTY_NUDGE_STATE, awayMs: 0 }),
    { show: true, kind: 'morning' },
    'manhã: 8h ≥ 7h, não mostrou hoje → morning',
  );
  // Antes do horário e sem ausência → nada.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 6, localDay: DAY, pref: enabledPref, state: EMPTY_NUDGE_STATE, awayMs: 0 }),
    { show: false },
    'antes do horário e sem ausência → nada',
  );
  // Já mostrou hoje (lastShownDay === DAY) e sem ausência → sem morning repetido.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 9, localDay: DAY, pref: enabledPref, state: { lastShownDay: DAY, lastShownAtMs: noonMs - 1 * H, engagedDay: 0 }, awayMs: 0 }),
    { show: false },
    'já mostrou hoje + sem ausência → sem repetir de manhã',
  );

  // ══ (3) VOLTOU-DEPOIS-DE-UM-TEMPO ════════════════════════════════════════════════════════
  // Já mostrou de manhã (5h atrás > cooldown 4h), ausente 3h+, não engajou → idleReturn.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 12, localDay: DAY, pref: enabledPref, state: { lastShownDay: DAY, lastShownAtMs: noonMs - 5 * H, engagedDay: 0 }, awayMs: IDLE_THRESHOLD_MS }),
    { show: true, kind: 'idleReturn' },
    'voltou após 3h, fora do cooldown, não engajou → idleReturn',
  );

  // ══ (4) BLOQUEIOS do idle ════════════════════════════════════════════════════════════════
  // Cooldown: último nudge há 2h (< 4h) → bloqueia.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 12, localDay: DAY, pref: enabledPref, state: { lastShownDay: DAY, lastShownAtMs: noonMs - 2 * H, engagedDay: 0 }, awayMs: IDLE_THRESHOLD_MS }),
    { show: false },
    'idle dentro do cooldown de 4h → bloqueado',
  );
  // Ausência curta (< 3h) → bloqueia.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 12, localDay: DAY, pref: enabledPref, state: { lastShownDay: DAY, lastShownAtMs: noonMs - 5 * H, engagedDay: 0 }, awayMs: IDLE_THRESHOLD_MS - 1 }),
    { show: false },
    'idle com ausência < 3h → bloqueado',
  );
  // Já engajou hoje → idle some.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs, localHour: 12, localDay: DAY, pref: enabledPref, state: { lastShownDay: DAY, lastShownAtMs: noonMs - 5 * H, engagedDay: DAY }, awayMs: IDLE_THRESHOLD_MS }),
    { show: false },
    'engajou hoje → idle some',
  );

  // ══ (5) markShown ════════════════════════════════════════════════════════════════════════
  const shown = markShown(EMPTY_NUDGE_STATE, DAY, noonMs, false);
  assert.deepEqual(shown, { lastShownDay: DAY, lastShownAtMs: noonMs, engagedDay: 0 }, 'markShown(engaged=false) registra dia/instante, mantém engagedDay');
  const engaged = markShown(shown, DAY, noonMs + 1, true);
  assert.equal(engaged.engagedDay, DAY, 'markShown(engaged=true) marca engagedDay=hoje');
  // Após engajar, o idle no mesmo dia some.
  assert.deepEqual(
    decideNudge({ nowMs: noonMs + 5 * H, localHour: 17, localDay: DAY, pref: enabledPref, state: engaged, awayMs: IDLE_THRESHOLD_MS }),
    { show: false },
    'após engajar, idle no mesmo dia não volta',
  );

  // Novo dia após engajar ontem: morning volta.
  assert.deepEqual(
    decideNudge({ nowMs: (DAY + 1) * 86_400_000 + 8 * H, localHour: 8, localDay: DAY + 1, pref: enabledPref, state: engaged, awayMs: 0 }),
    { show: true, kind: 'morning' },
    'novo dia: morning volta mesmo tendo engajado ontem',
  );

  // ══ (6) parse* tolerante ═════════════════════════════════════════════════════════════════
  assert.deepEqual(parseNudgePref(null), DEFAULT_NUDGE_PREF, 'pref null → default (OFF)');
  assert.equal(DEFAULT_NUDGE_PREF.enabled, false, 'default é OPT-IN OFF');
  assert.deepEqual(parseNudgePref('{"enabled":true,"hour":6}'), { enabled: true, hour: 6 }, 'pref parse ok');
  assert.deepEqual(parseNudgePref('{"enabled":"yes","hour":99}'), { enabled: false, hour: 7 }, 'pref coerção: enabled não-bool→false, hour fora de faixa→default');
  assert.deepEqual(parseNudgePref('not json'), DEFAULT_NUDGE_PREF, 'pref corrompida → default');
  assert.deepEqual(parseNudgeState(null), EMPTY_NUDGE_STATE, 'state null → vazio');
  assert.deepEqual(parseNudgeState('{"lastShownDay":5,"lastShownAtMs":9,"engagedDay":5}'), { lastShownDay: 5, lastShownAtMs: 9, engagedDay: 5 }, 'state parse ok');
  assert.deepEqual(parseNudgeState('{"lastShownDay":-1}'), EMPTY_NUDGE_STATE, 'state negativo/incompleto → vazio-normalizado');
  assert.deepEqual(parseNudgeState('nope'), EMPTY_NUDGE_STATE, 'state corrompido → vazio');

  // Presets + chaves + thresholds sãos.
  assert.ok(Array.isArray(NUDGE_HOUR_PRESETS) && NUDGE_HOUR_PRESETS.every((h) => h >= 0 && h <= 23), 'presets de hora válidos');
  assert.equal(NUDGE_PREF_KEY, 'engagement.devotionalNudge', 'chave da pref');
  assert.equal(NUDGE_STATE_KEY, 'engagement.devotionalNudgeState', 'chave do estado');
  assert.ok(NUDGE_COOLDOWN_MS > 0 && IDLE_THRESHOLD_MS > 0, 'thresholds positivos');

  // ══ (7) OFFLINE-FIRST ESTRUTURAL ═════════════════════════════════════════════════════════
  for (const file of OFFLINE_SRC_FILES) {
    const src = await readFile(join(LIB, file), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src), `${file}: nunca chama fetch (sem rede)`);
    assert.ok(!/https?:\/\//.test(src), `${file}: nenhuma URL http(s) (sem servidor)`);
    assert.ok(!/getExpoPushTokenAsync|getDevicePushTokenAsync/.test(src), `${file}: sem push token`);
    assert.ok(!/console\./.test(src), `${file}: sem console.* (nada logado — privacidade)`);
  }

  console.log('PASS — decisão do nudge devocional (pura, sem device/rede):');
  console.log('  desligado → nunca; manhã 1×/dia (hora ≥ pref); idleReturn após 3h fora, cooldown 4h, some ao engajar');
  console.log('  bloqueios: cooldown, ausência curta, engajou-hoje; markShown/engaged; parse* tolerante');
  console.log('  offline-first: sem fetch/URL/push token/console.* nos fontes do nudge');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
