// interlinear.web.test.mjs — Rodada 2 (modo interlinear; molde de lexicalEntries.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser) da PARIDADE WEB do interlinear: exercita
// `interlinearVerseOnHandle` (→ `queryInterlinearVerse`, o SELECT espelhado guardado por
// mirror-drift) sobre os BYTES de `lexicon-sample.sqlite` (store on-demand, F5.15) num `wa-sqlite`
// de memória. Assevera: tokens na ORDEM de `wordIndex`, superfície VERBATIM do store, glosa/Strong,
// atribuição STEP CC-BY, e vazio (sem throw) p/ versículo sem cobertura. Sai 0 se tudo bater.
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
const ENTRY = join(__dirname, 'interlinear-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const LEXICON_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'lexicon-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `interlinear-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function openLexiconDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_WASM);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);
  const vfs = new MemoryVFS();
  const bytes = await readFile(LEXICON_DB);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set('lexicon-sample.sqlite', { name: 'lexicon-sample.sqlite', flags: SQLite.SQLITE_OPEN_READONLY, size: data.byteLength, data });
  sqlite3.vfs_register(vfs, false);
  const db = await sqlite3.open_v2('lexicon-sample.sqlite', SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

async function main() {
  const { init, mod, interlinearVerseOnHandle } = await loadBundle();
  await init({ module_or_path: await readFile(FRONTIER_WASM) });
  mod.initialize();
  const handle = await openLexiconDbInMemory();

  // João 3:16 (NT, coberto) → tokens gregos na ordem de leitura.
  const iv = await interlinearVerseOnHandle(handle, 43, 3, 16);
  assert.ok(iv.tokens.length >= 3, `João 3:16 deve ter vários tokens, veio ${iv.tokens.length}`);
  // ORDEM: word_index estritamente crescente (o SELECT usa ORDER BY t.word_index).
  const idx = iv.tokens.map((t) => t.wordIndex);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'tokens ordenados por wordIndex');
  assert.ok(iv.tokens.every((t) => typeof t.surface === 'string' && t.surface.length > 0), 'toda palavra tem surface verbatim');
  assert.ok(iv.tokens.some((t) => (t.strongs ?? '').length > 0 && (t.gloss ?? '').length > 0), 'ao menos um token tem Strong + glosa do store');
  assert.ok(iv.tokens.every((t) => t.testament === 'NT'), 'João é NT (grego)');
  assert.ok(iv.sources.some((s) => s.includes('STEP Bible') && s.includes('CC BY 4.0')), 'atribuição STEP CC-BY verbatim: ' + JSON.stringify(iv.sources));

  // Versículo sem cobertura → vazio, sem throw.
  const empty = await interlinearVerseOnHandle(handle, 43, 3, 99);
  assert.deepEqual(empty.tokens, [], 'versículo sem cobertura → tokens vazio');
  assert.deepEqual(empty.sources, [], 'versículo sem cobertura → sources vazio');

  await handle.sqlite3.close(handle.db);
  console.log('PASS — interlinear web (queryInterlinearVerse sobre lexicon-sample.sqlite, STEP CC-BY):');
  console.log(`  João 3:16 -> ${iv.tokens.length} tokens (ordenados por wordIndex); sources: ${iv.sources.length}`);
  console.log(`  amostra   -> ${JSON.stringify(iv.tokens.slice(0, 4).map((t) => `${t.surface}:${t.gloss ?? ''}`))}`);
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
