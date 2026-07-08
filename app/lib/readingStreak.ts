// app/lib/readingStreak.ts — Rodada 4 (engajamento): sequência de dias de leitura (streak)
//
// Hábito diário 100% LOCAL e offline: conta dias CONSECUTIVOS em que o app foi aberto/lido. Sem
// rede, sem conta, sem tocar o `the-light` — persiste no KV de preferências app-side (`prefs`,
// ADR-0038), o mesmo alicerce do idioma/tema. A LÓGICA é pura e determinística (recebe o "dia" como
// número — `dayIndexUtc`), então é testável headless sem relógio. Nada sensível é gravado/logado.

import { getPref, setPref, type Prefs } from './prefs';

/**
 * Índice do dia LOCAL do usuário (não UTC). Um streak de HÁBITO conta dias de CALENDÁRIO LOCAL:
 * a virada tem de ser à MEIA-NOITE LOCAL, senão um leitor da noite perto do horário em que a
 * meia-noite UTC cai no fuso (ex.: 21h no Brasil, UTC-3 — dentro da janela devocional) teria a
 * sequência resetada/inflada por engano. `Date.UTC(ano,mês,dia)` sobre os componentes LOCAIS dá a
 * meia-noite daquele dia local em ms → índice inteiro de dia local, estável. (Distinto do
 * `dayIndexUtc` do versículo do dia, que usa UTC de PROPÓSITO — rotação global determinística.)
 */
export function localDayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** Estado do streak: último dia registrado (índice de dia LOCAL), sequência atual e recorde. */
export type StreakState = { lastDay: number; current: number; best: number };

/** Chave de preferência (namespaceada por `prefIdFor` dentro do KV). */
export const STREAK_PREF_KEY = 'engagement.readingStreak';

export const EMPTY_STREAK: StreakState = { lastDay: 0, current: 0, best: 0 };

/**
 * Avança o streak ao registrar atividade em `today` (índice de dia UTC). PURA e idempotente:
 *   • `today <= lastDay` (mesmo dia, ou relógio para trás) → estado inalterado (não conta 2×/dia).
 *   • `today === lastDay + 1` (dia seguinte) → sequência +1.
 *   • senão (buraco de ≥1 dia, ou 1º registro) → sequência REINICIA em 1.
 * `best` acompanha o maior `current` já visto. Nunca anda para trás.
 */
export function advanceStreak(state: StreakState, today: number): StreakState {
  if (today <= state.lastDay) {
    return state;
  }
  const current = today === state.lastDay + 1 ? state.current + 1 : 1;
  const best = Math.max(state.best, current);
  return { lastDay: today, current, best };
}

/**
 * Streak EFETIVO para exibir em `today`, sem registrar: se o último registro foi hoje ou ontem, a
 * sequência segue viva (`current`); se há ≥2 dias sem registro, já está QUEBRADA (0). Determinística.
 */
export function effectiveStreak(state: StreakState, today: number): number {
  if (state.lastDay === 0) return 0;
  return today - state.lastDay <= 1 ? state.current : 0;
}

/** Interpreta o JSON persistido em `StreakState` (tolerante a ausência/corrupção → EMPTY). */
export function parseStreak(raw: string | null): StreakState {
  if (!raw) return EMPTY_STREAK;
  try {
    const o = JSON.parse(raw) as Partial<StreakState>;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    return { lastDay: num(o.lastDay), current: num(o.current), best: num(o.best) };
  } catch {
    return EMPTY_STREAK; // offline-first: corrupção nunca quebra a Home
  }
}

/** Lê o streak persistido (via KV app-side). `prefsGet` injetável p/ teste headless. */
export async function loadStreak(prefsGet: Prefs['getPref'] = getPref): Promise<StreakState> {
  return parseStreak(await prefsGet(STREAK_PREF_KEY));
}

/**
 * Registra atividade de HOJE e devolve o novo estado (persistindo se mudou). É o que a Home chama no
 * mount (abrir o app conta como leitura do dia). `today`/`getP`/`setP` injetáveis p/ teste headless.
 */
export async function recordActivity(
  today: number = localDayIndex(new Date()),
  getP: Prefs['getPref'] = getPref,
  setP: Prefs['setPref'] = setPref,
): Promise<StreakState> {
  const prev = parseStreak(await getP(STREAK_PREF_KEY));
  const next = advanceStreak(prev, today);
  if (next !== prev) {
    await setP(STREAK_PREF_KEY, JSON.stringify(next));
  }
  return next;
}
