// app/web/reading.web.ts — F1.13 (ADR-0018/ADR-0019) · F1.14 (ADR-0020: busca) ·
// F1.15 (ADR-0021: xref)
//
// GLUE web de LEITURA + BUSCA + XREF (hand-written, VERSIONADO). A paridade web lê
// do SUBSET de leitura `reading-lite.sqlite` (~4,3 MB, SEM léxico — F5.15/ADR-0044;
// o nativo empacota o combinado `reading-sample.sqlite`, ADR-0014) via `wa-sqlite`
// (OPFS no browser / MemoryVFS na prova), ESPELHANDO os
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
  AiAnswerMulti,
  CitedPassage,
  StudyResultOut,
  StudySection,
  StudyCitation,
  VerifiedLexiconOut,
  InterlinearVerseOut,
  InterlinearTokenOut,
  LexEntry,
  ChatTurn,
  ReadingPlanSummary,
  ReadingPlanDay,
  ReadingPlanProgress,
} from './generated/the_light_app_core';
import { StudyMode, StudyLens, StudyDepth, ChatRole } from './generated/the_light_app_core';
// F5.9 (ADR-0040): CODE-SPLIT. Os transportes PESADOS (a factory do wa-sqlite +
// store OPFS de leitura, a IA `ai-anchored`, o estudo/léxico `study`, a conversa
// `session`, a busca/xref e o userdata) NÃO são mais importados ESTÁTICOS aqui —
// eram arrastados p/ o chunk EAGER de entry mesmo p/ quem só abre a home. Agora
// carregam SOB DEMANDA via `import()` no LIMITE DE CHAMADA (ao abrir capítulo/busca/
// IA/estudo/notas, ou quando o DB é preciso), como chunks async LOCAIS do Metro
// (offline-first: nada de rede — assets da própria origem). Isto muda SÓ QUANDO o
// código carrega, NUNCA o comportamento: assinaturas públicas e saídas IDÊNTICAS
// (zero drift; os self-tests exercitam as funções `*OnHandle` diretamente, intactas).
// `AiFetch` é só TIPO (apagado na compilação) → não puxa `ai-anchored` p/ o entry.
import type { AiFetch } from './ai-anchored.web';
// Tipos-só (apagados) dos handles dos openers dinâmicos — p/ os brackets `withReadingDb`/`withLexiconDb`.
import type { OpenReadingDb } from './sqlite-reading-opfs.web';
import type { OpenLexiconDb } from './sqlite-lexicon-opfs.web';

export type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
  AiAnswer,
  AiAnswerMulti,
  CitedPassage,
  StudyResultOut,
  StudySection,
  StudyCitation,
  VerifiedLexiconOut,
  InterlinearVerseOut,
  InterlinearTokenOut,
  LexEntry,
  ChatTurn,
  ReadingPlanSummary,
  ReadingPlanDay,
  ReadingPlanProgress,
};
export { StudyMode, StudyLens, StudyDepth, ChatRole };

// ADR-0078: `parse_reference` SÍNCRONO do core (wasm) exposto pela COSTURA de leitura (ver reading.ts) —
// o `snapshotStore` valida referência por esta seam, sem ramificar por plataforma.
export { parseReference as parseReferenceSync } from './generated/index.web';

/**
 * 66 livros canônicos (PURO — `reference::BOOKS`), do RUST (wasm). SÍNCRONO, como
 * o nativo: exige o wasm já inicializado (pré-aquecido por `useWasmReady()` no
 * `_layout.tsx`). NÃO relista os 66 à mão nem lê a tabela `books` (a fronteira nem
 * a usa) — uma fonte da verdade do cânon.
 */
export function listBooks(): Book[] {
  return listBooksWasm();
}

// ── BRACKETS de handle (ADR-0077) ─────────────────────────────────────────────────────────
// O ciclo open→try→`finally close` do store web (leitura/léxico) estava re-tipado em ~12 funções — um
// `finally` esquecido VAZA o handle wa-sqlite (o `deepStudy` chegou a ter esse bug, ADR-0072). Estes
// brackets concentram a política de fechamento: `fn` roda sobre o handle e ele é SEMPRE fechado (leak-safe
// por construção). O opener entra por `import()` dinâmico (code-split F5.9 preservado). `deepStudy` COMPÕE
// os dois (léxico dentro de leitura) → fecha o léxico antes da leitura, sem vazar se o léxico falhar ao abrir.
// Fix de perf (celular) + ADR-0057/0077: o banco de leitura é um SINGLETON de sessão
// (`openReadingDbWeb` memoiza a abertura — ~64 MB baixados/parseados UMA vez; antes era
// open→query→close a CADA chamada, re-fazendo o fetch+parse de 64 MB por capítulo, 2× no
// paralelo). Como é UMA conexão wa-sqlite compartilhada, os efeitos CONCORRENTES da tela
// (getChapter primário + paralelo + xref + traduções) NÃO podem intercalar statements
// nela — então SERIALIZAMOS os ops numa fila (promise chain). O `close` do handle é no-op
// (a sessão é dona do handle; nada a fechar por chamada → o vazamento que os brackets da
// ADR-0077 evitavam não se aplica). A fila prossegue mesmo se um op falhar (o erro vai só
// ao chamador). A resolução do opener (import dinâmico, code-split F5.9) roda DENTRO do
// passo serializado, então a montagem da fila é síncrona (ordem determinística).
let readingOpChain: Promise<unknown> = Promise.resolve();

function withReadingDb<T>(fn: (handle: OpenReadingDb) => Promise<T>): Promise<T> {
  const run = readingOpChain.then(async () => {
    const { openReadingDbWeb } = await import('./sqlite-reading-opfs.web');
    const handle = await openReadingDbWeb();
    return fn(handle);
  });
  readingOpChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

async function withLexiconDb<T>(fn: (handle: OpenLexiconDb) => Promise<T>): Promise<T> {
  const { openLexiconDbWeb } = await import('./sqlite-lexicon-opfs.web');
  const lexHandle = await openLexiconDbWeb();
  try {
    return await fn(lexHandle);
  } finally {
    await lexHandle.close();
  }
}

/**
 * Traduções presentes no subset de leitura (`reading-lite.sqlite`): KJV (en) e Almeida 1911
 * (pt). Espelha `EmbeddedSource::translations` (ordem do SQLite). `_dbPath` é aceito
 * por paridade de assinatura com o nativo; o store web abre o subset internamente.
 */
export async function listTranslations(_dbPath: string): Promise<Translation[]> {
  const { queryTranslations } = await import('./sqlite-reading.web');
  return withReadingDb((handle) => queryTranslations(handle));
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
  const { hasTranslation, queryChapter, composeChapterPassage } = await import('./sqlite-reading.web');
  return withReadingDb(async (handle) => {
    if (!(await hasTranslation(handle, translation))) {
      // Espelha `SourceError::UnknownTranslation` ("versão desconhecida: {id}") que a fronteira
      // nativa propaga como `CoreError` em `getChapter`.
      throw new Error(`versão desconhecida: ${translation}`);
    }
    const rows = await queryChapter(handle, translation, book, chapter);
    return composeChapterPassage(book, chapter, rows, translation);
  });
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
  const { queryChapterCount } = await import('./sqlite-reading.web');
  return withReadingDb((handle) => queryChapterCount(handle, translation, book));
}

/**
 * Busca full-text (FTS5) sobre o subset de leitura local (`reading-lite.sqlite`), espelhando
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
  const { searchOnHandle } = await import('./sqlite-search.web');
  return withReadingDb((handle) => searchOnHandle(handle, query, translation, book, limit));
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
  const { crossRefsOnHandle } = await import('./sqlite-xref.web');
  return withReadingDb((handle) => crossRefsOnHandle(handle, book, chapter, verse, minVotes, limit));
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
  const [{ openUserDataWeb }, { putNoteFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  await putNoteFs(dir, ref, body);
}

export async function getNote(_dataDir: string, reference: string): Promise<Note | undefined> {
  const ref = parseReference(reference);
  const [{ openUserDataWeb }, { getNoteFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return getNoteFs(dir, ref);
}

export async function deleteNote(_dataDir: string, reference: string): Promise<boolean> {
  const ref = parseReference(reference);
  const [{ openUserDataWeb }, { deleteNoteFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return deleteNoteFs(dir, ref);
}

export async function listNotes(_dataDir: string): Promise<Note[]> {
  const [{ openUserDataWeb }, { listNotesFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
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
  const [{ openUserDataWeb }, { addHighlightFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  await addHighlightFs(dir, ref, color, tag);
}

export async function removeHighlight(_dataDir: string, reference: string): Promise<number> {
  const ref = parseReference(reference);
  const [{ openUserDataWeb }, { removeHighlightFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return removeHighlightFs(dir, ref);
}

export async function listHighlights(_dataDir: string): Promise<Highlight[]> {
  const [{ openUserDataWeb }, { listHighlightsFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./userdata-fs.web'),
  ]);
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
  const { askAnchoredOnHandle } = await import('./ai-anchored.web');
  return withReadingDb((handle) =>
    askAnchoredOnHandle(handle, defaultFetch, translation, reference, question, provider, key, model, lang),
  );
}

/**
 * Estimativa de custo (US$) via a tabela de preços do core (fonte única). Import DINÂMICO da
 * fronteira wasm p/ NÃO puxar `generated` ao grafo estático (só carrega ao estimar — pós-resposta,
 * quando o wasm já está inicializado). `undefined`=sem preço; `0`=local/grátis; `>0`=estimado.
 */
export async function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number | undefined> {
  const mod = await import('./generated/the_light_app_core');
  return mod.estimateCostUsd(model, inputTokens, outputTokens);
}

/**
 * Estudo temático CONJUNTO no web sobre VÁRIOS trechos disjuntos: abre o store web e
 * delega ao pipeline `askMultiAnchoredOnHandle` (wasm `ai-pure` + `fetch`). `_dbPath` é
 * aceito por paridade com o nativo. O `AiAnswerMulti` traz N `citedPassages` (store,
 * verbatim) SEPARADAS da `interpretation` (LLM) única que as tece.
 */
export async function askMultiAnchored(
  _dbPath: string,
  translation: string,
  references: string[],
  question: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  lang: string,
): Promise<AiAnswerMulti> {
  const { askMultiAnchoredOnHandle } = await import('./ai-anchored.web');
  return withReadingDb((handle) =>
    askMultiAnchoredOnHandle(handle, defaultFetch, translation, references, question, provider, key, model, lang),
  );
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
  const { askAnchoredOnHandle } = await import('./ai-anchored.web');
  return withReadingDb((handle) =>
    askAnchoredOnHandle(handle, defaultFetch, translation, reference, question, provider, key, model, lang, onToken),
  );
}

// ── ESTUDO PROFUNDO + LÉXICO (deep_study/lexical_entries) — F3.12a (ADR-0031) ──────────
// DESTUBADO: paridade web do estudo. O prompt/RAG/verify/citação/aparato vêm do Rust
// `ai-pure` no wasm (`studyWebPrepare`/`studyWebFinalize`, ZERO drift nativo↔web) e o
// transporte é `fetch` ao provedor (MVP = Gemini), delegado ao pipeline
// `deepStudyOnHandle` (`study.web.ts`). F5.15 (ADR-0044): o TEXTO do versículo vem do
// subset de LEITURA (`reading-lite.sqlite`, via `sqlite-reading.web`) e o LÉXICO
// verificado vem de um store SEPARADO carregado ON-DEMAND (`lexicon-sample.sqlite`, ~9 MB,
// via `sqlite-lexicon.web` sobre `openLexiconDbWeb`). Aqui só abrimos os stores web (OPFS)
// e passamos o `globalThis.fetch`. Anti-alucinação: texto/léxico
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
  // F5.15 (ADR-0044): o estudo precisa do TEXTO (subset de leitura) + do LÉXICO (~9 MB,
  // ON-DEMAND). Abrimos DOIS stores: `openReadingDbWeb` (reading-lite, verses) e
  // `openLexiconDbWeb` (lexicon-sample, léxico STEP CC-BY buscado só agora). Ambos são
  // assets LOCAIS (offline-first). A UX de carregamento do léxico vive no painel de
  // estudo (`busy`/aviso), já que este `import()`+fetch do léxico é a "descida" deferida.
  const { deepStudyOnHandle } = await import('./study.web');
  // Brackets COMPOSTOS (ADR-0077): léxico DENTRO de leitura → fecha o léxico antes da leitura; se o léxico
  // falhar ao ABRIR, o bracket externo fecha a leitura (o vazamento que a ADR-0072 corrigiu à mão vira grátis).
  return withReadingDb((handle) =>
    withLexiconDb((lexHandle) =>
      deepStudyOnHandle(
        handle,
        lexHandle,
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
      ),
    ),
  );
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
  // F5.15 (ADR-0044): o léxico é INDEPENDENTE do texto — abre SÓ o store de léxico
  // on-demand (`lexicon-sample.sqlite`, ~9 MB), nunca o subset de leitura. Leitores
  // puros jamais chegam aqui, então o léxico só "desce" ao abrir o léxico/estudo.
  const { lexicalEntriesOnHandle } = await import('./study.web');
  return withLexiconDb((lexHandle) => lexicalEntriesOnHandle(lexHandle, book, chapter, verse, limit));
}

/**
 * Tokens INTERLINEARES (idioma original) de um versículo no web: abre o store de léxico on-demand
 * (`lexicon-sample.sqlite`, mesmo caminho da F5.15) e delega ao `interlinearVerseOnHandle` (espelho
 * TS do SELECT). `_dbPath` aceito por paridade com o nativo.
 */
export async function interlinearVerse(
  _dbPath: string,
  book: number,
  chapter: number,
  verse: number,
): Promise<InterlinearVerseOut> {
  const { interlinearVerseOnHandle } = await import('./study.web');
  return withLexiconDb((lexHandle) => interlinearVerseOnHandle(lexHandle, book, chapter, verse));
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
  const { askSessionAnchoredOnHandle } = await import('./session.web');
  return withReadingDb((handle) =>
    askSessionAnchoredOnHandle(
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
    ),
  );
}

// ── PLANOS DE LEITURA (list/day/day_index) — F5.10 (geração REAL/wasm) ─────────
// DESTUBADO: a geração de planos é CFG-FREE no core (F5.10/ADR-0037/rev `225b8c9`): a
// superfície PURA `userdata::plans` compila sob `ai-pure` (wasm-safe), então os bindings
// gerados carregam a impl REAL (não mais os stubs vazios). Aqui só reexportamos a fronteira
// wasm (assinatura IDÊNTICA ao glue nativo), SEM espelhar geração em TS: o CATALOG (ids/nomes
// PT), a divisão em dias (capítulos inteiros) e o índice do dia vêm SEMPRE do core (uma fonte
// da verdade; anti-alucinação — refs/nomes do core, ZERO-DRIFT nativo↔web). SÍNCRONO, como
// `listBooks` (exige o wasm já inicializado, pré-aquecido por `useWasmReady()`). NÃO tocam
// OPFS (geração pura em memória).

/** Os 3 planos (annual/nt/gospels) com nome PT verbatim do core + nº de dias — REAL (wasm). */
export function listReadingPlans(): ReadingPlanSummary[] {
  return listReadingPlansWasm();
}

/** As leituras (capítulos inteiros) de um dia + rótulo PT — REAL (wasm). Fora do intervalo → vazio. */
export function readingPlanDay(planId: string, day: number): ReadingPlanDay {
  return readingPlanDayWasm(planId, day);
}

/** Índice (0-based) do dia de hoje (satura em `[0, len-1]`) — REAL (wasm). Data inválida → lança. */
export function readingPlanDayIndex(startDate: string, today: string, len: number): number {
  return readingPlanDayIndexWasm(startDate, today, len);
}

// ── PROGRESSO DO PLANO (persistência) — F5.10 (OPFS app-side) ─────────────────
// DESTUBADO: como `userdata::plans::PlanStore` (fs) é nativo-only (`#[cfg(feature="embedded")]`)
// e NÃO entra no wasm, o PROGRESSO no web é persistido em TS sobre OPFS, ESPELHANDO o formato em
// disco do core (`reading-plans/active.json` = `{plan_id, start_date, completed}`), como
// notas/highlights (F1.16/ADR-0022). O I/O de ARQUIVO INTEIRO vem do MESMO backend OPFS de
// userdata (`openUserDataWeb`); o FORMATO + a validação (plan_id via CATALOG do core, start_date
// ISO via `readingPlanDayIndex`) vivem em `plans-fs.web.ts` (VFS-agnóstico, espelho do core).
// `_dataDir` é aceito por paridade de assinatura com o nativo; o store web abre o OPFS
// internamente (mesmo padrão de `putNote`/`getChapter`). Offline-first: só OPFS local, sem rede.

/** Lê o PROGRESSO do plano ativo (OPFS); sem plano ativo → `undefined` (não erro). */
export async function readingPlanProgress(
  _dataDir: string,
): Promise<ReadingPlanProgress | undefined> {
  const [{ openUserDataWeb }, { readActivePlanFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./plans-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return readActivePlanFs(dir);
}

/**
 * INICIA um plano (`completed = 0`) em OPFS. `planId` fora do CATALOG do core / `startDate`
 * não-ISO → lança (mesma semântica/mensagem do nativo), sem gravar. SOBRESCREVE o plano ativo.
 */
export async function startReadingPlan(
  _dataDir: string,
  planId: string,
  startDate: string,
): Promise<ReadingPlanProgress> {
  const [{ openUserDataWeb }, { startPlanFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./plans-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return startPlanFs(dir, planId, startDate);
}

/** ATUALIZA os dias concluídos do plano ativo (OPFS); sem plano ativo → lança. */
export async function setReadingPlanCompleted(
  _dataDir: string,
  completed: number,
): Promise<ReadingPlanProgress> {
  const [{ openUserDataWeb }, { setCompletedFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./plans-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return setCompletedFs(dir, completed);
}

/** REMOVE o plano ativo (OPFS); `true` se removeu, idempotente → `false` se não havia. */
export async function clearReadingPlan(_dataDir: string): Promise<boolean> {
  const [{ openUserDataWeb }, { clearActivePlanFs }] = await Promise.all([
    import('./userdata-opfs.web'),
    import('./plans-fs.web'),
  ]);
  const dir = await openUserDataWeb();
  return clearActivePlanFs(dir);
}
