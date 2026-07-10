// app/lib/searchIntent.ts — ADR-0075 (deepening): orquestração pura do "você quis dizer?" (zero-path)
//
// A tela de busca montava INLINE, dentro do efeito, a orquestração do caminho ZERO-resultado: a SONDA
// de existência (busca com `limit=1` → contagem, falha→0), os candidatos fuzzy do corpus (falha→[]) e a
// composição em `buildDidYouMean`. Sem interface → sem teste — e é justamente onde os bugs de
// orquestração vivem (o fio das portas, os `catch` de resiliência). Concentrada aqui como função PURA
// (ports injetados). O debounce, o race-guard (`seqRef`) e o `setResults`/`setSuggestions` em DUAS
// fases seguem no efeito da tela → TIMING INALTERADO (só a montagem do zero-path saiu). Molde:
// `searchSuggest.buildDidYouMean` (a mesma disciplina de ports injetados).
import { buildDidYouMean, type DidYouMean, type SearchProbe } from './searchSuggest';
import type { SearchLocale } from './searchSynonyms';
import type { WordlistLang } from './searchWordlist';

/** Nº máximo de candidatos fuzzy do corpus a considerar (paridade com a chamada inline anterior). */
export const FUZZY_MAX = 6;

/** Portas injetadas: a busca de texto (p/ a sonda de existência) e o dicionário fuzzy do corpus buscado. */
export interface SearchIntentPorts {
  /** A busca de texto; `limit` serve à SONDA de existência (`limit=1` → 0/1). Usa-se só `.length` do retorno. */
  search: (term: string, translation: string, limit?: number) => Promise<readonly unknown[]>;
  /** Candidatos fuzzy (edit-distance) do dicionário do corpus da tradução buscada. */
  suggestFuzzy: (term: string, lang: WordlistLang, max: number) => Promise<string[]>;
}

/**
 * Resolve as sugestões "você quis dizer?" no caminho ZERO-resultado: `buildDidYouMean` sonda candidatos
 * (conceito → termos significativos → sinônimos → fuzzy do corpus) contra o store e mantém só os que DE
 * FATO retornam resultados. Puro: `search`/`suggestFuzzy` são injetados. A resiliência é preservada
 * verbatim — a sonda que falha conta 0 (candidato descartado); o fuzzy que falha vira [] (a busca segue
 * intacta). NÃO faz debounce/race — isso é do efeito da tela.
 */
export async function resolveDidYouMean(
  term: string,
  translation: string,
  locale: SearchLocale,
  lang: WordlistLang,
  ports: SearchIntentPorts,
): Promise<DidYouMean[]> {
  const probe: SearchProbe = (cand) =>
    ports.search(cand, translation, 1).then((r) => r.length).catch(() => 0);
  const fuzzy = await ports.suggestFuzzy(term, lang, FUZZY_MAX).catch(() => []);
  return buildDidYouMean({ query: term, locale, probe, extraCandidates: () => fuzzy });
}
