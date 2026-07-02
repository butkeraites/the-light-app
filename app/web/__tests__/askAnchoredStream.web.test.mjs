// askAnchoredStream.web.test.mjs — F4.1 (ADR-0033; molde F2.7b askAnchored.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) do STREAMING WEB REAL da IA:
// exercita `askAnchoredOnHandle(..., onToken)` (a função de PRODUÇÃO do pipeline web) DE
// PONTA A PONTA com um `fetch` MOCK que devolve um corpo `ReadableStream` **SSE** com N
// chunks (endpoint `:streamGenerateContent?alt=sse`), provando que:
//   1) o transporte LÊ o `ReadableStream` incremental, extrai cada DELTA e chama `onToken`
//      N vezes (incrementos REAIS, não 1×), na ORDEM dos chunks;
//   2) o texto COMPLETO acumulado (concatenação dos tokens) é o que segue para
//      `ai_web_finalize` (wasm) — o MESMO caminho zero-drift do não-streaming;
//   3) `cited_text` == João 3:16 KJV VERBATIM do STORE (via `ai_web_prepare`), INALTERADO —
//      NÃO vem do mock, SEPARADO da interpretação (anti-alucinação);
//   4) uma âncora Strong ESPÚRIA (`[V:G9999]`) no stream do modelo é REMOVIDA por
//      `ai_web_finalize` (Rust `rewrite_anchors`) — a interpretação final não a contém;
//   5) 1 única chamada `fetch`, ao endpoint de STREAMING, POST, com a chave SÓ no header
//      `x-goog-api-key` (NUNCA na URL/log);
//   6) o caminho `"mock"` com `onToken` emite ≥1 incremento OFFLINE (sem `fetch`).
//
// O streaming muda SÓ o transporte TS: `ai_web_prepare`/`ai_web_finalize` (Rust `ai-pure`)
// são INALTERADOS. O TEXTO bíblico vem do STORE LOCAL (`wa-sqlite` build SYNC sobre um VFS
// de MEMÓRIA carregado com os BYTES de `assets/data/reading-sample.sqlite`), rodando a MESMA
// `queryChapter` de produção. NENHUMA rede/chave real.
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

const ENTRY = join(__dirname, 'askAnchoredStream-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// Chave DUMMY (nunca real, nunca logada). Só existe p/ provar que vai ao header.
const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `askanchoredstream-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Constrói o TEXTO SSE Gemini para uma lista de deltas: cada delta vira um evento
// `data: {candidates:[{content:{parts:[{text:<delta>}]}}]}` seguido de linha em branco.
// Ao fim, um sentinela `data: [DONE]` (Gemini não o envia, mas o transporte deve tolerar).
function sseText(deltas) {
  let out = '';
  for (const text of deltas) {
    const payload = JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
    out += `data: ${payload}\n\n`;
  }
  out += 'data: [DONE]\n\n';
  return out;
}

// `fetch` MOCK que devolve um corpo `ReadableStream` SSE. `sliceBytes` (opcional) fatia o
// texto SSE em pedaços de N BYTES — provando que o parser incremental (getReader +
// TextDecoder + buffer de linha) reconstrói eventos QUEBRADOS através de fronteiras de
// chunk. Registra cada chamada em `calls` (p/ provar 1 fetch, URL, header, método).
function makeStreamingFetch(calls, deltas, sliceBytes) {
  return async (url, requestInit) => {
    calls.push({ url, init: requestInit });
    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(sseText(deltas));
    const step = sliceBytes ?? fullBytes.length; // default: 1 chunk com tudo
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < fullBytes.length; i += step) {
          controller.enqueue(fullBytes.slice(i, i + step));
        }
        controller.close();
      },
    });
    return { ok: true, status: 200, body };
  };
}

async function main() {
  const { init, mod, askAnchoredOnHandle } = await loadBundle();

  // (1) Fronteira Rust no wasm — ai_web_prepare/ai_web_finalize/parse_reference (INALTERADA).
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  // ══ CENÁRIO A — STREAMING LIMPO (sem âncora): concatenação dos tokens == interpretation ══
  // N=6 deltas de INTERPRETAÇÃO do modelo (NÃO bíblicos). Sem âncoras → finalize é no-op no
  // corpo → a concatenação dos tokens é EXATAMENTE a interpretation final.
  const deltasA = ['This ', 'passage ', 'speaks ', 'of ', "God's ", 'love.'];
  const callsA = [];
  const tokensA = [];
  const answerA = await askAnchoredOnHandle(
    handle,
    makeStreamingFetch(callsA, deltasA),
    'kjv',
    'John 3:16',
    'What does this passage mean?',
    'gemini',
    DUMMY_KEY,
    undefined,
    'en',
    (t) => tokensA.push(t),
  );

  // Streaming REAL: N tokens, na ORDEM dos deltas (não 1×).
  assert.equal(tokensA.length, deltasA.length, 'onToken chamado N vezes (1 por delta SSE)');
  assert.ok(tokensA.length >= 2, 'N >= 2 incrementos reais (não 1×)');
  assert.deepEqual(tokensA, deltasA, 'tokens chegam na ORDEM dos chunks do stream');
  // Concatenação dos tokens == interpretation (sem âncora, finalize no-op no corpo).
  assert.equal(
    tokensA.join(''),
    answerA.interpretation,
    'a concatenação dos tokens == AiAnswer.interpretation',
  );
  // cited_text = João 3:16 KJV VERBATIM do STORE (via ai_web_prepare), INALTERADO ≠ stream.
  assert.equal(
    answerA.citedText,
    `16 ${JOHN_3_16_KJV}`,
    'cited_text = "16 <João 3:16 KJV verbatim>" (store, ai_web_prepare, inalterado)',
  );
  assert.ok(
    !answerA.interpretation.includes('For God so loved'),
    'a interpretation (LLM/stream) NÃO reproduz o texto bíblico',
  );
  // TRANSPORTE: 1 fetch, endpoint de STREAMING (?alt=sse), POST, chave SÓ no header.
  assert.equal(callsA.length, 1, 'exatamente 1 chamada fetch (streaming)');
  const urlA = callsA[0].url;
  assert.ok(
    urlA.startsWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent',
    ),
    `URL de streamGenerateContent com o modelo, veio: ${urlA}`,
  );
  assert.ok(urlA.includes('alt=sse'), 'endpoint SSE (?alt=sse)');
  assert.ok(!urlA.includes(DUMMY_KEY), 'a chave NUNCA vai na URL');
  assert.equal(callsA[0].init.method, 'POST', 'método POST');
  assert.equal(
    callsA[0].init.headers['x-goog-api-key'],
    DUMMY_KEY,
    'chave só no header x-goog-api-key',
  );
  const bodyA = JSON.parse(callsA[0].init.body);
  assert.ok(bodyA.system_instruction?.parts?.[0]?.text, 'body tem system_instruction (ai-pure)');
  assert.ok(
    bodyA.contents?.[0]?.parts?.[0]?.text?.includes(JOHN_3_16_KJV),
    'o user prompt ancora no cited_text VERBATIM do store (contexto RAG)',
  );

  // ══ CENÁRIO B — ÂNCORA ESPÚRIA + fronteiras de byte quebradas ═══════════════════════════
  // O modelo streama uma âncora Strong ESPÚRIA (`[V:G9999]`) num delta. O stream é fatiado em
  // pedaços de 7 BYTES (eventos SSE quebrados através de chunks) p/ provar o parser incremental.
  const deltasB = ['God ', 'loved ', 'the ', 'world. ', '[V:G9999]'];
  const callsB = [];
  const tokensB = [];
  const answerB = await askAnchoredOnHandle(
    handle,
    makeStreamingFetch(callsB, deltasB, 7),
    'kjv',
    'John 3:16',
    'Explain briefly.',
    'gemini',
    DUMMY_KEY,
    undefined,
    'en',
    (t) => tokensB.push(t),
  );

  assert.equal(tokensB.length, deltasB.length, 'onToken N vezes mesmo com bytes fatiados (7B)');
  assert.deepEqual(tokensB, deltasB, 'deltas reconstruídos na ordem apesar das fronteiras de byte');
  const rawB = tokensB.join('');
  // O modelo EMITIU a âncora espúria...
  assert.ok(rawB.includes('[V:G9999]'), 'o stream do modelo contém a âncora espúria [V:G9999]');
  // ...mas ai_web_finalize (Rust rewrite_anchors) a REMOVEU da interpretação final.
  assert.ok(
    !answerB.interpretation.includes('[V:G9999]'),
    'ai_web_finalize (Rust rewrite_anchors) removeu a âncora Strong inválida',
  );
  // A interpretação final é a concatenação com APENAS a âncora espúria removida pelo Rust
  // (nada mais mudou) — o streaming não altera o texto além de fatiá-lo.
  assert.equal(
    answerB.interpretation,
    rawB.replaceAll('[V:G9999]', ''),
    'interpretation == concatenação dos tokens com só a âncora espúria removida (pelo Rust)',
  );
  // cited_text segue VERBATIM do store, INALTERADO e SEPARADO da interpretação.
  assert.equal(answerB.citedText, `16 ${JOHN_3_16_KJV}`, 'cited_text inalterado (store)');
  assert.notEqual(answerB.citedText, answerB.interpretation, 'cited_text ≠ interpretation');
  assert.equal(answerB.provider, 'gemini', 'provider gemini');
  assert.equal(answerB.model, 'gemini-2.5-flash', 'model default do gemini (ai-pure)');
  assert.equal(answerB.reference.book, 43, 'João é o livro 43');
  assert.equal(answerB.reference.verses.inner.verse, 16, 'versículo 16');
  assert.equal(callsB.length, 1, '1 fetch de streaming no cenário B');

  // ══ CENÁRIO C — provider "mock" com onToken: ≥1 incremento OFFLINE, SEM fetch ════════════
  const callsC = [];
  const tokensC = [];
  const mockFetchC = async (url, requestInit) => {
    callsC.push({ url, init: requestInit });
    throw new Error('o caminho "mock" NÃO deve tocar a rede');
  };
  const answerC = await askAnchoredOnHandle(
    handle,
    mockFetchC,
    'kjv',
    'John 3:16',
    'Explique.',
    'mock',
    undefined,
    undefined,
    'pt',
    (t) => tokensC.push(t),
  );
  assert.equal(callsC.length, 0, 'provider "mock" NÃO faz fetch (offline)');
  assert.ok(tokensC.length >= 1, 'mock com onToken emite >= 1 incremento offline');
  assert.equal(
    tokensC.join(''),
    answerC.interpretation,
    'mock: concatenação dos tokens == interpretation (finalize no-op)',
  );
  assert.equal(answerC.citedText, `16 ${JOHN_3_16_KJV}`, 'mock: cited_text = store verbatim');

  await handle.sqlite3.close(handle.db);

  console.log('PASS — streaming web REAL (transporte TS streama; ai_web_prepare/finalize inalterados):');
  console.log(`  [A limpo]   onToken ${tokensA.length}x em ordem -> concat == interpretation`);
  console.log(`              interpretation -> "${answerA.interpretation}"`);
  console.log(`              transporte     -> POST ${urlA.split('?')[0]}?alt=sse (chave só no header)`);
  console.log(`  [B âncora]  onToken ${tokensB.length}x (bytes fatiados 7B); stream tinha [V:G9999]`);
  console.log(`              interpretation (pós-finalize Rust) -> "${answerB.interpretation}"  (âncora removida)`);
  console.log(`  [C mock]    onToken ${tokensC.length}x OFFLINE, 0 fetch -> "${answerC.interpretation}"`);
  console.log(`  cited_text (STORE, ai_web_prepare, inalterado) -> "16 <João 3:16 KJV verbatim>"`);
  console.log(
    '  ANTI-ALUCINAÇÃO ZERO-DRIFT: streaming muda só o transporte; cited_text do store (verbatim, ' +
      'separado); âncora Strong espúria removida pela MESMA ai_web_finalize (Rust); tokens só da interpretação.',
  );
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
