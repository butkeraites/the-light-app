// app/web/reading.ts — F1.3 (ADR-0014)
//
// GLUE NATIVO de LEITURA (hand-written, VERSIONADO). Delega à fronteira UniFFI
// (F1.2) exposta pelo Turbo Module GERADO (JSI → the-light-core): listBooks,
// listTranslations, getChapter, chapterCount. NÃO reimplementa SQL/leitura em TS:
// o cânon, o store e o texto vêm do Rust (uma fonte da verdade; anti-alucinação —
// o texto do versículo é verbatim do store local). Resolução por extensão do
// Metro: este `.ts` vale no NATIVO; no web vale `reading.web.ts` (stub = F1.13).
//
// `./native-generated/src/index` é o barrel gerado do Turbo Module (instala o
// crate Rust no runtime JSI na importação e reexporta os bindings UniFFI).
import {
  listBooks as listBooksNative,
  listTranslations as listTranslationsNative,
  getChapter as getChapterNative,
  chapterCount as chapterCountNative,
  search as searchNative,
  crossRefs as crossRefsNative,
} from './native-generated/src/index';
import type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
} from './native-generated/bindings/the_light_app_core';

export type { Book, Passage, Translation, SearchHit, CrossRef };

/** 66 livros canônicos (PURO — `reference::BOOKS`, independe do banco). */
export function listBooks(): Book[] {
  return listBooksNative();
}

/** Traduções presentes no store (`db_path`): ex.: KJV (en) e Almeida 1911 (pt). */
export async function listTranslations(dbPath: string): Promise<Translation[]> {
  return listTranslationsNative(dbPath);
}

/**
 * Capítulo inteiro numerado por versículo, do store local. O `text` de cada
 * versículo vem VERBATIM do store (anti-alucinação). Síncrono no JSI (o crate já
 * está instalado); embrulhado em Promise p/ assinatura uniforme com o web.
 */
export async function getChapter(
  dbPath: string,
  translation: string,
  book: number,
  chapter: number,
): Promise<Passage> {
  return getChapterNative(dbPath, translation, book, chapter);
}

/** Capítulos do livro PRESENTES no store (`max(chapter)`; 0 se ausente). */
export async function chapterCount(
  dbPath: string,
  translation: string,
  book: number,
): Promise<number> {
  return chapterCountNative(dbPath, translation, book);
}

/**
 * Busca full-text (FTS5/BM25, acento-insensível) no store local, delegando à
 * fronteira `search` da F1.5 (binding gerado → JSI → the_light_core::search).
 * NÃO reimplementa SQL/FTS/`MATCH`/`bm25`/`highlight` em TS: o índice, o ranking
 * e o destaque vivem no core; a UI só embrulha o retorno (uma fonte da verdade).
 * Cada `SearchHit` traz `text` VERBATIM do store (anti-alucinação) e `highlighted`
 * com os marcadores de controle do core ao redor do termo casado — a UI da F1.6
 * os converte em estilo. Síncrono no JSI; embrulhado em Promise p/ assinatura
 * uniforme com o web (stub = F1.14). `book`/`limit` opcionais (padrões do core).
 */
export async function search(
  dbPath: string,
  query: string,
  translation: string,
  book?: number,
  limit?: number,
): Promise<SearchHit[]> {
  return searchNative(dbPath, query, translation, book, limit);
}

/**
 * Referências cruzadas (xref) de um versículo, delegando à fronteira `cross_refs`
 * da F1.8 (binding gerado `crossRefs` → JSI → `the_light_core::xref::for_verse`).
 * NÃO reimplementa SQL/consulta/ordenação/filtro de votos em TS: a busca da tabela,
 * a ordenação por votos (DESC) e o corte por `min_votes`/`limit` vivem no core; a UI
 * (F1.9) só apresenta o `Vec<CrossRef>` retornado (uma fonte da verdade). Cada
 * `CrossRef` é só **referência** de destino + `votes` (anti-alucinação: nenhum texto
 * bíblico). `minVotes`/`limit` opcionais (padrões do core: `min_votes`=1 oculta
 * disputadas/negativas; `limit`=20). `votes` é `i64` no core → `bigint` no binding
 * (a UI/self-test formatam via `String(...)`, robusto a `number`/`bigint`). Versículo
 * sem xref → `Vec` vazio (não erro). Síncrono no JSI; embrulhado em Promise p/
 * assinatura uniforme com o web (stub = F1.15).
 */
export async function crossRefs(
  dbPath: string,
  book: number,
  chapter: number,
  verse: number,
  minVotes?: bigint,
  limit?: number,
): Promise<CrossRef[]> {
  return crossRefsNative(dbPath, book, chapter, verse, minVotes, limit);
}
