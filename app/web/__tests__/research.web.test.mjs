// research.web.test.mjs — F3.12b (ADR-0028/ADR-0032; molde deepStudy.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da PESQUISA WEB WIKIPEDIA
// OPT-IN no ESTUDO PROFUNDO: exercita `deepStudyOnHandle` (a função de PRODUÇÃO) com
// `researchBackend="wikipedia"` + um `fetch` MOCK que atende DUAS URLs — a da Wikipedia
// (fontes canônicas KEYLESS) E a do LLM (corpo Gemini fixo com uma citação [W:1]):
//   1) `resolveWebSources` faz o `fetch` KEYLESS à Wikipedia → `StudyWebSourceInput[]`;
//   2) `studyWebPrepare` (wasm) embute o bloco [W:n] no user prompt (do Rust `ai-pure`);
//   3) o LLM (mock) responde citando [W:1];
//   4) `studyWebFinalize` (wasm) monta as citações `kind="Web"` DAS URLs buscadas (nunca do
//      modelo) + `academicMarkdown` — tudo do MESMO Rust `ai-pure`.
//
// ANTI-ALUCINAÇÃO: `passageText` = João 3:16 KJV VERBATIM do STORE; `citations` `Web` das
// URLs (não do modelo); `[W:n]`/verify do Rust. Regressão F3.12a preservada: SEM
// `researchBackend` → NENHUMA citação `Web`. Wikipedia é KEYLESS (sem segredo na URL); a
// chave do LLM vai SÓ no header. Sai 0 se tudo bater; ≠0 caso contrário.
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

// Título/trecho da fonte Wikipedia MOCK (keyless). Sem tags só p/ o alvo do snippet.
const WIKI_TITLE = 'John 3:16';
const WIKI_SNIPPET = 'A widely cited <span class="searchmatch">verse</span> of the New Testament.';

// Chave DUMMY do LLM (nunca real, nunca logada). A Wikipedia é KEYLESS (sem chave).
const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `research-headless-${randomBytes(6).toString('hex')}.mjs`);
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

/** `fetch` MOCK que ROTEIA por URL: Wikipedia (keyless) vs LLM (Gemini). Registra em `calls`. */
function makeMockFetch(calls) {
  return async (url, requestInit) => {
    calls.push({ url, init: requestInit });
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

  // ── (A) Estudo Acadêmico COM pesquisa web Wikipedia (opt-in). ──────────────────────
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
    DUMMY_KEY,
    undefined,
    'wikipedia', // ← pesquisa web OPT-IN
  );

  // Anti-alucinação: passageText do STORE, verbatim; ≠ interpretation.
  assert.equal(study.passageText, `16 ${JOHN_3_16_KJV}`, 'passageText verbatim do store');
  assert.notEqual(study.passageText, study.interpretation, 'passageText (store) ≠ interpretation (LLM)');

  // ── ≥1 citação kind="Web" cuja URL contém "wikipedia" (das URLs, não do modelo). ───
  const webCites = study.citations.filter((c) => c.kind === 'Web');
  assert.ok(webCites.length >= 1, `deve haver ≥1 citação Web: ${JSON.stringify(study.citations)}`);
  assert.ok(
    webCites.some((c) => (c.url ?? '').includes('wikipedia')),
    `citação Web deve trazer a URL da Wikipedia: ${JSON.stringify(webCites)}`,
  );

  // ── academicMarkdown cita [W / a fonte web (do Rust ai-pure). ──────────────────────
  assert.ok(
    study.academicMarkdown.includes('[W') || study.academicMarkdown.includes('wikipedia'),
    'academicMarkdown deve citar [W:n] ou a fonte web (Wikipedia)',
  );
  // O texto bíblico continua do store no markdown.
  assert.ok(study.academicMarkdown.includes(JOHN_3_16_KJV), 'academicMarkdown contém a passagem do store');

  // ── TRANSPORTE: houve fetch à Wikipedia (keyless) E ao LLM (chave só no header). ───
  const wikiCall = calls.find((c) => c.url.includes('wikipedia.org'));
  const llmCall = calls.find((c) => c.url.includes('generativelanguage.googleapis.com'));
  assert.ok(wikiCall, 'deve haver um fetch à Wikipedia (rede opt-in)');
  assert.ok(llmCall, 'deve haver um fetch ao LLM (Gemini)');
  // Wikipedia é KEYLESS: nenhuma chave/header de auth; a chave do LLM NÃO vaza p/ a Wikipedia.
  assert.ok(!wikiCall.url.includes(DUMMY_KEY), 'a URL da Wikipedia não carrega segredo (keyless)');
  const wikiHeaders = wikiCall.init?.headers ?? {};
  assert.ok(
    !('x-goog-api-key' in wikiHeaders) && !('authorization' in wikiHeaders),
    'a chamada à Wikipedia NÃO envia chave/authorization (keyless)',
  );
  assert.equal(llmCall.init.headers['x-goog-api-key'], DUMMY_KEY, 'chave do LLM só no header');
  assert.ok(!llmCall.url.includes(DUMMY_KEY), 'a chave do LLM NUNCA vai na URL');

  // ── (B) REGRESSÃO F3.12a: SEM researchBackend → NENHUMA citação Web, sem fetch Wiki. ─
  const callsB = [];
  const noWeb = await deepStudyOnHandle(
    handle,
    lexHandle,
    makeMockFetch(callsB),
    'kjv',
    43,
    3,
    16,
    StudyMode.Academic,
    StudyLens.Presbyterian,
    StudyDepth.Exegetical,
    'en',
    'gemini',
    DUMMY_KEY,
    undefined,
    undefined, // ← sem pesquisa web
  );
  assert.ok(
    noWeb.citations.every((c) => c.kind !== 'Web'),
    `sem researchBackend NÃO deve haver citação Web: ${JSON.stringify(noWeb.citations)}`,
  );
  assert.ok(
    !callsB.some((c) => c.url.includes('wikipedia.org')),
    'sem researchBackend NÃO deve haver fetch à Wikipedia (offline por padrão)',
  );
  assert.equal(noWeb.passageText, `16 ${JOHN_3_16_KJV}`, 'passageText segue verbatim do store sem research');

  await lexHandle.sqlite3.close(lexHandle.db);
  await handle.sqlite3.close(handle.db);

  console.log('PASS — pesquisa web Wikipedia OPT-IN no estudo web (fetch MOCK Wikipedia + LLM):');
  console.log(`  citações Web (URLs)      -> ${webCites.length} (url contém wikipedia)`);
  console.log(`  academicMarkdown         -> cita [W:n]/fonte web; passagem do store presente`);
  console.log(`  transporte               -> Wikipedia keyless (sem segredo) + LLM (chave no header)`);
  console.log('  regressão F3.12a         -> sem researchBackend => 0 citação Web, 0 fetch Wikipedia');
  console.log('  ANTI-ALUCINAÇÃO: passageText = João 3:16 do store; [W:n]/citações do Rust, das URLs.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
