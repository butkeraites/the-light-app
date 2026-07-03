// app/lib/planReminders.ts — F5.13 (ADR-0042)
//
// Backend NATIVO dos LEMBRETES LOCAIS do plano de leitura. Envolve `expo-notifications`
// (agendamento LOCAL no device: iOS/Android) por trás do `NotificationsBackend`
// injetável definido em `planReminders.shared.ts` (onde vive a LÓGICA pura + testável).
//
// OFFLINE-FIRST (regra dura): SÓ notificação LOCAL (`scheduleNotificationAsync` com
// trigger DIÁRIO de calendário). NUNCA `getExpoPushTokenAsync`/`getDevicePushTokenAsync`,
// NUNCA rede, NUNCA conta. Permissão pedida SÓ no opt-in (dentro de `enableReminder`,
// via `requestPermission`), nunca no boot. Import de `expo-notifications` é LAZY (dynamic
// import) — mantém o módulo nativo FORA de qualquer bundle que não o use e permite a prova
// headless injetar um backend fake sem carregar o módulo nativo (molde `keystore.ts`).
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `planReminders.web.ts` (best-effort/no-op), o que mantém `expo-notifications` FORA do
// bundle web (a tela de planos já degrada no web — F5.10 — e nunca renderiza o toggle).
import { createPrefs } from './prefs';
import {
  REMINDER_PREF_KEY,
  createPlanReminders,
  formatHHMM,
  parseHHMM,
  type DailyReminderInput,
  type EnableInput,
  type EnableResult,
  type NotificationsBackend,
  type PlanReminders,
  type ReminderPref,
} from './planReminders.shared';

/** True neste alvo: o agendamento LOCAL está disponível (nativo). */
export const REMINDERS_SUPPORTED = true;

/** Id do canal Android das notificações de lembrete (no-op em iOS). */
export const REMINDER_CHANNEL_ID = 'plan-reminders';

/**
 * Backend padrão NATIVO sobre `expo-notifications`. Cada método faz o import LAZY do
 * módulo nativo (só quando de fato invocado). Estritamente LOCAL: agenda/cancela e lê/
 * pede permissão — nenhum push token, nenhuma rede.
 */
export const defaultNotificationsBackend: NotificationsBackend = {
  async getPermissionGranted() {
    const N = await import('expo-notifications');
    const perm = await N.getPermissionsAsync();
    return perm.granted === true;
  },

  async requestPermission() {
    const N = await import('expo-notifications');
    const perm = await N.requestPermissionsAsync();
    return perm.granted === true;
  },

  async scheduleDailyReminder({ title, body, channelName, hour, minute }: DailyReminderInput) {
    const N = await import('expo-notifications');
    // Android exige um canal p/ a notificação aparecer; em iOS isto resolve `null`
    // (no-op) — por isso pode ser chamado sem checar a plataforma.
    await N.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: channelName,
      importance: N.AndroidImportance.DEFAULT,
    });
    // Trigger DIÁRIO de calendário LOCAL: dispara todo dia quando hora:minuto batem.
    return N.scheduleNotificationAsync({
      content: { title, body },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DAILY,
        channelId: REMINDER_CHANNEL_ID,
        hour,
        minute,
      },
    });
  },

  async cancelReminder(id: string) {
    const N = await import('expo-notifications');
    await N.cancelScheduledNotificationAsync(id);
  },
};

// Re-exporta a superfície pura + tipos (a UI importa tudo daqui — o Metro escolhe este
// `.ts` no nativo e o `.web.ts` no web, ambos com os MESMOS nomes).
export { REMINDER_PREF_KEY, createPlanReminders, formatHHMM, parseHHMM };
export type {
  DailyReminderInput,
  EnableInput,
  EnableResult,
  NotificationsBackend,
  PlanReminders,
  ReminderPref,
};

// Serviço padrão do app (backend expo-notifications LOCAL + KV de prefs nativo). A
// construção é side-effect-free: `createPrefs()` não toca o fs até um método rodar, e o
// backend é só um objeto — nada é agendado nem nenhuma permissão é pedida no import.
const defaultPlanReminders = createPlanReminders(defaultNotificationsBackend, createPrefs());

export function getReminder(): Promise<ReminderPref | null> {
  return defaultPlanReminders.getReminder();
}
export function enableReminder(input: EnableInput): Promise<EnableResult> {
  return defaultPlanReminders.enableReminder(input);
}
export function disableReminder(): Promise<void> {
  return defaultPlanReminders.disableReminder();
}
