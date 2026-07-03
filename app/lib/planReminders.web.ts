// app/lib/planReminders.web.ts — F5.13 (ADR-0042)
//
// Backend WEB dos lembretes — paridade de TIPOS com o nativo (`planReminders.ts`), mas
// SEM `expo-notifications` (que é NATIVO): o Metro escolhe este `.web.ts` no web e mantém
// o módulo nativo FORA do bundle web. A LÓGICA pura vem do mesmo `planReminders.shared.ts`.
//
// DEGRADAÇÃO web (offline-first preservado): um export web ESTÁTICO não tem como agendar
// uma notificação DIÁRIA confiável (exigiria service worker + background), então o backend
// WEB é um NO-OP documentado, best-effort: NUNCA lança, NUNCA toca a rede, NUNCA pede push
// token/permissão remota. Na prática a tela de planos já degrada no web (PlansWebNotice,
// F5.10) e NUNCA renderiza o toggle de lembrete — então estes métodos não são exercitados
// em produção; existem só p/ paridade de tipos e p/ manter `expo-notifications` fora do web.
// Os planos permanecem 100% utilizáveis sem lembretes.
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

/** False no web: o agendamento LOCAL diário não está disponível (degrada). */
export const REMINDERS_SUPPORTED = false;

/**
 * Backend WEB no-op (best-effort, offline). Reporta permissão negada e não agenda nada —
 * nunca lança, nunca toca a rede. É o fallback documentado do degrade web.
 */
export const defaultNotificationsBackend: NotificationsBackend = {
  async getPermissionGranted() {
    return false;
  },
  async requestPermission() {
    return false;
  },
  async scheduleDailyReminder() {
    // No-op: sem agendamento confiável no web estático. Retorna id vazio (nunca usado —
    // a UI de planos não renderiza o toggle no web).
    return '';
  },
  async cancelReminder() {
    // No-op.
  },
};

export { REMINDER_PREF_KEY, createPlanReminders, formatHHMM, parseHHMM };
export type {
  DailyReminderInput,
  EnableInput,
  EnableResult,
  NotificationsBackend,
  PlanReminders,
  ReminderPref,
};

// Serviço padrão do app WEB (backend no-op + KV de prefs `localStorage`). A superfície é
// idêntica ao nativo; a UI compartilhada importa daqui sem saber a plataforma.
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
