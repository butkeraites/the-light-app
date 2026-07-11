// app/lib/engagementNudge.shared.ts — Rodada 5 (engajamento): decisão do NUDGE devocional (PURA)
//
// LÓGICA PURA (offline, dependency-free) do "lembrete diário" IN-APP de orar & ler. NÃO agenda
// notificação de SISTEMA (um export web estático não pode, sem servidor — ADR-0042/offline-first);
// em vez disso, um NUDGE aparece quando o usuário ABRE / volta ao app (o único mecanismo honesto no
// web, que é a plataforma do usuário). Este arquivo só DECIDE — dado (agora + prefs + estado +
// tempo ausente) SE e QUAL nudge mostrar — de forma determinística e testável headless. NÃO importa
// `react`, `react-native` nem `./prefs`: a UI/controlador faz o I/O de KV e chama estas funções.
//
// OFFLINE-FIRST: sem rede, sem conta, sem push token. Opt-in (OFF por padrão — consistente com
// lembretes/sync). ANTI-ALUCINAÇÃO: aqui NÃO há texto bíblico — só a decisão; a UI busca o
// versículo do dia VERBATIM do store.

/** Chave (namespaceada via `prefIdFor` no KV F5.2) da PREFERÊNCIA do nudge. */
export const NUDGE_PREF_KEY = 'engagement.devotionalNudge';
/** Chave do ESTADO (último dia/instante mostrado + dia engajado) — separada da preferência. */
export const NUDGE_STATE_KEY = 'engagement.devotionalNudgeState';

/** Preferência PERSISTIDA: ligado/desligado + hora local de início da "manhã". */
export interface NudgePref {
  enabled: boolean;
  /** Hora LOCAL 0–23 a partir da qual o nudge da manhã pode aparecer. */
  hour: number;
}

/**
 * Estado PERSISTIDO (device-local): último dia local mostrado, instante (ms) do último nudge (p/ o
 * cooldown) e o último dia em que o usuário ENGAJOU (tocou "Abrir"/"Orar" num nudge — sinal
 * PRÓPRIO do nudge, distinto do streak, que conta "abriu o app" como leitura).
 */
export interface NudgeState {
  lastShownDay: number;
  lastShownAtMs: number;
  engagedDay: number;
}

export type NudgeKind = 'morning' | 'idleReturn';

/** Default: OFF, manhã às 7h (opt-in). */
export const DEFAULT_NUDGE_PREF: NudgePref = { enabled: false, hour: 7 };
export const EMPTY_NUDGE_STATE: NudgeState = { lastShownDay: 0, lastShownAtMs: 0, engagedDay: 0 };

/** Ausência mínima p/ o nudge de "voltou depois de um tempo" (3h). */
export const IDLE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
/** Intervalo mínimo entre nudges (teto anti-spam, 4h). */
export const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** Presets de horário da manhã oferecidos na UI (24h). O `hour` da pref sai daqui. */
export const NUDGE_HOUR_PRESETS: readonly number[] = [5, 6, 7, 8, 9];

export interface DecideInput {
  nowMs: number;
  /** Hora LOCAL 0–23 de `now` (o chamador extrai de `new Date().getHours()`). */
  localHour: number;
  /** Índice de dia LOCAL de `now` (reusa `localDayIndex` de `readingStreak`). */
  localDay: number;
  pref: NudgePref;
  state: NudgeState;
  /** ms desde que o app foi ao background/oculto (`Infinity` = abertura fresca da sessão). */
  awayMs: number;
}

export interface DecideResult {
  show: boolean;
  kind?: NudgeKind;
}

/**
 * Decide se/qual nudge mostrar. PURO/determinístico:
 *  - desligado → nunca.
 *  - MANHÃ (prioritário, 1×/dia): ainda não mostrou hoje E hora local ≥ `pref.hour` → 'morning'.
 *  - VOLTOU-DEPOIS-DE-UM-TEMPO: ausente ≥ `IDLE_THRESHOLD_MS`, respeitando o cooldown desde o
 *    último nudge, E o usuário ainda NÃO engajou hoje (`engagedDay < localDay`) → 'idleReturn'.
 *    (Cap por horas + some quando o usuário engaja — nunca vira spam.)
 */
export function decideNudge(input: DecideInput): DecideResult {
  const { nowMs, localHour, localDay, pref, state, awayMs } = input;
  if (!pref.enabled) {
    return { show: false };
  }
  // Manhã: 1ª abertura no/depois do horário, uma vez por dia.
  if (state.lastShownDay < localDay && localHour >= pref.hour) {
    return { show: true, kind: 'morning' };
  }
  // Voltou depois de um tempo: ausência real, fora do cooldown, e ainda não engajou hoje.
  const pastCooldown = nowMs - state.lastShownAtMs >= NUDGE_COOLDOWN_MS;
  if (awayMs >= IDLE_THRESHOLD_MS && pastCooldown && state.engagedDay < localDay) {
    return { show: true, kind: 'idleReturn' };
  }
  return { show: false };
}

/**
 * Novo estado após MOSTRAR um nudge em `nowMs`/`localDay`. `engaged=true` quando o usuário ATUOU
 * (tocou "Abrir"/"Orar") → marca `engagedDay` e cala os nudges de idle pelo resto do dia. PURO.
 */
export function markShown(
  state: NudgeState,
  localDay: number,
  nowMs: number,
  engaged: boolean,
): NudgeState {
  return {
    lastShownDay: localDay,
    lastShownAtMs: nowMs,
    engagedDay: engaged ? localDay : state.engagedDay,
  };
}

/** Parse TOLERANTE da preferência (ausência/corrupção → default; offline-first nunca quebra). */
export function parseNudgePref(raw: string | null): NudgePref {
  if (!raw) {
    return DEFAULT_NUDGE_PREF;
  }
  try {
    const o = JSON.parse(raw) as Partial<NudgePref>;
    const hour =
      typeof o.hour === 'number' && Number.isInteger(o.hour) && o.hour >= 0 && o.hour <= 23
        ? o.hour
        : DEFAULT_NUDGE_PREF.hour;
    return { enabled: o.enabled === true, hour };
  } catch {
    return DEFAULT_NUDGE_PREF;
  }
}

/** Parse TOLERANTE do estado (ausência/corrupção → vazio). */
export function parseNudgeState(raw: string | null): NudgeState {
  if (!raw) {
    return EMPTY_NUDGE_STATE;
  }
  try {
    const o = JSON.parse(raw) as Partial<NudgeState>;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
    return { lastShownDay: num(o.lastShownDay), lastShownAtMs: num(o.lastShownAtMs), engagedDay: num(o.engagedDay) };
  } catch {
    return EMPTY_NUDGE_STATE;
  }
}
