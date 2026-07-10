// mirror-drift.web.test.mjs — deepening (ADR-0062, guarda de drift UNGATED)
//
// GUARDA (não o fix): assere que o ESPELHO TS do web (SQL SELECTs + constantes numéricas do
// the-light) bate com o FONTE Rust do `the-light-core` NO REV EXATO pinado em `core/Cargo.toml`.
// Detecta os dois vetores de drift compiler-invisível (ADR-0062): (a) o TS divergir do Rust, e
// (b) o the-light mudar sob o mesmo pin sem o espelho ser revisto. Lê o Rust via
// `git -C ../the-light show <rev>:...` (sem checkout) e o TS via fonte (lint-like, sem wasm/rede).
//
// Normalização: `\` (continuação de string Rust) → espaço; `?1/?2/...` (Rust numerado) → `?`
// (TS posicional); colapsa espaços; minúsculas. Assim o SELECT do Rust e o do TS ficam idênticos
// quando fiéis. Se o the-light não estiver disponível (clone isolado do app), a guarda faz SKIP
// LOUD (exit 0) — ela só FALHA em drift REAL. Ver ADR-0062: o espelho é a costura; isto só guarda.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // app/web/__tests__ -> the-light-app root
const THE_LIGHT = join(ROOT, '..', 'the-light'); // repo irmão
const readApp = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Rev pinado do the-light-core em core/Cargo.toml (fonte da verdade do que o app consome). */
function pinnedRev() {
  const cargo = readApp('core/Cargo.toml');
  const m = cargo.match(/rev\s*=\s*"([a-f0-9]{40})"/);
  assert.ok(m, 'rev pinado não encontrado em core/Cargo.toml');
  return m[1];
}

/** Fonte Rust de `crates/the-light-core/src/<file>` no rev pinado (git show, sem checkout). */
function rustSrc(rev, file) {
  return execFileSync('git', ['-C', THE_LIGHT, 'show', `${rev}:crates/the-light-core/src/${file}`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

const normalizeSql = (s) =>
  s
    .replace(/\\/g, ' ') // continuação de string Rust
    .replace(/\?\d+/g, '?') // ?1 ?2 (Rust) -> ? (TS)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Todos os literais de string que começam com "SELECT no fonte (SQL não tem `"` embutido). */
function rustSqlLiterals(src) {
  const out = [];
  const re = /"(SELECT[\s\S]*?)"/gi;
  let m;
  while ((m = re.exec(src)) !== null) out.push(normalizeSql(m[1]));
  return out;
}

/** O único literal SELECT que contém todos os `include` e nenhum dos `exclude` (normalizados). */
function pickRustSql(src, { include = [], exclude = [] }) {
  const cands = rustSqlLiterals(src).filter(
    (s) => include.every((i) => s.includes(i)) && exclude.every((e) => !s.includes(e)),
  );
  assert.equal(cands.length, 1, `esperava 1 SELECT Rust p/ include=${JSON.stringify(include)}, achei ${cands.length}`);
  return cands[0];
}

/** Valor da const SQL do TS (concatenação `'..' + '..'`), normalizado. */
function tsSqlConst(src, name) {
  const start = src.search(new RegExp(`(export\\s+)?const\\s+${name}\\b`));
  assert.ok(start >= 0, `TS const ${name} não encontrada`);
  const semi = src.indexOf(';', start);
  assert.ok(semi > start, `TS const ${name} sem terminador ;`);
  let span = src.slice(start, semi);
  span = span.replace(/\/\/[^\n]*/g, ' '); // tira comentários de linha
  span = span.replace(/^[^=]*=/, ''); // tira `const NAME =`
  span = span.replace(/['"`+]/g, ' '); // tira sintaxe de string JS
  return normalizeSql(span);
}

/** Valor numérico de uma const Rust `const NAME: TYPE = <n>`. */
function rustNum(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*:\\s*\\w+\\s*=\\s*(\\d+)`));
  assert.ok(m, `Rust const ${name} não encontrada`);
  return Number(m[1]);
}

/** Valor numérico de uma const TS `NAME = <n>`. */
function tsNum(src, name) {
  const m = src.match(new RegExp(`\\b${name}\\b[^=]*=\\s*(\\d+)`));
  assert.ok(m, `TS const ${name} não encontrada`);
  return Number(m[1]);
}

// Descritores: cada linha da costura espelhada (constante numérica ou SELECT).
const CONSTS = [
  { name: 'xref DEFAULT_MIN_VOTES', rustFile: 'xref.rs', rustConst: 'DEFAULT_MIN_VOTES', tsFile: 'app/web/sqlite-xref.web.ts', tsConst: 'DEFAULT_MIN_VOTES' },
  { name: 'xref DEFAULT_LIMIT', rustFile: 'xref.rs', rustConst: 'DEFAULT_LIMIT', tsFile: 'app/web/sqlite-xref.web.ts', tsConst: 'DEFAULT_LIMIT' },
  // `providers DEFAULT_MAX_TOKENS` RETIRADO (ADR-0062, fatia transporte-URLs/max_tokens): o
  // espelho TS `DEFAULT_MAX_TOKENS = 8192` de `ai-anchored.web.ts` FOI COLAPSADO — o valor
  // agora vem da fronteira wasm `llmDefaultMaxTokens()` (fonte única no core). Sem espelho =
  // sem drift a guardar. As URLs (anthropic/openai/ollama/gemini) idem, via `llmEndpointUrl`.
];

const SELECTS = [
  { name: 'xref for_verse', rustFile: 'xref.rs', include: ['from cross_references'], tsFile: 'app/web/sqlite-xref.web.ts', tsConst: 'XREF_SELECT' },
  { name: 'chapter_count', rustFile: 'source/embedded.rs', include: ['max(chapter)'], tsFile: 'app/web/sqlite-reading.web.ts', tsConst: 'CHAPTER_COUNT_SELECT' },
  { name: 'translations', rustFile: 'source/embedded.rs', include: ['abbrev, name, language'], tsFile: 'app/web/sqlite-reading.web.ts', tsConst: 'TRANSLATIONS_SELECT' },
  { name: 'has_translation', rustFile: 'source/embedded.rs', include: ['select 1 from translations'], tsFile: 'app/web/sqlite-reading.web.ts', tsConst: 'HAS_TRANSLATION_SELECT' },
  { name: 'chapter whole', rustFile: 'source/embedded.rs', include: ['verse, text from verses', 'order by verse'], exclude: ['verse = ?', 'between'], tsFile: 'app/web/sqlite-reading.web.ts', tsConst: 'CHAPTER_SELECT_WHOLE' },
  { name: 'passage single', rustFile: 'source/embedded.rs', include: ['verse, text from verses', 'verse = ?'], exclude: ['between'], tsFile: 'app/web/sqlite.web.ts', tsConst: 'PASSAGE_SELECT_SINGLE' },
  { name: 'search base', rustFile: 'search.rs', include: ['verses_fts match'], tsFile: 'app/web/sqlite-search.web.ts', tsConst: 'SEARCH_SELECT_BASE' },
  { name: 'interlinear tokens', rustFile: 'ai/lexicon.rs', include: ['from original_tokens', 'order by t.word_index'], tsFile: 'app/web/sqlite-lexicon.web.ts', tsConst: 'INTERLINEAR_SELECT' },
];

function theLightAvailable(rev) {
  try {
    execFileSync('git', ['-C', THE_LIGHT, 'cat-file', '-t', rev], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const rev = pinnedRev();

  if (!theLightAvailable(rev)) {
    // Em CI o repo irmão DEVE estar presente (o workflow faz checkout do the-light em ../the-light no
    // rev pinado). Se faltar em CI, é MISCONFIG → FALHA alta (não deixa a guarda de paridade mais forte
    // passar em silêncio). Fora de CI (clone isolado do app), mantém o SKIP LOUD histórico.
    if (process.env.CI) {
      console.error('FAIL — mirror-drift em CI sem o repo irmão the-light em ../the-light.');
      console.error(`  Pin (core/Cargo.toml): ${rev.slice(0, 10)}. O workflow deve fazer checkout do the-light.`);
      process.exit(1);
    }
    console.log('SKIP — mirror-drift: repo the-light indisponível em ../the-light (ou rev ausente).');
    console.log(`  Pin lido de core/Cargo.toml: ${rev.slice(0, 10)}`);
    console.log('  Esta guarda precisa do repo irmão the-light p/ comparar contra o Rust no rev exato.');
    console.log('  (Guarda de drift ungated — ADR-0062; SKIP não é falha fora de CI.)');
    return;
  }

  const rustCache = new Map();
  const rustOf = (file) => {
    if (!rustCache.has(file)) rustCache.set(file, rustSrc(rev, file));
    return rustCache.get(file);
  };

  let checked = 0;
  for (const c of CONSTS) {
    const r = rustNum(rustOf(c.rustFile), c.rustConst);
    const t = tsNum(readApp(c.tsFile), c.tsConst);
    assert.equal(t, r, `DRIFT const ${c.name}: TS ${t} != the-light@${rev.slice(0, 8)} ${r}`);
    checked++;
  }

  for (const s of SELECTS) {
    const rustSql = pickRustSql(rustOf(s.rustFile), { include: s.include, exclude: s.exclude ?? [] });
    const tsSql = tsSqlConst(readApp(s.tsFile), s.tsConst);
    assert.equal(tsSql, rustSql, `DRIFT SELECT ${s.name}:\n  TS   : ${tsSql}\n  RUST : ${rustSql}`);
    checked++;
  }

  console.log(`PASS — mirror-drift: espelho TS FIEL ao the-light @ ${rev.slice(0, 10)} (${checked} itens):`);
  console.log(`  constantes numéricas (${CONSTS.length}): xref min_votes/limit (providers max_tokens colapsado p/ wasm — ADR-0062): OK`);
  console.log(`  SQL SELECTs (${SELECTS.length}): xref, chapter_count, translations, has_translation, chapter-whole, passage-single, search-base: OK`);
}

try {
  main();
} catch (err) {
  console.error('FAIL —', err?.message ?? err);
  process.exit(1);
}
