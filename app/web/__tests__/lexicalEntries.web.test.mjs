// lexicalEntries.web.test.mjs — F3.12a (ADR-0031; molde deepStudy.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser, SEM rede/chave) do LÉXICO VERIFICADO WEB: exercita
// `lexicalEntriesOnHandle` (a função de PRODUÇÃO) sobre um wa-sqlite (VFS de memória) com
// os BYTES do subset de LÉXICO ON-DEMAND `lexicon-sample.sqlite` (F5.15/ADR-0044 — o DADO
// do léxico STEP CC-BY separado do caminho de leitura; conteúdo IDÊNTICO ao que a F3.5
// propagava no combinado, ZERO drift). Prova que:
//   - João 3:16 (livro 43, cap 3, v 16) → ≥1 entrada Strong (do léxico do store) + `sources`
//     com a atribuição STEP CC-BY VERBATIM;
//   - passagem sem cobertura (João 3:99) → `{ entries: [], sources: [] }` (sem throw);
//   - `limit` trunca (limite 1 → 1 entrada).
// Anti-alucinação: glosas/lemas/Strong/atribuição são VERBATIM do store — nenhuma lógica
// de anti-alucinação em TS (só o SELECT + shaping, infra ADR-0011). Sai 0 se bater; ≠0 c.c.
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

const ENTRY = join(__dirname, 'deepStudy-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
// F5.15 (ADR-0044): o léxico vive num arquivo SEPARADO, carregado on-demand.
const LEXICON_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'lexicon-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `lexical-headless-${randomBytes(6).toString('hex')}.mjs`);
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

async function openLexiconDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_WASM);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);

  const vfs = new MemoryVFS();
  const bytes = await readFile(LEXICON_DB);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set('lexicon-sample.sqlite', {
    name: 'lexicon-sample.sqlite',
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: data.byteLength,
    data,
  });
  sqlite3.vfs_register(vfs, false);

  const db = await sqlite3.open_v2('lexicon-sample.sqlite', SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

async function main() {
  const { init, mod, lexicalEntriesOnHandle } = await loadBundle();
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const handle = await openLexiconDbInMemory();

  // (1) João 3:16 → entradas Strong + atribuição STEP CC-BY (do store, verbatim).
  const lex = await lexicalEntriesOnHandle(handle, 43, 3, 16, undefined);
  assert.ok(lex.entries.length >= 1, `João 3:16 deve ter ≥1 entrada léxica, veio ${lex.entries.length}`);
  assert.ok(
    lex.entries.every((e) => typeof e.strongs === 'string' && e.strongs.length > 0),
    'toda entrada tem um número de Strong (base)',
  );
  assert.ok(
    lex.entries.some((e) => /^[GH]\d/.test(e.strongs) && (e.gloss ?? '').length > 0),
    'ao menos uma entrada tem Strong grego/hebraico + glosa VERBATIM do léxico',
  );
  assert.ok(lex.sources.length >= 1, 'deve haver ≥1 atribuição de fonte (STEP CC-BY)');
  assert.ok(
    lex.sources.some((s) => s.includes('STEP Bible') && s.includes('CC BY 4.0')),
    'a atribuição STEP CC-BY é VERBATIM do store: ' + JSON.stringify(lex.sources),
  );

  // Strong BASE: sem sufixo de desambiguação (ex.: nada como "H7225G" — só "H7225").
  assert.ok(
    lex.entries.every((e) => /^[GH]\d+$/.test(e.strongs)),
    'os Strong são BASE (sem letra de desambiguação à direita): ' +
      JSON.stringify(lex.entries.map((e) => e.strongs)),
  );

  // (2) Passagem SEM cobertura (João 3:99 não existe) → vazio, sem throw.
  const empty = await lexicalEntriesOnHandle(handle, 43, 3, 99, undefined);
  assert.deepEqual(empty.entries, [], 'passagem sem cobertura → entries vazio (sem throw)');
  assert.deepEqual(empty.sources, [], 'passagem sem cobertura → sources vazio');

  // (3) `limit` trunca (limite 1 → 1 entrada).
  const limited = await lexicalEntriesOnHandle(handle, 43, 3, 16, 1);
  assert.equal(limited.entries.length, 1, 'limit=1 → exatamente 1 entrada');

  await handle.sqlite3.close(handle.db);

  console.log('PASS — léxico verificado web (de lexicon-sample.sqlite on-demand, STEP CC-BY):');
  console.log(`  João 3:16 -> ${lex.entries.length} entradas Strong; sources: ${lex.sources.length} (STEP CC-BY)`);
  console.log(`  amostra   -> ${JSON.stringify(lex.entries.slice(0, 3).map((e) => `${e.strongs}:${e.gloss ?? ''}`))}`);
  console.log('  sem cobertura (João 3:99) -> vazio sem throw; limit=1 -> 1 entrada');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
