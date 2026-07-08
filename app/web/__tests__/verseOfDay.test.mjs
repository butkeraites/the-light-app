// verseOfDay.test.mjs — Rodada 4 (engajamento): prova a lógica PURA do versículo do dia.
//
// `lib/verseOfDay.ts` é pura (sem store/wasm): a rotação é DETERMINÍSTICA por data. Aqui provamos:
// determinismo (mesma data → mesma referência), rotação diária, wrap no tamanho da lista, robustez
// a datas pré-época, e que TODA referência curada é canônica (livro 1..66, cap/verso ≥ 1). O TEXTO
// não é testado aqui (vem do store; a paridade é coberta pelo smoke em browser). Sai 0 se tudo bater.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'verseOfDay.ts');

async function load() {
  const outfile = join(tmpdir(), `vod-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

// Meia-noite UTC de um dia arbitrário conhecido (determinístico; não usa "hoje").
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

async function main() {
  const { verseOfDayRef, dayIndexUtc, VERSE_OF_DAY_REFS } = await load();
  const N = VERSE_OF_DAY_REFS.length;
  assert.ok(N >= 7, `lista curada deve ter várias entradas, tem ${N}`);

  // (1) Toda referência curada é CANÔNICA (livro 1..66, capítulo e versículo ≥ 1, inteiros).
  for (const r of VERSE_OF_DAY_REFS) {
    assert.ok(Number.isInteger(r.book) && r.book >= 1 && r.book <= 66, `livro fora do cânon: ${JSON.stringify(r)}`);
    assert.ok(Number.isInteger(r.chapter) && r.chapter >= 1, `capítulo inválido: ${JSON.stringify(r)}`);
    assert.ok(Number.isInteger(r.verse) && r.verse >= 1, `versículo inválido: ${JSON.stringify(r)}`);
  }

  // (2) DETERMINISMO: a mesma data (independente da hora) dá a MESMA referência.
  const a = verseOfDayRef(day(2026, 7, 8));
  const b = verseOfDayRef(new Date(Date.UTC(2026, 6, 8, 23, 59, 59)));
  assert.deepEqual(a, b, 'mesma data (UTC) → mesma referência, independente da hora');

  // (3) ROTAÇÃO: dias consecutivos avançam UMA posição na lista (mod N).
  const base = day(2026, 1, 1);
  const i0 = ((dayIndexUtc(base) % N) + N) % N;
  for (let k = 0; k < N + 3; k++) {
    const d = new Date(base.getTime() + k * 86_400_000);
    assert.deepEqual(verseOfDayRef(d), VERSE_OF_DAY_REFS[(i0 + k) % N], `dia +${k} deve mapear na posição rotacionada`);
  }

  // (4) WRAP: dia D e dia D+N dão a MESMA referência.
  const d0 = day(2026, 3, 10);
  const dN = new Date(d0.getTime() + N * 86_400_000);
  assert.deepEqual(verseOfDayRef(d0), verseOfDayRef(dN), `D e D+${N} → mesma referência (wrap)`);

  // (5) ROBUSTEZ: data PRÉ-ÉPOCA não produz índice negativo/crash (retorna uma ref válida).
  const pre = verseOfDayRef(new Date(Date.UTC(1900, 0, 1)));
  assert.ok(VERSE_OF_DAY_REFS.includes(pre), 'data pré-época → referência válida da lista (sem índice negativo)');

  console.log(`PASS — verso-do-dia: ${N} refs canônicas, determinístico, rotação+wrap OK, robusto a pré-época.`);
  console.log(`  exemplo 2026-07-08 -> ${a.book}:${a.chapter}:${a.verse}`);
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
