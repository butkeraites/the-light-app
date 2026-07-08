// chapterNav.test.mjs — navegação capítulo-a-capítulo: prova a lógica PURA de adjacência.
//
// `lib/chapterNav.ts` é pura (sem store/wasm): decide o capítulo ANTERIOR/PRÓXIMO a partir do cânon.
// Provamos: dentro do livro (±1), CRUZAR fronteira de livro (Gên 50→Êx 1, Êx 1→Gên 50), os EXTREMOS
// (Gên 1 sem anterior; Apoc 22 sem próximo), próximo-livro AUSENTE → null, e livro desconhecido →
// {null,null} (sem crash). Sai 0 se tudo bater.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'chapterNav.ts');

async function load() {
  const outfile = join(tmpdir(), `chapternav-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const { chapterNav } = await load();
  // Fixture mínima: Gênesis(1,50), Êxodo(2,40), Apocalipse(66,22). Cobre início/meio/fim do cânon.
  const books = [
    { number: 1, chapterCount: 50 },
    { number: 2, chapterCount: 40 },
    { number: 66, chapterCount: 22 },
  ];

  // (1) Extremo inicial: Gênesis 1 → sem anterior; próximo é Gênesis 2.
  assert.deepEqual(chapterNav(books, 1, 1), { prev: null, next: { book: 1, chapter: 2 } }, 'Gên 1: sem prev, next Gên 2');

  // (2) Meio de livro: ±1 no mesmo livro.
  assert.deepEqual(chapterNav(books, 1, 25), { prev: { book: 1, chapter: 24 }, next: { book: 1, chapter: 26 } }, 'Gên 25: ±1');

  // (3) CRUZAR fronteira p/ frente: Gênesis 50 (último) → Êxodo 1.
  assert.deepEqual(chapterNav(books, 1, 50).next, { book: 2, chapter: 1 }, 'Gên 50 → Êx 1');

  // (4) CRUZAR fronteira p/ trás: Êxodo 1 → Gênesis 50 (último do anterior).
  assert.deepEqual(chapterNav(books, 2, 1).prev, { book: 1, chapter: 50 }, 'Êx 1 → Gên 50');

  // (5) Próximo livro AUSENTE do cânon → null (aqui livro 3 não está na fixture).
  assert.equal(chapterNav(books, 2, 40).next, null, 'último cap. + próximo livro ausente → next null');

  // (6) Extremo final: Apocalipse 22 → sem próximo; anterior é Apoc 21.
  assert.deepEqual(chapterNav(books, 66, 22), { prev: { book: 66, chapter: 21 }, next: null }, 'Apoc 22: sem next, prev Apoc 21');

  // (7) Livro desconhecido → degrada sem crash.
  assert.deepEqual(chapterNav(books, 99, 1), { prev: null, next: null }, 'livro desconhecido → {null,null}');

  console.log('PASS — chapterNav: dentro do livro, cruzar fronteira (ambos sentidos), extremos do cânon, robusto.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
