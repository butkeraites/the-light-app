// prefs-headless-entry.ts — ADR-0073
//
// Barrel fino p/ o esbuild-bundle da guarda: re-exporta a superfície do KV de prefs do leaf nativo
// (`../../lib/prefs`), que re-exporta de `prefs.shared`. `expo-file-system/legacy` é marcado `external`
// no teste (o backend fake injetado é o único usado; o backend nativo nunca é invocado). Sem lógica nova.
export { createPrefs, prefIdFor } from '../../lib/prefs';
export type { PrefsBackend } from '../../lib/prefs';
