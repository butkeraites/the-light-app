// coverage.web.test.mjs — F5.36 (ADR-0056; molde search.web.test.mjs F1.14)
//
// GUARDA DE COBERTURA da Bíblia COMPLETA no banco de LEITURA web. PROVA HEADLESS
// (node, sem browser/Expo) de que `assets/data/reading-lite.sqlite` (o fixture do web,
// baixado 1x → OPFS em runtime, F5.3) contém a Bíblia INTEIRA — 66 livros × 2 traduções
// (KJV + Almeida 1911) — e NÃO um sample de dev de 3 livros (Gênesis/Salmos/João).
//
// Contexto do bug (F5.36): antes, o gerador `core/examples/gen_reading_sample_db.rs`
// copiava só {1,19,43}; abrir Mateus 1 dava "Nenhum capítulo disponível" e a busca só
// achava hits nesses 3 livros. Esta guarda FALHA se o banco regredir para um sample —
// é o teste de não-regressão do dado de leitura.
//
// Exercita o MESMO glue de PRODUÇÃO (`../sqlite-reading.web` + `../sqlite-search.web`)
// que as telas de leitura/busca usam no browser, sobre um `wa-sqlite` COM FTS5 (asset
// local vendored, ADR-0020) e um VFS de MEMÓRIA carregado com os BYTES do fixture.
// Em runtime no browser o VFS é OPFS; aqui node injeta os bytes direto no VFS de memória.
//
// Anti-alucinação: nenhum texto bíblico é hardcoded aqui; as contagens/nomes vêm SEMPRE
// do store (`wa-sqlite`/fixture). O texto verbatim é provado por reading/search.web.test.
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
// wa-sqlite COM FTS5 (build SÍNCRONO, asset local vendored — ADR-0020).
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'coverage-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const WA_SQLITE_FTS5_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// Cânon: 66 livros; 2 traduções (KJV en, Almeida 1911 pt).
const TOTAL_BOOKS = 66;
const TRANSLATIONS = ['kjv', 'alm1911'];
// Livros FORA do sample de dev antigo {Gênesis(1), Salmos(19), João(43)} — precisam
// existir na Bíblia completa. (number, KJV name, Almeida name).
const BOOKS_OUTSIDE_SAMPLE = [
  { number: 40, en: 'Matthew', pt: 'Mateus' },
  { number: 41, en: 'Mark', pt: 'Marcos' },
  { number: 42, en: 'Luke', pt: 'Lucas' },
  { number: 45, en: 'Romans', pt: 'Romanos' },
];
const OLD_SAMPLE_BOOKS = new Set([1, 19, 43]);

async function loadBundle() {
  const outfile = join(tmpdir(), `coverage-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Abre um `wa-sqlite` (build sync COM FTS5) sobre um VFS de memória semeado com os
// BYTES do fixture — o backend de prova equivalente, em node, ao OPFS do browser.
async function openReadingDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_FTS5_WASM);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);

  const vfs = new MemoryVFS();
  const bytes = await readFile(READING_DB);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set('reading-lite.sqlite', {
    name: 'reading-lite.sqlite',
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: data.byteLength,
    data,
  });
  sqlite3.vfs_register(vfs, false);

  const db = await sqlite3.open_v2('reading-lite.sqlite', SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

/** Uma coluna escalar do primeiro (único) row de uma query — via wa-sqlite. */
async function scalar(handle, sql) {
  let value;
  for await (const stmt of handle.sqlite3.statements(handle.db, sql)) {
    if ((await handle.sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      value = handle.sqlite3.column(stmt, 0);
    }
  }
  return value;
}

async function main() {
  const { init, mod, listBooks, queryChapterCount, queryTranslations, searchOnHandle } =
    await loadBundle();

  // (1) Fronteira Rust no wasm — o CÂNON tem 66 livros (independente do dado).
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();
  const canon = listBooks();
  assert.equal(canon.length, TOTAL_BOOKS, `cânon (Rust) deve ter ${TOTAL_BOOKS} livros`);

  // (2) Store local (wa-sqlite COM FTS5 + VFS de memória sobre os bytes do fixture).
  const handle = await openReadingDbInMemory();

  // (2a) COBERTURA por TABELA `books`: 132 linhas (66 × 2) e 66 números DISTINTOS. Num
  //      sample de 3 livros isto seria 6 / 3 — a guarda falha se o banco regredir.
  const bookRows = Number(await scalar(handle, 'SELECT COUNT(*) FROM books'));
  assert.equal(
    bookRows,
    TOTAL_BOOKS * TRANSLATIONS.length,
    `books deve ter ${TOTAL_BOOKS * TRANSLATIONS.length} linhas (66 × 2), veio ${bookRows}`,
  );
  const distinctBooks = Number(await scalar(handle, 'SELECT COUNT(DISTINCT number) FROM books'));
  assert.equal(distinctBooks, TOTAL_BOOKS, `books deve ter 66 números distintos, veio ${distinctBooks}`);

  // (2b) 2 traduções (KJV + Almeida 1911), cada uma com os 66 livros.
  const translations = await queryTranslations(handle);
  const tids = translations.map((t) => t.id).sort();
  assert.deepEqual(tids, [...TRANSLATIONS].sort(), `traduções devem ser ${TRANSLATIONS.join('+')}`);
  for (const tid of TRANSLATIONS) {
    const perTx = Number(
      await scalar(handle, `SELECT COUNT(DISTINCT number) FROM books WHERE translation_id='${tid}'`),
    );
    assert.equal(perTx, TOTAL_BOOKS, `${tid} deve ter 66 livros, veio ${perTx}`);
  }

  // (2c) Livros FORA do sample de dev {Gn,Sl,Jo} EXISTEM com nome certo e ≥1 capítulo
  //      nas DUAS traduções — via `queryChapterCount` (o MESMO que a tela de leitura usa
  //      para saber se um livro abre; o bug F5.36 era isto retornar 0 para Mateus).
  for (const b of BOOKS_OUTSIDE_SAMPLE) {
    assert.ok(!OLD_SAMPLE_BOOKS.has(b.number), `${b.en} não está no sample antigo (sanidade do teste)`);
    const nameEn = await scalar(
      handle,
      `SELECT name FROM books WHERE number=${b.number} AND translation_id='kjv'`,
    );
    assert.equal(nameEn, b.en, `livro ${b.number} (KJV) deve se chamar ${b.en}, veio ${nameEn}`);
    const namePt = await scalar(
      handle,
      `SELECT name FROM books WHERE number=${b.number} AND translation_id='alm1911'`,
    );
    assert.equal(namePt, b.pt, `livro ${b.number} (Almeida) deve se chamar ${b.pt}, veio ${namePt}`);
    for (const tid of TRANSLATIONS) {
      const chapters = await queryChapterCount(handle, tid, b.number);
      assert.ok(
        chapters >= 1,
        `${b.en}/${tid} deve ter ≥1 capítulo (bug F5.36: "Nenhum capítulo disponível"), veio ${chapters}`,
      );
    }
  }

  // (2d) BUSCA cobre livros FORA de {Gn,Sl,Jo}: "faith"/kjv acha hits em Romanos (45)
  //      e, no geral, hits em livros que o sample antigo NÃO tinha. Num sample de 3
  //      livros "faith"/Romanos seria 0 — a guarda falha.
  const faithRomans = await searchOnHandle(handle, 'faith', 'kjv', 45, 1000);
  assert.ok(faithRomans.length >= 1, `"faith"/kjv deve achar hits em Romanos (45), veio ${faithRomans.length}`);
  assert.ok(
    faithRomans.every((h) => h.reference.book === 45),
    'todos os hits de "faith" filtrados por 45 devem ser de Romanos',
  );
  const faithAll = await searchOnHandle(handle, 'faith', 'kjv', undefined, 5000);
  const outsideHit = faithAll.find((h) => !OLD_SAMPLE_BOOKS.has(h.reference.book));
  assert.ok(
    outsideHit,
    'a busca deve achar ≥1 hit de "faith" FORA do sample antigo {Gênesis, Salmos, João}',
  );

  await handle.sqlite3.close(handle.db);

  console.log('PASS — cobertura web (Bíblia COMPLETA em reading-lite.sqlite, F5.36/ADR-0056):');
  console.log(`  books                       -> ${bookRows} linhas (66 × 2), ${distinctBooks} livros distintos`);
  console.log(`  traduções                   -> [${tids.join(', ')}] (66 livros cada)`);
  console.log(
    `  fora do sample {1,19,43}    -> ${BOOKS_OUTSIDE_SAMPLE.map((b) => `${b.en}/${b.pt}(${b.number})`).join(', ')} presentes, ≥1 cap. em ambas`,
  );
  console.log(`  busca "faith"/kjv em Romanos -> ${faithRomans.length} hits (era 0 no sample)`);
  console.log(`  busca "faith"/kjv (todos)   -> ${faithAll.length} hits; ≥1 fora de {Gn,Sl,Jo}`);
  console.log('  GUARDA: falha se o banco regredir para um sample de 3 livros.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
