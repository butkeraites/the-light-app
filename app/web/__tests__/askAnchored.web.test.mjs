// askAnchored.web.test.mjs — F2.7b (ADR-0025; molde F1.13 ADR-0019)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da PARIDADE WEB DE IA:
// exercita `askAnchoredOnHandle` (a função de PRODUÇÃO do pipeline web) DE PONTA A PONTA
// com um `fetch` MOCK que devolve um corpo Gemini FIXO:
//   1) a fronteira Rust no wasm (`ai_web_prepare`/`ai_web_finalize`) monta o `cited_text`
//      (numerado, VERBATIM do STORE) e o `system`/`user` do `ai-pure` — ZERO drift com o
//      nativo;
//   2) o TEXTO do versículo vem do STORE LOCAL: um `wa-sqlite` (build SYNC) sobre um VFS
//      de MEMÓRIA carregado com os BYTES de `assets/data/reading-sample.sqlite` (o MESMO
//      subset/schema do nativo), rodando a MESMA `queryChapter` de produção;
//   3) o transporte é um `fetch` MOCK (corpo Gemini fixo) — NENHUMA rede/chave real; a
//      `interpretation` sai de `candidates[0].content.parts[*].text` (extração TS);
//   4) `aiWebFinalize` (wasm) monta o `AiAnswer` com o `cited_text` do store SEPARADO da
//      `interpretation` do mock.
//
// ANTI-ALUCINAÇÃO (asserção central): `cited_text` == João 3:16 KJV VERBATIM do STORE,
// NUNCA o texto do mock; `interpretation` == o texto da resposta MOCK, NUNCA bíblico.
// PARIDADE com o nativo: o `cited_text` numerado ("16 <verbatim>") é o MESMO formato que
// o `ask_anchored` nativo prova (ai_tests). A chave (dummy) vai só no header
// `x-goog-api-key`, NUNCA na URL nem logada.
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

const ENTRY = join(__dirname, 'askAnchored-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// Interpretação FIXA da resposta MOCK do provedor (texto do "modelo", NÃO bíblico).
// Distintiva o suficiente p/ provar que a interpretation vem do mock, não do store.
const MOCK_INTERPRETATION =
  'Resposta simulada do provedor (MOCK): esta passagem fala do amor de Deus. ' +
  '[V:G9999]'; // âncora Strong ESPÚRIA — deve ser removida por rewrite_anchors (Rust).

// Chave DUMMY (nunca real, nunca logada). Só existe p/ provar que vai ao header.
const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `askanchored-headless-${randomBytes(6).toString('hex')}.mjs`);
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

  // (1) Fronteira Rust no wasm — ai_web_prepare/ai_web_finalize/parse_reference.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  // (3) `fetch` MOCK: captura o request (p/ provar o transporte) e devolve um corpo
  //     Gemini FIXO. NENHUMA rede real. A chave dummy NÃO deve aparecer na URL.
  const calls = [];
  const mockFetch = async (url, requestInit) => {
    calls.push({ url, init: requestInit });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: MOCK_INTERPRETATION }] } }],
      }),
    };
  };

  // (4) Pipeline web de IA ponta a ponta: provider "gemini" + chave dummy + fetch MOCK.
  const answer = await askAnchoredOnHandle(
    handle,
    mockFetch,
    'kjv',
    'John 3:16',
    'What does this passage mean?',
    'gemini',
    DUMMY_KEY,
    undefined,
    'en',
  );

  // ── ANTI-ALUCINAÇÃO: cited_text é o STORE, verbatim e numerado; NÃO o mock. ────────
  assert.equal(
    answer.citedText,
    `16 ${JOHN_3_16_KJV}`,
    'cited_text deve ser "16 <João 3:16 KJV verbatim>" (store, via ai_web_prepare)',
  );
  assert.ok(answer.citedText.includes(JOHN_3_16_KJV), 'cited_text contém o KJV verbatim do store');
  assert.ok(
    !answer.citedText.includes('MOCK'),
    'cited_text NÃO vem do mock (anti-alucinação): é o texto do store',
  );

  // ── interpretation vem da resposta MOCK (extração TS), NÃO do store. ──────────────
  assert.ok(
    answer.interpretation.includes('Resposta simulada do provedor (MOCK)'),
    'interpretation deve ser o texto extraído da resposta MOCK',
  );
  assert.ok(
    !answer.interpretation.includes('For God so loved'),
    'a interpretation (LLM/mock) NÃO reproduz o texto bíblico',
  );
  // rewrite_anchors (Rust, ai_web_finalize) removeu a âncora Strong espúria do mock.
  assert.ok(
    !answer.interpretation.includes('[V:G9999]'),
    'ai_web_finalize deve aplicar rewrite_anchors (Rust) e remover a âncora inválida',
  );
  // cited_text (store) SEPARADO da interpretation (LLM).
  assert.notEqual(answer.citedText, answer.interpretation, 'cited_text ≠ interpretation');

  // ── provider/model e referência canônica. ─────────────────────────────────────────
  assert.equal(answer.provider, 'gemini', 'provider deve ser gemini');
  assert.equal(answer.model, 'gemini-2.5-flash', 'model default do gemini (ai-pure)');
  assert.equal(answer.reference.book, 43, 'João é o livro 43');
  assert.equal(answer.reference.chapter, 3, 'capítulo 3');
  assert.equal(answer.reference.verses.inner.verse, 16, 'versículo 16');

  // ── TRANSPORTE: 1 chamada `fetch`; modelo na URL; chave no header, NÃO na URL. ────
  assert.equal(calls.length, 1, 'exatamente 1 chamada fetch (transporte não-streaming)');
  const [{ url, init: requestInit }] = calls;
  assert.ok(
    url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'),
    `URL Gemini com o modelo, veio: ${url}`,
  );
  assert.ok(!url.includes(DUMMY_KEY), 'a chave NUNCA vai na URL');
  assert.equal(requestInit.method, 'POST', 'método POST');
  assert.equal(requestInit.headers['x-goog-api-key'], DUMMY_KEY, 'chave no header x-goog-api-key');
  const sentBody = JSON.parse(requestInit.body);
  assert.ok(sentBody.system_instruction?.parts?.[0]?.text, 'body tem system_instruction (ai-pure)');
  assert.ok(
    sentBody.contents?.[0]?.parts?.[0]?.text?.includes('What does this passage mean?'),
    'o user prompt (ai-pure) embute a pergunta',
  );
  assert.ok(
    sentBody.contents[0].parts[0].text.includes(JOHN_3_16_KJV),
    'o user prompt ancora no cited_text VERBATIM do store (contexto RAG)',
  );

  await handle.sqlite3.close(handle.db);

  console.log('PASS — paridade web de IA (ai_web_prepare/finalize no wasm + fetch MOCK):');
  console.log(`  cited_text (STORE, ai-pure) -> "${answer.citedText}"`);
  console.log(`  interpretation (MOCK/fetch) -> "${answer.interpretation}"`);
  console.log(`  provider/model              -> ${answer.provider} / ${answer.model}`);
  console.log(`  transporte                  -> POST ${url.split('?')[0]}`);
  console.log('  chave dummy                 -> só no header do provedor (nunca na URL/log)');
  console.log(
    '  ANTI-ALUCINAÇÃO: cited_text = João 3:16 KJV VERBATIM do store (não do mock); ' +
      'interpretation = texto da resposta MOCK. PARIDADE: mesmo cited_text numerado do nativo.',
  );
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
