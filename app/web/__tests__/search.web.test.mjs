// search.web.test.mjs — F1.14 (ADR-0020; molde reading.web.test.mjs F1.13)
//
// PROVA HEADLESS (node, sem browser/Expo) do STORE WEB de BUSCA (FTS5). Exercita o
// MESMO glue de PRODUÇÃO (`../sqlite-search.web` + `../sqlite-reading.web`) que a
// tela da F1.6 usa no browser, sobre um `wa-sqlite` COM FTS5 (asset local vendored,
// ADR-0020) e um VFS de MEMÓRIA carregado com os BYTES de
// `assets/data/reading-sample.sqlite` (o MESMO subset/schema do nativo, ADR-0014).
// Em runtime no browser o VFS é OPFS (`../sqlite-reading-opfs.web.ts`, REUSADO da
// F1.13 — sem recarregar o subset); aqui node injeta os bytes direto no VFS de
// memória, rodando as MESMAS funções de produção.
//
// O SQL de busca (MATCH + bm25 + highlight + filtro de livro + limite) ESPELHA
// `the_light_core::search::search` (search.rs, rev `8f66004`) — nenhum
// ranqueamento/semântica é reimplementado em TS (o índice FTS5, o BM25 e o
// destaque vivem no SQLite).
//
// Anti-alucinação: as constantes verbatim abaixo existem SÓ na ASSERÇÃO do teste —
// nunca no código de produto. O texto provado vem do `wa-sqlite`/subset, verbatim.
// Os marcadores de destaque (U+0002/U+0003) só aparecem em `highlighted`, NUNCA em
// `text` (que é limpo) — a UI os converte em estilo via `app/lib/highlight.ts`.
//
// PARIDADE: o João 3:16 LOCALIZADO no conjunto de `search("God","kjv",43,1000)` é o
// MESMO que o nativo prova em `TLA_SEARCH` (F1.6, search-selftest.ts) — mesmo SQL,
// mesmo dado. Na Bíblia COMPLETA (F5.36) João 3:16 fica ~1980º por BM25 para "God"/kjv,
// então LOCALIZAMOS filtrando por livro=43 (determinístico) em vez de num top-N.
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
// wa-sqlite COM FTS5 (build SÍNCRONO, asset local vendored — ADR-0020). O `.mjs`
// do npm NÃO traz FTS5 (probe: "no such module: fts5"); este artefato sim.
import SQLiteESMFactory from '../vendor/wa-sqlite-fts5/wa-sqlite.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'search-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const READING_DB = join(__dirname, '..', '..', '..', 'assets', 'data', 'reading-lite.sqlite');
const WA_SQLITE_FTS5_WASM = join(__dirname, '..', 'vendor', 'wa-sqlite-fts5', 'wa-sqlite.wasm');

// Marcadores de destaque do core (`search::HL_START`/`HL_END`). SÓ na asserção.
const HL_START = String.fromCharCode(0x02);
const HL_END = String.fromCharCode(0x03);

// João 3:16 — texto VERBATIM (KJV, domínio público). SÓ no teste (asserção).
const JOHN_3_16_KJV =
  'For God so loved the world, that he gave his only begotten Son, ' +
  'that whosoever believeth in him should not perish, but have everlasting life.';

// "God" na KJV — Bíblia COMPLETA (F5.36/ADR-0056): 3892 versículos (era 646 no
// sample de 3 livros). A contagem vem SEMPRE do índice FTS do store, verbatim.
const GOD_HITS_KJV_FULL = 3892;

async function loadBundle() {
  const outfile = join(tmpdir(), `search-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// Abre um `wa-sqlite` (build sync COM FTS5) sobre um VFS de memória semeado com os
// BYTES do subset — o backend de prova equivalente, em node, ao OPFS do browser.
async function openReadingDbInMemory() {
  const wasmBinary = await readFile(WA_SQLITE_FTS5_WASM);
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
  const { init, mod, listBooks, buildMatchQuery, searchOnHandle } = await loadBundle();

  // (1) Fronteira Rust no wasm — necessária p/ compor `VerseRange.Single` e o cânon.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (0) Sanidade do mirror anti-injeção `build_match_query` (search.rs).
  assert.equal(buildMatchQuery('God'), '"God"', 'build_match_query("God") deve virar `"God"`');
  assert.equal(buildMatchQuery('Deus amou'), '"Deus" "amou"', 'AND implícito por termo entre aspas');
  assert.equal(buildMatchQuery('   '), null, 'query só-espaços → null (sem termo)');
  assert.equal(buildMatchQuery('a"b'), '"a""b"', 'aspas internas escapadas (FTS5)');

  // (2) Store local (wa-sqlite COM FTS5 + VFS de memória sobre os bytes do subset).
  const handle = await openReadingDbInMemory();

  // (2a) PROBE FTS5 ativo + COBERTURA da Bíblia COMPLETA (F5.36/ADR-0056): o SELECT
  //      real do core (MATCH) roda sem "no such module" E a busca cobre os 66 livros —
  //      "God"/kjv agora tem 3892 hits (era 646 no sample de 3 livros). Se o FTS5
  //      estivesse ausente, `searchOnHandle` lançaria aqui.
  const godHits = await searchOnHandle(handle, 'God', 'kjv', undefined, 5000);
  assert.ok(Array.isArray(godHits) && godHits.length > 0, 'search("God","kjv") deve retornar hits (FTS5 ativo)');
  assert.equal(
    godHits.length,
    GOD_HITS_KJV_FULL,
    `"God"/kjv deve ter ${GOD_HITS_KJV_FULL} hits na Bíblia completa, veio ${godHits.length}`,
  );

  // (2b) João 3:16 LOCALIZADO (filtrado por livro=43): na Bíblia completa João 3:16
  //      fica em ~1980º por BM25 para "God"/kjv — FORA de um top-N pequeno. O filtro de
  //      livro é determinístico e prova o MESMO texto verbatim que o TLA_SEARCH nativo.
  const johnGodHits = await searchOnHandle(handle, 'God', 'kjv', 43, 1000);
  const john = johnGodHits.find((h) => {
    const v = h.reference.verses;
    return h.reference.book === 43 && h.reference.chapter === 3 && v.tag === 'Single' && v.inner.verse === 16;
  });
  assert.ok(john, 'João 3:16 (43/3/16) deve estar no conjunto de "God"/kjv (paridade TLA_SEARCH)');
  assert.equal(john.text, JOHN_3_16_KJV, 'TEXTO do store deve ser o KJV verbatim de João 3:16');
  assert.equal(john.translation, 'kjv', 'translation do hit deve ser "kjv"');
  assert.equal(typeof john.score, 'number', 'score (bm25) deve ser number');

  // (2c) Marcadores: `highlighted` envolve "God"; `text` é LIMPO (markers não vazam).
  assert.ok(john.highlighted.includes(HL_START) && john.highlighted.includes(HL_END), 'highlighted deve ter U+0002/U+0003');
  assert.ok(
    john.highlighted.includes(`${HL_START}God${HL_END}`),
    'highlighted deve envolver "God" com os marcadores do FTS5',
  );
  assert.ok(!john.text.includes(HL_START) && !john.text.includes(HL_END), 'text NÃO deve conter marcadores (limpo)');
  assert.equal(
    john.highlighted.split(HL_START).join('').split(HL_END).join(''),
    john.text,
    'highlighted sem marcadores deve ser idêntico ao text verbatim',
  );

  // (2d) ACENTO-INSENSÍVEL (índice `unicode61 remove_diacritics 2`): "ceus" (sem
  //      acento) casa "céus" (acentuado) na Almeida 1911.
  const accHits = await searchOnHandle(handle, 'ceus', 'alm1911');
  assert.ok(accHits.length > 0, 'search("ceus","alm1911") deve retornar hits (acento-insensível)');
  assert.ok(
    accHits.some((h) => h.text.includes('céus')),
    'algum hit de "ceus" deve conter a forma ACENTUADA "céus" (prova de remove_diacritics)',
  );

  // (2e) Query vazia/só-espaços → [] SEM throw (espelha build_match_query → None).
  const emptyHits = await searchOnHandle(handle, '   ', 'kjv');
  assert.deepEqual(emptyHits, [], 'query só-espaços deve retornar [] (sem erro)');

  // (2f) `limit` respeitado.
  const limited = await searchOnHandle(handle, 'God', 'kjv', undefined, 3);
  assert.equal(limited.length, 3, `limit=3 deve retornar 3 resultados, veio ${limited.length}`);

  // (2g) Filtro de livro: `book=43` (João) restringe os hits ao livro.
  const johnOnly = await searchOnHandle(handle, 'God', 'kjv', 43, 1000);
  assert.ok(johnOnly.length > 0, 'busca filtrada por João deve ter hits');
  assert.ok(johnOnly.every((h) => h.reference.book === 43), 'todos os hits devem ser do livro 43 (filtro de livro)');

  // (2h) Tradução inexistente → LANÇA (espelha UnknownTranslation → CoreError).
  await assert.rejects(
    () => searchOnHandle(handle, 'God', 'nope'),
    /versão desconhecida: nope/,
    'tradução inexistente deve lançar "versão desconhecida: nope"',
  );

  await handle.sqlite3.close(handle.db);

  console.log('PASS — busca web (wa-sqlite[FTS5] + VFS de memória sobre reading-sample.sqlite):');
  console.log(`  FTS5 ATIVO no wa-sqlite (MATCH/bm25/highlight rodaram) — vendored ADR-0020`);
  console.log(`  search("God","kjv",-,5000)  -> ${godHits.length} hits (Bíblia completa; era 646 no sample)`);
  console.log(`  João 3:16 LOCALIZADO (livro=43) -> ref=João ${john.reference.chapter}:16 score=${john.score.toFixed(3)}`);
  console.log(`  john.text (verbatim, limpo) -> "${john.text}"`);
  console.log(`  john.highlighted (markers)  -> ...${JSON.stringify(john.highlighted.slice(0, 24))}...`);
  console.log(`  acento-insensível "ceus"    -> ${accHits.length} hits; contém "céus": ${accHits.some((h) => h.text.includes('céus'))}`);
  console.log(`  vazio "   "                 -> [] (sem throw)`);
  console.log(`  limit=3                     -> ${limited.length} resultados`);
  console.log(`  filtro livro=43 (João)      -> ${johnOnly.length} hits, todos no livro 43`);
  console.log(`  tradução "nope"             -> lançou "versão desconhecida: nope"`);
  console.log(
    '  PARIDADE: João 3:16 (filtrado por livro=43) é o MESMO texto que o nativo prova ' +
      'em TLA_SEARCH (F1.6, search(...,"kjv",43,1000) + .find()).',
  );
  // `listBooks` usado só para confirmar o cânon (Rust) disponível na composição.
  void listBooks;
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
