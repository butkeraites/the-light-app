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

/**
 * Distância de edição de Levenshtein LIMITADA a `max`: devolve a distância REAL se ≤ `max`, senão
 * `max + 1` (só nos importa "está perto?"). DP por linhas com early-exit quando a linha inteira já
 * excede `max` — barato para as distâncias pequenas (1–2) que usamos p/ correção de digitação.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) {
    return max + 1; // diferença de comprimento já força > max edições
  }
  let prev = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= la; i++) {
    const cur = new Array<number>(lb + 1);
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur[j] = v;
      if (v < rowMin) {
        rowMin = v;
      }
    }
    if (rowMin > max) {
      return max + 1; // nenhuma célula da linha ainda cabe no orçamento → sem chance
    }
    prev = cur;
  }
  return prev[lb] <= max ? prev[lb] : max + 1;
}

/**
 * Até `max` palavras do corpus dentro de edit-distance ≤ `maxDist` do `term` — para CORREÇÃO DE
 * DIGITAÇÃO ("eternidde" → "eternidade"). Ordena por (distância asc, frequência desc). Exige ≥3
 * letras (termos curtos ficam perto de tudo → ruído). Pré-filtra por comprimento (barato) antes do
 * Levenshtein. As palavras vêm do corpus da tradução buscada → sugerir uma SEMPRE retorna versículos.
 */
export function fuzzyMatches(wl: Wordlist, term: string, maxDist = 2, max = 6): string[] {
  const t = fold(term);
  if (t.length < 3) {
    return [];
  }
  const { keys, words } = wl;
  const hits: { word: string; dist: number; freq: number }[] = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (Math.abs(k.length - t.length) > maxDist || k === t) {
      continue; // pré-filtro por comprimento; iguais não são "typo" (já teriam casado)
    }
    const d = boundedLevenshtein(t, k, maxDist);
    if (d <= maxDist) {
      hits.push({ word: words[i][0], dist: d, freq: words[i][1] });
    }
  }
  hits.sort((a, b) => a.dist - b.dist || b.freq - a.freq);
  return hits.slice(0, max).map((h) => h.word);
}
