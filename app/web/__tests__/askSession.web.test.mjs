// askSession.web.test.mjs — F3.12b (ADR-0032; molde askAnchored.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da PARIDADE WEB DA CONVERSA
// ANCORADA: exercita `askSessionAnchoredOnHandle` (a função de PRODUÇÃO do pipeline web)
// DE PONTA A PONTA com um `fetch` MOCK que devolve um corpo Gemini FIXO:
//   1) `sessionWebPrepare` (wasm) monta o `citedText` (numerado, VERBATIM do STORE) + o
//      `system`/`user` da CONVERSA (`ask_session` → transcript dobrado) — ZERO drift com o
//      nativo `ask_session_anchored`;
//   2) o TEXTO do versículo (âncora) vem do STORE LOCAL: `wa-sqlite` (build SYNC) sobre um
//      VFS de MEMÓRIA com os BYTES de `assets/data/reading-sample.sqlite`, rodando a MESMA
//      `queryChapter` de produção;
//   3) o transporte é um `fetch` MOCK (corpo Gemini fixo) — NENHUMA rede/chave real; a chave
//      dummy vai SÓ no header `x-goog-api-key`, NUNCA na URL/log;
//   4) `aiWebFinalize` (wasm, REUSO do `ask`) monta o `AiAnswer` com o `citedText` do store
//      SEPARADO da `interpretation` do mock.
//
// ANTI-ALUCINAÇÃO (asserção central): `citedText` == João 3:16 KJV VERBATIM do STORE
// (numerado), NUNCA o texto do mock; `interpretation` == o texto da resposta MOCK, NUNCA
// bíblico. Multi-turno (≥2 turnos) sem panic. O `user` enviado embute o `citedText` (contexto
// ancorado) 1× (invariante do 1º turno) + o transcript. Caminho "mock" = OFFLINE (0 fetch).
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
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'askSession-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// Interpretação FIXA da resposta MOCK do provedor (texto do "modelo", NÃO bíblico).
const MOCK_INTERPRETATION =
  'Resposta simulada do provedor (MOCK): esta passagem fala do amor de Deus. [V:G9999]';

// Chave DUMMY (nunca real, nunca logada). Só existe p/ provar que vai ao header.
const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `asksession-headless-${randomBytes(6).toString('hex')}.mjs`);
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
  const { init, mod, ChatRole, askSessionAnchoredOnHandle } = await loadBundle();

  // (1) Fronteira Rust no wasm — session_web_prepare/ai_web_finalize/parse_reference/list_books.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  // (3) `fetch` MOCK: captura o request e devolve um corpo Gemini FIXO. Sem rede real.
  const calls = [];
  const mockFetch = async (url, requestInit) => {
    calls.push({ url, init: requestInit });
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: MOCK_INTERPRETATION }] } }] }),
    };
  };

  // (4) CONVERSA ponta a ponta (1 turno): provider "gemini" + chave dummy + fetch MOCK.
  const firstTurns = [{ role: ChatRole.User, content: 'What does this mean?' }];
  const first = await askSessionAnchoredOnHandle(
    handle,
    mockFetch,
    'kjv',
    43,
    3,
    16,
    'en',
    firstTurns,
    undefined,
    undefined,
    'gemini',
    DUMMY_KEY,
    undefined,
  );

  // ── ANTI-ALUCINAÇÃO: citedText é o STORE, verbatim e numerado; NÃO o mock. ────────
  assert.equal(
    first.citedText,
    `16 ${JOHN_3_16_KJV}`,
    'citedText deve ser "16 <João 3:16 KJV verbatim>" (store, via session_web_prepare)',
  );
  assert.ok(first.citedText.includes(JOHN_3_16_KJV), 'citedText contém o KJV verbatim do store');
  assert.ok(!first.citedText.includes('MOCK'), 'citedText NÃO vem do mock (anti-alucinação)');

  // ── interpretation vem da resposta MOCK, NÃO do store; âncora espúria removida. ────
  assert.ok(
    first.interpretation.includes('Resposta simulada do provedor (MOCK)'),
    'interpretation deve ser o texto extraído da resposta MOCK',
  );
  assert.ok(
    !first.interpretation.includes('For God so loved'),
    'a interpretation (LLM/mock) NÃO reproduz o texto bíblico',
  );
  assert.ok(
    !first.interpretation.includes('[V:G9999]'),
    'ai_web_finalize (REUSO) aplica rewrite_anchors (Rust) e remove a âncora inválida',
  );
  assert.notEqual(first.citedText, first.interpretation, 'citedText (store) ≠ interpretation (LLM)');

  // ── provider/model + referência canônica. ─────────────────────────────────────────
  assert.equal(first.provider, 'gemini', 'provider deve ser gemini');
  assert.equal(first.model, 'gemini-2.5-flash', 'model default do gemini (ai-pure)');
  assert.equal(first.reference.book, 43, 'João é o livro 43');
  assert.equal(first.reference.chapter, 3, 'capítulo 3');
  assert.equal(first.reference.verses.inner.verse, 16, 'versículo 16');

  // ── TRANSPORTE: 1 chamada; modelo na URL; chave no header; user ancora no store 1×. ─
  assert.equal(calls.length, 1, 'exatamente 1 chamada fetch no 1º turno (não-streaming)');
  const [{ url, init: requestInit }] = calls;
  assert.ok(
    url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'),
    `URL Gemini com o modelo, veio: ${url}`,
  );
  assert.ok(!url.includes(DUMMY_KEY), 'a chave NUNCA vai na URL');
  assert.equal(requestInit.method, 'POST', 'método POST');
  assert.equal(requestInit.headers['x-goog-api-key'], DUMMY_KEY, 'chave no header x-goog-api-key');
  const sentUser = JSON.parse(requestInit.body).contents[0].parts[0].text;
  assert.ok(sentUser.includes('What does this mean?'), 'o user embute a pergunta do turno');
  assert.equal(
    sentUser.split(JOHN_3_16_KJV).length - 1,
    1,
    'o user ancora no citedText do store EXATAMENTE 1× (invariante do 1º turno)',
  );

  // ── MULTI-TURNO (User/Assistant/User): sem panic; âncora do store preservada; ───────
  //    o transcript (as 2 falas do usuário) vai no body. Provedor "gemini" → +1 fetch.
  const followTurns = [
    { role: ChatRole.User, content: 'What does this mean?' },
    { role: ChatRole.Assistant, content: 'It speaks of God love.' },
    { role: ChatRole.User, content: 'Can you say more about that?' },
  ];
  const second = await askSessionAnchoredOnHandle(
    handle,
    mockFetch,
    'kjv',
    43,
    3,
    16,
    'en',
    followTurns,
    undefined,
    undefined,
    'gemini',
    DUMMY_KEY,
    undefined,
  );
  assert.equal(second.citedText, `16 ${JOHN_3_16_KJV}`, 'multi-turno: citedText verbatim do store');
  assert.equal(calls.length, 2, 'multi-turno: +1 fetch (2 no total)');
  const secondUser = JSON.parse(calls[1].init.body).contents[0].parts[0].text;
  assert.ok(
    secondUser.includes('What does this mean?') && secondUser.includes('Can you say more about that?'),
    'o user do follow-up embute o transcript dobrado (as 2 falas do usuário)',
  );

  // ── Caminho OFFLINE (provider "mock", sem fetch/chave): também produz conversa válida. ─
  const callsBefore = calls.length;
  const offline = await askSessionAnchoredOnHandle(
    handle,
    mockFetch,
    'kjv',
    43,
    3,
    16,
    'en',
    firstTurns,
    undefined,
    undefined,
    'mock',
    undefined,
    undefined,
  );
  assert.equal(calls.length, callsBefore, 'provider "mock" é OFFLINE (nenhuma chamada fetch)');
  assert.equal(offline.citedText, `16 ${JOHN_3_16_KJV}`, 'mock offline: citedText verbatim do store');
  assert.equal(offline.provider, 'mock', 'provider mock');
  assert.ok(offline.interpretation.length > 0, 'mock offline: interpretation do mock não-vazia');

  // ── Chave nunca logada: em NENHUM request a chave aparece na URL. ──────────────────
  for (const c of calls) {
    assert.ok(!c.url.includes(DUMMY_KEY), 'a chave NUNCA vai na URL de nenhum request');
  }

  await handle.sqlite3.close(handle.db);

  console.log('PASS — paridade web da CONVERSA (session_web_prepare + fetch MOCK + reuso de ai_web_finalize):');
  console.log(`  citedText (STORE)        -> "${first.citedText.slice(0, 40)}..."`);
  console.log(`  interpretation (MOCK)    -> "${first.interpretation.slice(0, 40)}..."`);
  console.log(`  multi-turno              -> ${followTurns.length} turnos sem panic; transcript no body`);
  console.log(`  provider/model           -> ${first.provider} / ${first.model}`);
  console.log('  chave dummy              -> só no header do provedor (nunca na URL/log); "mock" = 0 fetch');
  console.log('  ANTI-ALUCINAÇÃO: citedText = João 3:16 KJV do store; interpretation = MOCK.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
