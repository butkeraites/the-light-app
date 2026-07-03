// app/web/reading.ts — F1.3 (ADR-0014)
//
// GLUE NATIVO de LEITURA (hand-written, VERSIONADO). Delega à fronteira UniFFI
// (F1.2) exposta pelo Turbo Module GERADO (JSI → the-light-core): listBooks,
// listTranslations, getChapter, chapterCount. NÃO reimplementa SQL/leitura em TS:
// o cânon, o store e o texto vêm do Rust (uma fonte da verdade; anti-alucinação —
// o texto do versículo é verbatim do store local). Resolução por extensão do
// Metro: este `.ts` vale no NATIVO; no web vale `reading.web.ts` (stub = F1.13).
//
// `./native-generated/src/index` é o barrel gerado do Turbo Module (instala o
// crate Rust no runtime JSI na importação e reexporta os bindings UniFFI).
import {
  listBooks as listBooksNative,
  listTranslations as listTranslationsNative,
  getChapter as getChapterNative,
  chapterCount as chapterCountNative,
  search as searchNative,
  crossRefs as crossRefsNative,
  putNote as putNoteNative,
  getNote as getNoteNative,
  deleteNote as deleteNoteNative,
  listNotes as listNotesNative,
  addHighlight as addHighlightNative,
  removeHighlight as removeHighlightNative,
  listHighlights as listHighlightsNative,
  askAnchored as askAnchoredNative,
  askAnchoredStream as askAnchoredStreamNative,
  deepStudy as deepStudyNative,
  lexicalEntries as lexicalEntriesNative,
  askSessionAnchored as askSessionAnchoredNative,
  listReadingPlans as listReadingPlansNative,
  readingPlanDay as readingPlanDayNative,
  readingPlanDayIndex as readingPlanDayIndexNative,
  readingPlanProgress as readingPlanProgressNative,
  startReadingPlan as startReadingPlanNative,
  setReadingPlanCompleted as setReadingPlanCompletedNative,
  clearReadingPlan as clearReadingPlanNative,
} from './native-generated/src/index';
import type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
  AiAnswer,
  AiTokenCallback,
  StudyResultOut,
  StudySection,
  StudyCitation,
  VerifiedLexiconOut,
  LexEntry,
  ChatTurn,
  ReadingPlanSummary,
  ReadingPlanDay,
  ReadingPlanProgress,
} from './native-generated/bindings/the_light_app_core';
import {
  StudyMode,
  StudyLens,
  StudyDepth,
  ChatRole,
} from './native-generated/bindings/the_light_app_core';

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
  ReadingPlanProgress,
};
export { StudyMode, StudyLens, StudyDepth, ChatRole };

/** 66 livros canônicos (PURO — `reference::BOOKS`, independe do banco). */
export function listBooks(): Book[] {
  return listBooksNative();
}

/** Traduções presentes no store (`db_path`): ex.: KJV (en) e Almeida 1911 (pt). */
export async function listTranslations(dbPath: string): Promise<Translation[]> {
  return listTranslationsNative(dbPath);
}

/**
 * Capítulo inteiro numerado por versículo, do store local. O `text` de cada
 * versículo vem VERBATIM do store (anti-alucinação). Síncrono no JSI (o crate já
 * está instalado); embrulhado em Promise p/ assinatura uniforme com o web.
 */
export async function getChapter(
  dbPath: string,
  translation: string,
  book: number,
  chapter: number,
): Promise<Passage> {
  return getChapterNative(dbPath, translation, book, chapter);
}

/** Capítulos do livro PRESENTES no store (`max(chapter)`; 0 se ausente). */
export async function chapterCount(
  dbPath: string,
  translation: string,
  book: number,
): Promise<number> {
  return chapterCountNative(dbPath, translation, book);
}

/**
 * Busca full-text (FTS5/BM25, acento-insensível) no store local, delegando à
 * fronteira `search` da F1.5 (binding gerado → JSI → the_light_core::search).
 * NÃO reimplementa SQL/FTS/`MATCH`/`bm25`/`highlight` em TS: o índice, o ranking
 * e o destaque vivem no core; a UI só embrulha o retorno (uma fonte da verdade).
 * Cada `SearchHit` traz `text` VERBATIM do store (anti-alucinação) e `highlighted`
 * com os marcadores de controle do core ao redor do termo casado — a UI da F1.6
 * os converte em estilo. Síncrono no JSI; embrulhado em Promise p/ assinatura
 * uniforme com o web (stub = F1.14). `book`/`limit` opcionais (padrões do core).
 */
export async function search(
  dbPath: string,
  query: string,
  translation: string,
  book?: number,
  limit?: number,
): Promise<SearchHit[]> {
  return searchNative(dbPath, query, translation, book, limit);
}

/**
 * Referências cruzadas (xref) de um versículo, delegando à fronteira `cross_refs`
 * da F1.8 (binding gerado `crossRefs` → JSI → `the_light_core::xref::for_verse`).
 * NÃO reimplementa SQL/consulta/ordenação/filtro de votos em TS: a busca da tabela,
 * a ordenação por votos (DESC) e o corte por `min_votes`/`limit` vivem no core; a UI
 * (F1.9) só apresenta o `Vec<CrossRef>` retornado (uma fonte da verdade). Cada
 * `CrossRef` é só **referência** de destino + `votes` (anti-alucinação: nenhum texto
 * bíblico). `minVotes`/`limit` opcionais (padrões do core: `min_votes`=1 oculta
 * disputadas/negativas; `limit`=20). `votes` é `i64` no core → `bigint` no binding
 * (a UI/self-test formatam via `String(...)`, robusto a `number`/`bigint`). Versículo
 * sem xref → `Vec` vazio (não erro). Síncrono no JSI; embrulhado em Promise p/
 * assinatura uniforme com o web (stub = F1.15).
 */
export async function crossRefs(
  dbPath: string,
  book: number,
  chapter: number,
  verse: number,
  minVotes?: bigint,
  limit?: number,
): Promise<CrossRef[]> {
  return crossRefsNative(dbPath, book, chapter, verse, minVotes, limit);
}

// ── USERDATA (notas/highlights) — F1.11, fronteira F1.10 ─────────────────────
// Glue NATIVO da fronteira `userdata` (F1.10): delega às 7 funções geradas
// (`putNote`/`getNote`/`deleteNote`/`listNotes`/`addHighlight`/`removeHighlight`/
// `listHighlights`) → JSI → o módulo `userdata` do the-light-core.
// NÃO reimplementa I/O de arquivo, serialização de userdata, slug de
// referência nem ordenação em TS — tudo vive no core (uma fonte da verdade). A UI só
// chama estas funções e apresenta os Records `Note`/`Highlight` retornados.
//
// O `dataDir` é o diretório GRAVÁVEL de userdata (`${documentDirectory}userdata/`,
// via `app/lib/userdata.ts`), SEPARADO do banco só-leitura (`ensureReadingDb`). A
// `reference` é a string canônica (ex.: `"John 3:16"`); o core a parseia
// (`parse_reference`) — PT e EN caem na MESMA nota/highlight. O `body`/`color`/`tag`
// são dado livre do usuário (anti-alucinação não se aplica ao corpo). Síncrono no
// JSI; embrulhado em Promise p/ assinatura uniforme com o web (stub = F1.16).

/** Cria/substitui a NOTA (Markdown) de uma referência (escrita atômica no core). */
export async function putNote(dataDir: string, reference: string, body: string): Promise<void> {
  return putNoteNative(dataDir, reference, body);
}

/** Lê a NOTA de uma referência; ausente → `undefined` (não erro). */
export async function getNote(dataDir: string, reference: string): Promise<Note | undefined> {
  return getNoteNative(dataDir, reference);
}

/** Remove a NOTA; `true` se removeu, idempotente → `false` se não havia. */
export async function deleteNote(dataDir: string, reference: string): Promise<boolean> {
  return deleteNoteNative(dataDir, reference);
}

/** Lista todas as NOTAS (ordenadas por referência canônica pelo core). */
export async function listNotes(dataDir: string): Promise<Note[]> {
  return listNotesNative(dataDir);
}

/** Marca/atualiza um HIGHLIGHT (mesma referência substitui a cor); `tag` opcional. */
export async function addHighlight(
  dataDir: string,
  reference: string,
  color: string,
  tag?: string,
): Promise<void> {
  return addHighlightNative(dataDir, reference, color, tag);
}

/** Desmarca o HIGHLIGHT da referência; devolve quantos saíram (idempotente → 0). */
export async function removeHighlight(dataDir: string, reference: string): Promise<number> {
  return removeHighlightNative(dataDir, reference);
}

/** Lista todos os HIGHLIGHTS do usuário. */
export async function listHighlights(dataDir: string): Promise<Highlight[]> {
  return listHighlightsNative(dataDir);
}

// ── ESTUDO ASSISTIDO ANCORADO (ask) — F2.5, fronteira F2.1/F2.3a ──────────────
// Glue NATIVO da fronteira de IA (`ask_anchored`/`ask_anchored_stream`): delega às
// funções geradas → JSI → a camada `ai` do the-light-core. NÃO reimplementa
// prompt/RAG/citação/streaming em TS — TODO o pipeline (referência canônica →
// passagem VERBATIM do store → contexto ancorado → provedor BYOK → interpretação)
// vive no core (uma fonte da verdade). O `AiAnswer` retornado SEPARA `citedText`
// (texto bíblico, verbatim do store — anti-alucinação) da `interpretation` (saída
// do LLM/mock); o texto do versículo NUNCA vem do modelo.
//
// BYOK/offline-first: a `key` é ARGUMENTO (lida sob demanda do keystore pela UI) e
// NUNCA é logada aqui; com `provider="mock"` não há chave nem rede (prova headless).
// A paridade web de IA é a F2.7 (`reading.web.ts` = stub). Síncrono no JSI;
// embrulhado em Promise p/ assinatura uniforme com o web.

/**
 * Pergunta ancorada (sem streaming): resposta completa de uma vez. `key`/`model`
 * `undefined` no mock (o core usa o default). Delega ao binding gerado `askAnchored`.
 */
export async function askAnchored(
  dbPath: string,
  translation: string,
  reference: string,
  question: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  lang: string,
): Promise<AiAnswer> {
  return askAnchoredNative(dbPath, translation, reference, question, provider, key, model, lang);
}

/**
 * Pergunta ancorada com STREAMING: constrói o objeto `AiTokenCallback` (`{ onToken }`)
 * que a fronteira invoca a CADA incremento da interpretação (o mock emite a resposta
 * inteira 1×; provedores reais fazem SSE na F2.6), e devolve o `AiAnswer` final. Os
 * tokens são da INTERPRETAÇÃO (LLM), nunca do texto bíblico (que viaja separado, do
 * store, em `citedText`). Delega ao binding gerado `askAnchoredStream`.
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
  const callback: AiTokenCallback = { onToken };
  return askAnchoredStreamNative(
    dbPath,
    translation,
    reference,
    question,
    provider,
    key,
    model,
    lang,
    callback,
  );
}

// ── ESTUDO PROFUNDO + LÉXICO (deep_study/lexical_entries) — F3.5, fronteira F3.2/F3.3 ─
// Glue NATIVO das duas funções de estudo/léxico geradas → JSI → a camada `ai` do
// the-light-core. NÃO reimplementa prompt/RAG/aparato/SQL/JOIN de léxico em TS — TODO
// o pipeline (passagem VERBATIM do store → léxico verificado do banco → RAG leve →
// provedor BYOK → interpretação) vive no core (uma fonte da verdade). O `StudyResultOut`
// SEPARA `passageText` (texto bíblico, verbatim do store — anti-alucinação) da
// `interpretation` (saída do LLM/mock); as `citations` e o léxico vêm SEMPRE do banco
// local verificado (STEP Bible CC-BY), nunca do modelo. `VerifiedLexiconOut.sources`
// preserva a ATRIBUIÇÃO STEP CC-BY que a UI (F3.5) exibe obrigatoriamente.
//
// BYOK/offline-first: a `key` é ARGUMENTO (lida sob demanda do keystore pela UI) e
// NUNCA é logada aqui; com `provider="mock"` não há chave nem rede (prova headless).
// A paridade web de estudo/léxico é a F3.12 (`reading.web.ts` = stub). Síncrono no JSI;
// embrulhado em Promise p/ assinatura uniforme com o web.
//
// ATENÇÃO à ordem REAL dos argumentos da fronteira (contra alucinação): `deep_study`
// recebe `lang` ANTES de `providerName`, e a passagem é `book/chapter/verse` NUMÉRICOS
// (não uma string "John 3:16"); `lexical_entries` NÃO tem `translation` (o léxico é
// independente de tradução, chaveado por book/chapter[/verse]).

/**
 * Estudo profundo (modo × lente × profundidade) de uma passagem, delegando ao binding
 * gerado `deepStudy` → JSI → `the_light_core::ai::study`. `key`/`model` `undefined` no
 * mock (o core usa o default e não faz rede). O `StudyResultOut` traz `passageText`
 * (store, verbatim) SEPARADO de `interpretation` (LLM), mais `sections`/`citations`/
 * `warnings`. Anti-alucinação: o texto bíblico e as citações vêm do banco, não do modelo.
 *
 * `researchBackend` (ADR-0028/F3.9a) liga a PESQUISA WEB opt-in de fontes secundárias
 * (`[W:n]`): `undefined` (padrão) = desligado, sem rede; `"wikipedia"` = keyless, rede
 * opt-in do usuário (validada na F4.5); `"mock"` = fontes canônicas sem rede (prova);
 * `"tavily"` = BYOK, rede opt-in (F4.5). O core cita as URLs REALMENTE buscadas, nunca o
 * modelo (anti-alucinação). Só NATIVO.
 *
 * `researchKey` (ADR-0035/F4.3) é a chave BYOK de pesquisa, repassada DIRETO ao core:
 * `"mock"`/`"wikipedia"` a IGNORAM (keyless); `"tavily"` a EXIGE (sem ela → erro, antes de
 * qualquer rede). NUNCA logada/persistida aqui; a UI de Tavily web é a F4.4.
 */
export async function deepStudy(
  dbPath: string,
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
  return deepStudyNative(
    dbPath,
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
}

/**
 * Dados léxicos Strong verificados de uma passagem, delegando ao binding gerado
 * `lexicalEntries` → JSI → `the_light_core::ai::lexicon`. SEM `translation` (léxico é
 * independente de tradução). Cada `LexEntry` traz `strongs`/`lemma`/`translit`/`gloss`
 * VERBATIM do léxico local (STEP Bible / TBESH–TBESG, CC-BY) — nenhum LLM envolvido
 * (lookup puro de banco, anti-alucinação). `sources` guarda a atribuição STEP CC-BY que
 * a UI exibe obrigatoriamente. `limit` opcional (padrão do core).
 */
export async function lexicalEntries(
  dbPath: string,
  book: number,
  chapter: number,
  verse: number | undefined,
  lang: string,
  limit: number | undefined,
): Promise<VerifiedLexiconOut> {
  return lexicalEntriesNative(dbPath, book, chapter, verse, lang, limit);
}

// ── CONVERSA/FOLLOW-UP ANCORADO (ask_session_anchored) — F3.6, fronteira F3.4 ────────
// Glue NATIVO da fronteira de CONVERSA multi-turno (`ask_session_anchored`): delega ao
// binding gerado → JSI → a camada `ai` do the-light-core. NÃO reimplementa prompt/RAG/
// contexto/conversa em TS — TODO o pipeline (passagem VERBATIM do store → âncora montada
// pelo core, injetada SÓ no 1º turno de usuário → provedor BYOK → interpretação) vive no
// core (uma fonte da verdade). O `AiAnswer` retornado SEPARA `citedText` (texto bíblico,
// verbatim do store — anti-alucinação) da `interpretation` (saída do LLM/mock); o texto
// do versículo NUNCA vem do modelo. A conversa mantém a ÂNCORA porque a UI passa SEMPRE o
// mesmo `book/chapter/verse` do store a cada follow-up.
//
// BYOK/offline-first: a `key` é ARGUMENTO (lida sob demanda do keystore pela UI) e NUNCA é
// logada aqui; com `provider="mock"` não há chave nem rede (prova headless). A paridade web
// da conversa é a F3.12 (`reading.web.ts` = stub). Síncrono no JSI; embrulhado em Promise
// p/ assinatura uniforme com o web.
//
// ATENÇÃO à ordem REAL dos argumentos da fronteira (contra alucinação): `lang` vem ANTES
// de `turns`; `studyMode`/`studyLens` vêm DEPOIS de `turns` e ANTES de `providerName`; a
// passagem é `book/chapter/verse` NUMÉRICOS (não uma string "John 3:16").

/**
 * Conversa/follow-up ancorado numa passagem: cada chamada envia o HISTÓRICO de turnos
 * (`turns`: `ChatTurn[]` User/Assistant) e recebe o `AiAnswer` do turno corrente. Delega
 * ao binding gerado `askSessionAnchored` → JSI → `the_light_core::ai`. `studyMode`/
 * `studyLens` `undefined` no fluxo simples; `key`/`model` `undefined` no mock (o core usa
 * o default e não faz rede). O `AiAnswer` traz `citedText` (store, verbatim — a âncora)
 * SEPARADO de `interpretation` (LLM); NÃO há campo `turns` no retorno (o histórico vive na
 * UI). Anti-alucinação: o texto bíblico e a âncora vêm do store, não do modelo.
 */
export async function askSessionAnchored(
  dbPath: string,
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
  return askSessionAnchoredNative(
    dbPath,
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
}

// ── PLANOS DE LEITURA (list/day/day_index) — F5.1, fronteira NATIVA ───────────
// Glue NATIVO da geração de PLANOS (`listReadingPlans`/`readingPlanDay`/
// `readingPlanDayIndex`): delega às funções geradas → JSI → o módulo
// `the_light_core::userdata::plans`. NÃO reimplementa geração/chunking/índice do dia em
// TS — o CATALOG (ids/nomes PT), a divisão em dias (capítulos inteiros) e o cálculo/clamp
// do dia de hoje vivem no core (uma fonte da verdade; anti-alucinação — as refs e os nomes
// de plano vêm do core, NUNCA hardcoded). Geração PURA em memória (sem rede/store/chave),
// SÍNCRONA como `listBooks`. F5.10: a GERAÇÃO virou cfg-free/wasm (ADR-0037), então o web
// (`reading.web.ts`) chama a MESMA impl REAL do core (zero-drift), não mais stubs.

/** Os 3 planos disponíveis (annual/nt/gospels) com nome PT verbatim do core + nº de dias. */
export function listReadingPlans(): ReadingPlanSummary[] {
  return listReadingPlansNative();
}

/**
 * As leituras (capítulos inteiros) de um dia (0-based) de um plano + rótulo legível (PT).
 * Plano desconhecido / dia fora do intervalo → `{ label: '', references: [] }` (sem throw).
 */
export function readingPlanDay(planId: string, day: number): ReadingPlanDay {
  return readingPlanDayNative(planId, day);
}

/**
 * Índice (0-based) do dia de hoje num plano de `len` dias, dado `startDate`/`today` ISO
 * `YYYY-MM-DD`; satura em `[0, len-1]` (delegado a `PlanProgress::day_index_for`). Data
 * inválida → lança (CoreError).
 */
export function readingPlanDayIndex(startDate: string, today: string, len: number): number {
  return readingPlanDayIndexNative(startDate, today, len);
}

// ── PROGRESSO DO PLANO (persistência PlanStore fs) — F5.4, fronteira NATIVA ────
// Glue NATIVO da PERSISTÊNCIA do progresso (`readingPlanProgress`/`startReadingPlan`/
// `setReadingPlanCompleted`/`clearReadingPlan`): delega às funções geradas → JSI → o
// `the_light_core::userdata::plans::PlanStore` (fs). NÃO reimplementa serialização/layout/
// escrita atômica de `reading-plans/active.json` em TS — tudo vive no core (uma fonte da
// verdade; anti-alucinação — o `planId` é validado contra o CATALOG do core). O `dataDir`
// é o MESMO diretório gravável de userdata (notas/highlights), SEPARADO do banco só-leitura;
// o core persiste em `<dataDir>/reading-plans/active.json` (único plano ativo — iniciar um
// novo SOBRESCREVE). I/O local → async (molde das notas F1.10). F5.10: a paridade web do
// PROGRESSO é app-side em OPFS (`reading.web.ts` + `plans-fs.web.ts`, mesmo formato do core).

/** Lê o PROGRESSO do plano ativo; sem plano ativo → `undefined` (não erro). */
export async function readingPlanProgress(
  dataDir: string,
): Promise<ReadingPlanProgress | undefined> {
  return readingPlanProgressNative(dataDir);
}

/**
 * INICIA um plano (`completed = 0`), gravando o progresso. `planId` fora do CATALOG do
 * core / `startDate` não-ISO (`YYYY-MM-DD`) → lança (CoreError), sem gravar. SOBRESCREVE o
 * plano ativo existente (o core guarda um só `active.json`).
 */
export async function startReadingPlan(
  dataDir: string,
  planId: string,
  startDate: string,
): Promise<ReadingPlanProgress> {
  return startReadingPlanNative(dataDir, planId, startDate);
}

/** ATUALIZA os dias concluídos do plano ativo; sem plano ativo → lança (CoreError). */
export async function setReadingPlanCompleted(
  dataDir: string,
  completed: number,
): Promise<ReadingPlanProgress> {
  return setReadingPlanCompletedNative(dataDir, completed);
}

/** REMOVE o plano ativo; `true` se removeu, idempotente → `false` se não havia. */
export async function clearReadingPlan(dataDir: string): Promise<boolean> {
  return clearReadingPlanNative(dataDir);
}
