// verseOfDayResolves.web.test.mjs — Rodada 4: guarda de DADO do versículo do dia.
//
// Torna EXECUTÁVEL o invariante que a lista curada (`VERSE_OF_DAY_REFS`) precisa honrar: TODA
// referência do dia RESOLVE nas DUAS traduções embarcadas (kjv + alm1911) do `reading-lite.sqlite`
// — senão o cartão sumiria (ou mostraria versículo trocado) para usuários de um idioma. Blinda
// contra drift: se alguém adicionar uma referência que não existe numa das versões (ex.: diferença
// de numeração/superscrição), esta guarda REPROVA. Abre o DB REAL em wa-sqlite (MemoryVFS); precisa
// do asset sqlite, então roda LOCALMENTE (lista EXTRA de run-guards), não no CI source-level.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFS_TS = join(__dirname, '..', '..', 'lib', 'verseOfDay.ts');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// Traduções embarcadas que o versículo do dia usa (defaultTranslationFor: pt→alm1911, en→kjv).
const REQUIRED = ['kjv', 'alm1911'];

async function loadRefs() {
  const outfile = join(tmpdir(), `vodrefs-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [REFS_TS], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function openReadingDb() {
  const wasmBinary = await readFile(WA_SQLITE_WASM);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);
  const vfs = new MemoryVFS();
  const bytes = await readFile(READING_DB);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set('reading-lite.sqlite', { name: 'reading-lite.sqlite', flags: SQLite.SQLITE_OPEN_READONLY, size: data.byteLength, data });
  sqlite3.vfs_register(vfs, false);
  const db = await sqlite3.open_v2('reading-lite.sqlite', SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

/** translation_ids que têm ESTE versículo (book/chapter/verse) no store. */
async function translationsFor(sqlite3, db, book, chapter, verse) {
  const out = [];
  const sql = 'SELECT translation_id FROM verses WHERE book_number = ? AND chapter = ? AND verse = ?';
  for await (const stmt of sqlite3.statements(db, sql)) {
    sqlite3.bind(stmt, 1, book);
    sqlite3.bind(stmt, 2, chapter);
    sqlite3.bind(stmt, 3, verse);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      out.push(sqlite3.column_text(stmt, 0));
    }
  }
  return out;
}

async function main() {
  const { VERSE_OF_DAY_REFS } = await loadRefs();
  assert.ok(VERSE_OF_DAY_REFS.length >= 7, 'lista curada deve ter várias entradas');
  const { sqlite3, db } = await openReadingDb();
  try {
    const missing = [];
    for (const r of VERSE_OF_DAY_REFS) {
      const trs = await translationsFor(sqlite3, db, r.book, r.chapter, r.verse);
      for (const need of REQUIRED) {
        if (!trs.includes(need)) missing.push(`${r.book}:${r.chapter}:${r.verse} falta em ${need}`);
      }
    }
    assert.deepEqual(missing, [], `referências do dia sem cobertura nas 2 traduções:\n  ${missing.join('\n  ')}`);
    console.log(`PASS — verso-do-dia (DADO): as ${VERSE_OF_DAY_REFS.length} referências resolvem em ${REQUIRED.join(' + ')}.`);
  } finally {
    await sqlite3.close(db);
  }
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
