// app/lib/searchWordlistIndex.ts — ADR-0064 Fase B (autocomplete de termo do corpus)
//
// Índice PURO de palavras do corpus para autocomplete por PREFIXO ("eter" → eternamente,
// eternidade…). Recebe a lista `[display, freq]` ORDENADA pela forma dobrada (gerada por
// `scripts/gen-search-wordlist.mjs`), pré-computa as chaves dobradas UMA vez e faz busca binária
// do intervalo de prefixo, devolvendo as `max` palavras mais FREQUENTES. Sem I/O; testável headless.
//
// GARANTIA: as palavras vêm do texto do store da tradução buscada → um resultado de autocomplete
// SEMPRE retorna versículos ao ser buscado (não precisa sondar). ANTI-ALUCINAÇÃO: é índice de
// ferramenta de busca (consulta), não texto bíblico exibido.

import { fold } from './searchNormalize';

/** Entrada do dicionário: `[palavra de exibição, frequência no corpus]`. */
export type WordEntry = [string, number];

/** Dicionário carregado: palavras + chaves dobradas paralelas (ordenadas), para busca binária. */
export type Wordlist = { words: WordEntry[]; keys: string[] };

/** Constrói o índice: pré-dobra as chaves (a lista já vem ordenada por chave do gerador). */
export function makeWordlist(words: WordEntry[]): Wordlist {
  return { words, keys: words.map((w) => fold(w[0])) };
}

/** Menor índice `i` com `keys[i] >= p` (lower-bound; keys ordenadas). */
function lowerBound(keys: string[], p: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < p) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Até `max` palavras cujo prefixo (dobrado) casa `prefix`, ordenadas por FREQUÊNCIA desc. Exige
 * ≥2 letras (prefixo curto demais → `[]`, evita listas enormes). Devolve a grafia de EXIBIÇÃO.
 */
export function prefixMatches(wl: Wordlist, prefix: string, max = 6): string[] {
  const p = fold(prefix);
  if (p.length < 2) {
    return [];
  }
  const { keys, words } = wl;
  const start = lowerBound(keys, p);
  const hits: WordEntry[] = [];
  for (let i = start; i < keys.length && keys[i].startsWith(p); i++) {
    hits.push(words[i]);
  }
  hits.sort((a, b) => b[1] - a[1]);
  return hits.slice(0, max).map((w) => w[0]);
}
