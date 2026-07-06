// verseMarkers.test.mjs — deepening (ADR-0060)
//
// PROVA HEADLESS (node, SEM browser/wasm) da redução PURA `deriveVerseMarkers`
// (`app/lib/verseMarkers.ts`) — a lógica que estava presa em `refreshUserData` na tela do
// capítulo. Os imports de tipo (`Note`/`Highlight`) são APAGADOS na compilação, então o
// esbuild-bundle NÃO precisa bootar wasm. Constrói `Note[]`/`Highlight[]` com o shape real de
// Reference/VerseRange e assere o recorte: só o book/chapter corrente, só `Single`, última cor
// por versículo vence, refs estrangeiras e `Range`/`WholeChapter` fora, entradas vazias →
// conjuntos vazios. Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'verseMarkers.ts');

async function load() {
  const outfile = join(tmpdir(), `vm-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const single = (book, chapter, verse) => ({ book, chapter, verses: { tag: 'Single', inner: { verse } } });
const range = (book, chapter, start, end) => ({ book, chapter, verses: { tag: 'Range', inner: { start, end } } });
const whole = (book, chapter) => ({ book, chapter, verses: { tag: 'WholeChapter', inner: {} } });

async function main() {
  const { deriveVerseMarkers } = await load();

  const notes = [
    { reference: single(43, 3, 16), body: 'x' },
    { reference: single(43, 3, 17), body: 'y' },
    { reference: single(43, 4, 1), body: 'other chapter' },
    { reference: single(1, 3, 16), body: 'other book' },
    { reference: range(43, 3, 1, 3), body: 'range ignored' },
    { reference: whole(43, 3), body: 'whole-chapter ignored' },
  ];
  const highlights = [
    { reference: single(43, 3, 16), color: 'yellow' },
    { reference: single(43, 3, 16), color: 'green' }, // last wins
    { reference: single(43, 3, 18), color: 'blue' },
    { reference: single(43, 5, 2), color: 'red' }, // other chapter
    { reference: single(2, 3, 18), color: 'purple' }, // other book
    { reference: range(43, 3, 1, 3), color: 'orange' }, // range ignored
  ];

  const m = deriveVerseMarkers(notes, highlights, 43, 3);

  // notedVerses: só João 3 (43,3), só Single → {16, 17}
  assert.deepEqual([...m.notedVerses].sort((a, b) => a - b), [16, 17], 'notedVerses = {16,17}');
  // highlightColors: última cor por versículo vence (16→green), só Single do capítulo corrente
  assert.equal(m.highlightColors.get(16), 'green', '16 → green (última vence)');
  assert.equal(m.highlightColors.get(18), 'blue', '18 → blue');
  assert.equal(m.highlightColors.has(2), false, 'versículo 2 (outro capítulo) fora');
  assert.equal(m.highlightColors.size, 2, 'só 2 highlights no capítulo corrente');

  // Entradas vazias → conjuntos vazios.
  const e = deriveVerseMarkers([], [], 43, 3);
  assert.equal(e.notedVerses.size, 0, 'sem notas → notedVerses vazio');
  assert.equal(e.highlightColors.size, 0, 'sem highlights → highlightColors vazio');

  // Capítulo sem indicadores → vazio (mesmos dados, outro capítulo).
  const other = deriveVerseMarkers(notes, highlights, 43, 99);
  assert.equal(other.notedVerses.size, 0, 'capítulo 99 sem notas');
  assert.equal(other.highlightColors.size, 0, 'capítulo 99 sem highlights');

  console.log('PASS — deriveVerseMarkers (redução pura de notas/highlights por-capítulo):');
  console.log('  filtra book/chapter corrente, só Single (Range/WholeChapter/refs estrangeiras fora): OK');
  console.log('  última cor por versículo vence; entradas vazias → conjuntos vazios: OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
