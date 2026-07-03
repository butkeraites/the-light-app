// export.web.test.mjs — F3.12a (ADR-0031; usa o RETORNO real de deepStudy web)
//
// PROVA HEADLESS (node, sem browser, SEM rede/chave) do EXPORT ACADÊMICO WEB: roda
// `deepStudyOnHandle` (provedor "mock", OFFLINE) sobre o subset em memória para obter um
// `StudyResultOut` REAL, e prova que `buildStudyExport` (F3.8, PURA) produz:
//   - `markdown` == `StudyResultOut.academicMarkdown` VERBATIM (do core — ZERO drift);
//   - `sidecar.citations` == as citações REAIS do estudo (do banco, nunca do modelo);
//   - `sidecar.attributions` inclui a atribuição STEP CC-BY (das `sources` do léxico);
//   - `message` embute o Markdown acadêmico + o sidecar JSON.
// NADA é hardcoded: o exportável é montado a partir do RETORNO real de `deepStudy` web.
// Anti-alucinação: texto/citações do store (via o core); a interpretação é rotulada como
// IA. Sai 0 se tudo bater; ≠0 caso contrário.
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

const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

async function loadBundle() {
  const outfile = join(tmpdir(), `export-headless-${randomBytes(6).toString('hex')}.mjs`);
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

async function main() {
  const { init, mod, StudyMode, StudyLens, StudyDepth, deepStudyOnHandle, lexicalEntriesOnHandle, buildStudyExport } = await loadBundle();
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const handle = await openDbInMemory(READING_DB, 'reading-lite.sqlite');
  const lexHandle = await openDbInMemory(LEXICON_DB, 'lexicon-sample.sqlite');
  // `fetch` inerte (provider "mock" é offline; nunca chamado).
  const noFetch = async () => {
    throw new Error('fetch não deve ser chamado no provedor mock');
  };

  // Estudo REAL (offline, mock) → StudyResultOut com academicMarkdown + citações do léxico.
  const study = await deepStudyOnHandle(
    handle,
    lexHandle,
    noFetch,
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
  const lex = await lexicalEntriesOnHandle(lexHandle, 43, 3, 16, undefined);

  // Export a partir do RETORNO real (não hardcode).
  const exp = buildStudyExport(study, study.referenceLabel, lex.sources);

  // markdown == academicMarkdown VERBATIM (do core).
  assert.equal(exp.markdown, study.academicMarkdown, 'markdown == academicMarkdown VERBATIM do core');
  assert.ok(exp.markdown.length > 0, 'markdown acadêmico não-vazio');
  assert.ok(exp.markdown.includes(JOHN_3_16_KJV), 'markdown contém a passagem VERBATIM do store');
  assert.ok(exp.markdown.includes('STEPBible'), 'markdown traz a atribuição STEP CC-BY');

  // sidecar.citations == as citações REAIS do estudo (do banco).
  assert.deepEqual(exp.sidecar.citations, study.citations, 'sidecar.citations == StudyResultOut.citations');
  assert.ok(exp.sidecar.citations.length >= 1, 'há ≥1 citação (léxico STEP) no sidecar');

  // attributions inclui a STEP CC-BY (das sources do léxico).
  assert.ok(
    exp.sidecar.attributions.some((a) => a.includes('STEP Bible') && a.includes('CC BY 4.0')),
    'attributions inclui a STEP CC-BY VERBATIM: ' + JSON.stringify(exp.sidecar.attributions),
  );
  assert.equal(exp.sidecar.provider, 'mock', 'sidecar ecoa o provider real');

  // message embute o Markdown acadêmico + o sidecar JSON.
  assert.ok(exp.message.includes(study.academicMarkdown), 'message embute o academicMarkdown do core');
  assert.ok(exp.message.includes(exp.sidecarJson), 'message anexa o sidecar JSON');
  // sidecarJson é JSON válido e preserva a estrutura essencial (os campos opcionais
  // `undefined` das citações são omitidos pelo JSON.stringify — comportamento esperado).
  const parsed = JSON.parse(exp.sidecarJson);
  assert.equal(parsed.provider, 'mock', 'sidecarJson: provider preservado');
  assert.equal(parsed.citations.length, exp.sidecar.citations.length, 'sidecarJson: nº de citações preservado');
  assert.deepEqual(parsed.attributions, exp.sidecar.attributions, 'sidecarJson: atribuições preservadas');

  await lexHandle.sqlite3.close(lexHandle.db);
  await handle.sqlite3.close(handle.db);

  console.log('PASS — export acadêmico web (buildStudyExport sobre o retorno real de deepStudy):');
  console.log(`  markdown (== academicMarkdown do core) -> ${exp.markdown.length} chars`);
  console.log(`  citações no sidecar                    -> ${exp.sidecar.citations.length}`);
  console.log(`  atribuições (STEP CC-BY)               -> ${exp.sidecar.attributions.length}`);
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
