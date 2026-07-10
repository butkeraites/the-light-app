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

import {
  buildMatchQuery as coreBuildMatchQuery,
  searchQuery,
  VerseRange,
  type Reference,
  type SearchHit,
  type SqlPlan,
} from './generated/the_light_app_core';
import { bindPlanParams, hasTranslation, type ReadingDb } from './sqlite-reading.web';

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
 * Builder de expressão FTS5 seguro — DELEGA a `build_match_query` da fronteira
 * (`the_light_core::query`, ADR-0062): divide por espaços, aspa cada termo (escapa
 * `"`→`""`, AND implícito), `null` se sem termo. Fonte única no core; o `?? null`
 * adapta o `Option<String>`→`string|null` do contrato antigo.
 */
export function buildMatchQuery(input: string): string | null {
  return coreBuildMatchQuery(input) ?? null;
}

/**
 * EXECUTA um plano de busca (`SqlPlan` de `search_query`, ADR-0062) e devolve as
 * linhas `{ book, chapter, verse, text, highlighted, score }` JÁ ordenadas por
 * `score` (BM25, do SQLite). ISOLADA do VFS (OPFS no browser, memória na prova). O
 * SQL, a ordem dos params (HL_START, HL_END, match_query, translation, [book], limit)
 * e o clamp de limite vêm todos do core — o web só liga e lê as colunas.
 */
export async function querySearch(handle: ReadingDb, plan: SqlPlan): Promise<SearchRow[]> {
  const { sqlite3, db } = handle;
  const rows: SearchRow[] = [];
  for await (const stmt of sqlite3.statements(db, plan.sql)) {
    bindPlanParams(sqlite3, stmt, plan.params);
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
  // O plano (build_match_query + SQL + params + clamp) vem do core; `undefined` = sem
  // termo utilizável ⇒ `[]` SEM erro (espelha `search_plan` → `None`).
  const plan = searchQuery(query, translation, book, limit ?? DEFAULT_LIMIT);
  if (plan === undefined) {
    return [];
  }
  const rows = await querySearch(handle, plan);
  return rows.map((row) => composeSearchHit(row, translation));
}
