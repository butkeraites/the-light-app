// app/lib/studyScope.ts — Fase 2 (redesenho da IA: "Escopo de Estudo" multi-seleção)
//
// Lógica PURA do ESCOPO DE ESTUDO: um conjunto ORDENADO de TRECHOS. Cada trecho é uma faixa
// CONTÍGUA de versículos DENTRO de um capítulo (ou o capítulo inteiro). Isso permite juntar
// seleções de lugares diferentes (capítulos/livros distintos) num escopo só — a dor que o
// usuário relatou (escopo preso a 1 versículo). Cada trecho é expressável como UMA referência
// que o core `parse_reference` aceita (Single | Range intra-capítulo | WholeChapter), então o
// texto citado vem SEMPRE do store por essa referência, NUNCA do modelo (anti-alucinação).
//
// Sem I/O, sem `react` — testável headless (`test:web:study-scope`).
import type { ReadSpec } from './passageResolve';

/** Um trecho do escopo. `from/to` ausentes = CAPÍTULO INTEIRO; `from===to` = versículo único. */
export type ScopeChunk = ReadSpec; // { book, chapter, from?, to? }

/** Trecho = capítulo inteiro (sem faixa de versos)? */
export function isWholeChapter(c: ScopeChunk): boolean {
  return c.from == null && c.to == null;
}

/** Chave estável de um trecho (dedup/remoção). */
export function chunkKey(c: ScopeChunk): string {
  return `${c.book}:${c.chapter}:${c.from ?? '*'}-${c.to ?? '*'}`;
}

/** Dobra uma lista de versos (de UM capítulo) em trechos CONTÍGUOS ordenados. */
function coalesce(book: number, chapter: number, verses: number[]): ScopeChunk[] {
  const sorted = [...new Set(verses)].filter((v) => v > 0).sort((a, b) => a - b);
  const out: ScopeChunk[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const v of sorted) {
    if (start == null) {
      start = v;
      prev = v;
    } else if (v === (prev as number) + 1) {
      prev = v;
    } else {
      out.push({ book, chapter, from: start, to: prev as number });
      start = v;
      prev = v;
    }
  }
  if (start != null) out.push({ book, chapter, from: start, to: prev as number });
  return out;
}

/** Ordem canônica dos trechos: por livro, capítulo, e verso inicial (capítulo inteiro primeiro). */
function sortChunks(chunks: ScopeChunk[]): ScopeChunk[] {
  return [...chunks].sort(
    (a, b) => a.book - b.book || a.chapter - b.chapter || (a.from ?? 0) - (b.from ?? 0),
  );
}

/** Versos de UM capítulo já no escopo: `whole` (capítulo inteiro) ou o conjunto de versos acesos. */
export function versesForChapter(
  chunks: ScopeChunk[],
  book: number,
  chapter: number,
): { whole: boolean; verses: Set<number> } {
  const here = chunks.filter((c) => c.book === book && c.chapter === chapter);
  if (here.some(isWholeChapter)) {
    return { whole: true, verses: new Set() };
  }
  const verses = new Set<number>();
  for (const c of here) {
    if (c.from != null && c.to != null) {
      for (let v = c.from; v <= c.to; v++) verses.add(v);
    }
  }
  return { whole: false, verses };
}

/**
 * Alterna UM versículo no escopo (adiciona/remove), re-coalescendo os trechos daquele capítulo.
 * A edição por versículo SUPERA um trecho de capítulo-inteiro do mesmo capítulo (vira faixas
 * explícitas) — o usuário está refinando a seleção. Os demais capítulos/livros ficam intactos.
 */
export function toggleVerse(
  chunks: ScopeChunk[],
  book: number,
  chapter: number,
  verse: number,
): ScopeChunk[] {
  const others = chunks.filter((c) => !(c.book === book && c.chapter === chapter));
  const { verses } = versesForChapter(chunks, book, chapter);
  if (verses.has(verse)) verses.delete(verse);
  else verses.add(verse);
  return sortChunks([...others, ...coalesce(book, chapter, [...verses])]);
}

/**
 * Alterna o CAPÍTULO INTEIRO no escopo: se já há um trecho de capítulo-inteiro daquele capítulo,
 * remove; senão substitui as faixas explícitas daquele capítulo por um único trecho WholeChapter.
 */
export function toggleWholeChapter(chunks: ScopeChunk[], book: number, chapter: number): ScopeChunk[] {
  const here = chunks.filter((c) => c.book === book && c.chapter === chapter);
  const others = chunks.filter((c) => !(c.book === book && c.chapter === chapter));
  if (here.some(isWholeChapter)) {
    return sortChunks(others); // já estava inteiro → remove
  }
  return sortChunks([...others, { book, chapter }]); // vira capítulo inteiro
}

/** Remove um trecho pela chave. */
export function removeChunk(chunks: ScopeChunk[], key: string): ScopeChunk[] {
  return chunks.filter((c) => chunkKey(c) !== key);
}

/**
 * Referência CANÔNICA (EN) de um trecho, para a fronteira `parse_reference` do core:
 * capítulo inteiro → "John 3"; único → "John 3:16"; faixa → "John 3:16-18".
 * `bookNameEn` vem de `listBooks()` (store) — nunca sintetizado.
 */
export function chunkToReference(c: ScopeChunk, bookNameEn: string): string {
  if (isWholeChapter(c)) return `${bookNameEn} ${c.chapter}`;
  if (c.from === c.to) return `${bookNameEn} ${c.chapter}:${c.from}`;
  return `${bookNameEn} ${c.chapter}:${c.from}-${c.to}`;
}

/** Rótulo de EXIBIÇÃO (idioma da versão/UI) de um trecho — `bookLabel` = nome já resolvido do store. */
export function chunkLabel(c: ScopeChunk, bookLabel: string): string {
  if (isWholeChapter(c)) return `${bookLabel} ${c.chapter}`;
  if (c.from === c.to) return `${bookLabel} ${c.chapter}:${c.from}`;
  return `${bookLabel} ${c.chapter}:${c.from}–${c.to}`;
}

/** Nº de versículos EXPLÍCITOS no escopo (trechos de capítulo-inteiro não entram — contagem desconhecida). */
export function explicitVerseCount(chunks: ScopeChunk[]): number {
  let n = 0;
  for (const c of chunks) {
    if (c.from != null && c.to != null) n += c.to - c.from + 1;
  }
  return n;
}

/** O escopo reduz a UM único trecho? (→ uma chamada de IA CONJUNTA real, sem fan-out.) */
export function isSingleChunk(chunks: ScopeChunk[]): boolean {
  return chunks.length === 1;
}
