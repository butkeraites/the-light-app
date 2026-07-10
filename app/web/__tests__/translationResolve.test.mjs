// translationResolve.test.mjs — deepening (ADR-0070)
//
// PROVA HEADLESS (node, SEM browser/wasm) da resolução PURA de versão (`resolveEffectiveTranslation`,
// `langForTranslation`) e dos construtores de href de leitura (`readingChapterHref`/`readingBookHref`),
// que estavam duplicados nas telas. Os imports de tipo são apagados → o esbuild-bundle não boota wasm.
// Assere a escada de 4 níveis, a derivação de idioma, e o invariante "sempre carregar `version`".
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'translationResolve-headless-entry.ts');

async function load() {
  const outfile = join(tmpdir(), `tr-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

const T = (id, language) => ({ id, language });

async function main() {
  const { resolveEffectiveTranslation, langForTranslation, defaultTranslationFor, FALLBACK_TRANSLATION, readingChapterHref, readingBookHref } =
    await load();

  const store4 = [T('bsb', 'en'), T('kjv', 'en'), T('alm1911', 'pt'), T('blivre', 'pt')];

  // defaultTranslationFor
  assert.equal(defaultTranslationFor('pt'), 'alm1911', 'pt → alm1911');
  assert.equal(defaultTranslationFor('en'), 'kjv', 'en → kjv');
  assert.equal(FALLBACK_TRANSLATION, 'kjv', 'fallback = kjv');

  // resolveEffectiveTranslation — escada de 4 níveis
  assert.equal(resolveEffectiveTranslation('kjv', store4, 'pt'), 'kjv', 'escolha válida vence o idioma');
  assert.equal(resolveEffectiveTranslation(null, store4, 'pt'), 'alm1911', 'sem escolha → default do idioma (pt)');
  assert.equal(resolveEffectiveTranslation(null, store4, 'en'), 'kjv', 'sem escolha → default do idioma (en)');
  assert.equal(resolveEffectiveTranslation('zzz', store4, 'pt'), 'alm1911', 'escolha inválida → cai no default');
  assert.equal(resolveEffectiveTranslation('alm1911', [], 'pt'), 'alm1911', 'store vazio → default do idioma');
  // default do idioma AUSENTE → 1ª do mesmo idioma
  assert.equal(resolveEffectiveTranslation(null, [T('bsb', 'en'), T('blivre', 'pt')], 'pt'), 'blivre', 'default pt ausente → 1ª pt (blivre)');
  // sem mesmo idioma → 1ª disponível
  assert.equal(resolveEffectiveTranslation(null, [T('bsb', 'en')], 'pt'), 'bsb', 'nenhuma pt → 1ª disponível (bsb)');

  // langForTranslation
  assert.equal(langForTranslation('alm1911', store4, 'en'), 'pt', 'idioma da tradução vence o locale');
  assert.equal(langForTranslation('kjv', store4, 'pt'), 'en', 'kjv → en');
  assert.equal(langForTranslation('zzz', store4, 'en'), 'en', 'id ausente → locale (en)');
  assert.equal(langForTranslation('zzz', store4, 'pt'), 'pt', 'id ausente → locale (pt)');

  // readingChapterHref — invariante "sempre version"; verse só quando presente
  const withVerse = readingChapterHref({ book: 43, chapter: 3, verse: 16, version: 'alm1911' });
  assert.equal(withVerse.pathname, '/read/[book]/[chapter]', 'pathname do capítulo');
  assert.deepEqual(withVerse.params, { book: '43', chapter: '3', version: 'alm1911', verse: '16' }, 'params com verse (strings)');
  const noVerse = readingChapterHref({ book: 43, chapter: 3, version: 'kjv' });
  assert.deepEqual(noVerse.params, { book: '43', chapter: '3', version: 'kjv' }, 'sem verse → sem chave verse');
  const nullVerse = readingChapterHref({ book: 1, chapter: 1, verse: null, version: 'kjv' });
  assert.equal('verse' in nullVerse.params, false, 'verse null → sem chave verse');

  // readingBookHref
  const bookHref = readingBookHref({ book: 40, version: 'alm1911' });
  assert.equal(bookHref.pathname, '/read/[book]', 'pathname do livro');
  assert.deepEqual(bookHref.params, { book: '40', version: 'alm1911' }, 'params do livro com version');

  console.log('PASS — resolução de versão + navegação de leitura (puro, ADR-0070):');
  console.log('  escada picked→locale→mesmo-idioma→1ª→default; langForTranslation com fallback ao locale: OK');
  console.log('  readingChapterHref/readingBookHref sempre carregam version; verse só quando presente: OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
