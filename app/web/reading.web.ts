// app/web/reading.web.ts — F1.13 (ADR-0018/ADR-0019) · F1.14 (ADR-0020: busca) ·
// F1.15 (ADR-0021: xref)
//
// GLUE web de LEITURA + BUSCA + XREF (hand-written, VERSIONADO). A paridade web lê
// do SUBSET `reading-sample.sqlite` (~4,4 MB; o MESMO que o nativo empacota,
// ADR-0014) via `wa-sqlite` (OPFS no browser / MemoryVFS na prova), ESPELHANDO os
// SELECTs da fronteira nativa (F1.2/F1.5/F1.8):
//   - `listBooks`        → cânon do RUST (wasm `listBooks`), SÍNCRONO (não relista à mão);
//   - `listTranslations` → `EmbeddedSource::translations` (queryTranslations);
//   - `getChapter`       → `has_translation` + `EmbeddedSource::passage`/WholeChapter
//                          (queryChapter + composeChapterPassage);
//   - `chapterCount`     → `EmbeddedSource::chapter_count` (queryChapterCount);
//   - `search`           → `EmbeddedSource::search` + `search::search` (FTS5: MATCH +
//                          bm25 + highlight), via `searchOnHandle` (sqlite-search.web);
//   - `crossRefs`        → `xref::for_verse` (filtro `from_*` + `votes >= min_votes`,
//                          `ORDER BY votes DESC, …`, `LIMIT`, montagem Single/Range),
//                          via `crossRefsOnHandle` (sqlite-xref.web).
// NÃO reimplementa parsing/cânon/ranqueamento/ordenação/lógica de domínio — só os
// SELECTs de leitura/busca/xref (infra) + composição dos Records (o índice
// FTS5/BM25/highlight e a ordem por votos vivem no SQLite, ADR-0020/0021).
// Anti-alucinação: o TEXTO vem SEMPRE do store local, verbatim; a xref é só
// referência+votos do store. Userdata segue stub (F1.16).
//
// As MESMAS telas React `app/app/read/**` (compartilhadas com o nativo `reading.ts`)
// passam a funcionar no browser só por este glue + `db.web.ts` (sentinela).
// Resolução por extensão do Metro: este `.web.ts` vale no web; no nativo vale
// `reading.ts` (Turbo Module → the-light-core).
import { listBooks as listBooksWasm } from './generated/index.web';
import type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
} from './generated/the_light_app_core';
import {
  composeChapterPassage,
  hasTranslation,
  queryChapter,
  queryChapterCount,
  queryTranslations,
} from './sqlite-reading.web';
import { searchOnHandle } from './sqlite-search.web';
import { crossRefsOnHandle } from './sqlite-xref.web';
import { openReadingDbWeb } from './sqlite-reading-opfs.web';

export type { Book, Passage, Translation, SearchHit, CrossRef, Note, Highlight };

// Notas/highlights no web (userdata sobre wa-sqlite/OPFS) = F1.16 (pós-gate F1.12).
// Até lá, o glue web de userdata é um stub que lança em runtime, mantendo `tsc`/build
// web verdes. O par nativo (`reading.ts`) grava/lê real via a fronteira `userdata`.
const WEB_NOTES_MSG =
  'notas/highlights web (userdata sobre wa-sqlite/OPFS) = F1.16; o userdata nativo usa o the_light_core::userdata via Turbo Module.';

/**
 * 66 livros canônicos (PURO — `reference::BOOKS`), do RUST (wasm). SÍNCRONO, como
 * o nativo: exige o wasm já inicializado (pré-aquecido por `useWasmReady()` no
 * `_layout.tsx`). NÃO relista os 66 à mão nem lê a tabela `books` (a fronteira nem
 * a usa) — uma fonte da verdade do cânon.
 */
export function listBooks(): Book[] {
  return listBooksWasm();
}

/**
 * Traduções presentes no subset (`reading-sample.sqlite`): KJV (en) e Almeida 1911
 * (pt). Espelha `EmbeddedSource::translations` (ordem do SQLite). `_dbPath` é aceito
 * por paridade de assinatura com o nativo; o store web abre o subset internamente.
 */
export async function listTranslations(_dbPath: string): Promise<Translation[]> {
  const handle = await openReadingDbWeb();
  try {
    return await queryTranslations(handle);
  } finally {
    await handle.close();
  }
}

/**
 * Capítulo inteiro numerado por versículo, do store local (subset). Espelha
 * `EmbeddedSource::passage` (variante `WholeChapter`): checa `has_translation`
 * ANTES (tradução ausente → mesma semântica do nativo: `UnknownTranslation`), lê
 * `SELECT verse, text …` e compõe a `Passage` (referência `WholeChapter`; cada
 * `Verse` com referência `Single` e `text` VERBATIM do store). O modo LADO A LADO
 * (F1.4) chama esta função 2× (uma por tradução), no próprio `[chapter].tsx`.
 */
export async function getChapter(
  _dbPath: string,
  translation: string,
  book: number,
  chapter: number,
): Promise<Passage> {
  const handle = await openReadingDbWeb();
  try {
    if (!(await hasTranslation(handle, translation))) {
      // Espelha `SourceError::UnknownTranslation` ("versão desconhecida: {id}")
      // que a fronteira nativa propaga como `CoreError` em `getChapter`.
      throw new Error(`versão desconhecida: ${translation}`);
    }
    const rows = await queryChapter(handle, translation, book, chapter);
    return composeChapterPassage(book, chapter, rows, translation);
  } finally {
    await handle.close();
  }
}

/**
 * Capítulos do livro PRESENTES no store (`max(chapter)`; 0 se livro/tradução
 * ausente). Espelha `EmbeddedSource::chapter_count` (DB-backed, ≠ o canônico de
 * `Book`). `_dbPath` aceito por paridade; o subset é aberto internamente.
 */
export async function chapterCount(
  _dbPath: string,
  translation: string,
  book: number,
): Promise<number> {
  const handle = await openReadingDbWeb();
  try {
    return await queryChapterCount(handle, translation, book);
  } finally {
    await handle.close();
  }
}

/**
 * Busca full-text (FTS5) sobre o subset local (`reading-sample.sqlite`), espelhando
 * `the_light_core::search::search` (MATCH + `bm25` + `highlight` + filtro de livro +
 * limite). REUSA o store da F1.13 (`openReadingDbWeb` — sem recarregar o subset) e
 * delega a `searchOnHandle`, que: checa `has_translation` ANTES (ausente → lança,
 * espelhando `UnknownTranslation` → `CoreError`, ≠ "vazio"); sanitiza a query
 * (`build_match_query` — anti-injeção/AND); query vazia/só-espaços → `[]` sem erro;
 * `limit` default 20. NENHUM ranqueamento/semântica é reimplementado em TS: o índice
 * FTS5, o BM25 e o destaque vivem no SQLite. `_dbPath` é aceito por paridade de
 * assinatura com o nativo; o store web abre o subset internamente.
 */
export async function search(
  _dbPath: string,
  query: string,
  translation: string,
  book?: number,
  limit?: number,
): Promise<SearchHit[]> {
  const handle = await openReadingDbWeb();
  try {
    return await searchOnHandle(handle, query, translation, book, limit);
  } finally {
    await handle.close();
  }
}

/**
 * Referências cruzadas (xref) de um versículo de ORIGEM, do store local (subset),
 * espelhando `the_light_core::xref::for_verse` (filtro `from_book/from_chapter/
 * from_verse` + `votes >= min_votes`, `ORDER BY votes DESC, to_book, to_chapter,
 * to_verse_start`, `LIMIT`, montagem `Single`/`Range` por `start >= end`). REUSA o
 * store da F1.13/F1.14 (`openReadingDbWeb` — sem recarregar o subset) e delega a
 * `crossRefsOnHandle`. A xref é INDEPENDENTE de tradução (sem `translation`/
 * `has_translation`). NENHUMA ordenação/filtro/semântica é reimplementada em TS: a
 * ordem por votos (com tiebreakers) e o corte `votes >= ?` vivem no SQLite.
 * Defaults do core: `minVotes ?? 1`, `limit ?? 20`. Versículo sem xref → `[]` (sem
 * throw). `_dbPath` é aceito por paridade de assinatura com o nativo; o store web
 * abre o subset internamente. Anti-alucinação: refs/votos vêm do store; a UI (F1.9)
 * exibe a atribuição CC-BY (ADR-0016) sempre que xrefs aparecem.
 */
export async function crossRefs(
  _dbPath: string,
  book: number,
  chapter: number,
  verse: number,
  minVotes?: bigint,
  limit?: number,
): Promise<CrossRef[]> {
  const handle = await openReadingDbWeb();
  try {
    return await crossRefsOnHandle(handle, book, chapter, verse, minVotes, limit);
  } finally {
    await handle.close();
  }
}

// ── USERDATA (notas/highlights) — STUB web (F1.16) ───────────────────────────
export async function putNote(_dataDir: string, _reference: string, _body: string): Promise<void> {
  throw new Error(WEB_NOTES_MSG);
}

export async function getNote(_dataDir: string, _reference: string): Promise<Note | undefined> {
  throw new Error(WEB_NOTES_MSG);
}

export async function deleteNote(_dataDir: string, _reference: string): Promise<boolean> {
  throw new Error(WEB_NOTES_MSG);
}

export async function listNotes(_dataDir: string): Promise<Note[]> {
  throw new Error(WEB_NOTES_MSG);
}

export async function addHighlight(
  _dataDir: string,
  _reference: string,
  _color: string,
  _tag?: string,
): Promise<void> {
  throw new Error(WEB_NOTES_MSG);
}

export async function removeHighlight(_dataDir: string, _reference: string): Promise<number> {
  throw new Error(WEB_NOTES_MSG);
}

export async function listHighlights(_dataDir: string): Promise<Highlight[]> {
  throw new Error(WEB_NOTES_MSG);
}
