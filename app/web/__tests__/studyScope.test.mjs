// studyScope.test.mjs — Fase 2 (Escopo de Estudo multi-seleção)
//
// PROVA HEADLESS (node, sem device/browser/rede) da lógica PURA do ESCOPO DE ESTUDO
// (`app/lib/studyScope.ts`). Bundla via esbuild (o único import é `import type` → apagado) e
// assevera, deterministicamente: coalescência de versos contíguos em trechos; alternar verso
// (adiciona/remove/re-coalesce); alternar capítulo inteiro; versesForChapter (whole vs conjunto);
// referência canônica EN (Single/Range/WholeChapter que o core parse_reference aceita) e rótulo
// de exibição; ordenação cross-capítulo/livro; contagens. Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'lib', 'studyScope.ts');

const outfile = join(tmpdir(), `study-scope-${randomBytes(6).toString('hex')}.mjs`);
await build({
  entryPoints: [SRC],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  logLevel: 'silent',
});
const S = await import(pathToFileURL(outfile).href);

const keys = (chunks) => chunks.map(S.chunkKey);

// ── (1) COALESCÊNCIA de versos contíguos num capítulo ────────────────────────────────
let c = [];
for (const v of [16, 17, 18]) c = S.toggleVerse(c, 43, 3, v);
assert.deepEqual(keys(c), ['43:3:16-18'], '16,17,18 contíguos → 1 trecho 16-18');
assert.equal(c.length, 1, 'um trecho');
assert.ok(S.isSingleChunk(c), 'isSingleChunk');

// versos disjuntos → trechos separados
c = [];
for (const v of [3, 5, 7]) c = S.toggleVerse(c, 43, 3, v);
assert.deepEqual(keys(c), ['43:3:3-3', '43:3:5-5', '43:3:7-7'], '3,5,7 disjuntos → 3 trechos');
assert.equal(S.explicitVerseCount(c), 3, '3 versos explícitos');

// ── (2) ALTERNAR verso remove/parte a faixa ──────────────────────────────────────────
c = [];
for (const v of [16, 17, 18]) c = S.toggleVerse(c, 43, 3, v);
c = S.toggleVerse(c, 43, 3, 17); // tira o do meio
assert.deepEqual(keys(c), ['43:3:16-16', '43:3:18-18'], 'tirar o 17 parte em 16 e 18');
c = S.toggleVerse(c, 43, 3, 16); // tira 16
assert.deepEqual(keys(c), ['43:3:18-18'], 'sobra só 18');

// ── (3) versesForChapter ─────────────────────────────────────────────────────────────
c = [];
for (const v of [16, 17, 18]) c = S.toggleVerse(c, 43, 3, v);
let vf = S.versesForChapter(c, 43, 3);
assert.equal(vf.whole, false, 'não é capítulo inteiro');
assert.deepEqual([...vf.verses].sort((a, b) => a - b), [16, 17, 18], 'versos 16,17,18 acesos');
assert.deepEqual([...S.versesForChapter(c, 43, 4).verses], [], 'outro capítulo: nada aceso');

// ── (4) ALTERNAR capítulo inteiro ────────────────────────────────────────────────────
c = S.toggleWholeChapter([], 43, 3);
assert.deepEqual(keys(c), ['43:3:*-*'], 'capítulo inteiro');
assert.equal(S.versesForChapter(c, 43, 3).whole, true, 'whole=true');
assert.equal(S.isWholeChapter(c[0]), true, 'isWholeChapter');
c = S.toggleWholeChapter(c, 43, 3); // toggle de novo → remove
assert.deepEqual(c, [], 'alternar de novo remove o capítulo inteiro');
// edição por verso SUPERA capítulo inteiro
c = S.toggleWholeChapter([], 43, 3);
c = S.toggleVerse(c, 43, 3, 16);
assert.deepEqual(keys(c), ['43:3:16-16'], 'tocar um verso troca capítulo-inteiro por faixa explícita');

// ── (5) referência canônica EN + rótulo de exibição ──────────────────────────────────
assert.equal(S.chunkToReference({ book: 43, chapter: 3 }, 'John'), 'John 3', 'whole → "John 3"');
assert.equal(S.chunkToReference({ book: 43, chapter: 3, from: 16, to: 16 }, 'John'), 'John 3:16', 'single');
assert.equal(S.chunkToReference({ book: 43, chapter: 3, from: 16, to: 18 }, 'John'), 'John 3:16-18', 'range');
assert.equal(S.chunkLabel({ book: 43, chapter: 3, from: 16, to: 18 }, 'João'), 'João 3:16–18', 'rótulo PT com en-dash');
assert.equal(S.chunkLabel({ book: 43, chapter: 3 }, 'João'), 'João 3', 'rótulo capítulo inteiro');

// ── (6) cross-capítulo / cross-livro: ordenado, trechos separados ─────────────────────
c = [];
c = S.toggleVerse(c, 45, 8, 1); // Romanos 8:1
c = S.toggleVerse(c, 43, 3, 16); // João 3:16
c = S.toggleWholeChapter(c, 19, 23); // Salmo 23 inteiro
assert.deepEqual(keys(c), ['19:23:*-*', '43:3:16-16', '45:8:1-1'], 'ordenado por livro,cap,verso');
assert.equal(S.isSingleChunk(c), false, '3 trechos ≠ único');

// ── (7) remover trecho pela chave ────────────────────────────────────────────────────
c = S.removeChunk(c, '43:3:16-16');
assert.deepEqual(keys(c), ['19:23:*-*', '45:8:1-1'], 'removeu João 3:16');

console.log('PASS — Escopo de Estudo (studyScope) puro, headless:');
console.log('  coalescência de versos contíguos; alternar verso (add/remove/re-coalesce); capítulo inteiro');
console.log('  versesForChapter (whole vs conjunto); referência EN (parse_reference: Single/Range/WholeChapter)');
console.log('  rótulo de exibição; ordenação cross-capítulo/livro; remoção por chave; contagens');
