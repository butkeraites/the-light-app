// app/lib/prefs.web.ts — F5.2 (ADR-0038) · deepening ADR-0073 (leaf WEB)
//
// Backend WEB do KV de preferências: `localStorage` (persiste entre reloads/reaberturas). A LÓGICA
// (namespacing + `createPrefs` — o módulo profundo) vive em `prefs.shared.ts` e é re-exportada aqui;
// este arquivo traz SÓ o `PrefsBackend` de localStorage + o KV ligado + os wrappers.
//
// Por que `localStorage` (e não o cofre de sessão do keystore): preferências de UI NÃO são segredos — o
// idioma escolhido é dado NÃO-sensível e device-local, então persistir é adequado (a escolha sobrevive à
// sessão). Isto é o OPOSTO da política de CHAVES BYOK web (`keystore.web.ts`, ADR-0025), session-only
// JUSTAMENTE por serem segredos. Nenhuma preferência é logada; nada aqui toca a rede (offline-first). O
// Metro escolhe este `.web.ts` e mantém `expo-file-system` FORA do bundle web.
export { prefIdFor, type Prefs, type PrefsBackend } from './prefs.shared';

import { createPrefs as createPrefsWith, type Prefs, type PrefsBackend } from './prefs.shared';

// Guarda de `localStorage` (SSR/ambientes sem DOM): degrada para no-op se ausente, nunca lança
// (offline-first: falha de storage não quebra a UI).
function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Backend padrão WEB: `localStorage` (persiste entre reloads/reaberturas). Envolto em try/catch para
 * nunca lançar em modo privado/sem storage.
 */
export const localStorageBackend: PrefsBackend = {
  async getItem(key) {
    const ls = safeLocalStorage();
    if (!ls) {
      return null;
    }
    try {
      return ls.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    const ls = safeLocalStorage();
    if (!ls) {
      return;
    }
    try {
      ls.setItem(key, value);
    } catch {
      /* modo privado / cota — offline-first: não quebra a UI */
    }
  },
  async removeItem(key) {
    const ls = safeLocalStorage();
    if (!ls) {
      return;
    }
    try {
      ls.removeItem(key);
    } catch {
      /* idem */
    }
  },
};

/**
 * Cria um KV de preferências. Sem argumento usa o backend padrão WEB (`localStorage`); o teste headless
 * injeta um backend fake. A LÓGICA (namespacing) vive em `prefs.shared` (`createPrefsWith`).
 */
export function createPrefs(backend: PrefsBackend = localStorageBackend): Prefs {
  return createPrefsWith(backend);
}

// KV padrão do app WEB (localStorage) + funções ligadas a ele — o Metro resolve este `.web.ts` no web;
// a superfície é idêntica ao nativo (o `I18nProvider` é compartilhado).
const defaultPrefs = createPrefs();

export function getPref(key: string): Promise<string | null> {
  return defaultPrefs.getPref(key);
}
export function setPref(key: string, value: string): Promise<void> {
  return defaultPrefs.setPref(key, value);
}
export function removePref(key: string): Promise<void> {
  return defaultPrefs.removePref(key);
}
