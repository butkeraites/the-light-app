// engagementNudge-headless-entry.ts — Rodada 5 (molde planReminders-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless da DECISÃO do nudge devocional. Empacotado
// (esbuild) por `engagementNudge.web.test.mjs` e rodado em node SEM device/browser — reexporta
// APENAS a superfície PURA de `../../lib/engagementNudge.shared` (sem `react`/`react-native`/KV).
// Nenhuma lógica nova aqui.
import {
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
} from '../../lib/engagementNudge.shared';

export {
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
};
