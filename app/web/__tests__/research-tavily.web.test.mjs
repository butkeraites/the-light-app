// research-tavily.web.test.mjs — F4.4 (ADR-0035; molde research.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da PESQUISA WEB TAVILY
// OPT-IN (BYOK) no ESTUDO PROFUNDO: exercita `deepStudyOnHandle` (a função de PRODUÇÃO)
// com `researchBackend="tavily"` + `researchKey="dummy"` + um `fetch` MOCK que atende DUAS
// URLs — `api.tavily.com/search` (fontes BYOK, chave NO CORPO) E a do LLM (corpo Gemini
// fixo com uma citação [W:1]):
//   1) `resolveWebSources` faz o `POST` a `api.tavily.com/search` com a chave SÓ no CORPO
//      (`api_key`) → `StudyWebSourceInput[]` (mesmo tipo do Wikipedia);
//   2) `studyWebPrepare` (wasm) embute o bloco [W:n] no user prompt (do Rust `ai-pure`);
//   3) o LLM (mock) responde citando [W:1];
//   4) `studyWebFinalize` (wasm) monta as citações `kind="Web"` DAS URLs buscadas (nunca do
//      modelo) + `academicMarkdown` — tudo do MESMO Rust `ai-pure` (ZERO DRIFT).
//
// ASSERÇÕES-CHAVE: URL `api.tavily.com/search`; a chave vai NO CORPO (parse do body do
// fetch), NUNCA na URL/header/log; `passageText` = João 3:16 KJV VERBATIM do STORE ≠
// `interpretation`; ≥1 citação `Web` da URL do resultado Tavily (do Rust). Além disso:
// backend=tavily SEM chave → erro citando SÓ "tavily" (0 fetch); Wikipedia keyless
// PRESERVADO (sem regressão); `off` → 0 pesquisa. Sai 0 se tudo bater; ≠0 caso contrário.
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
// F5.15 (ADR-0044): estudo lê TEXTO do reading-lite + LÉXICO on-demand do lexicon-sample.
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const LEXICON_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'lexicon-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// Resposta FIXA de estudo do MOCK (texto do "modelo"): 2 seções + âncora Strong VÁLIDA +
// uma citação [W:1] da fonte web (dentro do intervalo → sem warning; prova o wiring [W:n]).
const MOCK_STUDY =
  '## Contexto\nDeus amou ([V:G0025]) o mundo, na lente reformada.\n' +
  '## Fontes\nVer a fonte enciclopédica sobre este versículo [W:1].';

// Fonte Tavily MOCK (host DISTINTO do Wikipedia p/ provar a origem da citação Web).
const TAVILY_TITLE = 'John 3:16';
const TAVILY_URL = 'https://www.britannica.com/topic/John-3-16';
const TAVILY_CONTENT = 'A widely cited verse of the New Testament describing divine love.';

// Fonte Wikipedia MOCK (keyless) — p/ o bloco de regressão (sem tags só p/ o alvo do snippet).
const WIKI_TITLE = 'John 3:16';
const WIKI_SNIPPET = 'A widely cited <span class="searchmatch">verse</span> of the New Testament.';

// Chaves DUMMY (nunca reais, nunca logadas): uma p/ o LLM (header), outra p/ o Tavily (corpo).
const DUMMY_LLM_KEY = 'test-only-not-a-real-llm-key';
const DUMMY_TAVILY_KEY = 'test-only-not-a-real-tavily-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `research-tavily-headless-${randomBytes(6).toString('hex')}.mjs`);
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

async function openDbInMemory(dbPath, name) {
  const wasmBinary = await readFile(WA_SQLITE_WASM);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);

  const vfs = new MemoryVFS();
  const bytes = await readFile(dbPath);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vfs.mapNameToFile.set(name, {
    name,
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: data.byteLength,
    data,
  });
  sqlite3.vfs_register(vfs, false);

  const db = await sqlite3.open_v2(name, SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return { sqlite3, db };
}

/** `fetch` MOCK que ROTEIA por URL: Tavily (chave no corpo) · Wikipedia (keyless) · LLM. */
function makeMockFetch(calls) {
  return async (url, requestInit) => {
    calls.push({ url, init: requestInit });
    if (url.includes('api.tavily.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ title: TAVILY_TITLE, url: TAVILY_URL, content: TAVILY_CONTENT }],
        }),
      };
    }
    if (url.includes('wikipedia.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: { search: [{ title: WIKI_TITLE, snippet: WIKI_SNIPPET }] },
        }),
      };
    }
    // LLM (Gemini): corpo fixo de estudo com [W:1].
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: MOCK_STUDY }] } }] }),
    };
  };
}

async function main() {
  const { init, mod, StudyMode, StudyLens, StudyDepth, deepStudyOnHandle } = await loadBundle();

  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const handle = await openDbInMemory(READING_DB, 'reading-lite.sqlite');
  const lexHandle = await openDbInMemory(LEXICON_DB, 'lexicon-sample.sqlite');

  // ── (A) Estudo Acadêmico COM pesquisa web TAVILY (opt-in, BYOK). ────────────────────
  const calls = [];
  const study = await deepStudyOnHandle(
    handle,
    lexHandle,
    makeMockFetch(calls),
    'kjv',
    43,
    3,
    16,
    StudyMode.Academic,
    StudyLens.Presbyterian,
    StudyDepth.Exegetical,
    'en',
    'gemini',
    DUMMY_LLM_KEY,
    undefined,
    'tavily', // ← pesquisa web OPT-IN (Tavily)
    DUMMY_TAVILY_KEY, // ← chave BYOK session-only
  );

  // Anti-alucinação: passageText do STORE, verbatim; ≠ interpretation.
  assert.equal(study.passageText, `16 ${JOHN_3_16_KJV}`, 'passageText verbatim do store');
  assert.notEqual(
    study.passageText,
    study.interpretation,
    'passageText (store) ≠ interpretation (LLM)',
  );

  // ── ≥1 citação kind="Web" cuja URL é a do resultado Tavily (das URLs, não do modelo). ─
  const webCites = study.citations.filter((c) => c.kind === 'Web');
  assert.ok(webCites.length >= 1, `deve haver ≥1 citação Web: ${JSON.stringify(study.citations)}`);
  assert.ok(
    webCites.some((c) => (c.url ?? '').includes('britannica.com')),
    `citação Web deve trazer a URL do resultado Tavily: ${JSON.stringify(webCites)}`,
  );

  // ── academicMarkdown cita [W / a fonte web (do Rust ai-pure). ──────────────────────
  assert.ok(
    study.academicMarkdown.includes('[W') || study.academicMarkdown.includes('britannica'),
    'academicMarkdown deve citar [W:n] ou a fonte web (Tavily)',
  );
  // O texto bíblico continua do store no markdown.
  assert.ok(
    study.academicMarkdown.includes(JOHN_3_16_KJV),
    'academicMarkdown contém a passagem do store',
  );

  // ── TRANSPORTE: houve POST a api.tavily.com/search; chave NO CORPO, NUNCA na URL/header. ─
  const tavilyCall = calls.find((c) => c.url.includes('api.tavily.com'));
  const llmCall = calls.find((c) => c.url.includes('generativelanguage.googleapis.com'));
  assert.ok(tavilyCall, 'deve haver um POST a api.tavily.com/search (rede opt-in)');
  assert.ok(llmCall, 'deve haver um fetch ao LLM (Gemini)');

  // URL exata do endpoint Tavily + método POST.
  assert.equal(tavilyCall.url, 'https://api.tavily.com/search', 'endpoint Tavily correto');
  assert.equal(tavilyCall.init.method, 'POST', 'Tavily via POST');

  // A chave BYOK vai NO CORPO (`api_key`) — parse do body do fetch mock.
  const tavilyBody = JSON.parse(tavilyCall.init.body);
  assert.equal(tavilyBody.api_key, DUMMY_TAVILY_KEY, 'a chave Tavily vai NO CORPO (api_key)');
  assert.equal(tavilyBody.search_depth, 'basic', 'search_depth = "basic" (espelha o core)');
  assert.equal(typeof tavilyBody.query, 'string', 'query no corpo (rótulo da passagem)');
  assert.ok(tavilyBody.max_results >= 1 && tavilyBody.max_results <= 10, 'max_results clamp 1..10');

  // A chave BYOK NUNCA na URL, NUNCA em header (só no corpo).
  assert.ok(!tavilyCall.url.includes(DUMMY_TAVILY_KEY), 'a chave Tavily NUNCA vai na URL');
  const tavilyHeaders = tavilyCall.init.headers ?? {};
  assert.ok(
    !Object.values(tavilyHeaders).some((v) => String(v).includes(DUMMY_TAVILY_KEY)),
    'a chave Tavily NUNCA vai em header',
  );
  assert.equal(tavilyHeaders['content-type'], 'application/json', 'content-type: application/json');

  // A chave do LLM segue SÓ no header (não vaza p/ o Tavily; não vai na URL).
  assert.equal(llmCall.init.headers['x-goog-api-key'], DUMMY_LLM_KEY, 'chave do LLM só no header');
  assert.ok(!llmCall.url.includes(DUMMY_LLM_KEY), 'a chave do LLM NUNCA vai na URL');
  assert.ok(
    !tavilyCall.url.includes(DUMMY_LLM_KEY) && tavilyBody.api_key !== DUMMY_LLM_KEY,
    'a chave do LLM NÃO vaza p/ o corpo/URL do Tavily',
  );

  // ── (B) BYOK/erro: backend=tavily SEM chave → erro citando SÓ "tavily", 0 fetch. ─────
  const callsNoKey = [];
  await assert.rejects(
    () =>
      deepStudyOnHandle(
        handle,
        lexHandle,
        makeMockFetch(callsNoKey),
        'kjv',
        43,
        3,
        16,
        StudyMode.Academic,
        StudyLens.Presbyterian,
        StudyDepth.Exegetical,
        'en',
        'gemini',
        DUMMY_LLM_KEY,
        undefined,
        'tavily', // ← backend Tavily
        undefined, // ← SEM chave
      ),
    (err) => {
      assert.ok(err instanceof Error, 'erro é um Error');
      assert.ok(/tavily/i.test(err.message), `erro deve citar "tavily": ${err.message}`);
      assert.ok(
        !err.message.includes(DUMMY_TAVILY_KEY) && !err.message.includes(DUMMY_LLM_KEY),
        'a mensagem de erro NUNCA inclui chave',
      );
      return true;
    },
  );
  assert.equal(callsNoKey.length, 0, 'backend=tavily sem chave → 0 fetch (nem Tavily nem LLM)');

  // ── (C) REGRESSÃO Wikipedia (keyless) PRESERVADA: sem chave, fetch keyless, citação Web. ─
  const callsWiki = [];
  const wikiStudy = await deepStudyOnHandle(
    handle,
    lexHandle,
    makeMockFetch(callsWiki),
    'kjv',
    43,
    3,
    16,
    StudyMode.Academic,
    StudyLens.Presbyterian,
    StudyDepth.Exegetical,
    'en',
    'gemini',
    DUMMY_LLM_KEY,
    undefined,
    'wikipedia', // ← keyless (sem researchKey)
  );
  const wikiCites = wikiStudy.citations.filter((c) => c.kind === 'Web');
  assert.ok(wikiCites.length >= 1, 'Wikipedia keyless ainda gera citação Web');
  assert.ok(
    wikiCites.some((c) => (c.url ?? '').includes('wikipedia')),
    'citação Web da Wikipedia (regressão preservada)',
  );
  const wikiCall = callsWiki.find((c) => c.url.includes('wikipedia.org'));
  assert.ok(wikiCall, 'houve fetch keyless à Wikipedia');
  assert.ok(!callsWiki.some((c) => c.url.includes('api.tavily.com')), 'Wikipedia NÃO chama Tavily');
  assert.ok(
    !wikiCall.url.includes(DUMMY_TAVILY_KEY) && !wikiCall.url.includes(DUMMY_LLM_KEY),
    'a URL da Wikipedia não carrega segredo (keyless)',
  );

  // ── (D) OFF: sem researchBackend → 0 citação Web, 0 fetch Tavily/Wikipedia. ──────────
  const callsOff = [];
  const off = await deepStudyOnHandle(
    handle,
    lexHandle,
    makeMockFetch(callsOff),
    'kjv',
    43,
    3,
    16,
    StudyMode.Academic,
    StudyLens.Presbyterian,
    StudyDepth.Exegetical,
    'en',
    'gemini',
    DUMMY_LLM_KEY,
    undefined,
    undefined, // ← sem pesquisa web
  );
  assert.ok(
    off.citations.every((c) => c.kind !== 'Web'),
    `off NÃO deve haver citação Web: ${JSON.stringify(off.citations)}`,
  );
  assert.ok(
    !callsOff.some((c) => c.url.includes('api.tavily.com') || c.url.includes('wikipedia.org')),
    'off NÃO deve haver fetch de pesquisa (offline por padrão)',
  );
  assert.equal(off.passageText, `16 ${JOHN_3_16_KJV}`, 'passageText segue verbatim do store (off)');

  await lexHandle.sqlite3.close(lexHandle.db);
  await handle.sqlite3.close(handle.db);

  console.log('PASS — pesquisa web TAVILY OPT-IN (BYOK) no estudo web (fetch MOCK Tavily + LLM):');
  console.log(`  endpoint / método        -> POST https://api.tavily.com/search`);
  console.log(`  chave BYOK               -> NO CORPO (api_key); NUNCA na URL/header/log`);
  console.log(`  citações Web (URLs)      -> ${webCites.length} (url contém britannica — do Rust)`);
  console.log(`  academicMarkdown         -> cita [W:n]/fonte web; passagem do store presente`);
  console.log('  BYOK sem chave           -> erro citando só "tavily", 0 fetch');
  console.log('  regressão Wikipedia      -> keyless preservado (citação Web, sem chave)');
  console.log('  off                      -> 0 citação Web, 0 fetch de pesquisa');
  console.log('  ANTI-ALUCINAÇÃO: passageText = João 3:16 do store; [W:n]/citações do Rust, das URLs.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
