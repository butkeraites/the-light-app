// app/web/sqlite-xref.web.ts — F1.15 (ADR-0021; par de sqlite-search.web.ts)
//
// GLUE web do STORE de REFERÊNCIAS CRUZADAS (xref) (hand-written, VERSIONADO).
// Camada de INFRAESTRUTURA que roda a consulta de xref sobre o MESMO `wa-sqlite`/
// subset da leitura (F1.13, ADR-0019) / busca (F1.14, ADR-0020), ESPELHANDO o
// SELECT de xref do core (`the_light_core::xref::for_verse`, rev pinado `8f66004`):
// filtro `from_*` + `votes >= min_votes`, `ORDER BY votes DESC, …` e a montagem
// `VerseRange::Single`/`Range`. NÃO há ordenação/filtro/semântica reimplementados
// aqui: a ordem por votos (com os tiebreakers), o corte `votes >= ?` e o `LIMIT`
// (clamp ≥1) vivem no SQLite. Esta camada só monta o SQL idêntico ao do core, faz o
// bind dos params na MESMA ordem e compõe os Records `CrossRef` dos bindings.
//
// A xref é INDEPENDENTE de tradução (chaveada por `from_book/from_chapter/from_verse`),
// então — diferente de `getChapter`/`search` — NÃO há parâmetro `translation` nem
// checagem `has_translation`.
//
// Anti-alucinação: a xref é só REFERÊNCIA de destino + votos (NENHUM texto bíblico);
// as referências/votos vêm SEMPRE do store local (`wa-sqlite`), nunca hardcoded.
// Licença (ADR-0016): a atribuição CC-BY `Cross references courtesy of
// OpenBible.info (CC-BY)` é exibida pela UI (F1.9) sempre que xrefs aparecem.
//
// VFS-agnóstica (par exato de `sqlite-search.web.ts`): o backend de runtime no
// browser é OPFS (`openReadingDbWeb`, REUSADO da F1.13/F1.14 — sem recarregar o
// subset); a prova headless em node usa um VFS de memória sobre os MESMOS bytes do
// `assets/data/reading-sample.sqlite`. Ambos exercitam EXATAMENTE estas funções.
import * as SQLite from 'wa-sqlite';

import { VerseRange, type CrossRef, type Reference } from './generated/the_light_app_core';
import type { ReadingDb } from './sqlite-reading.web';

/** Limiar padrão de votos (espelha `xref::DEFAULT_MIN_VOTES = 1` do core). */
export const DEFAULT_MIN_VOTES = 1n;
/** Limite padrão de resultados (espelha `xref::DEFAULT_LIMIT = 20` do core). */
export const DEFAULT_LIMIT = 20;

/** Uma linha bruta de `cross_references` (apenas infra; o domínio é composto adiante). */
export interface CrossRefRow {
  toBook: number;
  toChapter: number;
  toVerseStart: number;
  toVerseEnd: number;
  /** Votos da comunidade (`votes`, i64 → bigint). */
  votes: bigint;
}

/**
 * SELECT espelhado de `the_light_core::xref::for_verse` (xref.rs, rev `8f66004`):
 *   "SELECT to_book, to_chapter, to_verse_start, to_verse_end, votes \
 *    FROM cross_references \
 *    WHERE from_book = ?1 AND from_chapter = ?2 AND from_verse = ?3 AND votes >= ?4 \
 *    ORDER BY votes DESC, to_book, to_chapter, to_verse_start \
 *    LIMIT ?5"
 * É a ÚNICA SQL de xref no web — infraestrutura, não domínio. Os tiebreakers
 * (`to_book, to_chapter, to_verse_start`) fazem PARTE do mirror (anti-drift): a
 * ordem e o filtro `votes >= ?` vêm do SQLite, NUNCA de TS.
 */
export const XREF_SELECT =
  'SELECT to_book, to_chapter, to_verse_start, to_verse_end, votes ' +
  'FROM cross_references ' +
  'WHERE from_book = ? AND from_chapter = ? AND from_verse = ? AND votes >= ? ' +
  'ORDER BY votes DESC, to_book, to_chapter, to_verse_start ' +
  'LIMIT ?';

/**
 * Roda o SELECT de xref (espelho de `xref::for_verse`) e devolve as linhas
 * `{ toBook, toChapter, toVerseStart, toVerseEnd, votes }` JÁ ordenadas por votos
 * DESC (com os tiebreakers), do SQLite. ISOLADA do VFS: funciona sobre o VFS OPFS
 * (browser) e o de memória (prova node). Bind na MESMA ordem do core: book, chapter,
 * verse (int), `min_votes` (int64/bigint), `limit` (int64). `limit` é clampado a
 * `>= 1` (espelha `limit.clamp(1, i64::MAX)` do core: evita LIMIT 0). NÃO ordena/
 * filtra em TS — tudo vem do SQL.
 */
export async function queryCrossRefs(
  handle: ReadingDb,
  book: number,
  chapter: number,
  verse: number,
  minVotes: bigint = DEFAULT_MIN_VOTES,
  limit: number = DEFAULT_LIMIT,
): Promise<CrossRefRow[]> {
  const { sqlite3, db } = handle;
  const clampedLimit = Math.max(1, Math.trunc(limit));
  const rows: CrossRefRow[] = [];
  for await (const stmt of sqlite3.statements(db, XREF_SELECT)) {
    let i = 1;
    sqlite3.bind(stmt, i++, book);
    sqlite3.bind(stmt, i++, chapter);
    sqlite3.bind(stmt, i++, verse);
    // `min_votes`/`limit` são i64 no core → bind como int64 (fiel ao contrato).
    sqlite3.bind_int64(stmt, i++, minVotes);
    sqlite3.bind_int64(stmt, i++, BigInt(clampedLimit));
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      rows.push({
        toBook: sqlite3.column_int(stmt, 0),
        toChapter: sqlite3.column_int(stmt, 1),
        toVerseStart: sqlite3.column_int(stmt, 2),
        toVerseEnd: sqlite3.column_int(stmt, 3),
        votes: sqlite3.column_int64(stmt, 4),
      });
    }
  }
  return rows;
}

/**
 * Referência de destino de uma xref (espelha a regra do core em `xref.rs`):
 * `if start >= end → VerseRange::Single(start)`, senão `VerseRange::Range{start,end}`.
 */
function targetReference(book: number, chapter: number, start: number, end: number): Reference {
  const verses =
    start >= end ? new VerseRange.Single({ verse: start }) : new VerseRange.Range({ start, end });
  return { book, chapter, verses };
}

/**
 * Compõe um `CrossRef` (do bindings) a partir de uma linha de `cross_references`.
 * Espelha o Record do core (`the_light_core::xref::CrossRef`): `reference` de
 * destino (Single|Range por `start >= end`) e `votes` (i64 → bigint).
 */
export function composeCrossRef(row: CrossRefRow): CrossRef {
  return {
    reference: targetReference(row.toBook, row.toChapter, row.toVerseStart, row.toVerseEnd),
    votes: row.votes,
  };
}

/**
 * Orquestra a XREF sobre um handle aberto (VFS-agnóstica) — o MESMO pipeline de
 * `core/src/lib.rs::cross_refs` + `xref::for_verse` (xref.rs):
 *   1) aplica os defaults do core (`min_votes ?? 1`, `limit ?? 20`);
 *   2) `queryCrossRefs(...)` (SELECT de xref do core; ordem por votos DESC do SQLite);
 *   3) compõe os `CrossRef` (Single|Range por `start >= end`).
 * SEM `has_translation` (xref independe de tradução). Versículo sem xref → `[]` (sem
 * throw). `reading.web.ts::crossRefs` apenas abre/fecha o store (REUSO de
 * `openReadingDbWeb`, F1.13/F1.14) ao redor desta função; a prova headless a exercita
 * sobre o VFS de memória.
 */
export async function crossRefsOnHandle(
  handle: ReadingDb,
  book: number,
  chapter: number,
  verse: number,
  minVotes?: bigint,
  limit?: number,
): Promise<CrossRef[]> {
  const rows = await queryCrossRefs(
    handle,
    book,
    chapter,
    verse,
    minVotes ?? DEFAULT_MIN_VOTES,
    limit ?? DEFAULT_LIMIT,
  );
  return rows.map(composeCrossRef);
}
