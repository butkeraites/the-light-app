// planReminders-headless-entry.ts — F5.13 (ADR-0042; molde keystore-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless dos LEMBRETES LOCAIS do plano. É
// empacotado (esbuild) por `planReminders.web.test.mjs` num único `.mjs` e rodado em node
// SEM device — reexporta APENAS a superfície pura de `../../lib/planReminders` (nativo) que
// a prova exercita com um `NotificationsBackend` FAKE injetado + um KV de prefs em memória.
// O `defaultNotificationsBackend` importa `expo-notifications` de forma LAZY e é marcado
// `external` no bundle: a prova NUNCA o aciona (nenhuma notificação real disparada, nenhum
// módulo nativo carregado). Nenhuma lógica nova aqui.
import {
  REMINDER_PREF_KEY,
  createPlanReminders,
  formatHHMM,
  parseHHMM,
} from '../../lib/planReminders';
import type {
  EnableResult,
  NotificationsBackend,
  ReminderPref,
} from '../../lib/planReminders';
import { createPrefs, prefIdFor } from '../../lib/prefs';
import type { PrefsBackend } from '../../lib/prefs';

export { REMINDER_PREF_KEY, createPlanReminders, formatHHMM, parseHHMM, createPrefs, prefIdFor };
export type { EnableResult, NotificationsBackend, ReminderPref, PrefsBackend };
