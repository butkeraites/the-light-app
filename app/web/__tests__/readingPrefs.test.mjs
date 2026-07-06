// readingPrefs.test.mjs — ADR-0063 (molde theme.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser/rede) das PREFERÊNCIAS DE LEITURA (tamanho/
// entrelinha/tema/família/justificação) persistidas no MESMO KV de prefs OFFLINE da F5.2.
// Bundla (esbuild) `readingPrefs.ts` (lógica PURA) + `prefs.ts` (com backend FAKE em memória)
// e assevera, deterministicamente:
//   1) GUARDAS: `isReadingTheme`/`isLineSpacing`/`isReadingFont`/`isFontStep` aceitam só
//      valores canônicos; desconhecido/vazio/null/case-diferente → false;
//   2) ESCALA: `clampFontStep` limita à faixa; `fontScaleForStep` devolve o fator; passo
//      default = fator 1.0; `parseFontStep` tolera lixo (→ default);
//   3) ROUND-TRIP + REABRIR: cada preferência round-trips no KV sob a chave NAMESPACEADA e
//      SOBREVIVE a uma nova instância de `Prefs` (simular reabrir o app);
//   4) DEFAULTS na ausência: sem valor salvo, os parsers/guards devolvem o default (o leitor
//      volta ao padrão), e um valor corrompido é ignorado (offline-first);
//   5) HIGIENE: `readingPrefs.ts` sem `console.*` (preferência nunca logada).
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
const ENTRY = join(__dirname, 'readingPrefs-headless-entry.ts');
const READING_PREFS_TS = join(__dirname, '..', '..', 'lib', 'readingPrefs.ts');

async function loadBundle() {
  const outfile = join(tmpdir(), `readingprefs-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    external: ['expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

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
  const m = await loadBundle();
  const {
    READING_THEMES,
    READING_THEME_KEY,
    isReadingTheme,
    LINE_SPACINGS,
    LINE_HEIGHT_FACTOR,
    READING_SPACING_KEY,
    DEFAULT_LINE_SPACING,
    isLineSpacing,
    READING_FONTS,
    READING_FONT_KEY,
    DEFAULT_READING_FONT,
    isReadingFont,
    FONT_SCALE_STEPS,
    DEFAULT_FONT_STEP,
    READING_FONT_STEP_KEY,
    isFontStep,
    clampFontStep,
    fontScaleForStep,
    fontStepToString,
    parseFontStep,
    READING_JUSTIFY_KEY,
    DEFAULT_JUSTIFY,
    justifyToString,
    parseJustify,
    createPrefs,
    prefIdFor,
  } = m;

  // ══ (1) GUARDAS canônicas ══════════════════════════════════════════════════════════════
  assert.deepEqual([...READING_THEMES], ['light', 'sepia', 'dark'], 'temas de leitura');
  assert.ok(isReadingTheme('light') && isReadingTheme('sepia') && isReadingTheme('dark'), 'temas válidos');
  assert.ok(!isReadingTheme('system') && !isReadingTheme('') && !isReadingTheme(null) && !isReadingTheme('Dark'), 'temas inválidos barrados');
  assert.deepEqual([...LINE_SPACINGS], ['compact', 'comfortable', 'relaxed'], 'entrelinhas');
  assert.ok(isLineSpacing('comfortable') && !isLineSpacing('cozy') && !isLineSpacing(null), 'guard de entrelinha');
  assert.deepEqual([...READING_FONTS], ['serif', 'sans'], 'famílias');
  assert.ok(isReadingFont('serif') && !isReadingFont('mono') && !isReadingFont(undefined), 'guard de família');

  // ══ (2) ESCALA de tamanho ══════════════════════════════════════════════════════════════
  assert.equal(FONT_SCALE_STEPS[DEFAULT_FONT_STEP], 1, 'passo default = fator 1.0 (sem escala)');
  assert.ok(isFontStep(0) && isFontStep(FONT_SCALE_STEPS.length - 1), 'extremos são passos válidos');
  assert.ok(!isFontStep(-1) && !isFontStep(FONT_SCALE_STEPS.length) && !isFontStep(1.5), 'fora da faixa/não-inteiro inválido');
  assert.equal(clampFontStep(-5), 0, 'clamp abaixo → 0');
  assert.equal(clampFontStep(999), FONT_SCALE_STEPS.length - 1, 'clamp acima → último');
  assert.equal(clampFontStep(2.4), 2, 'clamp arredonda');
  assert.equal(clampFontStep(Number.NaN), DEFAULT_FONT_STEP, 'clamp de NaN → default');
  assert.equal(fontScaleForStep(DEFAULT_FONT_STEP), 1, 'fator do passo default');
  assert.equal(parseFontStep(null), DEFAULT_FONT_STEP, 'ausência → passo default');
  assert.equal(parseFontStep('nope'), DEFAULT_FONT_STEP, 'lixo → passo default');
  assert.equal(parseFontStep('0'), 0, 'string válida parseia');
  // Tabela de entrelinha coerente (compacto < confortável < amplo).
  assert.ok(
    LINE_HEIGHT_FACTOR.compact < LINE_HEIGHT_FACTOR.comfortable &&
      LINE_HEIGHT_FACTOR.comfortable < LINE_HEIGHT_FACTOR.relaxed,
    'fatores de entrelinha crescem',
  );

  // ══ (3) ROUND-TRIP OFFLINE + re-hidratação (reabrir o app) ═════════════════════════════
  const backend = makeMemBackend();
  const prefs = createPrefs(backend);

  // Tema de leitura (string canônica).
  assert.equal(await prefs.getPref(READING_THEME_KEY), null, 'sem tema de leitura salvo (segue o app)');
  await prefs.setPref(READING_THEME_KEY, 'sepia');
  assert.equal(prefIdFor(READING_THEME_KEY), 'tla.pref.reading.theme', 'chave namespaceada do tema de leitura');
  assert.ok(backend.store.has('tla.pref.reading.theme') && !backend.store.has(READING_THEME_KEY), 'grava sob a chave namespaceada');
  // Passo de tamanho (serializado).
  await prefs.setPref(READING_FONT_STEP_KEY, fontStepToString(4));
  // Entrelinha, família, justificação.
  await prefs.setPref(READING_SPACING_KEY, 'relaxed');
  await prefs.setPref(READING_FONT_KEY, 'sans');
  await prefs.setPref(READING_JUSTIFY_KEY, justifyToString(true));

  // Simula REABRIR o app: nova instância sobre o MESMO storage lê e re-hidrata tudo.
  const reopened = createPrefs(backend);
  const savedTheme = await reopened.getPref(READING_THEME_KEY);
  assert.ok(isReadingTheme(savedTheme) && savedTheme === 'sepia', 'tema de leitura sobrevive e re-hidrata');
  assert.equal(parseFontStep(await reopened.getPref(READING_FONT_STEP_KEY)), 4, 'passo de tamanho sobrevive');
  const savedSpacing = await reopened.getPref(READING_SPACING_KEY);
  assert.ok(isLineSpacing(savedSpacing) && savedSpacing === 'relaxed', 'entrelinha sobrevive');
  const savedFont = await reopened.getPref(READING_FONT_KEY);
  assert.ok(isReadingFont(savedFont) && savedFont === 'sans', 'família sobrevive');
  assert.equal(parseJustify(await reopened.getPref(READING_JUSTIFY_KEY)), true, 'justificação sobrevive');

  // ══ (4) DEFAULTS na ausência + valor corrompido ignorado ═══════════════════════════════
  const fresh = createPrefs(makeMemBackend());
  assert.equal(parseFontStep(await fresh.getPref(READING_FONT_STEP_KEY)), DEFAULT_FONT_STEP, 'sem passo salvo → default');
  assert.equal(parseJustify(await fresh.getPref(READING_JUSTIFY_KEY)), DEFAULT_JUSTIFY, 'sem justificação salva → default (false)');
  assert.ok(!isReadingTheme(await fresh.getPref(READING_THEME_KEY)), 'sem tema salvo → guard barra (segue o app)');
  assert.equal(DEFAULT_LINE_SPACING, 'comfortable', 'default de entrelinha');
  assert.equal(DEFAULT_READING_FONT, 'serif', 'default de família (leitura em serifa)');
  // Um valor corrompido no storage é devolvido cru pelo KV, mas ignorado pelo guard.
  await prefs.setPref(READING_THEME_KEY, 'neon');
  assert.equal(await prefs.getPref(READING_THEME_KEY), 'neon', 'o KV devolve o valor cru (não filtra)');
  assert.ok(!isReadingTheme(await prefs.getPref(READING_THEME_KEY)), 'valor desconhecido ignorado pelo guard');

  // ══ (5) HIGIENE de log ═════════════════════════════════════════════════════════════════
  const src = await readFile(READING_PREFS_TS, 'utf8');
  assert.ok(!/console\./.test(src), 'readingPrefs.ts sem `console.*`');

  console.log('PASS — preferências de LEITURA no KV de prefs OFFLINE (backend fake, sem device/rede):');
  console.log('  guardas: tema (claro/sépia/escuro), entrelinha, família, passo de tamanho — só valores canônicos');
  console.log('  escala: passo default = fator 1.0; clamp/parse toleram lixo (→ default); entrelinha cresce');
  console.log('  round-trip: cada pref SOBREVIVE a reabrir; chaves namespaceadas tla.pref.reading.*');
  console.log('  defaults na ausência (serif / comfortable / false); valor corrompido ignorado pelo guard');
  console.log('  higiene: readingPrefs.ts sem console.* (preferência nunca logada)');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
