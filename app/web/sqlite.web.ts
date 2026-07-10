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
  passageQuery,
  VerseRange,
  VerseRange_Tags,
  type Passage,
  type Reference,
  type Verse,
} from './generated/the_light_app_core';
import { bindPlanParams } from './sqlite-reading.web';

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
 * EXECUTA o plano da passagem `Single` (`passageQuery` → `query::passage_plan`,
 * ADR-0062) no `wa-sqlite` e devolve as linhas `{ verse, text }`. ISOLADA do VFS
 * (OPFS no browser, memória na prova). O SQL e os params vêm do core — o web só liga.
 */
export async function queryPassage(
  handle: PassageDb,
  translationId: string,
  book: number,
  chapter: number,
  verse: number,
): Promise<PassageRow[]> {
  const { sqlite3, db } = handle;
  const { sql, params } = passageQuery(singleReference(book, chapter, verse), translationId);
  const rows: PassageRow[] = [];
  for await (const stmt of sqlite3.statements(db, sql)) {
    bindPlanParams(sqlite3, stmt, params);
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
