// app/web/sqlite.web.ts — F0.10 (ADR-0011/ADR-0012)
//
// GLUE web do STORE (hand-written, VERSIONADO). Camada de INFRAESTRUTURA que lê
// uma passagem de um banco `wa-sqlite` (SQLite em wasm), ESPELHANDO o SELECT de
// `the_light_core::source::EmbeddedSource::passage` (caso `Single`). NÃO há
// parsing de domínio aqui: a `Reference` (livro/capítulo/versículo) vem do RUST
// (wasm) via `reference.web.ts`; aqui só roda o SQL e compõe a `Passage`.
//
// Anti-alucinação: o TEXTO do versículo vem SEMPRE do store local (`wa-sqlite`),
// verbatim — nunca hardcoded no produto nem gerado por LLM.
//
// `queryPassage` é ISOLADA do VFS de propósito: o backend de runtime no browser é
// OPFS (F5.12/ADR-0041: a home REUSA o store de leitura `sqlite-reading-opfs.web`
// sobre o subset `reading-sample.sqlite`, via o build vendorado wa-sqlite+FTS5), e a
// prova headless em node usa um VFS de memória sobre os MESMOS bytes do subset.
// Ambos exercitam EXATAMENTE esta função (o mesmo SELECT `Single`).
import * as SQLite from 'wa-sqlite';

import {
  VerseRange,
  VerseRange_Tags,
  type Passage,
  type Reference,
  type Verse,
} from './generated/the_light_app_core';

/** Conexão `wa-sqlite` aberta: a API low-level + o ponteiro do banco. */
export interface PassageDb {
  /** API `wa-sqlite` (resultado de `SQLite.Factory(module)`). */
  sqlite3: SQLiteAPI;
  /** Ponteiro do banco aberto (`open_v2`). */
  db: number;
}

/** Uma linha bruta de `verses` (apenas infra; o domínio é composto adiante). */
export interface PassageRow {
  verse: number;
  text: string;
}

/**
 * SELECT espelhado de `EmbeddedSource::passage` (variante `Single`, fonte:
 * the-light-core/src/source/embedded.rs). É a ÚNICA SQL de leitura de passagem no
 * web — infraestrutura, não lógica de domínio.
 */
export const PASSAGE_SELECT_SINGLE =
  'SELECT verse, text FROM verses ' +
  'WHERE translation_id = ? AND book_number = ? AND chapter = ? AND verse = ? ' +
  'ORDER BY verse';

/**
 * Roda o SELECT espelhado (caso `Single`) no `wa-sqlite` e devolve as linhas
 * `{ verse, text }`. ISOLADA do VFS: funciona tanto sobre o VFS OPFS (browser)
 * quanto sobre o VFS de memória (prova node), pois ambos expõem a mesma API.
 */
export async function queryPassage(
  handle: PassageDb,
  translationId: string,
  book: number,
  chapter: number,
  verse: number,
): Promise<PassageRow[]> {
  const { sqlite3, db } = handle;
  const rows: PassageRow[] = [];
  for await (const stmt of sqlite3.statements(db, PASSAGE_SELECT_SINGLE)) {
    sqlite3.bind(stmt, 1, translationId);
    sqlite3.bind(stmt, 2, book);
    sqlite3.bind(stmt, 3, chapter);
    sqlite3.bind(stmt, 4, verse);
    // `step` resolve para SQLITE_ROW/SQLITE_DONE (Promise no build async, valor
    // no build sync); `await` cobre os dois casos.
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      rows.push({
        verse: sqlite3.column_int(stmt, 0),
        text: sqlite3.column_text(stmt, 1),
      });
    }
  }
  return rows;
}

/** Referência de um único versículo (espelha `Reference::single` do core). */
function singleReference(book: number, chapter: number, verse: number): Reference {
  return { book, chapter, verses: new VerseRange.Single({ verse }) };
}

/**
 * Compõe a `Passage` a partir da `Reference` (RUST) + as linhas lidas do store
 * (TEXTO do `wa-sqlite`). Pura: não toca o VFS nem o wasm. Espelha o laço de
 * `EmbeddedSource::passage` que monta `Verse { reference, text, translation }`.
 */
export function composePassage(
  reference: Reference,
  rows: PassageRow[],
  translation: string,
): Passage {
  const verses: Verse[] = rows.map((row) => ({
    reference: singleReference(reference.book, reference.chapter, row.verse),
    text: row.text,
    translation,
  }));
  return { reference, verses };
}

/**
 * Lê a passagem de um único versículo do store (`wa-sqlite`) e compõe a
 * `Passage`. É o núcleo VFS-AGNÓSTICO compartilhado por `getPassage` (browser,
 * VFS OPFS) e pela prova headless (node, VFS de memória).
 */
export async function readPassage(
  handle: PassageDb,
  reference: Reference,
  translation: string,
): Promise<Passage> {
  if (reference.verses.tag !== VerseRange_Tags.Single) {
    throw new Error(
      'Store web (F0.10) suporta apenas referência de versículo único (ex.: "João 3:16").',
    );
  }
  const verse = reference.verses.inner.verse;
  const rows = await queryPassage(handle, translation, reference.book, reference.chapter, verse);
  return composePassage(reference, rows, translation);
}
