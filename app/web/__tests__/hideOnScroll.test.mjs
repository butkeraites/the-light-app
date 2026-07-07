// hideOnScroll.test.mjs — leitura imersiva (esconder cromo ao rolar)
//
// PROVA HEADLESS (node, sem device/browser) da lógica PURA de `app/lib/hideOnScroll.ts`. Bundla via
// esbuild (só `import type` → apagado) e assevera a máquina de direção: rolar pra frente esconde,
// pra trás mostra, perto do topo sempre mostra, e a histerese (limiar) evita piscar. Sai 0 se OK.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', '..', 'lib', 'hideOnScroll.ts');
const outfile = join(tmpdir(), `hide-on-scroll-${randomBytes(6).toString('hex')}.mjs`);
await build({ entryPoints: [SRC], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
const H = await import(pathToFileURL(outfile).href);

const opts = { threshold: 12, topGuard: 24 };
// Roda uma sequência de offsets e devolve o estado final + trilha de `hidden`.
function run(ys, start = H.initialHideScroll) {
  let s = start;
  const trail = [];
  for (const y of ys) {
    s = H.reduceHideScroll(s, y, opts);
    trail.push(s.hidden);
  }
  return { s, trail };
}

// ── (1) perto do topo sempre VISÍVEL ─────────────────────────────────────────────────
assert.equal(H.reduceHideScroll(H.initialHideScroll, 0, opts).hidden, false, 'topo: visível');
assert.equal(H.reduceHideScroll({ hidden: true, lastY: 200, acc: 0 }, 10, opts).hidden, false, 'voltar ao topo revela');

// ── (2) rolar PRA FRENTE (y cresce além do limiar) → ESCONDE ──────────────────────────
{
  const { s } = run([30, 50, 80]); // +26 acumulado (>12) já no 2º passo
  assert.equal(s.hidden, true, 'rolar pra frente esconde');
}

// ── (3) rolar PRA TRÁS (y decresce) → MOSTRA ──────────────────────────────────────────
{
  let s = { hidden: true, lastY: 300, acc: 0 };
  s = H.reduceHideScroll(s, 285, opts); // -15 (< -12) → mostra
  assert.equal(s.hidden, false, 'rolar pra trás mostra');
}

// ── (4) HISTERESE: micro-tremor abaixo do limiar NÃO alterna ──────────────────────────
{
  // a partir de y=200 visível, oscila ±5 (nunca acumula 12 numa direção)
  const { s } = run([205, 200, 206, 201, 207], { hidden: false, lastY: 200, acc: 0 });
  assert.equal(s.hidden, false, 'tremor pequeno não esconde');
}

// ── (5) troca de direção reinicia o acumulador (não arrasta momento) ──────────────────
{
  // sobe 10 (acc=10, <12, não esconde), depois desce: acc deve zerar antes de somar negativo
  let s = { hidden: false, lastY: 100, acc: 0 };
  s = H.reduceHideScroll(s, 110, opts); // +10 acc=10
  assert.equal(s.acc, 10, 'acumulou +10');
  s = H.reduceHideScroll(s, 108, opts); // dy=-2, troca de sinal → acc=0 depois -2 = -2
  assert.equal(s.acc, -2, 'trocou de direção: acumulador reinicia');
  assert.equal(s.hidden, false, 'ainda visível');
}

// ── (6) ciclo completo: esconde e volta a mostrar ─────────────────────────────────────
{
  let s = H.initialHideScroll;
  s = run([40, 70, 100], s).s; // pra frente → esconde
  assert.equal(s.hidden, true, 'escondeu');
  s = run([80, 55, 30], s).s; // pra trás → mostra
  assert.equal(s.hidden, false, 'voltou a mostrar');
}

// ── (7) limiares ASSIMÉTRICOS: esconder deliberado, mostrar ágil ─────────────────────
{
  const asym = { threshold: 12, topGuard: 24, hideThreshold: 24, showThreshold: 8 };
  // +20 acumulado pra frente NÃO esconde (< hideThreshold 24)
  let s = { hidden: false, lastY: 100, acc: 0 };
  s = H.reduceHideScroll(s, 120, asym); // +20
  assert.equal(s.hidden, false, 'assimétrico: +20 não atinge hideThreshold(24) → não esconde');
  // mais +10 (acc 30 ≥ 24) → esconde
  s = H.reduceHideScroll(s, 130, asym);
  assert.equal(s.hidden, true, 'assimétrico: acumular ≥24 esconde');
  // pra trás só -8 já MOSTRA (showThreshold 8, ágil)
  s = H.reduceHideScroll(s, 122, asym); // -8
  assert.equal(s.hidden, false, 'assimétrico: -8 atinge showThreshold(8) → mostra (ágil)');
}

console.log('PASS — hideOnScroll (leitura imersiva) puro, headless:');
console.log('  topo sempre visível; rolar pra frente esconde; pra trás mostra');
console.log('  histerese (limiar) evita piscar; troca de direção reinicia o acumulador; ciclo completo');
console.log('  limiares ASSIMÉTRICOS (esconder deliberado / mostrar ágil) com fallback p/ threshold');
