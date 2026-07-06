// app/lib/searchReferenceSuggest.ts — ADR-0064 (busca inteligente)
//
// AUTOCOMPLETE de REFERÊNCIA a partir do CÂNON (66 livros, `listBooks()` — puro, offline). Ao
// digitar um único token que prefixa o nome/abreviação de um livro ("efé" → Efésios), sugere o
// livro (rótulo no idioma da UI) para abrir a leitura. Multi-palavra é tratado como BUSCA de
// texto (sem sugestão de livro), para não competir com a consulta full-text.
//
// PURO (recebe a lista de livros + locale; sem I/O). Casa por forma DOBRADA (acento-insensível),
// como o `parse_reference` do core. A DETECÇÃO de referência COMPLETA ("João 3") fica na tela,
// via a fronteira `parseReference` (async) — aqui é só o completar de NOME de livro.
//
// ANTI-ALUCINAÇÃO: os nomes vêm do STORE/cânon (namePt/nameEn), nunca traduzidos por `t()`; o
// `locale` só ESCOLHE o campo. Nenhum texto bíblico é tocado.

import { fold } from './searchNormalize';
import type { Book } from '../web/reading';
import type { SearchLocale } from './searchSynonyms';

/** Sugestão de livro para abrir na leitura. */
export type BookSuggestion = { book: number; label: string };

/** Nome de exibição do livro no idioma da UI (namePt/nameEn — do store, nunca `t()`). */
function label(book: Book, locale: SearchLocale): string {
  return locale === 'en' ? book.nameEn : book.namePt;
}

/**
 * Sugestões de LIVRO cujo nome/abreviação (PT+EN) começa com a consulta dobrada. Só para
 * consultas de UM token com ≥2 letras (multi-palavra = busca de texto → `[]`). Prioriza casamento
 * por NOME sobre abreviação e nomes mais curtos; DEDUP por livro; corta em `max` (default 5).
 */
export function suggestBooks(
  query: string,
  books: Book[],
  locale: SearchLocale,
  max = 5,
): BookSuggestion[] {
  const q = fold(query);
  if (q.length < 2 || /\s/.test(query.trim())) {
    return [];
  }
  type Scored = { book: Book; rank: number };
  const hits: Scored[] = [];
  for (const b of books) {
    const name = fold(locale === 'en' ? b.nameEn : b.namePt);
    const altName = fold(locale === 'en' ? b.namePt : b.nameEn);
    const abbr = fold(b.abbrevPt);
    const abbrEn = fold(b.abbrevEn);
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (altName.startsWith(q)) rank = 1;
    else if (abbr === q || abbrEn === q) rank = 2;
    else if (abbr.startsWith(q) || abbrEn.startsWith(q)) rank = 3;
    if (rank >= 0) {
      hits.push({ book: b, rank });
    }
  }
  hits.sort((a, z) => a.rank - z.rank || a.book.number - z.book.number);
  return hits.slice(0, max).map((h) => ({ book: h.book.number, label: label(h.book, locale) }));
}
