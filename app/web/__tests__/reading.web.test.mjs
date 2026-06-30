// reading.web.test.mjs — F1.13 (ADR-0018/ADR-0019; molde F0.10 ADR-0011/0012)
//
// PROVA HEADLESS (node, sem browser/Expo) do STORE WEB de LEITURA. Cobre o pipeline
// de leitura do ADR-0019 (paridade A1 sobre o subset ~4,4 MB) de ponta a ponta,
// EXCETO o backend OPFS (que é browser-only):
//   1) o CÂNON (66 livros) é resolvido PELO RUST (the-light-core via UniFFI→wasm):
//      `listBooks()` ⇒ 66 (inclui João/43) — não em TS;
//   2) o TEXTO/contagens vêm do STORE LOCAL por um `wa-sqlite` (build SYNC, sem
//      SharedArrayBuffer/COOP-COEP) sobre um VFS de MEMÓRIA carregado com os BYTES
//      de `assets/data/reading-sample.sqlite` (o MESMO subset/schema do nativo,
//      ADR-0014), rodando as MESMAS `queryChapter`/`composeChapterPassage`/
//      `queryChapterCount`/`queryTranslations` de produção (`../sqlite-reading.web`).
//
// Em RUNTIME no browser o VFS é OPFS (`../sqlite-reading-opfs.web.ts`), que HIDRATA
// o mesmo VFS de memória a partir dos bytes persistidos em OPFS. Aqui, node injeta
// os bytes do subset direto no VFS de memória — exercitando as mesmas queries.
// (OPFS não existe em node; ver ADR-0012.)
//
// Anti-alucinação: as constantes verbatim abaixo existem SÓ na ASSERÇÃO do teste —
// nunca no código de produto. O texto provado vem do `wa-sqlite`/subset, verbatim.
//
// PARIDADE: os números/textos abaixo são os MESMOS que o nativo prova em
// `TLA_READ` (books=66, john3_v16, john_chapters=21) e `TLA_PARALLEL`
// (alm_john3_16) — F1.3/F1.4.
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
// F1.14 (ADR-0020): UM ÚNICO artefato wa-sqlite (build SÍNCRONO COM FTS5,
// vendored) p/ leitura E busca — a leitura NÃO regride com o wasm novo.
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'reading-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-sample.sqlite');
const WA_SQLITE_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// João 3:16 — texto VERBATIM do store (domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';
const JOHN_3_16_ALM =
  'Porque Deus amou o mundo de tal maneira, que deu o seu Filho unigenito, ' +
  'para que todo aquelle que n\'elle crê não pereça, mas tenha a vida eterna.';
// Substring distintivo (sem o apóstrofo) p/ a checagem da Almeida.
const JOHN_3_16_ALM_DISTINCTIVE = 'Porque Deus amou o mundo de tal maneira';

async function loadBundle() {
  const outfile = join(tmpdir(), `reading-headless-${randomBytes(6).toString('hex')}.mjs`);
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
  const {
    init,
    mod,
    listBooks,
    composeChapterPassage,
    hasTranslation,
    queryChapter,
    queryChapterCount,
    queryTranslations,
  } = await loadBundle();

  // (1) Fronteira Rust no wasm — o CÂNON (66 livros) vem do RUST (listBooks).
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const books = listBooks();
  assert.equal(books.length, 66, `listBooks deve ter 66 livros, veio ${books.length}`);
  assert.ok(
    books.some((b) => b.number === 43),
    'o cânon (Rust) deve incluir João (número 43)',
  );

  // (2) Store local (wa-sqlite + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  // (2a) has_translation espelhado: o subset tem kjv e alm1911; "nope" não existe.
  assert.equal(await hasTranslation(handle, 'kjv'), true, 'kjv deve existir');
  assert.equal(await hasTranslation(handle, 'alm1911'), true, 'alm1911 deve existir');
  assert.equal(await hasTranslation(handle, 'nope'), false, '"nope" não deve existir');

  // (2b) getChapter('kjv',43,3) via as funções de PRODUÇÃO (queryChapter + compose).
  const kjvRows = await queryChapter(handle, 'kjv', 43, 3);
  const kjvPassage = composeChapterPassage(43, 3, kjvRows, 'kjv');
  assert.equal(
    kjvPassage.verses.length,
    36,
    `João 3 (KJV) deve ter 36 versículos, veio ${kjvPassage.verses.length}`,
  );
  assert.equal(
    kjvPassage.reference.verses.tag,
    'WholeChapter',
    `Passage.reference deve ser WholeChapter, veio ${kjvPassage.reference.verses.tag}`,
  );
  assert.ok(
    kjvPassage.verses.every((v) => v.reference.verses.tag === 'Single'),
    'cada Verse.reference deve ser Single',
  );
  const kjvV16 = kjvPassage.verses.find((v) => v.reference.verses.inner.verse === 16);
  assert.ok(kjvV16, 'João 3 (KJV) deve conter o versículo 16');
  assert.equal(kjvV16.text, JOHN_3_16_KJV, 'TEXTO do store deve ser o KJV verbatim de João 3:16');
  assert.equal(kjvV16.translation, 'kjv', `translation deve ser "kjv", veio ${kjvV16.translation}`);

  // (2c) getChapter('alm1911',43,3) — paridade com TLA_PARALLEL do nativo.
  const almRows = await queryChapter(handle, 'alm1911', 43, 3);
  const almPassage = composeChapterPassage(43, 3, almRows, 'alm1911');
  const almV16 = almPassage.verses.find((v) => v.reference.verses.inner.verse === 16);
  assert.ok(almV16, 'João 3 (Almeida) deve conter o versículo 16');
  assert.ok(
    almV16.text.startsWith(JOHN_3_16_ALM_DISTINCTIVE),
    'TEXTO do store deve começar com o trecho distintivo da Almeida',
  );
  assert.equal(almV16.text, JOHN_3_16_ALM, 'TEXTO do store deve ser a Almeida 1911 verbatim de João 3:16');

  // (2d) chapterCount('kjv',43) === 21 (max(chapter); paridade com TLA_READ).
  const johnChapters = await queryChapterCount(handle, 'kjv', 43);
  assert.equal(johnChapters, 21, `chapterCount("kjv",43) deve ser 21, veio ${johnChapters}`);

  // (2e) listTranslations inclui kjv (en) e alm1911 (pt), nessa ordem (do SQLite).
  const translations = await queryTranslations(handle);
  const ids = translations.map((t) => t.id);
  assert.ok(ids.includes('kjv'), 'listTranslations deve incluir kjv');
  assert.ok(ids.includes('alm1911'), 'listTranslations deve incluir alm1911');
  assert.equal(ids[0], 'kjv', 'ordem do SQLite (language, id): kjv (en) antes de alm1911 (pt)');

  await handle.sqlite3.close(handle.db);

  console.log('PASS — leitura web (wa-sqlite + VFS de memória sobre reading-sample.sqlite):');
  console.log(`  listBooks() (Rust/wasm)     -> ${books.length} livros (inclui João/43)`);
  console.log(`  getChapter("kjv",43,3) v16  -> "${kjvV16.text}"`);
  console.log(`  getChapter("alm1911",43,3) v16 -> "${almV16.text}"`);
  console.log(`  chapterCount("kjv",43)      -> ${johnChapters}`);
  console.log(`  João 3 (KJV)                -> ${kjvPassage.verses.length} versículos`);
  console.log(`  listTranslations            -> [${ids.join(', ')}]`);
  console.log(
    '  PARIDADE: mesmos valores que o nativo prova em TLA_READ ' +
      '(books=66, john3_v16, john_chapters=21) e TLA_PARALLEL (alm_john3_16).',
  );
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
