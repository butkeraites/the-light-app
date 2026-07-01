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
// referência+votos do store.
//
// F1.16 (ADR-0022): USERDATA (notas/marcações) destubado — o I/O é reimplementado em
// TS sobre OPFS (`userdata-opfs.web.ts`) ESPELHANDO o formato em disco do core
// (`notes/<slug>.md` + `highlights.json`), pois o módulo `userdata` é nativo-only
// (`#[cfg(feature="embedded")]`) e NÃO entra no wasm (precedente ADR-0011). A
// referência é canonicalizada pelo WASM (`parseReference`), NÃO inventada em TS; o
// FORMATO vive em `userdata-fs.web.ts` (VFS-agnóstico). O corpo da nota é dado livre
// do usuário (anti-alucinação não se aplica ao corpo, igual ao nativo, ADR-0017).
//
// As MESMAS telas React `app/app/read/**` (compartilhadas com o nativo `reading.ts`)
// passam a funcionar no browser só por este glue + `db.web.ts`/`userdata.web.ts`
// (sentinelas). Resolução por extensão do Metro: este `.web.ts` vale no web; no
// nativo vale `reading.ts` (Turbo Module → the-light-core).
import { listBooks as listBooksWasm, parseReference } from './generated/index.web';
import type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
  AiAnswer,
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
import { askAnchoredOnHandle, type AiFetch } from './ai-anchored.web';
import {
  addHighlightFs,
  deleteNoteFs,
  getNoteFs,
  listHighlightsFs,
  listNotesFs,
  putNoteFs,
  removeHighlightFs,
} from './userdata-fs.web';
import { openUserDataWeb } from './userdata-opfs.web';

export type { Book, Passage, Translation, SearchHit, CrossRef, Note, Highlight, AiAnswer };

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

// ── USERDATA (notas/highlights) — F1.16 (ADR-0022) ───────────────────────────
// O I/O é reimplementado em TS sobre OPFS (`openUserDataWeb`) ESPELHANDO o formato
// em disco do core (slug `notes/<slug>.md` + `highlights.json`), pois o módulo
// `userdata` é nativo-only (NÃO entra no wasm — precedente ADR-0011). A referência
// de ENTRADA é resolvida por `parseReference` (WASM) ANTES do I/O — paridade com o
// `put_note`/`add_highlight` do core (parseia antes de gravar; ref inválida → erro,
// sem I/O). `_dataDir` é aceito por paridade de assinatura com o nativo; o store
// web abre o OPFS internamente (mesmo padrão de `getChapter`/`search`/`crossRefs`).

export async function putNote(_dataDir: string, reference: string, body: string): Promise<void> {
  const ref = parseReference(reference);
  const dir = await openUserDataWeb();
  await putNoteFs(dir, ref, body);
}

export async function getNote(_dataDir: string, reference: string): Promise<Note | undefined> {
  const ref = parseReference(reference);
  const dir = await openUserDataWeb();
  return getNoteFs(dir, ref);
}

export async function deleteNote(_dataDir: string, reference: string): Promise<boolean> {
  const ref = parseReference(reference);
  const dir = await openUserDataWeb();
  return deleteNoteFs(dir, ref);
}

export async function listNotes(_dataDir: string): Promise<Note[]> {
  const dir = await openUserDataWeb();
  return listNotesFs(dir);
}

export async function addHighlight(
  _dataDir: string,
  reference: string,
  color: string,
  tag?: string,
): Promise<void> {
  const ref = parseReference(reference);
  const dir = await openUserDataWeb();
  await addHighlightFs(dir, ref, color, tag);
}

export async function removeHighlight(_dataDir: string, reference: string): Promise<number> {
  const ref = parseReference(reference);
  const dir = await openUserDataWeb();
  return removeHighlightFs(dir, ref);
}

export async function listHighlights(_dataDir: string): Promise<Highlight[]> {
  const dir = await openUserDataWeb();
  return listHighlightsFs(dir);
}

// ── ESTUDO ASSISTIDO ANCORADO (ask) — F2.7b (ADR-0025) ───────────────────────
// DESTUBADO: paridade web de IA. O prompt/RAG/citação vêm do Rust `ai-pure` no wasm
// (`aiWebPrepare`/`aiWebFinalize`, ZERO drift nativo↔web) e o transporte é `fetch` ao
// provedor (MVP = Gemini), delegado ao pipeline puro `askAnchoredOnHandle`
// (`ai-anchored.web.ts`). Aqui só abrimos o store web (subset F1.13, de onde sai o
// `cited_text` VERBATIM) e passamos o `globalThis.fetch`. Anti-alucinação: o texto
// bíblico vem SEMPRE do store; o LLM só interpreta. BYOK/offline-first: sem chave, o
// app segue offline; a IA web é opt-in e só faz rede no `fetch` (a chave, session-only
// no `keystore.web`, vai só no header — nunca logada).

/** `fetch` de produção (browser). Envolvido para casar com `AiFetch` sem `bind`. */
const defaultFetch: AiFetch = (input, init) => globalThis.fetch(input, init);

/**
 * Pergunta ancorada (sem streaming) no web: abre o store web (subset, F1.13) e delega
 * ao pipeline `askAnchoredOnHandle` (wasm `ai-pure` + `fetch`). `_dbPath` é aceito por
 * paridade de assinatura com o nativo; o store web abre o subset internamente. O
 * `AiAnswer` traz o `citedText` (store, verbatim) SEPARADO da `interpretation` (LLM).
 */
export async function askAnchored(
  _dbPath: string,
  translation: string,
  reference: string,
  question: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  lang: string,
): Promise<AiAnswer> {
  const handle = await openReadingDbWeb();
  try {
    return await askAnchoredOnHandle(
      handle,
      defaultFetch,
      translation,
      reference,
      question,
      provider,
      key,
      model,
      lang,
    );
  } finally {
    await handle.close();
  }
}

/**
 * Pergunta ancorada com "streaming" no web: NÃO-STREAMING nesta tarefa (F2.7b) — o
 * transporte web via `fetch` é não-streaming por ora (SSE/`ReadableStream` fica como
 * follow-up). Obtém a resposta completa por `askAnchored` e emite a `interpretation`
 * inteira 1× via `onToken` (mesma UX incremental que o nativo tem com o mock). Os
 * tokens são da INTERPRETAÇÃO (LLM), nunca do texto bíblico (que viaja separado, do
 * store, em `citedText`).
 */
export async function askAnchoredStream(
  dbPath: string,
  translation: string,
  reference: string,
  question: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  lang: string,
  onToken: (token: string) => void,
): Promise<AiAnswer> {
  const answer = await askAnchored(
    dbPath,
    translation,
    reference,
    question,
    provider,
    key,
    model,
    lang,
  );
  if (answer.interpretation.length > 0) {
    onToken(answer.interpretation);
  }
  return answer;
}
