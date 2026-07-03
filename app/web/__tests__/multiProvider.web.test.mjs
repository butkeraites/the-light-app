// multiProvider.web.test.mjs — F4.2 (ADR-0034; molde F4.1 askAnchoredStream.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) do TRANSPORTE WEB
// MULTI-PROVEDOR da IA (anthropic/openai/ollama) — exercita `askAnchoredOnHandle(...)` (a
// função de PRODUÇÃO do pipeline web) DE PONTA A PONTA com um `fetch` MOCK que devolve o corpo
// ESPECÍFICO de cada provedor (streaming SSE p/ anthropic/openai, NDJSON p/ ollama; e
// não-streaming), provando por provedor que:
//   1) o transporte monta URL + headers (chave BYOK no header CERTO) + body CORRETOS
//      (asserção sobre o request CAPTURADO pelo mock): anthropic `POST /v1/messages` com
//      `x-api-key`+`anthropic-version`; openai `POST /v1/chat/completions` com
//      `authorization: Bearer`; ollama `POST http://localhost:11434/api/chat` SEM header de
//      chave;
//   2) streaming → `onToken` N>=2 vezes na ORDEM; a concatenação dos tokens == a interpretação
//      final que segue para `ai_web_finalize` (zero-drift, MESMO caminho do não-streaming);
//   3) não-streaming → `interpretation` == o extract do shape do provedor
//      (anthropic `content[type=="text"].text`; openai `choices[0].message.content`; ollama
//      `message.content`);
//   4) `cited_text` == João 3:16 KJV VERBATIM do STORE (via `ai_web_prepare`), INALTERADO e
//      SEPARADO da interpretação — NÃO vem do mock (anti-alucinação);
//   5) uma âncora Strong ESPÚRIA (`[V:G9999]`) no stream do modelo é REMOVIDA por
//      `ai_web_finalize` (Rust `rewrite_anchors`) — a interpretação final não a contém;
//   6) a chave DUMMY vai SÓ no header (NUNCA na URL); ollama funciona SEM chave.
//
// O multi-provedor muda SÓ o transporte TS: `ai_web_prepare`/`ai_web_finalize` (Rust `ai-pure`)
// são INALTERADOS. O TEXTO bíblico vem do STORE LOCAL (`wa-sqlite` build SYNC sobre um VFS de
// MEMÓRIA carregado com os BYTES de `assets/data/reading-sample.sqlite`), rodando a MESMA
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

const ENTRY = join(__dirname, 'multiProvider-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// Chave DUMMY (nunca real, nunca logada). Só existe p/ provar que vai ao header CERTO.
const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `multiprovider-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Abre um `wa-sqlite` (build sync) sobre um VFS de memória semeado com os BYTES do subset — o
// backend de prova equivalente, em node, ao OPFS do browser.
async function openReadingDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_WASM);
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

// `fetch` MOCK de STREAMING: devolve um corpo `ReadableStream` com `text` (o corpo SSE/NDJSON
// do provedor). `sliceBytes` (opcional) fatia em pedaços de N BYTES — prova que o parser
// incremental reconstrói eventos QUEBRADOS através de fronteiras de chunk. Captura cada chamada.
function makeStreamFetch(calls, text, sliceBytes) {
  return async (url, init) => {
    calls.push({ url, init });
    const bytes = new TextEncoder().encode(text);
    const step = sliceBytes ?? bytes.length;
    const body = new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += step) {
          controller.enqueue(bytes.slice(i, i + step));
        }
        controller.close();
      },
    });
    return { ok: true, status: 200, body };
  };
}

// `fetch` MOCK NÃO-streaming: devolve `{ json: () => obj }` com o shape completo do provedor.
function makeJsonFetch(calls, obj) {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => obj };
  };
}

// ── Construtores de corpo por provedor ────────────────────────────────────────────────────

// Anthropic SSE (Messages API): eventos `message_start`/`content_block_start`/`ping` (ruído a
// ignorar) + N `content_block_delta` (`delta.type=="text_delta"`) + `content_block_stop`/
// `message_delta`/`message_stop`.
function anthropicSse(deltas) {
  let out = '';
  out += `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg', role: 'assistant', content: [] } })}\n\n`;
  out += `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`;
  out += `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`;
  for (const text of deltas) {
    out += `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`;
  }
  out += `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;
  out += `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}\n\n`;
  out += `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
  return out;
}
function anthropicJson(full) {
  // Inclui um bloco de "thinking" p/ provar que o extract filtra só `type=="text"`.
  return {
    content: [
      { type: 'thinking', thinking: 'raciocínio interno ignorado' },
      { type: 'text', text: full },
    ],
    stop_reason: 'end_turn',
  };
}

// OpenAI SSE (Chat Completions): 1º evento só-`role` (sem content, a ignorar) + N eventos
// `delta.content` + evento `finish_reason` + `data: [DONE]`.
function openaiSse(deltas) {
  let out = '';
  out += `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`;
  for (const text of deltas) {
    out += `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;
  }
  out += `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`;
  out += 'data: [DONE]\n\n';
  return out;
}
function openaiJson(full) {
  return { choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }] };
}

// Ollama NDJSON (um JSON por linha, SEM prefixo `data:`): N linhas `done:false` + linha final
// `done:true` com content vazio.
function ollamaNdjson(deltas) {
  let out = '';
  for (const text of deltas) {
    out += JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: text }, done: false }) + '\n';
  }
  out += JSON.stringify({ model: 'llama3', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }) + '\n';
  return out;
}
function ollamaJson(full) {
  return { model: 'llama3', message: { role: 'assistant', content: full }, done: true };
}

// ── Especificação por provedor (endpoint/headers/body + construtores de corpo) ──────────────
const SPECS = [
  {
    name: 'anthropic',
    key: DUMMY_KEY,
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-opus-4-8',
    sse: anthropicSse,
    json: anthropicJson,
    assertHeaders(headers) {
      assert.equal(headers['x-api-key'], DUMMY_KEY, 'anthropic: chave SÓ no header x-api-key');
      assert.equal(headers['anthropic-version'], '2023-06-01', 'anthropic: header anthropic-version');
      assert.equal(headers.authorization, undefined, 'anthropic: sem header authorization');
    },
    assertBody(body, { stream }) {
      assert.equal(body.model, 'claude-opus-4-8', 'anthropic: model default (ai_web_prepare)');
      assert.equal(body.max_tokens, 8192, 'anthropic: max_tokens 8192');
      assert.ok(typeof body.system === 'string' && body.system.length > 0, 'anthropic: system (ai-pure)');
      assert.equal(body.messages[0].role, 'user', 'anthropic: única mensagem role user');
      assert.ok(body.messages[0].content.includes(JOHN_3_16_KJV), 'anthropic: user ancora no cited_text do store');
      assert.equal(body.messages.length, 1, 'anthropic: só a mensagem user (system é campo próprio)');
      assert.equal(body.stream, stream ? true : undefined, `anthropic: stream=${stream ? 'true' : 'ausente'}`);
    },
  },
  {
    name: 'openai',
    key: DUMMY_KEY,
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    sse: openaiSse,
    json: openaiJson,
    assertHeaders(headers) {
      assert.equal(headers.authorization, `Bearer ${DUMMY_KEY}`, 'openai: chave SÓ no header authorization Bearer');
      assert.equal(headers['x-api-key'], undefined, 'openai: sem header x-api-key');
    },
    assertBody(body, { stream }) {
      assert.equal(body.model, 'gpt-4o', 'openai: model default (ai_web_prepare)');
      assert.equal(body.max_tokens, 8192, 'openai: max_tokens 8192');
      assert.equal(body.messages[0].role, 'system', 'openai: messages[0] role system');
      assert.equal(body.messages[1].role, 'user', 'openai: messages[1] role user');
      assert.ok(body.messages[1].content.includes(JOHN_3_16_KJV), 'openai: user ancora no cited_text do store');
      assert.equal(body.stream, stream ? true : undefined, `openai: stream=${stream ? 'true' : 'ausente'}`);
    },
  },
  {
    name: 'ollama',
    key: undefined, // Ollama é local — SEM chave.
    url: 'http://localhost:11434/api/chat',
    model: 'llama3',
    sse: ollamaNdjson,
    json: ollamaJson,
    assertHeaders(headers) {
      assert.equal(headers['x-api-key'], undefined, 'ollama: SEM header x-api-key');
      assert.equal(headers.authorization, undefined, 'ollama: SEM header authorization');
      // Nenhum valor de chave em NENHUM header.
      for (const v of Object.values(headers)) {
        assert.ok(!String(v).includes(DUMMY_KEY), 'ollama: nenhuma chave em header');
      }
    },
    assertBody(body, { stream }) {
      assert.equal(body.model, 'llama3', 'ollama: model default (ai_web_prepare)');
      assert.equal(body.messages[0].role, 'system', 'ollama: messages[0] role system');
      assert.equal(body.messages[1].role, 'user', 'ollama: messages[1] role user');
      assert.ok(body.messages[1].content.includes(JOHN_3_16_KJV), 'ollama: user ancora no cited_text do store');
      assert.equal(body.stream, stream, `ollama: stream=${stream}`);
    },
  },
];

// Asserções COMUNS do request capturado (endpoint + método + chave só no header + no URL).
function assertRequest(spec, call, opts) {
  assert.equal(call.url, spec.url, `${spec.name}: endpoint ${spec.url}`);
  assert.equal(call.init.method, 'POST', `${spec.name}: método POST`);
  assert.ok(!call.url.includes(DUMMY_KEY), `${spec.name}: a chave NUNCA vai na URL`);
  spec.assertHeaders(call.init.headers);
  spec.assertBody(JSON.parse(call.init.body), opts);
}

// Asserções COMUNS do AiAnswer (cited_text do store, separado; provider/model; referência).
function assertAnswer(spec, answer) {
  assert.equal(answer.provider, spec.name, `${spec.name}: answer.provider`);
  assert.equal(answer.model, spec.model, `${spec.name}: answer.model (default do ai_web_prepare)`);
  assert.equal(answer.citedText, `16 ${JOHN_3_16_KJV}`, `${spec.name}: cited_text = João 3:16 KJV verbatim do store`);
  assert.notEqual(answer.citedText, answer.interpretation, `${spec.name}: cited_text ≠ interpretation`);
  assert.ok(!answer.interpretation.includes('For God so loved'), `${spec.name}: a interpretation NÃO reproduz o texto bíblico`);
  assert.equal(answer.reference.book, 43, `${spec.name}: João é o livro 43`);
  assert.equal(answer.reference.verses.inner.verse, 16, `${spec.name}: versículo 16`);
}

async function main() {
  const { init, mod, askAnchoredOnHandle } = await loadBundle();

  // (1) Fronteira Rust no wasm — ai_web_prepare/ai_web_finalize/parse_reference (INALTERADA).
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  const summary = [];

  for (const spec of SPECS) {
    // ══ CENÁRIO 1 — STREAMING LIMPO: onToken N>=2 na ordem; concat == interpretation ══
    const deltas = ['This ', 'passage ', 'teaches ', "God's ", 'love.']; // N=5, sem âncora
    const callsS = [];
    const tokensS = [];
    const answerS = await askAnchoredOnHandle(
      handle,
      makeStreamFetch(callsS, spec.sse(deltas)),
      'kjv',
      'John 3:16',
      'What does this passage mean?',
      spec.name,
      spec.key,
      undefined,
      'en',
      (t) => tokensS.push(t),
    );
    assert.equal(callsS.length, 1, `${spec.name}: exatamente 1 fetch (streaming)`);
    assert.equal(tokensS.length, deltas.length, `${spec.name}: onToken N vezes (1 por delta)`);
    assert.ok(tokensS.length >= 2, `${spec.name}: N >= 2 incrementos reais (não 1x)`);
    assert.deepEqual(tokensS, deltas, `${spec.name}: tokens na ORDEM dos chunks`);
    assert.equal(tokensS.join(''), answerS.interpretation, `${spec.name}: concat dos tokens == interpretation`);
    assertRequest(spec, callsS[0], { stream: true });
    assertAnswer(spec, answerS);

    // ══ CENÁRIO 2 — NÃO-STREAMING: extract do shape do provedor == interpretation ══
    const full = 'A simple non-streaming interpretation of grace.';
    const callsN = [];
    const answerN = await askAnchoredOnHandle(
      handle,
      makeJsonFetch(callsN, spec.json(full)),
      'kjv',
      'John 3:16',
      'Explain briefly.',
      spec.name,
      spec.key,
      undefined,
      'en',
      // sem onToken → caminho NÃO-streaming
    );
    assert.equal(callsN.length, 1, `${spec.name}: exatamente 1 fetch (não-streaming)`);
    assert.equal(answerN.interpretation, full, `${spec.name}: interpretation == extract do provedor`);
    assertRequest(spec, callsN[0], { stream: false });
    assertAnswer(spec, answerN);

    // ══ CENÁRIO 3 — ÂNCORA ESPÚRIA + fronteiras de byte quebradas (5B) ══
    // O modelo streama uma âncora Strong ESPÚRIA `[V:G9999]`; ai_web_finalize (Rust) a remove.
    const deltasA = ['Grace ', 'abounds ', 'here. ', '[V:G9999]'];
    const callsA = [];
    const tokensA = [];
    const answerA = await askAnchoredOnHandle(
      handle,
      makeStreamFetch(callsA, spec.sse(deltasA), 5), // fatiado em 5 BYTES → eventos quebrados
      'kjv',
      'John 3:16',
      'Explain.',
      spec.name,
      spec.key,
      undefined,
      'en',
      (t) => tokensA.push(t),
    );
    assert.deepEqual(tokensA, deltasA, `${spec.name}: deltas reconstruídos na ordem apesar das fronteiras de byte`);
    const rawA = tokensA.join('');
    assert.ok(rawA.includes('[V:G9999]'), `${spec.name}: o stream do modelo contém a âncora espúria`);
    assert.ok(!answerA.interpretation.includes('[V:G9999]'), `${spec.name}: ai_web_finalize (Rust) removeu a âncora espúria`);
    assert.equal(
      answerA.interpretation,
      rawA.replaceAll('[V:G9999]', ''),
      `${spec.name}: interpretation == concat com só a âncora espúria removida (pelo Rust)`,
    );
    assertAnswer(spec, answerA);

    summary.push(
      `  [${spec.name}]  stream onToken ${tokensS.length}x -> concat==interpretation; ` +
        `POST ${spec.url} (${spec.key ? 'chave só no header' : 'SEM chave'}); ` +
        `não-stream extract OK; âncora [V:G9999] removida pelo Rust`,
    );
  }

  // ══ Chave AUSENTE p/ provedores de rede COM chave → erro que cita SÓ o provedor ══
  for (const provider of ['anthropic', 'openai']) {
    const callsE = [];
    let threw;
    try {
      await askAnchoredOnHandle(
        handle,
        makeJsonFetch(callsE, {}),
        'kjv',
        'John 3:16',
        'x',
        provider,
        '', // chave vazia
        undefined,
        'en',
      );
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, `${provider}: chave vazia deve lançar`);
    assert.ok(threw.message.includes(provider), `${provider}: erro cita o provedor`);
    assert.ok(!threw.message.includes(DUMMY_KEY), `${provider}: erro NÃO vaza valor de chave`);
    assert.equal(callsE.length, 0, `${provider}: sem fetch quando falta a chave`);
  }

  await handle.sqlite3.close(handle.db);

  console.log('PASS — transporte web MULTI-PROVEDOR (só transporte TS; ai_web_prepare/finalize inalterados):');
  for (const line of summary) {
    console.log(line);
  }
  console.log('  cited_text (STORE, ai_web_prepare, inalterado) -> "16 <João 3:16 KJV verbatim>" (separado da interpretação)');
  console.log('  chave ausente (anthropic/openai) -> erro cita só o provedor (nunca o valor); ollama sem chave');
  console.log(
    '  ANTI-ALUCINAÇÃO ZERO-DRIFT: multi-provedor muda só o transporte (endpoint/headers/body/extract por API); ' +
      'cited_text do store (verbatim, separado); âncora Strong espúria removida pela MESMA ai_web_finalize (Rust); tokens só da interpretação.',
  );
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
