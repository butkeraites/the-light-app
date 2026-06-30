// xref.web.test.mjs — F1.15 (ADR-0021; molde search.web.test.mjs F1.14)
//
// PROVA HEADLESS (node, sem browser/Expo) do STORE WEB de REFERÊNCIAS CRUZADAS
// (xref). Exercita o MESMO glue de PRODUÇÃO (`../sqlite-xref.web`) que a tela da
// F1.9 usa no browser, sobre um `wa-sqlite` (asset local vendored, ADR-0020) e um
// VFS de MEMÓRIA carregado com os BYTES de `assets/data/reading-sample.sqlite` (o
// MESMO subset/schema do nativo, ADR-0014). Em runtime no browser o VFS é OPFS
// (`../sqlite-reading-opfs.web.ts`, REUSADO da F1.13/F1.14 — sem recarregar o
// subset); aqui node injeta os bytes direto no VFS de memória, rodando as MESMAS
// funções de produção.
//
// O SQL de xref (filtro `from_*` + `votes >= min_votes`, `ORDER BY votes DESC, …`,
// `LIMIT` com clamp ≥1, montagem `Single`/`Range`) ESPELHA
// `the_light_core::xref::for_verse` (xref.rs, rev `8f66004`) — nenhuma
// ordenação/filtro/semântica é reimplementada em TS (a ordem por votos com os
// tiebreakers e o corte `votes >= ?` vivem no SQLite).
//
// Anti-alucinação: as constantes verbatim abaixo existem SÓ na ASSERÇÃO do teste —
// nunca no código de produto. As referências/votos provados vêm do `wa-sqlite`/
// subset. A xref é só REFERÊNCIA de destino + votos (NENHUM texto bíblico).
//
// PARIDADE com o nativo: o 1º por votos de João 3:16 é João 3:15 (439 votos), o
// MESMO que o nativo prova em `TLA_XREF first_ref="John 3:15" first_votes=439`
// (F1.9, xref-selftest.ts) — mesmo SQL, mesmo dado.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';
// wa-sqlite (build SÍNCRONO, asset local vendored — ADR-0020). É o MESMO artefato
// usado p/ leitura/busca/xref (um único wasm).
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'xref-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_FTS5_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `xref-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Abre um `wa-sqlite` (build sync) sobre um VFS de memória semeado com os BYTES do
// subset — o backend de prova equivalente, em node, ao OPFS do browser.
async function openReadingDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_FTS5_WASM);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);

  const vfs = new MemoryVFS();
  const bytes = await readFile(READING_DB);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set('reading-sample.sqlite', {
    name: 'reading-sample.sqlite',
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: data.byteLength,
    data,
  });
  sqlite3.vfs_register(vfs, false);

  const db = await sqlite3.open_v2('reading-sample.sqlite', SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

async function main() {
  const { init, mod, listBooks, crossRefsOnHandle } = await loadBundle();

  // (1) Fronteira Rust no wasm — necessária p/ compor `VerseRange.Single`/`Range`.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  // Atalho que espelha a assinatura pública `crossRefs(book,chapter,verse,minVotes?,limit?)`
  // (a tela chama isto via `reading.web.ts::crossRefs`, que só abre/fecha o store).
  const xref = (book, chapter, verse, minVotes, limit) =>
    crossRefsOnHandle(handle, book, chapter, verse, minVotes, limit);

  // (2a) João 3:16 (43/3/16) com defaults → 9 xrefs (do store; NÃO hardcoded no produto).
  const john316 = await xref(43, 3, 16);
  assert.ok(Array.isArray(john316), 'crossRefs deve retornar um array');
  assert.equal(john316.length, 9, `João 3:16 deve ter 9 xrefs, veio ${john316.length}`);

  // (2b) 1º por votos DESC = João 3:15 (Single, 439 votos) — PARIDADE com o TLA_XREF
  //      nativo (F1.9): first_ref="John 3:15" first_votes=439.
  const first = john316[0];
  assert.equal(first.reference.book, 43, '1º xref: livro 43 (João)');
  assert.equal(first.reference.chapter, 3, '1º xref: capítulo 3');
  assert.equal(first.reference.verses.tag, 'Single', '1º xref: João 3:15 é Single');
  assert.equal(first.reference.verses.inner.verse, 15, '1º xref: versículo 15');
  assert.equal(first.votes, 439n, '1º xref: 439 votos (bigint), igual ao TLA_XREF nativo');
  assert.equal(typeof first.votes, 'bigint', 'votes deve ser bigint (i64)');

  // (2c) Existe ≥1 Range no conjunto — João 11:25-26 (400 votos) prova Single vs Range.
  const range = john316.find(
    (cr) => cr.reference.verses.tag === 'Range' && cr.reference.book === 43 && cr.reference.chapter === 11,
  );
  assert.ok(range, 'João 11:25-26 (Range) deve estar no conjunto');
  assert.equal(range.reference.verses.inner.start, 25, 'Range start = 25');
  assert.equal(range.reference.verses.inner.end, 26, 'Range end = 26');
  assert.equal(range.votes, 400n, 'João 11:25-26 = 400 votos');

  // (2d) Cada CrossRef tem reference válido (book/chapter; verses Single|Range) + votes bigint.
  for (const cr of john316) {
    assert.equal(typeof cr.reference.book, 'number', 'reference.book é number');
    assert.equal(typeof cr.reference.chapter, 'number', 'reference.chapter é number');
    assert.ok(
      cr.reference.verses.tag === 'Single' || cr.reference.verses.tag === 'Range',
      'verses deve ser Single|Range',
    );
    assert.equal(typeof cr.votes, 'bigint', 'votes deve ser bigint');
  }

  // (2e) Versículo sem xref → [] SEM throw (João 3:999 inexistente).
  const none = await xref(43, 3, 999);
  assert.deepEqual(none, [], 'versículo inexistente deve retornar [] (sem throw)');

  // (2f) `minVotes` acima do máximo → [] SEM throw.
  const tooHigh = await xref(43, 3, 16, 100000n);
  assert.deepEqual(tooHigh, [], 'minVotes acima do máximo deve retornar [] (sem throw)');

  // (2g) `minVotes` respeitado: 400 → exatamente 2 (votos 439 e 400; o 3º, 344, é cortado).
  const minVotes400 = await xref(43, 3, 16, 400n);
  assert.equal(minVotes400.length, 2, `minVotes=400 deve dar 2 xrefs, veio ${minVotes400.length}`);
  assert.ok(
    minVotes400.every((cr) => cr.votes >= 400n),
    'todos os xrefs de minVotes=400 devem ter votes >= 400',
  );

  // (2h) `limit` respeitado: limit=1 → exatamente 1 (João 3:15); limit=3 → 3.
  const limit1 = await xref(43, 3, 16, undefined, 1);
  assert.equal(limit1.length, 1, `limit=1 deve dar 1 xref, veio ${limit1.length}`);
  assert.equal(limit1[0].reference.verses.inner.verse, 15, 'limit=1: o 1º é João 3:15');
  const limit3 = await xref(43, 3, 16, undefined, 3);
  assert.equal(limit3.length, 3, `limit=3 deve dar 3 xrefs, veio ${limit3.length}`);

  await handle.sqlite3.close(handle.db);

  const fmt = (cr) => {
    const v = cr.reference.verses;
    const verse = v.tag === 'Single' ? `${v.inner.verse}` : `${v.inner.start}-${v.inner.end}`;
    return `${cr.reference.book}/${cr.reference.chapter}:${verse} (${cr.votes} votos)`;
  };
  console.log('PASS — xref web (wa-sqlite + VFS de memória sobre reading-sample.sqlite):');
  console.log(`  crossRefs(43,3,16)          -> ${john316.length} xrefs`);
  console.log(`  1º por votos DESC           -> ${fmt(first)}  [Single]`);
  console.log(`  Range no conjunto           -> ${fmt(range)}  [Range]`);
  console.log(`  versículo sem xref (3:999)  -> [] (sem throw)`);
  console.log(`  minVotes=100000             -> [] (sem throw)`);
  console.log(`  minVotes=400                -> ${minVotes400.length} xrefs (439, 400; 344 cortado)`);
  console.log(`  limit=1 / limit=3           -> ${limit1.length} / ${limit3.length}`);
  console.log(
    '  PARIDADE: João 3:15 é o 1º por votos (439) — IGUAL ao TLA_XREF nativo ' +
      '(F1.9: first_ref="John 3:15" first_votes=439).',
  );
  // `listBooks` usado só para confirmar o cânon (Rust) disponível na composição.
  void listBooks;
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
