// app/lib/prefs.web.ts — F5.2 (ADR-0038)
//
// KV de PREFERÊNCIAS de UI no BROWSER. Paridade de tipos com o nativo (`prefs.ts`),
// só o backend muda: no web usamos `localStorage` (persistência local do navegador,
// sobrevive a reloads/reaberturas) em vez do arquivo JSON sob o documentDirectory.
//
// Por que `localStorage` (e não o cofre de sessão do keystore): preferências de UI
// NÃO são segredos — o idioma escolhido é dado NÃO-sensível e device-local, então
// persistir em `localStorage` é adequado e desejável (a escolha sobrevive à sessão).
// Isto é o OPOSTO da política de CHAVES BYOK no web (`keystore.web.ts`, ADR-0025),
// que são session-only/in-memory JUSTAMENTE por serem segredos. Nenhuma preferência
// é logada; nada aqui toca a rede (offline-first).
//
// O Metro escolhe este `.web.ts` no web e mantém `expo-file-system` FORA do bundle web.

// Namespace das entradas (paridade com o nativo) — só o NOME da preferência.
const PREF_PREFIX = 'tla.pref.';

/** Id namespaceado de uma preferência (paridade com o nativo). */
export function prefIdFor(key: string): string {
  return `${PREF_PREFIX}${key}`;
}

/** Backend mínimo de storage KV (paridade de tipo com o nativo). */
export interface PrefsBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Guarda de `localStorage` (SSR/ambientes sem DOM): degrada para no-op se ausente,
// nunca lança (offline-first: falha de storage não quebra a UI).
function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Backend padrão WEB: `localStorage` (persiste entre reloads/reaberturas). Envolto
 * em try/catch para nunca lançar em modo privado/sem storage.
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

/** Superfície pública do KV de preferências (idêntica ao nativo). */
export interface Prefs {
  getPref(key: string): Promise<string | null>;
  setPref(key: string, value: string): Promise<void>;
  removePref(key: string): Promise<void>;
}

/**
 * Cria um KV de preferências sobre um `PrefsBackend`. Por padrão usa `localStorage`;
 * o teste headless injeta um backend fake para provar o round-trip. A LÓGICA
 * (namespacing por `prefIdFor`) é IDÊNTICA ao nativo — só o backend muda.
 */
export function createPrefs(backend: PrefsBackend = localStorageBackend): Prefs {
  return {
    getPref: (key) => backend.getItem(prefIdFor(key)),
    setPref: (key, value) => backend.setItem(prefIdFor(key), value),
    removePref: (key) => backend.removeItem(prefIdFor(key)),
  };
}

// KV padrão do app WEB (localStorage) + funções ligadas a ele — o Metro resolve este
// `.web.ts` no web; a superfície é idêntica ao nativo (o `I18nProvider` é compartilhado).
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
