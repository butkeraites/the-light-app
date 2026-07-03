// theme-headless-entry.ts — F5.14 (ADR-0043; molde i18n-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless da PERSISTÊNCIA do modo de tema. É
// empacotado (esbuild) por `theme.test.mjs` num único `.mjs` e executado em node SEM
// device/browser/rede. Reexporta APENAS a superfície PURA que a prova exercita:
//   - themePrefs: `THEME_MODES`/`THEME_PREF_KEY`/`isThemeMode` (sem `react-native`);
//   - prefs: `createPrefs` (com backend INJETÁVEL em memória) + `prefIdFor`.
// O `defaultPrefsBackend` (arquivo nativo) importa `expo-file-system` de forma LAZY e é
// marcado `external` no bundle — a prova injeta um backend fake e nunca o aciona. NÃO
// importa `theme.ts` (que puxa `react-native`): a lógica de persistência é pura e isolada.
import { THEME_MODES, THEME_PREF_KEY, isThemeMode } from '../../lib/themePrefs';
import type { ThemeMode } from '../../lib/themePrefs';
import { createPrefs, prefIdFor } from '../../lib/prefs';
import type { PrefsBackend } from '../../lib/prefs';

export { THEME_MODES, THEME_PREF_KEY, isThemeMode, createPrefs, prefIdFor };
export type { ThemeMode, PrefsBackend };
