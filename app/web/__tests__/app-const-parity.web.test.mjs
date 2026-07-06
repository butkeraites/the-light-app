// app-const-parity.web.test.mjs — deepening (ADR-0062, guarda de drift UNGATED)
//
// GUARDA (não o fix): as constantes que o APP possui (`core/src/lib.rs`, NÃO o the-light) e
// que o espelho TS do web reproduz à mão. Fecha o drift APP-owned de HOJE, sem tocar o
// the-light. Lê o FONTE (lint-like, sem wasm/rede) dos dois lados e assere igualdade:
//   - core/src/lib.rs `DEFAULT_LEXICON_LIMIT` (32) == sqlite-lexicon.web.ts `DEFAULT_LEXICON_LIMIT`
//   - core/src/lib.rs `DEFAULT_RESEARCH_LIMIT` (4) == research.web.ts `DEFAULT_WIKIPEDIA_LIMIT`
//                                                  == research.web.ts `DEFAULT_TAVILY_LIMIT`
// Falha (≠0) se qualquer par divergir. Ver ADR-0062 (o espelho é a costura; isto só o guarda).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // app/web/__tests__ -> repo root
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Valor numérico de uma const Rust `const NAME: TYPE = <n>;` (o 1º match). */
function rustConst(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*:\\s*\\w+\\s*=\\s*(\\d+)`));
  assert.ok(m, `Rust const ${name} não encontrada`);
  return Number(m[1]);
}

/** Valor numérico de uma const TS `NAME = <n>` (o 1º match; ignora `export`/tipo). */
function tsConst(src, name) {
  const m = src.match(new RegExp(`\\b${name}\\b[^=]*=\\s*(\\d+)`));
  assert.ok(m, `TS const ${name} não encontrada`);
  return Number(m[1]);
}

function main() {
  const coreRs = read('core/src/lib.rs');
  const lexTs = read('app/web/sqlite-lexicon.web.ts');
  const researchTs = read('app/web/research.web.ts');

  // Léxico: a fonte única é o boundary do app; o web espelha o mesmo teto.
  const rustLexicon = rustConst(coreRs, 'DEFAULT_LEXICON_LIMIT');
  const tsLexicon = tsConst(lexTs, 'DEFAULT_LEXICON_LIMIT');
  assert.equal(
    tsLexicon,
    rustLexicon,
    `DRIFT: sqlite-lexicon.web.ts DEFAULT_LEXICON_LIMIT (${tsLexicon}) != core/src/lib.rs (${rustLexicon})`,
  );

  // Pesquisa web: o app owna DEFAULT_RESEARCH_LIMIT; o web espelha o mesmo default p/ os 2 backends.
  const rustResearch = rustConst(coreRs, 'DEFAULT_RESEARCH_LIMIT');
  const tsWikipedia = tsConst(researchTs, 'DEFAULT_WIKIPEDIA_LIMIT');
  const tsTavily = tsConst(researchTs, 'DEFAULT_TAVILY_LIMIT');
  assert.equal(
    tsWikipedia,
    rustResearch,
    `DRIFT: research.web.ts DEFAULT_WIKIPEDIA_LIMIT (${tsWikipedia}) != core/src/lib.rs DEFAULT_RESEARCH_LIMIT (${rustResearch})`,
  );
  assert.equal(
    tsTavily,
    rustResearch,
    `DRIFT: research.web.ts DEFAULT_TAVILY_LIMIT (${tsTavily}) != core/src/lib.rs DEFAULT_RESEARCH_LIMIT (${rustResearch})`,
  );

  console.log('PASS — paridade de constantes APP-owned (core/src/lib.rs ↔ espelho TS web):');
  console.log(`  DEFAULT_LEXICON_LIMIT: ${rustLexicon} (core) == ${tsLexicon} (lexicon.web): OK`);
  console.log(
    `  DEFAULT_RESEARCH_LIMIT: ${rustResearch} (core) == wikipedia ${tsWikipedia} == tavily ${tsTavily} (research.web): OK`,
  );
}

try {
  main();
} catch (err) {
  console.error('FAIL —', err?.message ?? err);
  process.exit(1);
}
