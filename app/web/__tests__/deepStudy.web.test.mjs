// deepStudy.web.test.mjs — F3.12a (ADR-0031; molde askAnchored.web.test.mjs)
//
// PROVA HEADLESS (node, sem browser/Expo, SEM rede/chave real) da PARIDADE WEB DO ESTUDO
// PROFUNDO: exercita `deepStudyOnHandle` (a função de PRODUÇÃO do pipeline web) DE PONTA A
// PONTA com o provedor "gemini" + um `fetch` MOCK que devolve um corpo Gemini FIXO
// (resposta de estudo), e também com o provedor "mock" (offline):
//   1) `studyWebPrepare` (wasm) monta o `passageText` (numerado, VERBATIM do STORE) + o
//      `system`/`user` do `ai-pure` — ZERO drift com o nativo `deep_study`;
//   2) o TEXTO do versículo vem do STORE LOCAL (wa-sqlite sobre um VFS de MEMÓRIA com os
//      BYTES de `assets/data/reading-sample.sqlite`) e o LÉXICO verificado vem do MESMO
//      store (SELECT + shaping, infra TS) — glosas STEP CC-BY;
//   3) o transporte é um `fetch` MOCK (corpo Gemini fixo) — NENHUMA rede/chave real; a
//      chave dummy vai SÓ no header `x-goog-api-key`, NUNCA na URL/log;
//   4) `studyWebFinalize` (wasm) aplica verify/citação/aparato/`to_academic_markdown` em
//      Rust e monta o `StudyResultOut` com o `passageText` do store SEPARADO da
//      `interpretation` do mock + o `academicMarkdown` (F3.8).
//
// ANTI-ALUCINAÇÃO (asserção central): `passageText` == João 3:16 KJV VERBATIM do STORE
// (numerado), NUNCA o texto do mock; `interpretation` == o texto da resposta MOCK, NUNCA
// bíblico; `citations` do LÉXICO STEP CC-BY (do banco, nunca do modelo). Sai 0 se tudo
// bater; ≠0 caso contrário.
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
// F5.15 (ADR-0044): o estudo lê o TEXTO do subset de leitura (`reading-lite.sqlite`, sem
// léxico) e o LÉXICO do arquivo separado on-demand (`lexicon-sample.sqlite`).
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const LEXICON_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'lexicon-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// Resposta FIXA de estudo do MOCK (texto do "modelo", NÃO bíblico): 2 seções (## ) +
// âncoras Strong VÁLIDAS (G0025 "ἀγαπάω", G2316 "θεός" — ambas no léxico de João 3:16).
const MOCK_STUDY =
  '## Contexto\nDeus amou ([V:G0025]) o mundo, na lente reformada.\n' +
  '## Análise\nO termo grego para Deus é θεός ([V:G2316]); ênfase na graça soberana.';

// Chave DUMMY (nunca real, nunca logada). Só existe p/ provar que vai ao header.
const DUMMY_KEY = 'test-only-not-a-real-key';

async function loadBundle() {
  const outfile = join(tmpdir(), `deepstudy-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Abre um wa-sqlite (VFS de memória) sobre os bytes de `dbPath`, com `name` lógico. F5.15
// (ADR-0044): usado 2×, um handle para o subset de leitura e um para o léxico on-demand.
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

async function main() {
  const { init, mod, StudyMode, StudyLens, StudyDepth, deepStudyOnHandle } = await loadBundle();

  // (1) Fronteira Rust no wasm — study_web_prepare/study_web_finalize/parse_reference.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) Stores locais: TEXTO (reading-lite) + LÉXICO on-demand (lexicon-sample), F5.15.
  const handle = await openDbInMemory(READING_DB, 'reading-lite.sqlite');
  const lexHandle = await openDbInMemory(LEXICON_DB, 'lexicon-sample.sqlite');

  // (3) `fetch` MOCK: captura o request e devolve um corpo Gemini FIXO. Sem rede real.
  const calls = [];
  const mockFetch = async (url, requestInit) => {
    calls.push({ url, init: requestInit });
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: MOCK_STUDY }] } }] }),
    };
  };

  // (4) Pipeline web de ESTUDO ponta a ponta: "gemini" + chave dummy + fetch MOCK.
  const study = await deepStudyOnHandle(
    handle,
    lexHandle,
    mockFetch,
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
  );

  // ── ANTI-ALUCINAÇÃO: passageText é o STORE, verbatim e numerado; NÃO o mock. ────────
  assert.equal(
    study.passageText,
    `16 ${JOHN_3_16_KJV}`,
    'passageText deve ser "16 <João 3:16 KJV verbatim>" (store, via study_web_prepare)',
  );
  assert.ok(study.passageText.includes(JOHN_3_16_KJV), 'passageText contém o KJV verbatim do store');
  assert.ok(!study.passageText.includes('lente reformada'), 'passageText NÃO vem do mock');

  // ── interpretation vem da resposta MOCK, NÃO do store. ────────────────────────────
  assert.ok(
    study.interpretation.includes('O termo grego para Deus'),
    'interpretation deve ser o texto extraído da resposta MOCK',
  );
  assert.ok(
    !study.interpretation.includes('For God so loved'),
    'a interpretation (LLM/mock) NÃO reproduz o texto bíblico',
  );
  assert.notEqual(study.passageText, study.interpretation, 'passageText (store) ≠ interpretation (LLM)');

  // ── sections (do core) + warnings (verify em Rust): 2 seções, sem Strong espúrio. ──
  assert.equal(study.sections.length, 2, 'duas seções (## ) fatiadas pelo core');
  assert.deepEqual(study.warnings, [], 'âncoras [V:G0025]/[V:G2316] são válidas → sem warnings');

  // ── CITAÇÕES do LÉXICO STEP CC-BY (do banco, nunca do modelo). ─────────────────────
  const sourceCites = study.citations.filter((c) => c.kind === 'Source');
  assert.ok(sourceCites.length >= 1, 'deve haver ≥1 citação kind="Source" do léxico');
  assert.ok(
    sourceCites.some((c) => (c.attribution ?? '').includes('STEPBible')),
    'a citação Source traz a atribuição STEP CC-BY (STEPBible): ' + JSON.stringify(sourceCites),
  );

  // ── academicMarkdown (do core, F3.8): não-vazio, com a passagem do store + STEP. ───
  assert.ok(study.academicMarkdown.length > 0, 'academicMarkdown não-vazio');
  assert.ok(study.academicMarkdown.includes(JOHN_3_16_KJV), 'academicMarkdown contém a passagem do store');
  assert.ok(study.academicMarkdown.includes('STEPBible'), 'academicMarkdown traz a atribuição STEP CC-BY');

  // ── provider/model + referência canônica. ─────────────────────────────────────────
  assert.equal(study.provider, 'gemini', 'provider gemini');
  assert.equal(study.model, 'gemini-2.5-flash', 'model default do gemini (ai-pure)');
  assert.equal(study.reference.book, 43, 'João é o livro 43');
  assert.equal(study.reference.chapter, 3, 'capítulo 3');
  assert.equal(study.reference.verses.inner.verse, 16, 'versículo 16');

  // ── TRANSPORTE: 1 chamada; modelo na URL; chave no header, NÃO na URL. ─────────────
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
  assert.ok(sentBody.system_instruction?.parts?.[0]?.text, 'body tem system_instruction do estudo (ai-pure)');
  assert.ok(
    sentBody.contents?.[0]?.parts?.[0]?.text?.includes('DADOS LÉXICOS'),
    'o user prompt (ai-pure) embute o bloco léxico verificado',
  );
  assert.ok(
    sentBody.contents[0].parts[0].text.includes(JOHN_3_16_KJV),
    'o user prompt ancora no texto VERBATIM do store (contexto RAG)',
  );

  // ── Caminho OFFLINE (provider "mock", sem fetch/chave): também produz estudo válido. ─
  const callsBefore = calls.length;
  const offline = await deepStudyOnHandle(
    handle,
    lexHandle,
    mockFetch,
    'kjv',
    43,
    3,
    16,
    StudyMode.Academic,
    StudyLens.Presbyterian,
    StudyDepth.Exegetical,
    'en',
    'mock',
    undefined,
    undefined,
  );
  assert.equal(calls.length, callsBefore, 'provider "mock" é OFFLINE (nenhuma chamada fetch)');
  assert.equal(offline.passageText, `16 ${JOHN_3_16_KJV}`, 'mock offline: passageText verbatim do store');
  assert.equal(offline.provider, 'mock', 'provider mock');
  assert.ok(offline.academicMarkdown.length > 0, 'mock offline: academicMarkdown não-vazio');

  await lexHandle.sqlite3.close(lexHandle.db);
  await handle.sqlite3.close(handle.db);

  console.log('PASS — paridade web do estudo profundo (study_web_prepare/finalize + fetch MOCK):');
  console.log(`  passageText (STORE)      -> "${study.passageText.slice(0, 40)}..."`);
  console.log(`  interpretation (MOCK)    -> "${study.interpretation.slice(0, 40)}..."`);
  console.log(`  sections/citations       -> ${study.sections.length} seções / ${study.citations.length} citações (STEP CC-BY)`);
  console.log(`  academicMarkdown         -> ${study.academicMarkdown.length} chars (passagem do store + STEP)`);
  console.log(`  provider/model           -> ${study.provider} / ${study.model}`);
  console.log('  chave dummy              -> só no header do provedor (nunca na URL/log)');
  console.log('  ANTI-ALUCINAÇÃO: passageText = João 3:16 KJV do store; interpretation = MOCK; citações do léxico.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
