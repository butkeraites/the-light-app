// app/lib/prefs.ts — F5.2 (ADR-0038) · deepening ADR-0073 (leaf NATIVO)
//
// Backend NATIVO do KV de preferências: um arquivo JSON `prefs.json` sob o documentDirectory (molde
// `userdata.ts`). A LÓGICA (namespacing + `createPrefs` — o módulo profundo) vive em `prefs.shared.ts`
// e é re-exportada aqui; este arquivo traz SÓ o `PrefsBackend` de arquivo + o KV ligado + os wrappers.
// Resolução por extensão do Metro: `.ts` no NATIVO, `prefs.web.ts` (localStorage) no web. O import de
// `expo-file-system/legacy` é LAZY — fora de qualquer bundle que não o use, e testável headless.
export { prefIdFor, type Prefs, type PrefsBackend } from './prefs.shared';

import { createPrefs as createPrefsWith, type Prefs, type PrefsBackend } from './prefs.shared';

// Nome do arquivo JSON de preferências sob o documentDirectory (nativo).
const PREFS_FILENAME = 'prefs.json';

// Lê TODO o objeto de preferências do arquivo JSON (ou `{}` se ausente/ilegível). Import LAZY de
// `expo-file-system` — mantém o módulo nativo fora de qualquer bundle que não o use.
async function readAllNative(): Promise<Record<string, string>> {
  const FileSystem = await import('expo-file-system/legacy');
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    return {};
  }
  const uri = `${dir}${PREFS_FILENAME}`;
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    return {};
  }
  const raw = await FileSystem.readAsStringAsync(uri);
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    // Arquivo corrompido → trata como vazio (offline-first: nunca quebra a UI).
    return {};
  }
}

async function writeAllNative(all: Record<string, string>): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const dir = FileSystem.documentDirectory;
  if (!dir) {
    throw new Error('FileSystem.documentDirectory indisponível neste alvo.');
  }
  const uri = `${dir}${PREFS_FILENAME}`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(all));
}

/**
 * Backend padrão NATIVO: um único arquivo `prefs.json` sob o documentDirectory (I/O local via
 * `expo-file-system/legacy`). Cada operação lê o objeto inteiro, aplica a mudança e reescreve — simples
 * e suficiente para o punhado de preferências de UI. Import LAZY do `expo-file-system`.
 */
export const defaultPrefsBackend: PrefsBackend = {
  async getItem(key) {
    const all = await readAllNative();
    return key in all ? all[key] : null;
  },
  async setItem(key, value) {
    const all = await readAllNative();
    all[key] = value;
    await writeAllNative(all);
  },
  async removeItem(key) {
    const all = await readAllNative();
    if (key in all) {
      delete all[key];
      await writeAllNative(all);
    }
  },
};

/**
 * Cria um KV de preferências. Sem argumento usa o backend padrão NATIVO (arquivo JSON); o teste
 * headless injeta um backend fake. A LÓGICA (namespacing) vive em `prefs.shared` (`createPrefsWith`).
 */
export function createPrefs(backend: PrefsBackend = defaultPrefsBackend): Prefs {
  return createPrefsWith(backend);
}

// KV padrão do app (arquivo JSON nativo) + funções ligadas a ele, para o `I18nProvider` e outros
// consumidores importarem direto.
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
