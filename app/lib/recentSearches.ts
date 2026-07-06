// app/lib/recentSearches.ts — ADR-0064 (busca inteligente; molde themePrefs/readingPrefs)
//
// BUSCAS RECENTES persistidas OFFLINE no MESMO KV de prefs da F5.2 (`prefs.ts`), sob a chave
// namespaceada `tla.pref.search.recent` (JSON de strings, mais nova primeiro, capado). Mostradas
// como atalhos quando o campo de busca está vazio. Reusa a infra — sem 2º mecanismo, sem rede.
//
// DEDUP por forma dobrada (não repete "Graça"/"graça"); guarda a grafia ORIGINAL do usuário. Um
// valor corrompido no storage é tratado como lista vazia (offline-first: nunca quebra). O termo
// é dado do usuário — nunca logado; anti-alucinação não se aplica (não é texto bíblico).

import { fold } from './searchNormalize';
import { getPref, removePref, setPref } from './prefs';

/** Chave da preferência (namespaceada por `prefIdFor` → `tla.pref.search.recent`). */
export const RECENT_KEY = 'search.recent';
/** Máx. de buscas recentes guardadas. */
export const RECENT_MAX = 8;

/** Subconjunto do KV usado aqui — INJETÁVEL para a prova headless (molde do keystore). */
export type RecentBackend = {
  getPref(key: string): Promise<string | null>;
  setPref(key: string, value: string): Promise<void>;
  removePref(key: string): Promise<void>;
};

const defaultBackend: RecentBackend = { getPref, setPref, removePref };

/** Parseia a lista persistida (JSON de strings). Corrompido/ausente → `[]` (nunca lança). */
function parse(raw: string | null): string[] {
  if (raw == null) {
    return [];
  }
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Lê as buscas recentes (mais nova primeiro). */
export async function getRecentSearches(backend: RecentBackend = defaultBackend): Promise<string[]> {
  return parse(await backend.getPref(RECENT_KEY));
}

/**
 * Registra um termo: apara, ignora vazio, DEDUP por forma dobrada (remove a ocorrência antiga),
 * insere no topo e capa em `RECENT_MAX`. Persiste offline (fire-and-forget tolerante a falha).
 */
export async function pushRecentSearch(
  term: string,
  backend: RecentBackend = defaultBackend,
): Promise<void> {
  const t = term.trim();
  if (t.length === 0) {
    return;
  }
  const key = fold(t);
  const prev = (await getRecentSearches(backend)).filter((x) => fold(x) !== key);
  const next = [t, ...prev].slice(0, RECENT_MAX);
  try {
    await backend.setPref(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* persistência é tolerada (offline-first) */
  }
}

/** Limpa o histórico de buscas. */
export async function clearRecentSearches(backend: RecentBackend = defaultBackend): Promise<void> {
  try {
    await backend.removePref(RECENT_KEY);
  } catch {
    /* tolerado */
  }
}
