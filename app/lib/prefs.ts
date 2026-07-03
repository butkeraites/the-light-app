// app/lib/prefs.ts — F5.2 (ADR-0038)
//
// KV de PREFERÊNCIAS de UI, 100% OFFLINE e dependency-free. Guarda pares
// `string → string` (ex.: idioma da UI escolhido) para que a escolha do usuário
// SOBREVIVA a reinícios do app SEM rede, sem conta e sem dependência nova. É o
// alicerce reutilizável do workstream de i18n/temas (o mesmo KV servirá, no
// futuro, para persistir o modo de tema — hoje só na sessão, ADR-0015).
//
// DISTINTO do keystore (`keystore.ts`): o keystore guarda SEGREDOS BYOK no cofre
// seguro do device (Keychain/Keystore) e NUNCA em storage comum; este KV guarda
// PREFERÊNCIAS NÃO-secretas (idioma, futuros ajustes) — nada sensível, nunca uma
// chave/segredo. Por isso, no nativo, um arquivo JSON simples sob o
// documentDirectory basta (molde `userdata.ts`), e no web um `localStorage`
// (`prefs.web.ts`). Nenhuma preferência é logada.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `prefs.web.ts` (localStorage) — o que mantém `expo-file-system` FORA do bundle
// web. O backend padrão importa `expo-file-system/legacy` de forma LAZY (dynamic
// import), só quando um método é de fato invocado — o que também mantém o serviço
// testável headless com um `PrefsBackend` INJETÁVEL em memória (molde
// `SecureBackend` do keystore).

// Namespace das entradas: prefixa toda chave (evita colisão com outras entradas
// do storage). Contém só o NOME da preferência, nunca dado sensível.
const PREF_PREFIX = 'tla.pref.';

/** Id namespaceado de uma preferência (ex.: `tla.pref.ui.locale`). */
export function prefIdFor(key: string): string {
  return `${PREF_PREFIX}${key}`;
}

// Nome do arquivo JSON de preferências sob o documentDirectory (nativo).
const PREFS_FILENAME = 'prefs.json';

/**
 * Backend mínimo de storage KV (subconjunto get/set/remove por chave). Injetável
 * para testar a LÓGICA do serviço headless, sem device e sem I/O real (molde
 * `SecureBackend` do keystore).
 */
export interface PrefsBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// Lê TODO o objeto de preferências do arquivo JSON (ou `{}` se ausente/ilegível).
// Import LAZY de `expo-file-system` — mantém o módulo nativo fora de qualquer
// bundle que não o use e permite injetar um backend fake no teste headless.
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
 * Backend padrão NATIVO: um único arquivo `prefs.json` sob o documentDirectory do
 * app (I/O local via `expo-file-system/legacy`). Cada operação lê o objeto inteiro,
 * aplica a mudança e reescreve — simples e suficiente para o punhado de preferências
 * de UI. Import LAZY do `expo-file-system` (fora do bundle que não o use).
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
 * Cria um KV de preferências sobre um `PrefsBackend`. Por padrão usa o arquivo JSON
 * nativo; o teste headless injeta um backend fake em memória para provar o round-trip
 * de persistência sem device. A LÓGICA (namespacing por `prefIdFor`) é idêntica no
 * nativo e no web — só o backend muda (arquivo vs. localStorage).
 */
export function createPrefs(backend: PrefsBackend = defaultPrefsBackend): Prefs {
  return {
    getPref: (key) => backend.getItem(prefIdFor(key)),
    setPref: (key, value) => backend.setItem(prefIdFor(key), value),
    removePref: (key) => backend.removeItem(prefIdFor(key)),
  };
}

// KV padrão do app (arquivo JSON nativo) + funções ligadas a ele, para o
// `I18nProvider` e futuros consumidores importarem direto.
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
