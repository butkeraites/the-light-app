// app/web/sqlite-reading.web.ts — F1.13 (ADR-0018/ADR-0019; molde F0.10 ADR-0011/0012)
//
// GLUE web do STORE de LEITURA (hand-written, VERSIONADO). Camada de
// INFRAESTRUTURA que lê CAPÍTULOS/TRADUÇÕES de um banco `wa-sqlite` (SQLite em
// wasm) ESPELHANDO os SELECTs da fronteira nativa de leitura (F1.2), que apenas
// delega a `the_light_core::source::EmbeddedSource`. NÃO há lógica de domínio
// aqui (sem parsing/cânon/ranqueamento): só roda o SQL de leitura e compõe os
// Records `Passage`/`Verse`/`Translation` dos bindings. O cânon (livros) vem do
// RUST (wasm) via `reading.web.ts::listBooks`.
//
// Anti-alucinação: o TEXTO do versículo vem SEMPRE do store local (`wa-sqlite`),
// verbatim — nunca hardcoded no produto nem gerado por LLM.
//
// As funções são ISOLADAS do VFS de propósito (par exato de `sqlite.web.ts`): o
// backend de runtime no browser é OPFS (ver `sqlite-reading-opfs.web.ts`), e a
// prova headless em node usa um VFS de memória sobre os MESMOS bytes do
// `assets/data/reading-sample.sqlite`. Ambos exercitam EXATAMENTE estas funções.
import * as SQLite from 'wa-sqlite';

import { VerseRange, type Passage, type Reference, type Translation, type Verse } from './generated/the_light_app_core';
import type { PassageDb } from './sqlite.web';

/**
 * Conexão `wa-sqlite` aberta (API low-level + ponteiro do banco). Reusa a forma
 * de `PassageDb` (mesmo handle de infra) — o store de leitura é o mesmo backend.
 */
export type ReadingDb = PassageDb;

/** Uma linha bruta de `verses` (apenas infra; o domínio é composto adiante). */
export interface ChapterRow {
  verse: number;
  text: string;
}

/**
 * SELECT espelhado de `EmbeddedSource::passage`, variante `VerseRange::WholeChapter`
 * (a fronteira nativa usa `Reference::whole_chapter(book, chapter)`). Fonte
 * (the-light-core/src/source/embedded.rs):
 *   "SELECT verse, text FROM verses \
 *    WHERE translation_id = ?1 AND book_number = ?2 AND chapter = ?3 \
 *    ORDER BY verse"
 * É a ÚNICA SQL de leitura de capítulo no web — infraestrutura, não domínio.
 */
export const CHAPTER_SELECT_WHOLE =
  'SELECT verse, text FROM verses ' +
  'WHERE translation_id = ? AND book_number = ? AND chapter = ? ' +
  'ORDER BY verse';

/**
 * SELECT espelhado de `EmbeddedSource::chapter_count`. Fonte (embedded.rs):
 *   "SELECT max(chapter) FROM verses WHERE translation_id = ?1 AND book_number = ?2"
 * `max(chapter)` é `NULL` quando o livro/tradução não tem versículos → 0 (idêntico
 * a `max.unwrap_or(0)` do core).
 */
export const CHAPTER_COUNT_SELECT =
  'SELECT max(chapter) FROM verses WHERE translation_id = ? AND book_number = ?';

/**
 * SELECT espelhado de `EmbeddedSource::translations`. Fonte (embedded.rs):
 *   "SELECT id, abbrev, name, language, license, embeddable \
 *    FROM translations ORDER BY language, id"
 * A ordenação (en antes de pt; `kjv` antes de `alm1911`) vem do SQLite — nunca de
 * TS. `embeddable` é `int`; mapeia para `embeddable != 0` (igual ao core).
 */
export const TRANSLATIONS_SELECT =
  'SELECT id, abbrev, name, language, license, embeddable ' +
  'FROM translations ORDER BY language, id';

/**
 * SELECT espelhado de `EmbeddedSource::has_translation`. Fonte (embedded.rs):
 *   "SELECT 1 FROM translations WHERE id = ?1"
 * O core checa isto ANTES de `passage`; tradução ausente → `UnknownTranslation`.
 */
export const HAS_TRANSLATION_SELECT = 'SELECT 1 FROM translations WHERE id = ?';

/**
 * Roda o SELECT de capítulo inteiro (espelho de `EmbeddedSource::passage` /
 * `WholeChapter`) e devolve as linhas `{ verse, text }` em ordem canônica.
 * ISOLADA do VFS: funciona sobre o VFS OPFS (browser) e o de memória (prova node).
 */
export async function queryChapter(
  handle: ReadingDb,
  translationId: string,
  book: number,
  chapter: number,
): Promise<ChapterRow[]> {
  const { sqlite3, db } = handle;
  const rows: ChapterRow[] = [];
  for await (const stmt of sqlite3.statements(db, CHAPTER_SELECT_WHOLE)) {
    sqlite3.bind(stmt, 1, translationId);
    sqlite3.bind(stmt, 2, book);
    sqlite3.bind(stmt, 3, chapter);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      rows.push({
        verse: sqlite3.column_int(stmt, 0),
        text: sqlite3.column_text(stmt, 1),
      });
    }
  }
  return rows;
}

/**
 * Roda o SELECT `max(chapter)` (espelho de `EmbeddedSource::chapter_count`) e
 * devolve o número de capítulos PRESENTES no store. `max(chapter)` `NULL` (livro/
 * tradução ausente) → 0 (`column_int` lê NULL como 0, idêntico a `unwrap_or(0)`).
 */
export async function queryChapterCount(
  handle: ReadingDb,
  translationId: string,
  book: number,
): Promise<number> {
  const { sqlite3, db } = handle;
  let count = 0;
  for await (const stmt of sqlite3.statements(db, CHAPTER_COUNT_SELECT)) {
    sqlite3.bind(stmt, 1, translationId);
    sqlite3.bind(stmt, 2, book);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      count = sqlite3.column_int(stmt, 0);
    }
  }
  return count;
}

/**
 * Roda o SELECT de traduções (espelho de `EmbeddedSource::translations`) e compõe
 * os Records `Translation`. A ordem vem do SQLite (`ORDER BY language, id`); o
 * mapeamento `embeddable != 0` espelha o core (sem lógica em TS).
 */
export async function queryTranslations(handle: ReadingDb): Promise<Translation[]> {
  const { sqlite3, db } = handle;
  const rows: Translation[] = [];
  for await (const stmt of sqlite3.statements(db, TRANSLATIONS_SELECT)) {
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      rows.push({
        id: sqlite3.column_text(stmt, 0),
        abbrev: sqlite3.column_text(stmt, 1),
        name: sqlite3.column_text(stmt, 2),
        language: sqlite3.column_text(stmt, 3),
        license: sqlite3.column_text(stmt, 4),
        embeddable: sqlite3.column_int(stmt, 5) !== 0,
      });
    }
  }
  return rows;
}

/**
 * Espelha `EmbeddedSource::has_translation`: `true` se `id` existe em
 * `translations`. O core o chama ANTES de ler a passagem (ver `getChapter`).
 */
export async function hasTranslation(handle: ReadingDb, id: string): Promise<boolean> {
  const { sqlite3, db } = handle;
  let found = false;
  for await (const stmt of sqlite3.statements(db, HAS_TRANSLATION_SELECT)) {
    sqlite3.bind(stmt, 1, id);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      found = true;
    }
  }
  return found;
}

/** Referência de capítulo inteiro (espelha `Reference::whole_chapter` do core). */
function wholeChapterReference(book: number, chapter: number): Reference {
  return { book, chapter, verses: new VerseRange.WholeChapter() };
}

/** Referência de um único versículo (espelha `Reference::single` do core). */
function singleReference(book: number, chapter: number, verse: number): Reference {
  return { book, chapter, verses: new VerseRange.Single({ verse }) };
}

/**
 * Compõe a `Passage` de um capítulo a partir das linhas lidas do store (TEXTO do
 * `wa-sqlite`). Pura: não toca o VFS nem o wasm. Espelha `EmbeddedSource::passage`:
 * a `Passage` carrega a referência `WholeChapter`; cada `Verse` carrega a
 * referência `Single` do seu versículo, com `text` verbatim e a `translation`.
 */
export function composeChapterPassage(
  book: number,
  chapter: number,
  rows: ChapterRow[],
  translation: string,
): Passage {
  const verses: Verse[] = rows.map((row) => ({
    reference: singleReference(book, chapter, row.verse),
    text: row.text,
    translation,
  }));
  return { reference: wholeChapterReference(book, chapter), verses };
}
