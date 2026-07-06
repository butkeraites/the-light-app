// search-smart.test.mjs — ADR-0064 (busca inteligente; molde theme.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser/rede) da camada de BUSCA INTELIGENTE app-side que
// envolve a fronteira `search` (INALTERADA). Bundla (esbuild) os módulos PUROS + `prefs` (backend
// fake) e assevera, deterministicamente:
//   1) NORMALIZE: `fold` remove acento + minúscula; `trimEdges` apara pontuação de borda;
//   2) STOPWORDS: `significantTerms` descarta conectivas/<2 letras, DEDUP por forma dobrada,
//      preserva grafia+ordem ("a armadura do Espírito" → ["armadura","Espírito"]);
//   3) SINÔNIMOS/CONCEITO: `synonymsFor`/`conceptExpansions` (o caso "armadura do espírito" →
//      "armadura de Deus");
//   4) DID-YOU-MEAN: `buildDidYouMean` com PROBE FAKE — só candidatos com contagem>0 sobrevivem,
//      ordem de prioridade (conceito→termos→sinônimos), consulta original nunca sugerida, caps;
//   5) REFERÊNCIA: `suggestBooks` (prefixo de nome/abrev, multi-palavra → []);
//   6) RECENTES: round-trip no KV fake (dedup por fold, cap, topo; clear; corrompido → []);
//   7) HIGIENE: módulos sem `console.*`.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'search-smart-headless-entry.ts');
const LIB = join(__dirname, '..', '..', 'lib');

async function loadBundle() {
  const outfile = join(tmpdir(), `search-smart-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    external: ['expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

// KV fake em memória (subconjunto get/set/remove) — molde theme.test.
function makeBackend() {
  const store = new Map();
  return {
    store,
    async getPref(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setPref(k, v) {
      store.set(k, v);
    },
    async removePref(k) {
      store.delete(k);
    },
  };
}

async function main() {
  const m = await loadBundle();
  const {
    fold,
    trimEdges,
    significantTerms,
    isStopword,
    synonymsFor,
    conceptExpansions,
    buildDidYouMean,
    suggestBooks,
    getRecentSearches,
    pushRecentSearch,
    clearRecentSearches,
    RECENT_MAX,
  } = m;

  // ══ (1) NORMALIZE ══════════════════════════════════════════════════════════════════════
  assert.equal(fold('Espírito'), 'espirito', 'fold remove acento + minúscula');
  assert.equal(fold('  Graça '), 'graca', 'fold apara + cedilha');
  assert.equal(fold('João'), 'joao', 'fold til');
  assert.equal(trimEdges('"armadura,"'), 'armadura', 'trimEdges apara pontuação de borda');
  assert.equal(trimEdges("d'água"), "d'água", 'trimEdges preserva pontuação interna');

  // ══ (2) STOPWORDS / termos significativos ══════════════════════════════════════════════
  assert.deepEqual(
    significantTerms('a armadura do Espírito'),
    ['armadura', 'Espírito'],
    'descarta a/do; preserva grafia+ordem',
  );
  assert.deepEqual(significantTerms('amor Amor AMOR'), ['amor'], 'dedup por forma dobrada');
  assert.deepEqual(significantTerms('de do da the of and'), [], 'só conectivas → vazio');
  assert.ok(isStopword('DO') && isStopword('the') && !isStopword('armadura'), 'isStopword');

  // ══ (3) SINÔNIMOS / CONCEITO ═══════════════════════════════════════════════════════════
  assert.ok(synonymsFor('espírito', 'pt').map(fold).includes('alma'), 'sinônimo pt espírito~alma');
  assert.ok(!synonymsFor('espírito', 'pt').map(fold).includes('espirito'), 'sinônimo exclui o próprio termo');
  assert.deepEqual(
    conceptExpansions('armadura do espírito', 'pt'),
    ['armadura de Deus'],
    'conceito: armadura do espírito → armadura de Deus',
  );
  assert.deepEqual(conceptExpansions('nada disso', 'pt'), [], 'conceito ausente → []');

  // ══ (4) DID-YOU-MEAN com PROBE FAKE ════════════════════════════════════════════════════
  // Só estes termos (forma dobrada) "existem" no store fake; a consulta inteira dá 0 (por isso
  // estamos no caminho did-you-mean).
  const COUNTS = { armadura: 7, espirito: 40, 'armadura de deus': 1 };
  let probeCalls = 0;
  const probe = async (term) => {
    probeCalls++;
    return COUNTS[fold(term)] ?? 0;
  };
  const sugg = await buildDidYouMean({ query: 'armadura do espírito', locale: 'pt', probe });
  const terms = sugg.map((s) => s.term);
  assert.ok(terms.includes('armadura de Deus'), 'sugere o conceito (armadura de Deus)');
  // Os termos preservam a grafia DIGITADA (query lowercase) — display fiel ao usuário.
  assert.ok(terms.includes('armadura') && terms.includes('espírito'), 'sugere os termos significativos');
  assert.equal(terms[0], 'armadura de Deus', 'conceito tem prioridade (primeiro)');
  assert.ok(sugg.every((s) => s.count > 0), 'toda sugestão TEM resultados (>0)');
  assert.ok(!terms.map(fold).includes('armadura do espirito'), 'nunca sugere a consulta original inteira');

  // Nada casa → sem sugestões.
  const empty = await buildDidYouMean({ query: 'xyzzyq', locale: 'pt', probe: async () => 0 });
  assert.deepEqual(empty, [], 'nenhum candidato com resultado → []');

  // Cap de sondas: maxProbes limita as chamadas.
  probeCalls = 0;
  await buildDidYouMean({ query: 'graça amor fé pecado salvação alegria luz', locale: 'pt', probe, maxProbes: 3 });
  assert.ok(probeCalls <= 3, `respeita maxProbes (sondou ${probeCalls} ≤ 3)`);

  // ══ (5) SUGESTÃO DE REFERÊNCIA (cânon fake) ════════════════════════════════════════════
  const BOOKS = [
    { number: 43, nameEn: 'John', namePt: 'João', abbrevEn: 'John', abbrevPt: 'Jo', chapterCount: 21 },
    { number: 49, nameEn: 'Ephesians', namePt: 'Efésios', abbrevEn: 'Eph', abbrevPt: 'Ef', chapterCount: 6 },
    { number: 18, nameEn: 'Job', namePt: 'Jó', abbrevEn: 'Job', abbrevPt: 'Jó', chapterCount: 42 },
  ];
  assert.deepEqual(
    suggestBooks('efé', BOOKS, 'pt').map((s) => s.label),
    ['Efésios'],
    'prefixo de nome pt → Efésios',
  );
  assert.deepEqual(suggestBooks('ef', BOOKS, 'pt').map((s) => s.book), [49], 'abrev exata "ef" → Efésios');
  assert.ok(
    suggestBooks('jo', BOOKS, 'pt').map((s) => s.book).includes(43),
    'prefixo "jo" inclui João',
  );
  assert.deepEqual(suggestBooks('efesios 6', BOOKS, 'pt'), [], 'multi-palavra → busca de texto (sem livro)');
  assert.deepEqual(suggestBooks('a', BOOKS, 'pt'), [], 'consulta <2 letras → []');

  // ══ (6) BUSCAS RECENTES (KV fake) ══════════════════════════════════════════════════════
  const backend = makeBackend();
  assert.deepEqual(await getRecentSearches(backend), [], 'sem recentes no início');
  await pushRecentSearch('graça', backend);
  await pushRecentSearch('armadura', backend);
  await pushRecentSearch('Graça', backend); // dedup por fold → sobe ao topo, não duplica
  assert.deepEqual(await getRecentSearches(backend), ['Graça', 'armadura'], 'dedup por fold + topo');
  // Cap.
  for (let i = 0; i < RECENT_MAX + 3; i++) await pushRecentSearch(`t${i}`, backend);
  assert.equal((await getRecentSearches(backend)).length, RECENT_MAX, 'capa em RECENT_MAX');
  await clearRecentSearches(backend);
  assert.deepEqual(await getRecentSearches(backend), [], 'clear limpa');
  // Valor corrompido → [] (nunca lança).
  const bad = makeBackend();
  await bad.setPref('tla.pref.search.recent', '{not json');
  assert.deepEqual(await getRecentSearches(bad), [], 'valor corrompido → [] (offline-first)');
  await pushRecentSearch('   ', backend);
  assert.deepEqual(await getRecentSearches(backend), [], 'termo vazio é ignorado');

  // ══ (7) HIGIENE — sem console.* nos módulos ════════════════════════════════════════════
  for (const f of ['searchNormalize', 'searchStopwords', 'searchSynonyms', 'searchSuggest', 'searchReferenceSuggest', 'recentSearches']) {
    const src = await readFile(join(LIB, `${f}.ts`), 'utf8');
    assert.ok(!/console\./.test(src), `${f}.ts sem console.*`);
  }

  console.log('PASS — busca inteligente app-side (did-you-mean + autocomplete de referência + recentes), headless:');
  console.log('  normalize/stopwords: "a armadura do Espírito" → ["armadura","Espírito"]; fold acento-insensível');
  console.log('  sinônimos/conceito: espírito~alma; "armadura do espírito" → "armadura de Deus"');
  console.log('  did-you-mean: só candidatos com resultado (probe>0), conceito 1º, consulta original nunca sugerida, caps');
  console.log('  referência: prefixo de nome/abrev; multi-palavra = busca de texto');
  console.log('  recentes: round-trip no KV offline (dedup por fold, cap, corrompido → [])');
  console.log('  higiene: módulos sem console.*');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
