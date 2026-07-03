// theme.test.mjs — F5.14 (ADR-0043; amendment ao ADR-0015; molde i18n.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser, SEM rede) da PERSISTÊNCIA do MODO DE TEMA
// (claro/escuro) no MESMO KV de prefs OFFLINE da F5.2 — fecha a lacuna 'persistência entre
// reinícios é futura' do ADR-0015 reusando a infra (NÃO um 2º mecanismo). Bundla (esbuild)
// `app/lib/themePrefs.ts` (lógica PURA, sem react-native) + `app/lib/prefs.ts` (com um
// `PrefsBackend` FAKE em memória injetado) e assevera, deterministicamente:
//   1) GUARD `isThemeMode`: só 'light'/'dark' são override válido; 'system'/''/null/
//      undefined/case-diferente → false (ausência = seguir o esquema do sistema, F1.4);
//   2) ROUND-TRIP + REABRIR: setPref(theme.mode='dark') → getPref; a escolha SOBREVIVE a
//      uma NOVA instância de `Prefs` sobre o MESMO storage (simula reabrir o app) e
//      re-hidrata via `isThemeMode`; grava sob a chave NAMESPACEADA `tla.pref.theme.mode`
//      (nunca a chave crua);
//   3) SEM override salvo: `removePref` limpa o modo (o app volta a seguir o sistema);
//   4) toggle SIMÉTRICO: cada valor ('light'/'dark') round-trips e re-hidrata; um valor
//      DESCONHECIDO no storage é ignorado pelo guard (offline-first: nunca quebra);
//   5) HIGIENE: `themePrefs.ts`/`theme.ts` não contêm `console.*` (pref de tema nunca logada).
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'theme-headless-entry.ts');
const THEME_PREFS_TS = join(__dirname, '..', '..', 'lib', 'themePrefs.ts');
const THEME_TS = join(__dirname, '..', '..', 'lib', 'theme.ts');

async function loadBundle() {
  const outfile = join(tmpdir(), `theme-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    // O backend padrão do prefs importa `expo-file-system` de forma lazy; a prova injeta
    // um fake em memória e nunca o aciona — mantê-lo EXTERNAL evita puxar o módulo nativo.
    external: ['expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

// Backend FAKE de prefs em memória (subconjunto get/set/remove). Espelha o storage.
function makeMemBackend() {
  const store = new Map();
  return {
    store,
    async getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
  };
}

async function main() {
  const { THEME_MODES, THEME_PREF_KEY, isThemeMode, createPrefs, prefIdFor } = await loadBundle();

  // ══ (1) GUARD isThemeMode — só light/dark são override válido ═══════════════════════════
  assert.deepEqual([...THEME_MODES], ['light', 'dark'], 'THEME_MODES = [light, dark]');
  assert.equal(THEME_PREF_KEY, 'theme.mode', 'chave da preferência de tema');
  assert.ok(isThemeMode('light'), "isThemeMode('light')");
  assert.ok(isThemeMode('dark'), "isThemeMode('dark')");
  assert.ok(!isThemeMode('system'), "'system' NÃO é override válido (ausência = seguir o sistema)");
  assert.ok(!isThemeMode(''), "'' inválido");
  assert.ok(!isThemeMode(null), 'null inválido (ausência de override)');
  assert.ok(!isThemeMode(undefined), 'undefined inválido');
  assert.ok(!isThemeMode('Light'), "case-sensitive: 'Light' inválido");

  // ══ (2) ROUND-TRIP de persistência OFFLINE + re-hidratação (reabrir o app) ══════════════
  const backend = makeMemBackend();
  const prefs = createPrefs(backend);

  assert.equal(await prefs.getPref(THEME_PREF_KEY), null, 'sem modo salvo no início (segue o sistema)');
  await prefs.setPref(THEME_PREF_KEY, 'dark');
  assert.equal(await prefs.getPref(THEME_PREF_KEY), 'dark', 'getPref devolve o modo salvo');
  // O storage guarda sob a chave NAMESPACEADA (nunca a chave crua) — paridade com o i18n.
  assert.equal(prefIdFor(THEME_PREF_KEY), 'tla.pref.theme.mode', 'prefIdFor namespaceia a chave do tema');
  assert.ok(backend.store.has('tla.pref.theme.mode'), 'valor gravado sob a chave namespaceada');
  assert.ok(!backend.store.has(THEME_PREF_KEY), 'a chave CRUA não é usada no storage');

  // Simula REABRIR o app: uma NOVA instância de Prefs sobre o MESMO storage lê a escolha.
  const prefsReopened = createPrefs(backend);
  const saved = await prefsReopened.getPref(THEME_PREF_KEY);
  assert.equal(saved, 'dark', 'o modo SOBREVIVE a uma nova instância (reabrir o app)');
  // E re-hidrata para um ThemeMode válido via isThemeMode (o que o ThemeProvider faz no boot).
  assert.ok(isThemeMode(saved), 'o valor salvo re-hidrata como ThemeMode válido');

  // ══ (3) SEM override → removePref volta a seguir o esquema do sistema ═══════════════════
  await prefs.removePref(THEME_PREF_KEY);
  assert.equal(await prefs.getPref(THEME_PREF_KEY), null, 'removePref limpa o modo (volta ao sistema)');
  assert.ok(!backend.store.has('tla.pref.theme.mode'), 'storage sem a entrada após remove');

  // ══ (4) toggle SIMÉTRICO: cada valor round-trips e re-hidrata; desconhecido é ignorado ══
  for (const m of THEME_MODES) {
    await prefs.setPref(THEME_PREF_KEY, m);
    const reopened = createPrefs(backend);
    const back = await reopened.getPref(THEME_PREF_KEY);
    assert.equal(back, m, `modo '${m}' sobrevive ao reabrir`);
    assert.ok(isThemeMode(back), `modo '${m}' re-hidrata válido`);
  }
  // Um valor corrompido/desconhecido no storage NÃO vira override (guard barra → segue o sistema).
  await prefs.setPref(THEME_PREF_KEY, 'sepia');
  const bad = await prefs.getPref(THEME_PREF_KEY);
  assert.equal(bad, 'sepia', 'o KV devolve o valor cru (não filtra)');
  assert.ok(!isThemeMode(bad), 'valor desconhecido é ignorado pelo guard (segue o esquema do sistema)');
  await prefs.removePref(THEME_PREF_KEY);

  // ══ (5) HIGIENE de log: themePrefs/theme não contêm `console.*` ═════════════════════════
  const themePrefsSrc = await readFile(THEME_PREFS_TS, 'utf8');
  const themeSrc = await readFile(THEME_TS, 'utf8');
  assert.ok(!/console\./.test(themePrefsSrc), 'themePrefs.ts sem `console.*`');
  assert.ok(!/console\./.test(themeSrc), 'theme.ts sem `console.*` (preferência de tema nunca logada)');

  console.log('PASS — persistência do MODO DE TEMA no KV de prefs OFFLINE (backend fake, sem device/rede):');
  console.log('  guard isThemeMode: só light/dark; system/vazio/null/undefined/case-diferente → inválido');
  console.log('  round-trip: setPref(theme.mode=dark) SOBREVIVE a nova instância (reabrir); chave namespaceada tla.pref.theme.mode');
  console.log('  removePref volta a seguir o esquema do sistema; valor desconhecido no storage ignorado pelo guard');
  console.log('  toggle simétrico: light/dark round-trips e re-hidratam');
  console.log('  higiene: themePrefs.ts / theme.ts sem console.* (pref de tema nunca logada)');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
