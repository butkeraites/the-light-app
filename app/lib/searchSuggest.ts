// app/lib/searchSuggest.ts — ADR-0064 (busca inteligente)
//
// Motor "did you mean?" (VOCÊ QUIS DIZER?), PURO. Quando a busca EXATA (AND palavra-a-palavra do
// core, INALTERADA) devolve zero, propõe termos alternativos que DE FATO retornam resultados —
// jamais uma sugestão morta. As fontes de candidatos, em ordem de prioridade:
//   1. EQUIVALÊNCIA de conceito da consulta inteira (curada) — ex.: "armadura de Deus".
//   2. Cada TERMO SIGNIFICATIVO (conectivas removidas) — ex.: "armadura", "espírito".
//   3. SINÔNIMOS curados de cada termo — ex.: "alma".
//   4. (Fase B) candidatos por PREFIXO/proximidade do dicionário de palavras do corpus.
// Cada candidato é PROVADO via `probe` (um wrapper fino sobre `search(limit=pequeno)` → contagem);
// só sobrevivem os com contagem > 0. `probe` é INJETADO → esta lógica é testável headless.
//
// PURO/sem I/O próprio. A corrida (respostas obsoletas) é responsabilidade do CHAMADOR (seqRef).
// ANTI-ALUCINAÇÃO: só reordena/expande a CONSULTA; o texto do resultado segue verbatim do store.

import { fold } from './searchNormalize';
import { significantTerms } from './searchStopwords';
import { conceptExpansions, synonymsFor, type SearchLocale } from './searchSynonyms';

/** Sonda de existência: nº de resultados de `term` (0 se nenhum). Wrapper de `search`. */
export type SearchProbe = (term: string) => Promise<number>;

/** Uma sugestão provada: o termo (exibição) e quantos resultados retorna. */
export type DidYouMean = { term: string; count: number };

export type SuggestParams = {
  query: string;
  locale: SearchLocale;
  probe: SearchProbe;
  /** Candidatos extra (Fase B: dicionário/prefixo/typo). Recebe a consulta, devolve termos. */
  extraCandidates?: (query: string) => string[];
  /** Máx. de candidatos a SONDAR (custo). Default 6. */
  maxProbes?: number;
  /** Máx. de sugestões a devolver. Default 4. */
  maxResults?: number;
};

/** Candidatos ordenados por prioridade, DEDUP por forma dobrada, excluindo a consulta original. */
function candidateTerms(params: SuggestParams): string[] {
  const { query, locale, extraCandidates } = params;
  const queryKey = fold(query).replace(/\s+/g, ' ');
  const out: string[] = [];
  const seen = new Set<string>([queryKey]); // nunca re-sugerir a consulta inteira original

  const add = (term: string) => {
    const key = fold(term);
    if (key.length < 2 || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(term);
  };

  // 1. Conceito (frase inteira) — maior prioridade.
  for (const c of conceptExpansions(query, locale)) add(c);
  // 2. Termos significativos.
  const terms = significantTerms(query);
  for (const term of terms) add(term);
  // 3. Sinônimos de cada termo.
  for (const term of terms) {
    for (const syn of synonymsFor(term, locale)) add(syn);
  }
  // 4. Extra (Fase B).
  if (extraCandidates) {
    for (const c of extraCandidates(query)) add(c);
  }
  return out;
}

/**
 * Constrói as sugestões "did you mean?": sonda os candidatos (em paralelo, até `maxProbes`),
 * mantém só os que retornam resultados, PRESERVA a ordem de prioridade e corta em `maxResults`.
 * Devolve `[]` se nada casar (a UI então mostra só "sem resultados").
 */
export async function buildDidYouMean(params: SuggestParams): Promise<DidYouMean[]> {
  const maxProbes = params.maxProbes ?? 6;
  const maxResults = params.maxResults ?? 4;
  const candidates = candidateTerms(params).slice(0, maxProbes);

  const probed = await Promise.all(
    candidates.map(async (term) => {
      try {
        return { term, count: await params.probe(term) };
      } catch {
        return { term, count: 0 }; // sonda falhou → trata como sem resultado (offline-first)
      }
    }),
  );

  return probed.filter((s) => s.count > 0).slice(0, maxResults);
}
