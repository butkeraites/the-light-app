// searchIntent.test.mjs — deepening (ADR-0075)
//
// PROVA HEADLESS (node, SEM wasm) da orquestração PURA do "você quis dizer?" (`resolveDidYouMean`), que
// estava presa inline no efeito da tela de busca (SEM teste). Bundla `lib/searchIntent.ts` (→ searchSuggest
// + helpers puros; imports de tipo apagados). Injeta PORTAS fake (busca/fuzzy) e prova: só candidatos que
// RETORNAM resultados sobrevivem; a resiliência (sonda falha→0; fuzzy falha→[]) não quebra.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'searchIntent.ts');

async function load() {
  const outfile = join(tmpdir(), `si-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const { resolveDidYouMean } = await load();

  // Porta de busca fake: só 'eternidade' EXISTE (1 hit); qualquer outro termo → 0 resultados.
  const searchExists = async (cand) => (cand === 'eternidade' ? [{}] : []);
  // Porta fuzzy fake: p/ o typo 'eternidde', o dicionário do corpus sugere 'eternidade'.
  const fuzzyEternidade = async () => ['eternidade'];

  // (1) O candidato fuzzy que EXISTE aparece; o typo original (0 resultados) é filtrado.
  const r = await resolveDidYouMean('eternidde', 'alm1911', 'pt', 'pt', {
    search: searchExists,
    suggestFuzzy: fuzzyEternidade,
  });
  assert.ok(r.some((d) => d.term === 'eternidade' && d.count === 1), 'candidato fuzzy que existe → sugerido');
  assert.ok(!r.some((d) => d.term === 'eternidde'), 'o typo (0 resultados) → filtrado');

  // (2) Resiliência: a SONDA que LANÇA conta 0 (candidato descartado) — não quebra.
  const throwingSearch = async () => {
    throw new Error('db indisponível');
  };
  const r2 = await resolveDidYouMean('eternidde', 'alm1911', 'pt', 'pt', {
    search: throwingSearch,
    suggestFuzzy: fuzzyEternidade,
  });
  assert.deepEqual(r2, [], 'sonda falhando → nenhuma sugestão (catch→0), sem lançar');

  // (3) Resiliência: `suggestFuzzy` que LANÇA vira [] — sem candidato fuzzy, não quebra.
  const throwingFuzzy = async () => {
    throw new Error('sem asset de wordlist');
  };
  const r3 = await resolveDidYouMean('eternidde', 'alm1911', 'pt', 'pt', {
    search: searchExists,
    suggestFuzzy: throwingFuzzy,
  });
  assert.equal(r3.length, 0, 'fuzzy falhando → fuzzy=[]; sem o candidato correto, nada sugerido (não quebra)');

  console.log('PASS — resolveDidYouMean (orquestração pura do zero-path, ADR-0075):');
  console.log('  só candidatos que RETORNAM resultados sobrevivem; typo filtrado; fuzzy injetado: OK');
  console.log('  resiliência: sonda falha→0 (sem lançar); fuzzy falha→[] (sem lançar): OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
