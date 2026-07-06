// app/lib/searchStopwords.ts — ADR-0064 (busca inteligente)
//
// Palavras-função (stopwords) PT+EN e extração de TERMOS SIGNIFICATIVOS de uma consulta.
// Motiva o "did you mean": a busca do core é AND palavra-a-palavra, então "armadura do
// espírito" exige as 3 numa só passagem (→ 0). Descartando a conectiva "do" e propondo os
// termos de conteúdo ("armadura", "espírito"), o usuário reencontra Efésios 6:11.
//
// PURO (sem react-native/I/O). Comparação por `fold` (acento/caixa-insensível). Devolve os
// tokens ORIGINAIS (com acento/caixa) para exibição; a filtragem é feita na forma dobrada.

import { fold, trimEdges } from './searchNormalize';

/**
 * Conjunto conservador de conectivas PT+EN (na forma DOBRADA — sem acento, minúsculas). Só
 * palavras-função de alta frequência; nada de conteúdo teológico. Tokens de 1 letra já caem
 * pela regra de tamanho, então aqui ficam só as de ≥2 letras.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // PT
  'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'um', 'uma', 'uns', 'umas',
  'ao', 'aos', 'as', 'os', 'para', 'por', 'com', 'que', 'se', 'ou', 'seu', 'sua', 'seus', 'suas',
  'meu', 'minha', 'este', 'esta', 'esse', 'essa', 'sao', 'foi',
  // EN
  'the', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'that', 'is', 'are', 'be',
  'as', 'at', 'by', 'this', 'his', 'her', 'my', 'your', 'it', 'was', 'were', 'from', 'not',
]);

/** True se `word` (qualquer caixa/acento) é uma conectiva. */
export function isStopword(word: string): boolean {
  return STOPWORDS.has(fold(word));
}

/**
 * Termos SIGNIFICATIVOS de uma consulta: tokeniza por espaço, apara pontuação de borda, descarta
 * conectivas e tokens < 2 letras, e DEDUP por forma dobrada — preservando a 1ª grafia (exibição)
 * e a ORDEM. Ex.: "a armadura do Espírito" → ["armadura", "Espírito"].
 */
export function significantTerms(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of query.trim().split(/\s+/)) {
    const tok = trimEdges(raw);
    const key = fold(tok);
    if (key.length < 2 || STOPWORDS.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(tok);
  }
  return out;
}
