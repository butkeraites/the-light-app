// askMultiAnchored.web.test.mjs — Fase 5 (ADR-0069 Caminho A; molde de askAnchored.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da SÍNTESE TEMÁTICA CONJUNTA
// sobre VÁRIOS trechos DISJUNTOS: exercita `askMultiAnchoredOnHandle` (a função de PRODUÇÃO
// do pipeline web multi) DE PONTA A PONTA com dois trechos cross-livro (João 3:16 + Mateus
// 1:1) e um `fetch` MOCK:
//   1) a fronteira Rust no wasm (`ai_multi_web_prepare`/`ai_multi_web_finalize`) resolve os N
//      `cited_text` (numerados, VERBATIM do STORE) e monta UM par system/user com o contexto
//      CONJUNTO dos dois trechos — ZERO drift com o nativo (mesma composição `multi_context`);
//   2) o TEXTO vem do STORE LOCAL (wa-sqlite sobre VFS de memória com os bytes do subset);
//   3) o transporte é UM `fetch` MOCK (corpo Gemini fixo) — uma única chamada CONJUNTA (não
//      fan-out); a `interpretation` sai da extração TS;
//   4) `ai_multi_web_finalize` (wasm) monta o `AiAnswerMulti` com as N passagens do store
//      SEPARADAS da interpretação única.
//
// ANTI-ALUCINAÇÃO (asserção central): cada `citedText` == o verbatim do STORE daquele trecho,
// NUNCA o texto do mock; UMA `interpretation` == o texto do mock, NUNCA bíblico. O user prompt
// CONJUNTO ancora nos DOIS textos verbatim (contexto RAG dos N trechos).
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

const ENTRY = join(__dirname, 'askMultiAnchored-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// Textos VERBATIM do store (domínio público) — só no teste (asserção anti-alucinação).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';
const MATTHEW_1_1_KJV =
  'The book of the generation of Jesus Christ, the son of David, the son of Abraham.';

// Interpretação FIXA da resposta MOCK (texto do "modelo", NÃO bíblico), distintiva.
const MOCK_INTERPRETATION =
  'Resposta simulada do provedor (MOCK): estes trechos, juntos, falam do plano de Deus. ' +
  '[V:G9999]'; // âncora Strong ESPÚRIA — deve ser removida por rewrite_anchors (Rust).

const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `askmulti-headless-${randomBytes(6).toString('hex')}.mjs`);
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

async function main() {
  const { init, mod, askMultiAnchoredOnHandle } = await loadBundle();

  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const handle = await openReadingDbInMemory();

  // `fetch` MOCK: captura os requests e devolve um corpo Gemini FIXO. NENHUMA rede real.
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

  // Pipeline web multi ponta a ponta: DOIS trechos disjuntos cross-livro, provider gemini.
  const answer = await askMultiAnchoredOnHandle(
    handle,
    mockFetch,
    'kjv',
    ['John 3:16', 'Matthew 1:1'],
    'What theme do these passages share?',
    'gemini',
    DUMMY_KEY,
    undefined,
    'en',
  );

  // ── N passagens citadas, cada uma VERBATIM do store (anti-alucinação). ──────────────
  assert.equal(answer.citedPassages.length, 2, 'devem vir 2 passagens citadas (uma por trecho)');
  const [p0, p1] = answer.citedPassages;
  assert.equal(p0.citedText, `16 ${JOHN_3_16_KJV}`, 'trecho 0 = "16 <João 3:16 KJV verbatim>"');
  assert.equal(p1.citedText, `1 ${MATTHEW_1_1_KJV}`, 'trecho 1 = "1 <Mateus 1:1 KJV verbatim>"');
  assert.equal(p0.reference.book, 43, 'trecho 0: João (43)');
  assert.equal(p1.reference.book, 40, 'trecho 1: Mateus (40)');
  assert.ok(!p0.citedText.includes('MOCK') && !p1.citedText.includes('MOCK'), 'citado NÃO vem do mock');

  // ── UMA interpretação, do MOCK, tecendo os trechos (não bíblica). ───────────────────
  assert.ok(
    answer.interpretation.includes('Resposta simulada do provedor (MOCK)'),
    'interpretation = texto extraído da resposta MOCK',
  );
  assert.ok(
    !answer.interpretation.includes('For God so loved') && !answer.interpretation.includes('generation of Jesus'),
    'a interpretation (LLM/mock) NÃO reproduz texto bíblico',
  );
  assert.ok(
    !answer.interpretation.includes('[V:G9999]'),
    'ai_multi_web_finalize aplica rewrite_anchors (Rust) e remove a âncora inválida',
  );
  assert.equal(answer.provider, 'gemini', 'provider gemini');
  assert.equal(answer.model, 'gemini-2.5-flash', 'model default do gemini (ai-pure)');

  // ── TRANSPORTE: UMA única chamada CONJUNTA (não fan-out); prompt ancora nos DOIS textos. ──
  assert.equal(calls.length, 1, 'exatamente 1 fetch — chamada CONJUNTA (não N do fan-out)');
  const [{ url, init: requestInit }] = calls;
  assert.ok(!url.includes(DUMMY_KEY), 'a chave NUNCA vai na URL');
  assert.equal(requestInit.headers['x-goog-api-key'], DUMMY_KEY, 'chave no header x-goog-api-key');
  const sentBody = JSON.parse(requestInit.body);
  const userText = sentBody.contents?.[0]?.parts?.[0]?.text ?? '';
  assert.ok(userText.includes('What theme do these passages share?'), 'o user prompt embute a pergunta');
  assert.ok(userText.includes(JOHN_3_16_KJV), 'o prompt CONJUNTO ancora no verbatim de João 3:16');
  assert.ok(userText.includes(MATTHEW_1_1_KJV), 'o prompt CONJUNTO ancora no verbatim de Mateus 1:1');

  await handle.sqlite3.close(handle.db);

  console.log('PASS — síntese temática CONJUNTA web (ai_multi_web_prepare/finalize no wasm + fetch MOCK):');
  console.log(`  citedPassages -> ["${p0.label}", "${p1.label}"] (VERBATIM do store, numeradas)`);
  console.log(`  interpretation -> "${answer.interpretation.slice(0, 56)}…" (MOCK, tecendo os trechos)`);
  console.log(`  transporte -> 1 POST CONJUNTO (não fan-out); prompt ancora nos 2 textos verbatim`);
  console.log('  ANTI-ALUCINAÇÃO: cada citedText = store verbatim; 1 interpretation = mock. Sem tocar o the-light.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
