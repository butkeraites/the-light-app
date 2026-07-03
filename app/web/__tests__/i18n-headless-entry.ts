// i18n-headless-entry.ts — F5.2 (ADR-0038; molde keystore-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless da camada de i18n + KV de prefs. É
// empacotado (esbuild) por `i18n.test.mjs` num único `.mjs` e executado em node SEM
// device/browser. Reexporta APENAS a superfície PURA que a prova exercita:
//   - i18n: catálogos + `translate`/`normalizeLocale`/`detectDeviceLocale` + metadados;
//   - prefs: `createPrefs` (com backend INJETÁVEL em memória) + `prefIdFor`.
// O `defaultPrefsBackend` (arquivo nativo) importa `expo-file-system` de forma LAZY e
// é marcado `external` no bundle — a prova injeta um backend fake e nunca o aciona.
// Nenhuma lógica nova aqui.
import {
  CATALOGS,
  LOCALES,
  MESSAGE_KEYS,
  LOCALE_PREF_KEY,
  isLocale,
  normalizeLocale,
  detectDeviceLocale,
  translate,
} from '../../lib/i18n';
import type { Locale, MessageKey } from '../../lib/i18n';
import { createPrefs, prefIdFor } from '../../lib/prefs';
import type { PrefsBackend } from '../../lib/prefs';

export {
  CATALOGS,
  LOCALES,
  MESSAGE_KEYS,
  LOCALE_PREF_KEY,
  isLocale,
  normalizeLocale,
  detectDeviceLocale,
  translate,
  createPrefs,
  prefIdFor,
};
export type { Locale, MessageKey, PrefsBackend };
