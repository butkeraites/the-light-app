// app/lib/syncPrefs.ts — F5.26 (ADR-0054, sobre F5.2/ADR-0038 e ADR-0036)
//
// Flag OPT-IN de SINCRONIZAÇÃO (OFF por padrão), persistido no KV OFFLINE da F5.2
// (`prefs`). É o interruptor mestre da trilha de sync (ADR-0036): OFF por padrão
// significa OFFLINE-FIRST puro — ZERO rede/conta sem uma ação explícita do usuário.
// Enquanto OFF, a tela de sync (F5.26) NÃO habilita nenhum transporte de rede
// (Google Drive); só o backup manual LOCAL (export/import, sem rede) fica disponível.
//
// Molde: `planReminders.shared.ts` (F5.13) — lógica PURA sobre um KV injetável, para
// provar o default-OFF + persistência HEADLESS (sem device), e uma instância padrão
// ligada ao `createPrefs()` do app (arquivo JSON nativo / localStorage web).
//
// NÃO-SEGREDO: o flag é uma preferência de UI booleana ('true'/ausente) — nunca uma
// chave/token. O token do Drive vive só no TokenStore da F5.24 (session/secure
// storage), JAMAIS aqui e jamais em git/log. Nada é logado neste módulo.
import { createPrefs } from './prefs';

/** Chave (namespaceada por `prefIdFor` no KV da F5.2) do flag opt-in de sync. */
export const SYNC_OPTIN_PREF_KEY = 'sync.optIn';

/**
 * Subconjunto do KV de prefs (F5.2) que este serviço usa. `Prefs` de `./prefs` é
 * estruturalmente compatível — no nativo grava em arquivo JSON local, no web em
 * `localStorage`; a prova headless injeta um backend em memória.
 */
export interface SyncPrefStore {
  getPref(key: string): Promise<string | null>;
  setPref(key: string, value: string): Promise<void>;
  removePref(key: string): Promise<void>;
}

/** Superfície pública do flag opt-in de sync (idêntica no nativo e no web). */
export interface SyncPrefs {
  /** Lê o opt-in; **default OFF** (KV vazio / valor != 'true' → `false`). */
  getSyncOptIn(): Promise<boolean>;
  /** Liga/desliga o opt-in; desligar REMOVE a chave (volta ao default OFF). */
  setSyncOptIn(enabled: boolean): Promise<void>;
}

/**
 * Cria o serviço do flag opt-in sobre um KV de prefs. **Default OFF por design**: a
 * ausência da chave (ou qualquer valor que não seja exatamente `'true'`) lê como
 * `false` — o app nunca liga sync sem uma gravação explícita. A prova headless injeta
 * um KV em memória e confere: KV vazio → `false`; `setSyncOptIn(true)` grava e relê
 * `true`; `setSyncOptIn(false)` remove e volta a `false`.
 */
export function createSyncPrefs(prefs: SyncPrefStore): SyncPrefs {
  return {
    async getSyncOptIn() {
      const raw = await prefs.getPref(SYNC_OPTIN_PREF_KEY);
      return raw === 'true'; // default OFF: null / 'false' / lixo → false
    },
    async setSyncOptIn(enabled) {
      if (enabled) {
        await prefs.setPref(SYNC_OPTIN_PREF_KEY, 'true');
      } else {
        await prefs.removePref(SYNC_OPTIN_PREF_KEY); // volta ao default OFF
      }
    },
  };
}

// Instância padrão do app (KV = arquivo JSON nativo / localStorage web). A construção
// é side-effect-free (o `createPrefs()` não toca o storage até um método rodar).
const defaultSyncPrefs = createSyncPrefs(createPrefs());

/** Lê o opt-in de sync do app (default OFF). */
export function getSyncOptIn(): Promise<boolean> {
  return defaultSyncPrefs.getSyncOptIn();
}
/** Liga/desliga o opt-in de sync do app (persiste offline). */
export function setSyncOptIn(enabled: boolean): Promise<void> {
  return defaultSyncPrefs.setSyncOptIn(enabled);
}
