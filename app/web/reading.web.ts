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
import {
  listBooks as listBooksWasm,
  parseReference,
  listReadingPlans as listReadingPlansWasm,
  readingPlanDay as readingPlanDayWasm,
  readingPlanDayIndex as readingPlanDayIndexWasm,
} from './generated/index.web';
import type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
  AiAnswer,
  StudyResultOut,
  StudySection,
  StudyCitation,
  VerifiedLexiconOut,
  LexEntry,
  ChatTurn,
  ReadingPlanSummary,
  ReadingPlanDay,
} from './generated/the_light_app_core';
import { StudyMode, StudyLens, StudyDepth, ChatRole } from './generated/the_light_app_core';
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
import { deepStudyOnHandle, lexicalEntriesOnHandle } from './study.web';
import { askSessionAnchoredOnHandle } from './session.web';
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

export type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
  AiAnswer,
  StudyResultOut,
  StudySection,
  StudyCitation,
  VerifiedLexiconOut,
  LexEntry,
  ChatTurn,
  ReadingPlanSummary,
  ReadingPlanDay,
};
export { StudyMode, StudyLens, StudyDepth, ChatRole };

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
 * Pergunta ancorada com STREAMING REAL no web (F4.1; realiza o follow-up adiado na F2.7b/
 * ADR-0025): abre o store web (subset, F1.13) e delega ao pipeline `askAnchoredOnHandle`
 * passando o `onToken` REAL. O transporte lê o `ReadableStream` do `fetch`
 * (`:streamGenerateContent?alt=sse`), extrai cada DELTA de texto e chama `onToken(delta)`
 * incrementalmente (o `"mock"` emite offline em ≥1 incrementos). O texto COMPLETO acumulado
 * vai à MESMA `ai_web_finalize` → `AiAnswer` idêntico ao não-streaming (ZERO drift). Os
 * tokens são da INTERPRETAÇÃO (LLM), nunca do texto bíblico (que viaja separado, do store,
 * em `citedText`). Assinatura pública e `AiAnswer` final INALTERADOS (o `ReaderAskPanel` já
 * consome `onToken`; agora recebe N incrementos reais em vez de 1).
 */
export async function askAnchoredStream(
  _dbPath: string,
  translation: string,
  reference: string,
  question: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  lang: string,
  onToken: (token: string) => void,
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
      onToken,
    );
  } finally {
    await handle.close();
  }
}

// ── ESTUDO PROFUNDO + LÉXICO (deep_study/lexical_entries) — F3.12a (ADR-0031) ──────────
// DESTUBADO: paridade web do estudo. O prompt/RAG/verify/citação/aparato vêm do Rust
// `ai-pure` no wasm (`studyWebPrepare`/`studyWebFinalize`, ZERO drift nativo↔web) e o
// transporte é `fetch` ao provedor (MVP = Gemini), delegado ao pipeline
// `deepStudyOnHandle` (`study.web.ts`). O texto do versículo e o léxico verificado vêm do
// STORE local (subset F1.13/F3.5, via `sqlite-reading.web`/`sqlite-lexicon.web`). Aqui só
// abrimos o store web (OPFS) e passamos o `globalThis.fetch`. Anti-alucinação: texto/léxico
// do store; o LLM só interpreta. BYOK/offline-first: sem chave, o app segue offline; a IA é
// opt-in e só faz rede no `fetch` (a chave, session-only no `keystore.web`, vai só no header
// — nunca logada). `researchBackend`/`researchKey` são aceitos por paridade mas IGNORADOS
// aqui (a pesquisa web + chave Tavily session-only no browser é a F4.4). A chave nunca é logada.

/**
 * Estudo profundo no web: abre o store web (subset, F1.13/F3.5) e delega ao pipeline
 * `deepStudyOnHandle` (wasm `ai-pure` + léxico do store + `fetch`). `_dbPath` é aceito por
 * paridade de assinatura com o nativo; o store web abre o subset internamente. O
 * `StudyResultOut` traz `passageText` (store, verbatim, numerado) SEPARADO da
 * `interpretation` (LLM) + `sections`/`citations`/`warnings`/`academicMarkdown`.
 */
export async function deepStudy(
  _dbPath: string,
  translation: string,
  book: number,
  chapter: number,
  verse: number | undefined,
  mode: StudyMode,
  lens: StudyLens,
  depth: StudyDepth,
  lang: string,
  providerName: string,
  key: string | undefined,
  model: string | undefined,
  researchBackend?: string,
  researchKey?: string,
): Promise<StudyResultOut> {
  const handle = await openReadingDbWeb();
  try {
    return await deepStudyOnHandle(
      handle,
      defaultFetch,
      translation,
      book,
      chapter,
      verse,
      mode,
      lens,
      depth,
      lang,
      providerName,
      key,
      model,
      researchBackend,
      researchKey,
    );
  } finally {
    await handle.close();
  }
}

/**
 * Léxico verificado no web (independente de tradução): abre o store web (subset) e delega
 * a `lexicalEntriesOnHandle` (SELECT + shaping do léxico do store — infra, ADR-0011). As
 * entradas Strong + `sources` (atribuição STEP CC-BY) são VERBATIM do store; passagem sem
 * cobertura → `{ entries: [], sources: [] }` (sem throw). `_dbPath` aceito por paridade.
 */
export async function lexicalEntries(
  _dbPath: string,
  book: number,
  chapter: number,
  verse: number | undefined,
  _lang: string,
  limit: number | undefined,
): Promise<VerifiedLexiconOut> {
  const handle = await openReadingDbWeb();
  try {
    return await lexicalEntriesOnHandle(handle, book, chapter, verse, limit);
  } finally {
    await handle.close();
  }
}

// ── CONVERSA/FOLLOW-UP ANCORADO (ask_session_anchored) — F3.12b (ADR-0032) ─────────────
// DESTUBADO: paridade web da CONVERSA multi-turno. O prompt/RAG/conversa/citação vêm do Rust
// `ai-pure` no wasm (`sessionWebPrepare` + reuso de `aiWebFinalize`, ZERO drift nativo↔web) e
// o transporte é `fetch` ao provedor (MVP = Gemini), delegado ao pipeline
// `askSessionAnchoredOnHandle` (`session.web.ts`). O texto do versículo (âncora) vem do STORE
// local (subset F1.13, via `sqlite-reading.web`). Aqui só abrimos o store web (OPFS) e
// passamos o `globalThis.fetch`. Anti-alucinação: o `citedText` (âncora) vem SEMPRE do store;
// o LLM só conversa/interpreta. BYOK/offline-first: sem chave, o app segue offline; a IA é
// opt-in e só faz rede no `fetch` (a chave, session-only no `keystore.web`, vai só no header —
// nunca logada). A assinatura é idêntica à do glue nativo (`lang` ANTES de `turns`;
// `studyMode`/`studyLens` DEPOIS de `turns`).

/**
 * Conversa/follow-up ancorado no web: abre o store web (subset, F1.13) e delega ao pipeline
 * `askSessionAnchoredOnHandle` (wasm `ai-pure` + `fetch`). `_dbPath` é aceito por paridade de
 * assinatura com o nativo; o store web abre o subset internamente. O `AiAnswer` traz o
 * `citedText` (âncora, store, verbatim) SEPARADO de cada `interpretation` (LLM).
 */
export async function askSessionAnchored(
  _dbPath: string,
  translation: string,
  book: number,
  chapter: number,
  verse: number | undefined,
  lang: string,
  turns: ChatTurn[],
  studyMode: StudyMode | undefined,
  studyLens: StudyLens | undefined,
  providerName: string,
  key: string | undefined,
  model: string | undefined,
): Promise<AiAnswer> {
  const handle = await openReadingDbWeb();
  try {
    return await askSessionAnchoredOnHandle(
      handle,
      defaultFetch,
      translation,
      book,
      chapter,
      verse,
      lang,
      turns,
      studyMode,
      studyLens,
      providerName,
      key,
      model,
    );
  } finally {
    await handle.close();
  }
}

// ── PLANOS DE LEITURA (list/day/day_index) — F5.1 (STUB web) ──────────────────
// STUB: o módulo `userdata` (geração de planos) é nativo-only (`#[cfg(feature="embedded")]`)
// e NÃO entra no wasm — os bindings gerados são os STUBS da fronteira (`list` → `[]`, `day`
// → vazio, `dayIndex` → CoreError). A paridade web REAL (F5.10) exigirá expor a superfície
// PURA de planos sob `ai-pure` no `the-light` (PR + ADR — gate estratégico à parte). Aqui só
// reexportamos os stubs (assinatura IDÊNTICA ao glue nativo), SEM espelhar geração em TS
// (zero drift). SÍNCRONO, como `listBooks` (exige o wasm já inicializado). Os stubs NÃO
// tocam OPFS (nada de `openReadingDbWeb`).

/** STUB web (F5.10): lista vazia até a PR `ai-pure` de planos ao core. */
export function listReadingPlans(): ReadingPlanSummary[] {
  return listReadingPlansWasm();
}

/** STUB web (F5.10): dia vazio (`{ label: '', references: [] }`) até a PR `ai-pure`. */
export function readingPlanDay(planId: string, day: number): ReadingPlanDay {
  return readingPlanDayWasm(planId, day);
}

/** STUB web (F5.10): lança (CoreError) até a PR `ai-pure` de planos ao core. */
export function readingPlanDayIndex(startDate: string, today: string, len: number): number {
  return readingPlanDayIndexWasm(startDate, today, len);
}
