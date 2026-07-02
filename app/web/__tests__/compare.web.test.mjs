// compare.web.test.mjs — F3.12b (molde askAnchored.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da COMPARAÇÃO MULTI-IA
// ANCORADA no WEB: exercita `askAnchoredOnHandle` (a MESMA função de PRODUÇÃO destubada na
// F2.7b, já web-ok) N=2 vezes sobre a MESMA passagem (João 3:16) com o provedor "mock"
// (OFFLINE, sem chave/rede) — o wiring de N provedores da comparação. Prova que as 2
// "colunas" leem a MESMA âncora do STORE (`citedText` idêntico e não-vazio = `cited_match`),
// sem finalizar nenhuma diferença de conteúdo (mock é fixo — a comparação REAL é a F3.10).
//
// ANTI-ALUCINAÇÃO: `citedText` == João 3:16 KJV VERBATIM do STORE nas 2 colunas, separado da
// `interpretation` do mock. Provedor "mock" → 0 fetch (offline). Sai 0 se bater; ≠0 caso não.
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

const ENTRY = join(__dirname, 'askAnchored-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

async function loadBundle() {
  const outfile = join(tmpdir(), `compare-headless-${randomBytes(6).toString('hex')}.mjs`);
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

async function openReadingDbInMemory() {
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
  const { init, mod, askAnchoredOnHandle } = await loadBundle();

  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const handle = await openReadingDbInMemory();

  // `fetch` que FALHA se chamado — o provedor "mock" é OFFLINE; nenhuma rede deve ocorrer.
  const calls = [];
  const failFetch = async (url, requestInit) => {
    calls.push({ url, init: requestInit });
    throw new Error('rede não deveria ser tocada com o provedor "mock" (offline)');
  };

  // N=2 chamadas INDEPENDENTES à MESMA `reference` (João 3:16), uma por coluna (mock/offline).
  // SEQUENCIAIS aqui (um único handle wa-sqlite não suporta acesso concorrente); no browser as
  // colunas abrem handles próprios (`openReadingDbWeb`), então a UI usa `Promise.all`.
  const question = 'What is the main message of this verse?';
  const results = [
    await askAnchoredOnHandle(handle, failFetch, 'kjv', 'John 3:16', question, 'mock', undefined, undefined, 'en'),
    await askAnchoredOnHandle(handle, failFetch, 'kjv', 'John 3:16', question, 'mock', undefined, undefined, 'en'),
  ];

  // ── providers=2, cited_match=true (mesma âncora do store nas 2 colunas). ───────────
  assert.equal(results.length, 2, 'duas colunas (N provedores)');
  const citedMatch = results[0].citedText === results[1].citedText && results[0].citedText.length > 0;
  assert.ok(citedMatch, 'cited_match: as 2 colunas leem a MESMA âncora do store, não-vazia');
  assert.equal(results[0].citedText, `16 ${JOHN_3_16_KJV}`, 'citedText verbatim do store (coluna 1)');
  assert.equal(results[1].citedText, `16 ${JOHN_3_16_KJV}`, 'citedText verbatim do store (coluna 2)');

  // ── anti-alucinação: citedText (store) ≠ interpretation (mock). ────────────────────
  assert.notEqual(results[0].citedText, results[0].interpretation, 'citedText ≠ interpretation');
  assert.equal(results[0].provider, 'mock', 'provider mock');
  assert.equal(results[1].provider, 'mock', 'provider mock');

  // ── OFFLINE: provedor "mock" não faz NENHUMA chamada de rede. ──────────────────────
  assert.equal(calls.length, 0, 'provedor "mock" é OFFLINE (0 fetch nas 2 colunas)');

  await handle.sqlite3.close(handle.db);

  console.log('PASS — comparação multi-IA ancorada no web (2× askAnchored mock, mesma âncora):');
  console.log(`  providers                -> ${results.length}`);
  console.log(`  cited_match              -> ${citedMatch} (mesma âncora do store)`);
  console.log(`  citedText (STORE)        -> "${results[0].citedText.slice(0, 40)}..."`);
  console.log('  offline                  -> provedor "mock" = 0 fetch (sem rede/chave)');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
