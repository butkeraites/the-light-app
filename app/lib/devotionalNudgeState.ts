// app/lib/devotionalNudgeState.ts — Rodada 5 (engajamento): I/O do ESTADO do nudge devocional
//
// Fino wrapper de KV (F5.2) sobre o ESTADO do nudge (último dia/instante mostrado + dia engajado),
// separado da PREFERÊNCIA (`useDevotionalNudgePref`). A LÓGICA (parse/markShown) vive pura em
// `engagementNudge.shared.ts`; aqui só o read/modify/write offline. `getP`/`setP` injetáveis (molde
// `readingStreak.ts`) — mas os testes exercitam a lógica pura direto, sem KV. Sem rede/conta.
import {
  markShown,
  NUDGE_STATE_KEY,
  parseNudgeState,
  type NudgeKind,
  type NudgeState,
} from './engagementNudge.shared';
import { localDayIndex } from './readingStreak';
import { getPref, setPref, type Prefs } from './prefs';

/** Lê o estado persistido do nudge (tolerante a ausência/corrupção → vazio). */
export async function loadNudgeState(getP: Prefs['getPref'] = getPref): Promise<NudgeState> {
  return parseNudgeState(await getP(NUDGE_STATE_KEY));
}

/** Grava o estado do nudge (fire-and-forget offline). */
export async function saveNudgeState(
  state: NudgeState,
  setP: Prefs['setPref'] = setPref,
): Promise<void> {
  await setP(NUDGE_STATE_KEY, JSON.stringify(state));
}

/**
 * Registra que um nudge FOI MOSTRADO agora (inicia o cooldown; `engaged=false`). Chamado pelo
 * controlador ao exibir o card. Best-effort: falha de KV não quebra a UI.
 */
export async function recordNudgeShown(_kind: NudgeKind): Promise<void> {
  try {
    const prev = await loadNudgeState();
    await saveNudgeState(markShown(prev, localDayIndex(new Date()), Date.now(), false));
  } catch {
    /* offline-first: tolerado */
  }
}

/**
 * Registra que o usuário ENGAJOU (tocou "Abrir"/"Orar") — cala os nudges de idle pelo resto do dia.
 * Chamado pelo card nas ações. Best-effort.
 */
export async function recordNudgeEngaged(): Promise<void> {
  try {
    const prev = await loadNudgeState();
    await saveNudgeState(markShown(prev, localDayIndex(new Date()), Date.now(), true));
  } catch {
    /* offline-first: tolerado */
  }
}
