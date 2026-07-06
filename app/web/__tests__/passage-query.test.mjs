// passage-query.test.mjs — ADR-0065 (molde search-smart.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser/rede) do lookup de passagem app-side (ranges + listas)
// que compõe leituras atômicas de capítulo POR CIMA das fronteiras `parseReference`/`getChapter`
// (INALTERADAS). Bundla (esbuild) os módulos PUROS e assevera:
//   1) CLASSIFICADOR: ref / chapterRange / crossChapter / bookRange / wholeBook / invalid; listas
//      por `;`/`,`/nova-linha; hífen e travessão; token de livro "1 João";
//   2) RESOLVEDOR (deps FAKE): single/range/capítulo/chapterRange/crossChapter/lista → trechos e
//      rótulos corretos; MEMOIZA `getChapter` por (livro,capítulo); TETO de versos/capítulos marca
//      `truncated`; livro/ref inválido conta em `invalid`, não quebra;
//   3) HIGIENE: módulos sem `console.*`.
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
const ENTRY = join(__dirname, 'passage-query-headless-entry.ts');
const LIB = join(__dirname, '..', '..', 'lib');

async function loadBundle() {
  const outfile = join(tmpdir(), `passage-query-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

// ── Fakes das fronteiras (deps injetadas no resolvedor) ────────────────────────────────────
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const BOOKS = { genesis: 1, exodo: 2, salmos: 19, joao: 43, romanos: 45, efesios: 49 };
const NAMES = { 1: 'Gênesis', 2: 'Êxodo', 19: 'Salmos', 43: 'João', 45: 'Romanos', 49: 'Efésios' };
const CHAPTERS = { 1: 50, 2: 40, 19: 150, 43: 21, 45: 16, 49: 6 };
const CHAPTER_VERSES = 20;

async function fakeParseReference(s) {
  const m = /^\s*(.+?)\s+(\d+)(?:[:.](\d+)(?:-(\d+))?)?\s*$/u.exec(s);
  if (!m) throw new Error('malformed: ' + s);
  const book = BOOKS[fold(m[1])];
  if (!book) throw new Error('unknown book: ' + m[1]);
  const chapter = Number(m[2]);
  let verses;
  if (m[3] == null) verses = { tag: 'WholeChapter' };
  else if (m[4] == null) verses = { tag: 'Single', inner: { verse: Number(m[3]) } };
  else verses = { tag: 'Range', inner: { start: Number(m[3]), end: Number(m[4]) } };
  return { book, chapter, verses };
}

function makeDeps(extra = {}) {
  let calls = 0;
  const seen = new Set();
  const deps = {
    parseReference: fakeParseReference,
    getChapter: async (book, chapter) => {
      calls++;
      seen.add(`${book}-${chapter}`);
      const verses = [];
      for (let n = 1; n <= CHAPTER_VERSES; n++) {
        verses.push({ reference: { verses: { tag: 'Single', inner: { verse: n } } }, text: `b${book}c${chapter}v${n}`, translation: 'x' });
      }
      return { reference: { book, chapter, verses: { tag: 'WholeChapter' } }, verses };
    },
    chapterCountOf: (b) => CHAPTERS[b] ?? 1,
    bookLabel: (b) => NAMES[b] ?? `Livro ${b}`,
    ...extra,
  };
  return { deps, getCalls: () => calls, distinct: () => seen.size };
}

async function main() {
  const { classifyItem, parsePassageQuery, resolvePassageQuery } = await loadBundle();

  // ══ (1) CLASSIFICADOR ══════════════════════════════════════════════════════════════════
  assert.equal(classifyItem('João 3:16').kind, 'ref', 'verso único → ref');
  assert.equal(classifyItem('João 3:16-18').kind, 'ref', 'range no capítulo → ref');
  assert.equal(classifyItem('João 3').kind, 'ref', 'capítulo inteiro → ref');
  assert.deepEqual(classifyItem('João 3-4'), { kind: 'chapterRange', book: 'João', from: 3, to: 4 }, 'chapterRange');
  assert.deepEqual(
    classifyItem('João 3:16-4:2'),
    { kind: 'crossChapter', book: 'João', fromCh: 3, fromV: 16, toCh: 4, toV: 2 },
    'crossChapter',
  );
  assert.deepEqual(classifyItem('Gênesis-Êxodo'), { kind: 'bookRange', fromBook: 'Gênesis', toBook: 'Êxodo' }, 'bookRange');
  assert.deepEqual(classifyItem('Gênesis'), { kind: 'wholeBook', book: 'Gênesis' }, 'wholeBook');
  assert.deepEqual(classifyItem('1 João 2-3'), { kind: 'chapterRange', book: '1 João', from: 2, to: 3 }, 'livro numerado');
  assert.equal(classifyItem('João 3–4').kind, 'chapterRange', 'travessão – também é range');
  assert.equal(classifyItem('@@@').kind, 'invalid', 'lixo → invalid');
  assert.deepEqual(
    parsePassageQuery('Jo 3.16; Rm 8.28, Sl 23').map((i) => i.kind),
    ['ref', 'ref', 'ref'],
    'lista por ;/, → 3 refs',
  );
  assert.equal(parsePassageQuery('João 3-4\nSalmos 23').length, 2, 'nova linha separa itens');
  assert.equal(parsePassageQuery('   ').length, 0, 'só espaços → vazio');

  // ══ (2) RESOLVEDOR (deps fake) ═════════════════════════════════════════════════════════
  const labels = (r) => r.segments.map((s) => s.label);

  {
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3:16', deps);
    assert.deepEqual(labels(r), ['João 3:16'], 'single: rótulo');
    assert.equal(r.verseCount, 1, 'single: 1 verso');
  }
  {
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3:16-18', deps);
    assert.deepEqual(labels(r), ['João 3:16-18'], 'range: rótulo');
    assert.equal(r.verseCount, 3, 'range: 3 versos');
  }
  {
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3', deps);
    assert.deepEqual(labels(r), ['João 3'], 'capítulo inteiro: rótulo sem versos');
    assert.equal(r.verseCount, CHAPTER_VERSES, 'capítulo inteiro: todos os versos');
  }
  {
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3-4', deps);
    assert.deepEqual(labels(r), ['João 3', 'João 4'], 'chapterRange: 2 capítulos');
    assert.equal(r.verseCount, 2 * CHAPTER_VERSES, 'chapterRange: versos');
  }
  {
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3:18-4:2', deps);
    assert.deepEqual(labels(r), ['João 3:18-20', 'João 4:1-2'], 'crossChapter: recorta borda inicial/final');
    assert.equal(r.verseCount, 3 + 2, 'crossChapter: 3+2 versos');
  }
  {
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3:16; Salmos 23', deps);
    assert.deepEqual(labels(r), ['João 3:16', 'Salmos 23'], 'lista: 2 trechos');
    assert.equal(r.resolved, 2, 'lista: 2 itens resolvidos');
    assert.equal(r.invalid, 0, 'lista: nenhum inválido');
  }
  {
    // Memoização: o MESMO capítulo é lido só uma vez.
    const { deps, getCalls, distinct } = makeDeps();
    await resolvePassageQuery('João 3:16; João 3:18', deps);
    assert.equal(getCalls(), 1, 'memoiza getChapter por (livro,capítulo) — 1 chamada');
    assert.equal(distinct(), 1, 'só 1 capítulo distinto');
  }
  {
    // Teto de VERSOS marca truncated (Salmos = 150 cap × 20 versos).
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('Salmos', { ...deps, maxVerses: 50, maxChapters: 100 });
    assert.equal(r.verseCount, 50, 'teto de versos = 50');
    assert.equal(r.truncated, true, 'marca truncated no teto de versos');
  }
  {
    // Teto de CAPÍTULOS (bookRange).
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('Gênesis-Êxodo', { ...deps, maxChapters: 3, maxVerses: 10000 });
    assert.equal(r.segments.length, 3, 'teto de capítulos = 3 trechos');
    assert.equal(r.truncated, true, 'marca truncated no teto de capítulos');
    assert.ok(labels(r).every((l) => l.startsWith('Gênesis')), 'primeiros 3 são de Gênesis');
  }
  {
    // Inválido: livro desconhecido não quebra.
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('Zzz 3-4', deps);
    assert.equal(r.segments.length, 0, 'inválido → sem trechos');
    assert.equal(r.invalid, 1, 'conta 1 inválido');
    assert.equal(r.resolved, 0, 'nenhum resolvido');
  }
  {
    // Parcial: um válido + um inválido.
    const { deps } = makeDeps();
    const r = await resolvePassageQuery('João 3:16; Zzz 9', deps);
    assert.equal(r.resolved, 1, 'parcial: 1 resolvido');
    assert.equal(r.invalid, 1, 'parcial: 1 inválido');
    assert.deepEqual(labels(r), ['João 3:16'], 'parcial: mostra o válido');
  }

  // ══ (3) HIGIENE ════════════════════════════════════════════════════════════════════════
  for (const f of ['passageQuery', 'passageResolve']) {
    const src = await readFile(join(LIB, `${f}.ts`), 'utf8');
    assert.ok(!/console\./.test(src), `${f}.ts sem console.*`);
  }

  console.log('PASS — lookup de passagem app-side (ranges + listas), headless:');
  console.log('  classificador: ref/chapterRange/crossChapter/bookRange/wholeBook/invalid; listas ;/,/\\n; hífen+travessão');
  console.log('  resolvedor: single/range/capítulo/chapterRange/crossChapter/lista → trechos + rótulos; memoiza getChapter');
  console.log('  guarda: teto de versos/capítulos marca truncated; inválido conta e não quebra');
  console.log('  higiene: módulos sem console.*');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
