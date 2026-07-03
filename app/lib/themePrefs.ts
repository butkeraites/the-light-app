// app/lib/themePrefs.ts — F5.14 (ADR-0043; amendment ao ADR-0015)
//
// LÓGICA PURA (offline, dependency-free) da PERSISTÊNCIA do MODO DE TEMA (claro/escuro)
// no KV de prefs da F5.2. É consumida pelo `ThemeProvider` (`theme.ts`), mas mantida
// SEPARADA de propósito: NÃO importa `react-native` (`useColorScheme`) nem `react`, de
// modo que a prova headless (node, sem device/browser, sem rede) possa bundlar SÓ estas
// funções puras + o KV. Molde: `planReminders.shared.ts` (F5.13) — orquestra o KV, sem I/O.
//
// OFFLINE-FIRST: o modo escolhido persiste no MESMO KV da F5.2 (arquivo JSON nativo /
// localStorage web), sob a chave NAMESPACEADA `tla.pref.theme.mode`. REUSA a infra — NÃO
// cria um 2º mecanismo de persistência (fecha a lacuna 'persistência entre reinícios é
// futura' do ADR-0015). Só assume 'light'|'dark'|AUSENTE (ausência = seguir o esquema do
// sistema, comportamento F1.4 preservado); nenhum outro estado; a preferência nunca é logada.

/** Modo de tema aplicável (override). AUSÊNCIA = seguir o esquema do sistema (F1.4). */
export type ThemeMode = 'light' | 'dark';

/** Modos de tema válidos, em ordem canônica. */
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark'] as const;

/**
 * Chave da preferência OFFLINE onde o modo de tema é persistido. Namespaceada pelo KV da
 * F5.2 (`prefIdFor` → `tla.pref.theme.mode`); só o NOME da preferência, nada sensível.
 */
export const THEME_PREF_KEY = 'theme.mode';

/**
 * True se `value` é um `ThemeMode` válido (`light`/`dark`). PURA, case-sensitive. Barra
 * qualquer valor desconhecido/corrompido no storage (offline-first: um valor inválido é
 * ignorado e o app volta a seguir o esquema do sistema, nunca quebra).
 */
export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value != null && (THEME_MODES as readonly string[]).includes(value);
}
