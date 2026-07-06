// app/lib/passageQuery.ts — ADR-0065 (lookup de passagem: ranges + listas)
//
// TOKENIZADOR/CLASSIFICADOR PURO da consulta de passagem da home. O core (pinado) só parseia UMA
// referência (verso único / range de versos NUM capítulo / capítulo inteiro; separadores `:`/`.`
// e `-`). Aqui, 100% APP-SIDE, quebramos a entrada em ITENS (lista por `;`/`,`/quebra-de-linha) e
// classificamos cada um numa FORMA que o resolvedor expande em leituras atômicas de capítulo:
//   • ref          — o core resolve (single / range-no-capítulo / capítulo inteiro), incl. erro;
//   • chapterRange — "João 3-4";
//   • crossChapter — "João 3:16-4:2";
//   • bookRange    — "Gênesis-Êxodo" (dois nomes de livro);
//   • wholeBook    — "Gênesis" (nome de livro sozinho);
//   • invalid      — não reconhecido.
// Aceita `-` e travessão `–`; `:`/`.` para cap:verso. Token de livro = padrão do core
// (`[123]?\p{L}[\p{L}\p{M}.\s]*`). SEM I/O — a resolução de nome de livro/leitura é do resolvedor.
//
// ANTI-ALUCINAÇÃO: isto tokeniza a CONSULTA do usuário; não toca texto bíblico (verbatim do store).

/** Item classificado de uma consulta de passagem. */
export type QueryItem =
  | { kind: 'ref'; text: string }
  | { kind: 'chapterRange'; book: string; from: number; to: number }
  | { kind: 'crossChapter'; book: string; fromCh: number; fromV: number; toCh: number; toV: number }
  | { kind: 'bookRange'; fromBook: string; toBook: string }
  | { kind: 'wholeBook'; book: string }
  | { kind: 'invalid'; text: string };

const BOOK = '([123]?\\s*\\p{L}[\\p{L}\\p{M}.\\s]*?)';
const DASH = '\\s*[-–]\\s*'; // hífen ou travessão
const SEP = '\\s*[:.]\\s*';
const N = '(\\d+)';

// Ordem IMPORTA: do mais específico ao mais geral.
const RE_CROSS = new RegExp(`^${BOOK}\\s+${N}${SEP}${N}${DASH}${N}${SEP}${N}\\s*$`, 'u');
const RE_CHAPTER_RANGE = new RegExp(`^${BOOK}\\s+${N}${DASH}${N}\\s*$`, 'u');
const RE_BOOK_RANGE = new RegExp(`^${BOOK}${DASH}([123]?\\s*\\p{L}[\\p{L}\\p{M}.\\s]*?)\\s*$`, 'u');
const RE_WHOLE_BOOK = new RegExp(`^[123]?\\s*\\p{L}[\\p{L}\\p{M}.\\s]*?\\s*$`, 'u'); // sem dígitos

function clean(book: string): string {
  return book.trim().replace(/\s+/g, ' ');
}

/** Classifica UM item (já trimado). PURO. */
export function classifyItem(raw: string): QueryItem {
  const item = raw.trim();
  if (item.length === 0) {
    return { kind: 'invalid', text: raw };
  }

  const cross = RE_CROSS.exec(item);
  if (cross) {
    return {
      kind: 'crossChapter',
      book: clean(cross[1]),
      fromCh: Number(cross[2]),
      fromV: Number(cross[3]),
      toCh: Number(cross[4]),
      toV: Number(cross[5]),
    };
  }

  const chRange = RE_CHAPTER_RANGE.exec(item);
  if (chRange) {
    return { kind: 'chapterRange', book: clean(chRange[1]), from: Number(chRange[2]), to: Number(chRange[3]) };
  }

  // bookRange só quando NENHUM lado tem dígito (dois nomes de livro).
  if (!/\d/.test(item)) {
    const bookRange = RE_BOOK_RANGE.exec(item);
    if (bookRange) {
      return { kind: 'bookRange', fromBook: clean(bookRange[1]), toBook: clean(bookRange[2]) };
    }
    if (RE_WHOLE_BOOK.test(item)) {
      return { kind: 'wholeBook', book: clean(item) };
    }
    return { kind: 'invalid', text: item };
  }

  // Tem dígito e não é range de capítulo/cross → deixa o core resolver (single/range/cap inteiro).
  return { kind: 'ref', text: item };
}

/** Quebra a entrada em itens (lista por `;`/`,`/nova linha) e classifica cada um. PURO. */
export function parsePassageQuery(input: string): QueryItem[] {
  return input
    .split(/[;,\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(classifyItem);
}
