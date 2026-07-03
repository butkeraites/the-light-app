// app/lib/planReminders.shared.ts — F5.13 (ADR-0042)
//
// LÓGICA PURA (offline, dependency-free) dos LEMBRETES LOCAIS do plano de leitura ativo.
// É COMPARTILHADA pelo backend NATIVO (`planReminders.ts`, que agenda via
// `expo-notifications` LOCAL) e pelo WEB (`planReminders.web.ts`, best-effort/no-op).
// Este arquivo NÃO importa `expo-notifications` nem `react-native`: só orquestra um
// `NotificationsBackend` INJETÁVEL (agenda/cancela/permissão) + o KV de prefs OFFLINE
// da F5.2. É por isso que a prova headless roda SEM device: injeta um backend fake.
//
// OFFLINE-FIRST (regra dura do lembrete): APENAS notificação LOCAL agendada no device.
// SEM servidor, SEM conta, SEM push token remoto, SEM rede. Opt-in (OFF por padrão): a
// permissão só é pedida no `enableReminder` (nunca no boot). A preferência (on/off +
// horário + id da notificação agendada) persiste no KV local da F5.2 — nada sai do device.
//
// ANTI-ALUCINAÇÃO: o corpo/título da notificação é CROMO i18n (`t()`) + o NOME do plano
// (que vem do CATALOG do core, VERBATIM) — nunca texto bíblico inventado. Esta camada só
// recebe as strings já traduzidas + o horário; não sintetiza conteúdo bíblico.

/** Chave (namespaceada via `prefIdFor` no KV da F5.2) onde o lembrete persiste. */
export const REMINDER_PREF_KEY = 'plans.reminder';

/**
 * Preferência PERSISTIDA do lembrete (app-side, SEPARADA do `active.json` do core — a
 * forma de `PlanProgress` do core fica intacta). `id` = identificador da notificação
 * LOCAL agendada, guardado só p/ cancelar depois (device-local, não é dado sensível).
 */
export interface ReminderPref {
  enabled: boolean;
  /** Horário diário no formato 24h `HH:MM` (calendário LOCAL do device). */
  time: string;
  /** Id da notificação LOCAL agendada (para cancelamento preciso). */
  id?: string;
}

/**
 * Backend mínimo de agendamento LOCAL (subconjunto de `expo-notifications`). Injetável
 * para provar a LÓGICA headless, sem device e sem disparar notificação real. NOTE que
 * NÃO há método de push token / rede: a superfície é 100% LOCAL por construção.
 */
export interface NotificationsBackend {
  /** Lê o status atual de permissão de notificação LOCAL (SEM pedir). */
  getPermissionGranted(): Promise<boolean>;
  /** Pede permissão de notificação LOCAL — chamado SÓ no opt-in (nunca no boot). */
  requestPermission(): Promise<boolean>;
  /** Agenda UMA notificação LOCAL diária (repete) no horário dado; retorna o id. */
  scheduleDailyReminder(input: DailyReminderInput): Promise<string>;
  /** Cancela a notificação LOCAL agendada por id (idempotente). */
  cancelReminder(id: string): Promise<void>;
}

/** Entrada do agendamento diário: cromo já traduzido + horário (hora/minuto locais). */
export interface DailyReminderInput {
  /** Título (cromo i18n). */
  title: string;
  /** Corpo (cromo i18n + nome do plano do core). */
  body: string;
  /** Nome do canal Android (cromo i18n) — no-op em iOS. */
  channelName: string;
  /** Hora local 0–23. */
  hour: number;
  /** Minuto local 0–59. */
  minute: number;
}

/** Entrada do `enableReminder`: horário + strings de cromo já traduzidas. */
export interface EnableInput {
  time: string;
  title: string;
  body: string;
  channelName: string;
}

/** Resultado do `enableReminder` (a UI reage a cada caso). */
export type EnableResult =
  | { status: 'scheduled'; pref: ReminderPref }
  | { status: 'permission-denied' }
  | { status: 'invalid-time' };

/**
 * Subconjunto do KV de prefs (F5.2) que este serviço usa. `Prefs` de `./prefs` é
 * estruturalmente compatível — no nativo grava em arquivo JSON local, no web em
 * `localStorage`; a prova headless injeta um backend em memória.
 */
export interface ReminderPrefStore {
  getPref(key: string): Promise<string | null>;
  setPref(key: string, value: string): Promise<void>;
  removePref(key: string): Promise<void>;
}

/** Superfície pública do serviço de lembretes (idêntica no nativo e no web). */
export interface PlanReminders {
  /** Lê a preferência de lembrete persistida (ou `null` se ausente/inválida). */
  getReminder(): Promise<ReminderPref | null>;
  /**
   * Liga o lembrete: valida o horário, cancela um agendamento anterior (se houver),
   * pede permissão LOCAL (opt-in) e agenda UMA notificação diária; persiste a pref.
   */
  enableReminder(input: EnableInput): Promise<EnableResult>;
  /** Desliga o lembrete: cancela o agendamento (se houver) e remove a pref. */
  disableReminder(): Promise<void>;
}

/**
 * Parseia um horário 24h `HH:MM` (ou `H:MM`) para `{ hour, minute }`; retorna `null`
 * se malformado/fora de faixa. PURO, sem locale/rede.
 */
export function parseHHMM(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) {
    return null;
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

/** Formata `hour`/`minute` de volta para `HH:MM` (zero-padded). PURO. */
export function formatHHMM(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Cria o serviço de lembretes sobre um `NotificationsBackend` (agendamento LOCAL) e um
 * KV de prefs (F5.2). A LÓGICA é idêntica no nativo e no web — só o backend muda
 * (expo-notifications LOCAL vs. no-op web). A prova headless injeta um backend fake e um
 * KV em memória e nunca dispara notificação real.
 */
export function createPlanReminders(
  notifications: NotificationsBackend,
  prefs: ReminderPrefStore,
): PlanReminders {
  async function getReminder(): Promise<ReminderPref | null> {
    const raw = await prefs.getPref(REMINDER_PREF_KEY);
    if (raw == null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Partial<ReminderPref>;
        if (typeof p.time === 'string' && parseHHMM(p.time)) {
          return {
            enabled: p.enabled === true,
            time: p.time,
            id: typeof p.id === 'string' ? p.id : undefined,
          };
        }
      }
    } catch {
      // Pref corrompida → trata como sem lembrete (offline-first: nunca quebra a UI).
    }
    return null;
  }

  return {
    getReminder,

    async enableReminder({ time, title, body, channelName }) {
      const hm = parseHHMM(time);
      if (!hm) {
        return { status: 'invalid-time' };
      }
      // Re-ativar / trocar horário: cancela o agendamento anterior antes de reagendar
      // (evita notificações duplicadas). Idempotente se não havia nada.
      const prev = await getReminder();
      if (prev?.id) {
        await notifications.cancelReminder(prev.id);
      }
      // Permissão pedida SÓ AQUI (opt-in) — nunca no boot. Se já concedida, não repergunta.
      let granted = await notifications.getPermissionGranted();
      if (!granted) {
        granted = await notifications.requestPermission();
      }
      if (!granted) {
        // Sem permissão → não agenda e deixa o lembrete OFF (remove a pref).
        await prefs.removePref(REMINDER_PREF_KEY);
        return { status: 'permission-denied' };
      }
      const id = await notifications.scheduleDailyReminder({
        title,
        body,
        channelName,
        hour: hm.hour,
        minute: hm.minute,
      });
      const pref: ReminderPref = { enabled: true, time, id };
      await prefs.setPref(REMINDER_PREF_KEY, JSON.stringify(pref));
      return { status: 'scheduled', pref };
    },

    async disableReminder() {
      const prev = await getReminder();
      if (prev?.id) {
        await notifications.cancelReminder(prev.id);
      }
      await prefs.removePref(REMINDER_PREF_KEY);
    },
  };
}
