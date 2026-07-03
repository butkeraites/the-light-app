// getPassage.web.test.mjs — F0.10 (ADR-0011/ADR-0012) · F5.12 (ADR-0041)
//
// PROVA HEADLESS (node, sem browser/Expo) do STORE WEB. Cobre o pipeline do
// `getPassage` web do ADR-0011 de ponta a ponta, EXCETO o backend OPFS (que é
// browser-only):
//   1) a REFERÊNCIA é resolvida PELO RUST (the-light-core via UniFFI→wasm) —
//      `parseReference("John 3:16")` ⇒ book=43, chapter=3, verse=16 (não em TS);
//   2) o TEXTO é lido do STORE LOCAL por um `wa-sqlite` (build SYNC, sem
//      SharedArrayBuffer/COOP-COEP) sobre um VFS de MEMÓRIA carregado com os BYTES
//      de `assets/data/reading-sample.sqlite`, rodando a MESMA `queryPassage`/
//      `readPassage` de produção (`../sqlite.web`).
//
// F5.12 (ADR-0041): RE-TARGET p/ o MESMO store da leitura (subset
// `reading-sample.sqlite` + build vendorado wa-sqlite COM FTS5) que a produção
// (`passage.web` → `sqlite-reading-opfs.web`) passou a reusar — o caminho F0.10
// legado (npm `wa-sqlite` async + `sample.sqlite` de 1 versículo) era um DUPLICADO
// MORTO removido do bundle. João 3:16 KJV é BYTE-IDÊNTICO no subset (zero drift).
//
// Em RUNTIME no browser o VFS é OPFS (`../sqlite-reading-opfs.web.ts`), que HIDRATA
// o mesmo VFS de memória a partir dos bytes persistidos em OPFS. Aqui, node injeta
// os bytes do subset direto no VFS de memória — exercitando a mesma query e a mesma
// leitura. (OPFS não existe em node; ver ADR-0012.)
//
// Anti-alucinação: a constante KJV abaixo existe SÓ na ASSERÇÃO do teste — nunca
// no código de produto. O texto provado vem do `wa-sqlite`/sample, verbatim.
//
// Como roda em node:
//   1) empacota getPassage-headless-entry.ts com esbuild (bundle único, ESM,
//      platform=node) — resolve os bindings GERADOS + @ubjs/core + glue
//      wasm-bindgen + as funções de produção do store;
//   2) instancia o wasm da fronteira passando os BYTES de index_bg.wasm
//      (node não tem fetch) e roda mod.initialize();
//   3) instancia o `wa-sqlite` (build sync COM FTS5, vendorado) com os BYTES de
//      wa-sqlite.wasm e abre um VFS de memória semeado com os bytes do subset;
//   4) parseReference (Rust) + readPassage/queryPassage (produção) ⇒ asserções.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'getPassage-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16, KJV (domínio público). SÓ no teste (asserção) — jamais no produto.
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

async function loadBundle() {
  const outfile = join(tmpdir(), `getpassage-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Abre um `wa-sqlite` (build sync COM FTS5, vendorado) sobre um VFS de memória
// semeado com os BYTES do subset — o backend de prova equivalente, em node, ao OPFS
// do browser (idêntico ao runtime de produção `sqlite-reading-opfs.web`).
async function openSubsetDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_WASM);
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
  const { init, mod, parseReference, queryPassage, readPassage } = await loadBundle();

  // (1) Fronteira Rust no wasm — referência resolvida PELO RUST.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const reference = parseReference('John 3:16');
  assert.equal(reference.book, 43, `book deve ser 43 (João), veio ${reference.book}`);
  assert.equal(reference.chapter, 3, `chapter deve ser 3, veio ${reference.chapter}`);
  assert.equal(reference.verses.tag, 'Single', `verses.tag deve ser "Single", veio ${reference.verses.tag}`);
  assert.equal(reference.verses.inner.verse, 16, `verse deve ser 16, veio ${reference.verses.inner.verse}`);

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openSubsetDbInMemory();

  // (2a) A MESMA `queryPassage` de produção: linhas brutas do SELECT espelhado.
  const rows = await queryPassage(
    handle,
    'kjv',
    reference.book,
    reference.chapter,
    reference.verses.inner.verse,
  );
  assert.equal(rows.length, 1, `queryPassage deve achar 1 versículo, veio ${rows.length}`);
  assert.equal(rows[0].verse, 16, `linha deve ser o versículo 16, veio ${rows[0].verse}`);
  assert.equal(
    rows[0].text,
    JOHN_3_16_KJV,
    'TEXTO do store (queryPassage) deve ser o KJV verbatim de João 3:16',
  );

  // (2b) A composição de produção `readPassage` ⇒ Passage completa.
  const passage = await readPassage(handle, reference, 'kjv');
  await handle.sqlite3.close(handle.db);

  assert.equal(passage.verses.length, 1, `Passage deve ter 1 versículo, veio ${passage.verses.length}`);
  const verse = passage.verses[0];
  assert.equal(verse.text, JOHN_3_16_KJV, 'TEXTO da Passage deve ser o KJV verbatim, lido do store local');
  assert.equal(verse.translation, 'kjv', `translation deve ser "kjv", veio ${verse.translation}`);
  assert.equal(verse.reference.book, 43, `Verse.reference.book deve ser 43, veio ${verse.reference.book}`);
  assert.equal(verse.reference.chapter, 3, `Verse.reference.chapter deve ser 3, veio ${verse.reference.chapter}`);
  assert.equal(verse.reference.verses.inner.verse, 16, 'Verse.reference deve ser o versículo 16');
  assert.equal(passage.reference.book, 43, 'Passage.reference (do Rust) deve ser livro 43');

  console.log('PASS — store web (wa-sqlite[FTS5] + VFS de memória sobre reading-sample.sqlite):');
  console.log(`  parseReference("John 3:16") -> book=${reference.book} chapter=${reference.chapter} verse=${reference.verses.inner.verse} (Rust/wasm)`);
  console.log(`  getPassage(text do store)   -> "${verse.text}"`);
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
