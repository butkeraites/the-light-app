// app/lib/prefs.shared.ts — F5.2 (ADR-0038) · deepening ADR-0073
//
// MÓDULO PROFUNDO do KV de PREFERÊNCIAS de UI, agnóstico de plataforma: o namespacing (`tla.pref.<key>`)
// e a superfície `createPrefs`. Era copiado BYTE-A-BYTE em `prefs.ts` (nativo, arquivo JSON) e
// `prefs.web.ts` (web, localStorage) — só o BACKEND diferia. Aqui a lógica vive UMA vez; cada leaf traz
// só o seu `PrefsBackend`. Molde: `snapshotStore.shared.ts`/`keystore.shared.ts`.
//
// DISTINTO do keystore: guarda PREFERÊNCIAS NÃO-secretas (idioma, ajustes) — nada sensível. Offline,
// sem rede; nenhuma preferência é logada.

// Namespace das entradas: prefixa toda chave (evita colisão). Só o NOME da preferência, nada sensível.
const PREF_PREFIX = 'tla.pref.';

/** Id namespaceado de uma preferência (ex.: `tla.pref.ui.locale`). */
export function prefIdFor(key: string): string {
  return `${PREF_PREFIX}${key}`;
}

/**
 * Backend mínimo de storage KV (get/set/remove por chave). Injetável para testar a LÓGICA headless, sem
 * device/I/O real; é o ÚNICO ponto que difere entre nativo (arquivo JSON) e web (localStorage).
 */
export interface PrefsBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Superfície pública do KV de preferências (idêntica no nativo e no web). */
export interface Prefs {
  /** Lê uma preferência (ou `null` se ausente). */
  getPref(key: string): Promise<string | null>;
  /** Grava uma preferência (`string → string`), offline. */
  setPref(key: string, value: string): Promise<void>;
  /** Remove uma preferência (idempotente) — volta ao default do app. */
  removePref(key: string): Promise<void>;
}

/**
 * Cria um KV de preferências sobre um `PrefsBackend`. O backend é OBRIGATÓRIO — cada plataforma injeta
 * o seu (nativo: arquivo JSON; web: localStorage; teste: fake). O namespacing (`prefIdFor`) vive AQUI.
 */
export function createPrefs(backend: PrefsBackend): Prefs {
  return {
    getPref: (key) => backend.getItem(prefIdFor(key)),
    setPref: (key, value) => backend.setItem(prefIdFor(key), value),
    removePref: (key) => backend.removeItem(prefIdFor(key)),
  };
}
