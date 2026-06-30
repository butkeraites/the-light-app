// app/web/sqlite-search.web.ts — F1.14 (ADR-0020; par de sqlite-reading.web.ts)
//
// GLUE web do STORE de BUSCA (hand-written, VERSIONADO). Camada de
// INFRAESTRUTURA que roda a BUSCA full-text (FTS5) sobre o MESMO `wa-sqlite`/
// subset da leitura (F1.13, ADR-0019), ESPELHANDO o SELECT de busca do core
// (`the_light_core::search::search`, rev pinado `8f66004`) — `verses_fts MATCH`,
// `bm25(...)` (ranking) e `highlight(...)` (destaque). NÃO há ranqueamento nem
// semântica reimplementados aqui: o índice FTS5, o BM25 e o highlight vivem no
// SQLite (FTS5 habilitado no wa-sqlite via ADR-0020). Esta camada só monta o SQL
// idêntico ao do core, faz o bind dos params na MESMA ordem e compõe os Records
// `SearchHit` dos bindings.
//
// Anti-alucinação: o TEXTO/snippet vem SEMPRE do store local (`wa-sqlite`),
// verbatim. Os marcadores de destaque (U+0002/U+0003) vêm do `highlight(...)` do
// FTS5 — nunca são exibidos crus (a UI da F1.6 os converte em estilo via
// `app/lib/highlight.ts`).
//
// VFS-agnóstica (par exato de `sqlite-reading.web.ts`): o backend de runtime no
// browser é OPFS (`openReadingDbWeb`, REUSADO da F1.13 — sem recarregar o
// subset); a prova headless em node usa um VFS de memória sobre os MESMOS bytes
// do `assets/data/reading-sample.sqlite`. Ambos exercitam EXATAMENTE estas funções.
import * as SQLite from 'wa-sqlite';

import { HL_END, HL_START } from '../lib/highlight';
import { VerseRange, type Reference, type SearchHit } from './generated/the_light_app_core';
import { hasTranslation, type ReadingDb } from './sqlite-reading.web';

/** Limite padrão de resultados (espelha `search::DEFAULT_LIMIT = 20` do core). */
export const DEFAULT_LIMIT = 20;

/** Uma linha bruta da busca (apenas infra; o domínio é composto adiante). */
export interface SearchRow {
  book: number;
  chapter: number;
  verse: number;
  /** Texto VERBATIM do versículo (`v.text`, sem marcadores). */
  text: string;
  /** Texto com os termos casados envolvidos por HL_START/HL_END (`highlight(...)`). */
  highlighted: string;
  /** Pontuação BM25 (`bm25(verses_fts)`; menor = mais relevante). */
  score: number;
}

/**
 * SELECT espelhado de `the_light_core::search::search` (search.rs, rev `8f66004`):
 *   "SELECT v.book_number, v.chapter, v.verse, v.text, \
 *    highlight(verses_fts, 0, ?, ?) AS hl, bm25(verses_fts) AS score \
 *    FROM verses_fts JOIN verses v ON v.id = verses_fts.verse_id \
 *    WHERE verses_fts MATCH ? AND verses_fts.translation_id = ?"
 * O filtro opcional de livro (`AND v.book_number = ?`) e o `ORDER BY score LIMIT ?`
 * são anexados em runtime, idênticos ao core. É a ÚNICA SQL de busca no web —
 * infraestrutura, não domínio (ranking/destaque são do FTS5, não de TS).
 */
export const SEARCH_SELECT_BASE =
  'SELECT v.book_number, v.chapter, v.verse, v.text, ' +
  'highlight(verses_fts, 0, ?, ?) AS hl, bm25(verses_fts) AS score ' +
  'FROM verses_fts JOIN verses v ON v.id = verses_fts.verse_id ' +
  'WHERE verses_fts MATCH ? AND verses_fts.translation_id = ?';

/**
 * Espelha `the_light_core::search::build_match_query` (search.rs): divide a query
 * por espaços, envolve CADA palavra em aspas (escapando `"` interna → `""`) e
 * junta por espaço (AND implícito do FTS5). Sem termo utilizável (vazia/só
 * espaços) → `null` (o chamador devolve `[]` sem erro). É INFRA (anti-injeção
 * FTS5 + semântica AND), NÃO ranqueamento — mirror obrigatório p/ paridade e p/
 * impedir injeção de sintaxe FTS5.
 */
export function buildMatchQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, '""')}"`);
  return terms.length === 0 ? null : terms.join(' ');
}

/**
 * Roda o SELECT de busca (espelho de `search::search`) e devolve as linhas
 * `{ book, chapter, verse, text, highlighted, score }` JÁ ordenadas por `score`
 * (BM25, do SQLite). ISOLADA do VFS: funciona sobre o VFS OPFS (browser) e o de
 * memória (prova node). Bind na MESMA ordem do core: HL_START, HL_END, match_query,
 * translation, [book], limit. `limit` é clampado a `>= 1` (espelha o clamp do core
 * `[1, i64::MAX]`: evita LIMIT 0).
 */
export async function querySearch(
  handle: ReadingDb,
  matchQuery: string,
  translation: string,
  book?: number,
  limit: number = DEFAULT_LIMIT,
): Promise<SearchRow[]> {
  const { sqlite3, db } = handle;
  let sql = SEARCH_SELECT_BASE;
  if (book !== undefined) {
    sql += ' AND v.book_number = ?';
  }
  sql += ' ORDER BY score LIMIT ?';

  const clampedLimit = Math.max(1, Math.trunc(limit));
  const rows: SearchRow[] = [];
  for await (const stmt of sqlite3.statements(db, sql)) {
    let i = 1;
    sqlite3.bind(stmt, i++, HL_START);
    sqlite3.bind(stmt, i++, HL_END);
    sqlite3.bind(stmt, i++, matchQuery);
    sqlite3.bind(stmt, i++, translation);
    if (book !== undefined) {
      sqlite3.bind(stmt, i++, book);
    }
    sqlite3.bind(stmt, i++, clampedLimit);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      rows.push({
        book: sqlite3.column_int(stmt, 0),
        chapter: sqlite3.column_int(stmt, 1),
        verse: sqlite3.column_int(stmt, 2),
        text: sqlite3.column_text(stmt, 3),
        highlighted: sqlite3.column_text(stmt, 4),
        score: sqlite3.column_double(stmt, 5),
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
 * Compõe um `SearchHit` (do bindings) a partir de uma linha da busca. Espelha o
 * Record do core (`core/src/lib.rs::SearchHit`): `reference` Single, `translation`,
 * `text` VERBATIM (limpo), `highlighted` (com U+0002/U+0003) e `score` (BM25).
 */
export function composeSearchHit(row: SearchRow, translation: string): SearchHit {
  return {
    reference: singleReference(row.book, row.chapter, row.verse),
    translation,
    text: row.text,
    highlighted: row.highlighted,
    score: row.score,
  };
}

/**
 * Orquestra a BUSCA sobre um handle aberto (VFS-agnóstica) — o MESMO pipeline do
 * `EmbeddedSource::search` (embedded.rs) + `search::search` (search.rs):
 *   1) checa `has_translation` ANTES → tradução ausente lança (espelha
 *      `SourceError::UnknownTranslation` → `CoreError`), ≠ "vazio";
 *   2) `build_match_query(query)` → `null` (vazia/só-espaços) ⇒ `[]` SEM erro;
 *   3) `querySearch(...)` (SELECT FTS5 do core) com `limit` default 20;
 *   4) compõe os `SearchHit` (ordem por `score` BM25 preservada do SQLite).
 * `reading.web.ts::search` apenas abre/fecha o store (REUSO de `openReadingDbWeb`,
 * F1.13) ao redor desta função; a prova headless a exercita sobre o VFS de memória.
 */
export async function searchOnHandle(
  handle: ReadingDb,
  query: string,
  translation: string,
  book?: number,
  limit?: number,
): Promise<SearchHit[]> {
  if (!(await hasTranslation(handle, translation))) {
    // Espelha `SourceError::UnknownTranslation` ("versão desconhecida: {id}") que a
    // fronteira nativa propaga como `CoreError` — checado ANTES do SQL de busca.
    throw new Error(`versão desconhecida: ${translation}`);
  }
  const matchQuery = buildMatchQuery(query);
  if (matchQuery === null) {
    return [];
  }
  const rows = await querySearch(handle, matchQuery, translation, book, limit ?? DEFAULT_LIMIT);
  return rows.map((row) => composeSearchHit(row, translation));
}
