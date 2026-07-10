// gestureNav.test.mjs — deepening (ADR-0071)
//
// PROVA HEADLESS (node, SEM browser) das decisões PURAS de virar-capítulo — `swipeIntent` (cinemática
// do swipe) e `sideNavZone` (zona de clique-lateral), que viviam inline em 3 efeitos de `window` na
// tela do capítulo e NÃO tinham teste. Bundla `lib/gestureNav.ts` (só puxa constantes de readingLayout).
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'gestureNav.ts');

async function load() {
  const outfile = join(tmpdir(), `gn-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const { swipeIntent, sideNavZone } = await load();

  // swipeIntent — SWIPE_MIN_DISTANCE=56, SWIPE_MAX_DURATION_MS=600, SWIPE_H_DOMINANCE=1.8
  assert.equal(swipeIntent(-100, 5, 200), 'next', 'esquerda rápido/horizontal → next');
  assert.equal(swipeIntent(100, 5, 200), 'prev', 'direita rápido/horizontal → prev');
  assert.equal(swipeIntent(-100, 5, 700), null, 'lento demais (dt>600) → null');
  assert.equal(swipeIntent(-30, 5, 200), null, 'curto demais (|dx|<56) → null');
  assert.equal(swipeIntent(-60, 60, 200), null, 'não horizontal (|dx|<|dy|*1.8) → null');
  assert.equal(swipeIntent(5, 100, 200), null, 'vertical → null');
  assert.equal(swipeIntent(-56, 0, 600), 'next', 'limiares exatos (=min dist, =max dur) → next');

  // sideNavZone — READING_COLUMN_MAX=680, SIDE_NAV_MIN_MARGIN=44; margin=(w-col)/2
  // viewport 1200, col 680 → margin=260
  assert.equal(sideNavZone(50, 1200, 680), 'prev', 'clique na margem esquerda → prev');
  assert.equal(sideNavZone(1150, 1200, 680), 'next', 'clique na margem direita → next');
  assert.equal(sideNavZone(600, 1200, 680), null, 'clique no meio (coluna) → null');
  assert.equal(sideNavZone(260, 1200, 680), 'prev', 'exatamente na borda esquerda (<=margin) → prev');
  // viewport estreito 700, col 680 → margin=10 < 44 → sempre null
  assert.equal(sideNavZone(5, 700, 680), null, 'tela estreita (margem<mínimo) → null');
  assert.equal(sideNavZone(695, 700, 680), null, 'tela estreita, borda direita → null');

  console.log('PASS — gestos de virar-capítulo (decisões puras, ADR-0071):');
  console.log('  swipeIntent: rápido+horizontal → prev/next; lento/curto/vertical → null: OK');
  console.log('  sideNavZone: margens laterais → prev/next; meio e tela-estreita → null: OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
