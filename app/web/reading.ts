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
} from './native-generated/src/index';
import type { Book, Passage, Translation } from './native-generated/bindings/the_light_app_core';

export type { Book, Passage, Translation };

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
