// app/web/study.web.ts — F3.12a (ADR-0031; molde EXATO F2.7b/ai-anchored.web.ts)
//
// PIPELINE web do ESTUDO PROFUNDO + LÉXICO (hand-written, VERSIONADO), SEM dependências
// de OPFS/asset (par de `ai-anchored.web.ts`: infra pura, exercitada por `reading.web.ts`
// no browser e pela prova headless em node). O contrato anti-alucinação COM ZERO DRIFT
// vem do Rust `ai-pure` no wasm (ADR-0029/ADR-0030/ADR-0031):
//   - `studyWebPrepare` (wasm): monta `passageText` (numerado, VERBATIM do store) + o
//     `system`/`user` EXATOS do estudo (`system_prompt_in`+`user_prompt`, mesmo prompt do
//     nativo `deep_study`). NENHUM prompt/RAG/citação é reimplementado em TS.
//   - transporte TS (`fetch`): a ÚNICA rede em runtime do estudo web (opt-in, com a chave
//     SÓ no header). REUSA `webLlmTransport` do `ai-anchored.web.ts` (mesmo transporte do
//     `ask`; MVP = Gemini). A chave NUNCA vai na URL/log.
//   - `studyWebFinalize` (wasm): aplica verify/citação/aparato/`to_academic_markdown` em
//     Rust (mesma impl do nativo) e monta o `StudyResultOut` com `passageText` do store
//     SEPARADO da `interpretation` do LLM + `academicMarkdown` (F3.8).
//
// O LÉXICO vem do STORE local (subset `reading-sample.sqlite`, F3.5/ADR-0027) via
// `queryVerifiedLexicon` (SELECT + shaping = infra TS, ADR-0011) — glosas/lemas/Strong
// VERBATIM do léxico STEP CC-BY, nunca de LLM. O `fetch` é INJETÁVEL (prova = MOCK).
//
// Importa as FUNÇÕES direto de `the_light_app_core` (não de `index.web`, que arrasta o
// `.wasm` como asset): o mesmo singleton wasm; a prova headless (esbuild/node) instancia o
// wasm manualmente. No browser o wasm já está inicializado por `useWasmReady()`.
import {
  listBooks,
  studyWebFinalize,
  studyWebPrepare,
  type Book,
  type StudyLexEntryInput,
  type StudyResultOut,
  type StudyDepth,
  type StudyLens,
  type StudyMode,
  type StudyWebSourceInput,
  type VerifiedLexiconOut,
  type AiVerseInput,
} from './generated/the_light_app_core';
import { webLlmTransport, type AiFetch } from './ai-anchored.web';
import { hasTranslation, queryChapter, type ChapterRow, type ReadingDb } from './sqlite-reading.web';
import { DEFAULT_LEXICON_LIMIT, queryVerifiedLexicon } from './sqlite-lexicon.web';
import {
  DEFAULT_TAVILY_LIMIT,
  DEFAULT_WIKIPEDIA_LIMIT,
  tavilySearch,
  wikipediaSearch,
} from './research.web';

/** Backends de pesquisa web SUPORTADOS no web (rede opt-in). */
const WIKIPEDIA_BACKEND = 'wikipedia'; // keyless (ADR-0028)
const TAVILY_BACKEND = 'tavily'; // BYOK, chave session-only SÓ no corpo (ADR-0035)

/**
 * Consulta de pesquisa web = rótulo da passagem (`<Livro> <cap>[:<verso>]`, nome EN do
 * cânon PURO do Rust via `listBooks`), espelhando o `query = reference_label` do nativo
 * (`deep_study`). Determinística; o mock a ignora, só a Wikipedia a usa.
 */
function researchQuery(book: number, chapter: number, verse: number | undefined): string {
  const found = listBooks().find((b: Book) => b.number === book);
  const name = found ? found.nameEn : `Book ${book}`;
  return verse == null ? `${name} ${chapter}` : `${name} ${chapter}:${verse}`;
}

/**
 * Resolve as FONTES WEB (opt-in) para o estudo. `undefined`/vazio → `[]` (comportamento
 * F3.12a, OFFLINE por padrão). `"wikipedia"` → `fetch` KEYLESS à Wikipedia (ADR-0028).
 * `"tavily"` → `POST` a `api.tavily.com/search` com a chave BYOK SÓ no CORPO (F4.4/ADR-0035);
 * SEM `researchKey` → erro explícito citando só "tavily" (0 fetch, sem vazar chave), espelhando
 * `AiError::NoKey` do nativo. Qualquer outro backend → erro explícito (espelha a rejeição do
 * nativo `build_research_provider`), sem rede. As citações/`[W:n]` são montadas pelo Rust
 * `ai-pure` (das URLs); aqui só RECUPERAMOS as fontes cruas (ZERO DRIFT). A chave nunca é
 * logada nem incluída em mensagem de erro/URL.
 */
async function resolveWebSources(
  fetchImpl: AiFetch,
  researchBackend: string | undefined,
  researchKey: string | undefined,
  book: number,
  chapter: number,
  verse: number | undefined,
  lang: string,
): Promise<StudyWebSourceInput[]> {
  if (researchBackend == null || researchBackend.trim().length === 0) {
    return [];
  }
  const query = researchQuery(book, chapter, verse);
  if (researchBackend === WIKIPEDIA_BACKEND) {
    return wikipediaSearch(fetchImpl, query, lang, DEFAULT_WIKIPEDIA_LIMIT);
  }
  if (researchBackend === TAVILY_BACKEND) {
    const key = researchKey?.trim() ?? '';
    if (key.length === 0) {
      // Espelha `AiError::NoKey`: sem chave, 0 fetch; a mensagem cita SÓ "tavily" (nunca a chave).
      throw new Error('pesquisa web tavily exige uma chave (BYOK) — nenhuma configurada');
    }
    return tavilySearch(fetchImpl, key, query, lang, DEFAULT_TAVILY_LIMIT);
  }
  throw new Error(`backend de pesquisa web desconhecido no web: ${researchBackend}`);
}

/**
 * Léxico verificado de uma passagem, do STORE local (subset) — infra TS (ADR-0011). É o
 * corpo de `reading.web.ts::lexicalEntries`, e a fonte dos dados léxicos que alimentam o
 * `studyWebPrepare`. Anti-alucinação: entradas/atribuição são VERBATIM do store (STEP
 * CC-BY); NENHUMA lógica de anti-alucinação/aparato em TS. Passagem sem cobertura →
 * `{ entries: [], sources: [] }` (sem throw).
 */
export async function lexicalEntriesOnHandle(
  handle: ReadingDb,
  book: number,
  chapter: number,
  verse: number | undefined,
  limit: number | undefined,
): Promise<VerifiedLexiconOut> {
  return queryVerifiedLexicon(handle, book, chapter, verse, limit ?? DEFAULT_LEXICON_LIMIT);
}

/**
 * Seleciona os versículos da passagem a partir das linhas do capítulo lidas do store
 * (TEXTO verbatim): versículo único → só o versículo; capítulo inteiro (`verse`
 * ausente) → todos. Espelha o recorte de `EmbeddedSource::passage`.
 */
function versesForPassage(verse: number | undefined, rows: ChapterRow[]): AiVerseInput[] {
  const wanted = verse == null ? () => true : (v: number) => v === verse;
  return rows.filter((r) => wanted(r.verse)).map((r) => ({ number: r.verse, text: r.text }));
}

/**
 * PIPELINE web do ESTUDO PROFUNDO sobre um handle de leitura ABERTO + um `fetch`
 * INJETÁVEL — a função de PRODUÇÃO exercitada pela prova headless (VFS de memória + fetch
 * MOCK) e pelo browser (OPFS + `globalThis.fetch`, via `reading.web.ts`). Passos:
 *   1) `hasTranslation` ANTES (paridade com o nativo → `UnknownTranslation`);
 *   2) `queryChapter` (SELECT existente) + recorte → `verses` do STORE (verbatim);
 *   3) `queryVerifiedLexicon` (SELECT + shaping do léxico do store, ADR-0011) → entradas
 *      Strong + `sources` (STEP CC-BY);
 *   4) `studyWebPrepare` (wasm) → `passageText` (store, numerado) + `system`/`user` (ai-pure);
 *   5) transporte TS (`fetch`) → `interpretation` (a única rede, opt-in, com a chave);
 *   6) `studyWebFinalize` (wasm) → `StudyResultOut` (verify/citação/aparato/markdown em
 *      Rust; `passageText` do store SEPARADO da `interpretation`).
 * `researchBackend === 'wikipedia'` (F3.12b, opt-in): `resolveWebSources` faz um `fetch`
 * KEYLESS à Wikipedia → `web_sources` alimenta prepare/finalize → o estudo ganha as
 * citações `[W:n]`/`kind="Web"` (do Rust `ai-pure`, das URLs — NUNCA do modelo). Sem
 * backend (ou `undefined`) → `web_sources` `[]` (comportamento F3.12a, OFFLINE por padrão).
 * `researchBackend === 'tavily'` (F4.4/ADR-0035, opt-in): `resolveWebSources` faz um `POST`
 * a `api.tavily.com/search` com a chave BYOK (`researchKey`) SÓ no CORPO (nunca URL/header/log,
 * session-only in-memory, ADR-0025) → as MESMAS `web_sources` cruas → as MESMAS citações
 * `[W:n]`/`kind="Web"` do Rust. SEM `researchKey` com backend=tavily → erro citando só "tavily"
 * (0 fetch). Anti-alucinação COM ZERO DRIFT: texto/léxico do store; prompt+verify+citação+
 * aparato do MESMO Rust `ai-pure` no web e no nativo; só a recuperação (léxico/Wikipedia/Tavily)
 * e o transporte (`fetch`) são infra TS.
 */
export async function deepStudyOnHandle(
  handle: ReadingDb,
  fetchImpl: AiFetch,
  translation: string,
  book: number,
  chapter: number,
  verse: number | undefined,
  mode: StudyMode,
  lens: StudyLens,
  depth: StudyDepth,
  lang: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  researchBackend?: string,
  researchKey?: string,
): Promise<StudyResultOut> {
  if (!(await hasTranslation(handle, translation))) {
    // Espelha `SourceError::UnknownTranslation` propagado pelo nativo.
    throw new Error(`versão desconhecida: ${translation}`);
  }
  const rows = await queryChapter(handle, translation, book, chapter);
  const verses = versesForPassage(verse, rows);

  // Léxico do store (infra TS, ADR-0011) → entradas p/ o prompt (VERBATIM do léxico STEP).
  const lex = await queryVerifiedLexicon(handle, book, chapter, verse, DEFAULT_LEXICON_LIMIT);
  const lexEntries: StudyLexEntryInput[] = lex.entries.map((e) => ({
    strongs: e.strongs,
    lemma: e.lemma,
    translit: e.translit,
    gloss: e.gloss,
    occurrences: e.occurrences,
    testament: e.testament,
  }));

  // Pesquisa web OPT-IN (Wikipedia keyless | Tavily BYOK) — rede além do LLM; padrão OFF ([]).
  // A chave Tavily (`researchKey`) vai SÓ no corpo do POST (nunca URL/header/log); backend=tavily
  // sem chave → erro citando só "tavily" (0 fetch).
  const webSources = await resolveWebSources(
    fetchImpl,
    researchBackend,
    researchKey,
    book,
    chapter,
    verse,
    lang,
  );

  // (4) prepare (wasm) — prompt/RAG/[W:n] do Rust `ai-pure`. web_sources = Wikipedia|Tavily|[].
  const request = studyWebPrepare(
    book,
    chapter,
    verse,
    mode,
    lens,
    depth,
    lang,
    provider,
    model,
    verses,
    lexEntries,
    lex.sources,
    webSources,
  );

  // (5) transporte (`fetch`) — a chave vai SÓ no header (nunca logada/na URL).
  const interpretation = await webLlmTransport(fetchImpl, provider, key, {
    system: request.system,
    user: request.user,
    model: request.model,
  });

  // (6) finalize (wasm) — verify/citação/aparato/markdown em Rust; store ≠ interpretação.
  return studyWebFinalize(
    book,
    chapter,
    verse,
    mode,
    lens,
    depth,
    lang,
    request.passageText,
    request.provider,
    request.model,
    interpretation,
    lexEntries,
    lex.sources,
    webSources,
  );
}
