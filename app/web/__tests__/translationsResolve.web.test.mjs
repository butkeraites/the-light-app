// translationsResolve.web.test.mjs — Rodada 3 (ADR-0012): guarda de DADO das 4 traduções.
//
// Torna EXECUTÁVEL o critério de aceite da amplitude: as QUATRO versões embarcadas
// (kjv, alm1911, bsb, blivre) resolvem para versículos de referência em AMBOS os testamentos no
// `reading-lite.sqlite` REAL — senão o seletor/paralelo/Compare ofereceria uma versão que não abre.
// Blinda contra regressão do pipeline de dados (re-pin/regeração). Abre o DB em wa-sqlite (MemoryVFS);
// precisa do asset sqlite (gerado por gen-bible-db → gen-reading-sample-db), então roda LOCAL (EXTRA).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// As 4 versões livres que o app deve oferecer (ADR-0012: + BSB en, + BLIVRE pt).
const REQUIRED = ['kjv', 'alm1911', 'bsb', 'blivre'];
// Amostra AT + NT (livro, capítulo, versículo) — cobre os dois testamentos e uma borda (Ap 22:21).
const SAMPLE = [
  { b: 1, c: 1, v: 1 }, // Gênesis 1:1 (AT)
  { b: 19, c: 23, v: 1 }, // Salmos 23:1 (AT)
  { b: 43, c: 3, v: 16 }, // João 3:16 (NT)
  { b: 66, c: 22, v: 21 }, // Apocalipse 22:21 (NT, último versículo)
];

async function openReadingDb() {
  const module = await SQLiteESMFactory({ wasmBinary: await readFile(WA_SQLITE_WASM) });
  const sqlite3 = SQLite.Factory(module);
  const vfs = new MemoryVFS();
  const bytes = await readFile(READING_DB);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set('reading-lite.sqlite', { name: 'reading-lite.sqlite', flags: SQLite.SQLITE_OPEN_READONLY, size: data.byteLength, data });
  sqlite3.vfs_register(vfs, false);
  const db = await sqlite3.open_v2('reading-lite.sqlite', SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

async function textOf(sqlite3, db, tr, b, c, v) {
  let out = null;
  const sql = 'SELECT text FROM verses WHERE translation_id = ? AND book_number = ? AND chapter = ? AND verse = ?';
  for await (const stmt of sqlite3.statements(db, sql)) {
    sqlite3.bind(stmt, 1, tr);
    sqlite3.bind(stmt, 2, b);
    sqlite3.bind(stmt, 3, c);
    sqlite3.bind(stmt, 4, v);
    if ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) out = sqlite3.column_text(stmt, 0);
  }
  return out;
}

async function main() {
  const { sqlite3, db } = await openReadingDb();
  try {
    // Todas as 4 versões estão registradas na tabela translations?
    const present = new Set();
    for await (const stmt of sqlite3.statements(db, 'SELECT id FROM translations')) {
      while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) present.add(sqlite3.column_text(stmt, 0));
    }
    for (const need of REQUIRED) assert.ok(present.has(need), `tradução "${need}" ausente em translations`);

    // Cada versão resolve (texto não-vazio) para cada versículo-amostra em ambos os testamentos.
    const missing = [];
    for (const r of SAMPLE) {
      for (const tr of REQUIRED) {
        const txt = await textOf(sqlite3, db, tr, r.b, r.c, r.v);
        if (!txt || txt.trim().length === 0) missing.push(`${tr} ${r.b}:${r.c}:${r.v}`);
      }
    }
    assert.deepEqual(missing, [], `versões sem texto p/ amostra:\n  ${missing.join('\n  ')}`);
    console.log(`PASS — 4 traduções (${REQUIRED.join(', ')}) resolvem em AT+NT (${SAMPLE.length} amostras) no reading-lite.`);
  } finally {
    await sqlite3.close(db);
  }
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
