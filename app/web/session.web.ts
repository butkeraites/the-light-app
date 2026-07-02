// app/web/session.web.ts — F3.12b (ADR-0032; molde F2.7b/ai-anchored.web.ts)
//
// PIPELINE web da CONVERSA ANCORADA (follow-up multi-turno) — hand-written, VERSIONADO,
// par exato de `ai-anchored.web.ts` (o `ask` de turno único). O contrato anti-alucinação
// COM ZERO DRIFT vem do Rust `ai-pure` no wasm (ADR-0029/ADR-0032):
//   - `sessionWebPrepare` (wasm): monta o `citedText` (numerado, VERBATIM do store) + o
//     `system`/`user` EXATOS da CONVERSA (`ask_session` → `study_followup`/`ask_system` +
//     o `context` do 1º turno + o transcript dobrado pelo `chat` default), capturados por
//     um `CaptureProvider` — o MESMO prompt do nativo `ask_session_anchored`. NENHUM
//     prompt/RAG/transcript é reimplementado em TS.
//   - transporte TS (`fetch`): REUSA `webLlmTransport` do `ai-anchored.web.ts` (mesmo
//     transporte do `ask`/estudo; MVP = Gemini). A chave session-only vai SÓ no header
//     `x-goog-api-key`, NUNCA na URL/log; é a única rede em runtime da conversa (opt-in).
//   - `aiWebFinalize` (wasm): REUSO PURO do finalize do `ask` (F2.7b) — `rewrite_anchors`
//     com o conjunto de âncoras válidas VAZIO (limpa âncoras espúrias) é exatamente o
//     finalize da conversa (sem citações léxicas). Separa `citedText` (store) da
//     `interpretation` (LLM). NENHUM finalize novo.
//
// O `related` (RAG leve de xref) é `[]` no MVP (decisão ADR-0032): a montagem do prompt/
// contexto é do MESMO Rust `ai-pure`; a recuperação de rótulos de xref do store web é
// follow-up. O `fetch` é INJETÁVEL (a prova headless passa um MOCK; produção usa
// `globalThis.fetch`). O TEXTO bíblico vem SEMPRE do store local (subset, F1.13); o LLM só
// conversa/interpreta.
//
// Importa as FUNÇÕES direto de `the_light_app_core` (não de `index.web`, que arrasta o
// `.wasm` como asset): o mesmo singleton wasm; a prova headless (esbuild/node) instancia o
// wasm manualmente. No browser o wasm já está inicializado por `useWasmReady()`.
import {
  aiWebFinalize,
  listBooks,
  sessionWebPrepare,
  type AiAnswer,
  type AiVerseInput,
  type Book,
  type ChatTurn,
  type StudyLens,
  type StudyMode,
} from './generated/the_light_app_core';
import { webLlmTransport, type AiFetch } from './ai-anchored.web';
import { hasTranslation, queryChapter, type ChapterRow, type ReadingDb } from './sqlite-reading.web';

/**
 * Seleciona os versículos da passagem a partir das linhas do capítulo lidas do store
 * (TEXTO verbatim): versículo único → só o versículo; capítulo inteiro (`verse` ausente) →
 * todos. Espelha o recorte de `EmbeddedSource::passage` (mesma semântica de `study.web.ts`).
 */
function versesForPassage(verse: number | undefined, rows: ChapterRow[]): AiVerseInput[] {
  const wanted = verse == null ? () => true : (v: number) => v === verse;
  return rows.filter((r) => wanted(r.verse)).map((r) => ({ number: r.verse, text: r.text }));
}

/**
 * Monta a string de referência canônica (nome EN do livro, do cânon PURO do Rust via
 * `listBooks`) que `aiWebFinalize` re-parseia (`parse_reference`) para compor a
 * `AiAnswer.reference`. `sessionWebPrepare` recebe a passagem NUMÉRICA; `aiWebFinalize`
 * (reuso do `ask`) recebe a referência textual — daqui sai a mesma referência canônica.
 */
function referenceString(book: number, chapter: number, verse: number | undefined): string {
  const found = listBooks().find((b: Book) => b.number === book);
  const name = found ? found.nameEn : `Book ${book}`;
  return verse == null ? `${name} ${chapter}` : `${name} ${chapter}:${verse}`;
}

/**
 * PIPELINE web da CONVERSA ANCORADA sobre um handle de leitura ABERTO + um `fetch`
 * INJETÁVEL — a função de PRODUÇÃO exercitada pela prova headless (VFS de memória + fetch
 * MOCK) e pelo browser (OPFS + `globalThis.fetch`, via `reading.web.ts`). Passos:
 *   1) `hasTranslation` ANTES (paridade com o nativo → `UnknownTranslation`);
 *   2) `queryChapter` (SELECT existente) + recorte → `verses` do STORE (verbatim);
 *   3) `sessionWebPrepare` (wasm) → `citedText` (store, numerado) + `system`/`user` da
 *      conversa (ai-pure; transcript dobrado); `related = []` (RAG leve = follow-up);
 *   4) transporte TS (`fetch`) → `interpretation` (a única rede, opt-in, com a chave);
 *   5) `aiWebFinalize` (wasm, REUSO do `ask`) → `AiAnswer` (citação anti-alucinação em
 *      Rust; `citedText` do store SEPARADO da `interpretation`).
 * Anti-alucinação COM ZERO DRIFT: o texto bíblico vem SEMPRE do store; prompt/conversa/
 * citação do MESMO Rust `ai-pure` no web e no nativo.
 */
export async function askSessionAnchoredOnHandle(
  handle: ReadingDb,
  fetchImpl: AiFetch,
  translation: string,
  book: number,
  chapter: number,
  verse: number | undefined,
  lang: string,
  turns: ChatTurn[],
  studyMode: StudyMode | undefined,
  studyLens: StudyLens | undefined,
  provider: string,
  key: string | undefined,
  model: string | undefined,
): Promise<AiAnswer> {
  if (!(await hasTranslation(handle, translation))) {
    // Espelha `SourceError::UnknownTranslation` propagado pelo nativo.
    throw new Error(`versão desconhecida: ${translation}`);
  }
  const rows = await queryChapter(handle, translation, book, chapter);
  const verses = versesForPassage(verse, rows);

  // (3) prepare (wasm) — prompt/conversa/RAG do Rust `ai-pure`. related = [] (F3.12b MVP).
  const request = sessionWebPrepare(
    book,
    chapter,
    verse,
    lang,
    turns,
    studyMode,
    studyLens,
    provider,
    model,
    verses,
    [],
  );

  // (4) transporte (`fetch`) — a chave vai SÓ no header (nunca logada/na URL).
  const interpretation = await webLlmTransport(fetchImpl, provider, key, {
    system: request.system,
    user: request.user,
    model: request.model,
  });

  // (5) finalize (wasm, REUSO do `ask`) — citação anti-alucinação; store ≠ interpretação.
  return aiWebFinalize(
    referenceString(book, chapter, verse),
    request.citedText,
    request.provider,
    request.model,
    interpretation,
  );
}
