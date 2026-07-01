// app/web/ai-anchored.web.ts — F2.7b (ADR-0025): paridade web de IA (ask ancorado)
//
// PIPELINE web do `ask` ancorado (hand-written, VERSIONADO), SEM dependências de OPFS/
// asset (par exato de `sqlite-search.web.ts`/`sqlite-xref.web.ts`: infra pura, exercitada
// por `reading.web.ts` no browser e pela prova headless em node). O contrato
// anti-alucinação COM ZERO DRIFT vem do Rust `ai-pure` no wasm:
//   - `aiWebPrepare` (wasm): monta `cited_text` (numerado, VERBATIM do store), o `system`/
//     `user` EXATOS (mesmo prompt do nativo, capturado via `ask`) e resolve `provider`/
//     `model`. NENHUM prompt/RAG/citação é reimplementado em TS.
//   - transporte TS (`fetch`): a ÚNICA rede em runtime da IA web (opt-in, com a chave). Os
//     `*_body`/`*_extract` do core são PRIVADOS (ADR-0024/ADR-0025) → o corpo do request e
//     a extração da resposta são feitos aqui, em TS, ESPELHANDO `gemini_body`/`gemini_extract`
//     (transporte = infra, ADR-0023/D2). MVP = Gemini (validado na F2.6).
//   - `aiWebFinalize` (wasm): aplica `citation::rewrite_anchors` (citação anti-alucinação em
//     Rust) e monta o `AiAnswer` com o `cited_text` do store SEPARADO da `interpretation`.
//
// O `fetch` é INJETÁVEL (a prova headless passa um MOCK; produção usa `globalThis.fetch`).
// A chave vai SÓ no header `x-goog-api-key` (NUNCA na URL/log). O TEXTO bíblico vem SEMPRE
// do store local (subset `reading-sample.sqlite`, F1.13); o LLM só interpreta.
// Importa as FUNÇÕES direto de `the_light_app_core` (não de `index.web`): este último
// importa o `.wasm` como asset (p/ o `uniffiInitAsync` do browser), o que a prova
// headless em node (esbuild) não sabe carregar. As funções são o MESMO singleton wasm
// por qualquer caminho (`index.web` só reexporta) — no browser o wasm já está
// inicializado por `useWasmReady()`/`uniffiInitAsync` antes de `askAnchored` rodar.
import {
  aiWebFinalize,
  aiWebPrepare,
  parseReference,
  type AiAnswer,
  type AiVerseInput,
  type AiWebRequest,
  type Reference,
} from './generated/the_light_app_core';
import { hasTranslation, queryChapter, type ChapterRow, type ReadingDb } from './sqlite-reading.web';

/**
 * Assinatura do `fetch` do transporte web de IA — INJETÁVEL. Produção passa
 * `globalThis.fetch`; a prova headless passa um MOCK (sem rede/chave real). É o ÚNICO
 * ponto de rede em runtime da IA web (opt-in).
 */
export type AiFetch = typeof fetch;

// `DEFAULT_MAX_TOKENS` do core (providers.rs:29) — o corpo Gemini o inclui em
// `generationConfig.maxOutputTokens`, espelhando `gemini_body`.
const GEMINI_MAX_TOKENS = 8192;

/**
 * Resposta determinística OFFLINE do provedor `"mock"` (sem rede/chave), ESPELHANDO a
 * resposta canônica do `MockLlmProvider::default()` do core. Mantém o caminho de estudo
 * utilizável offline no web (default seguro do `ReaderAskPanel`) — texto do "modelo",
 * NÃO bíblico.
 */
const MOCK_INTERPRETATION =
  'Interpretação simulada (provedor de teste). ' +
  'A passagem é citada acima a partir do texto local.';

/**
 * Extrai `candidates[0].content.parts[*].text` (concatenado) — ESPELHA o `gemini_extract`
 * PRIVADO do core (providers.rs). Sem `candidates`, tenta `promptFeedback.blockReason`
 * (resposta bloqueada por segurança) para uma mensagem clara.
 */
function geminiExtract(raw: unknown): string {
  const v = raw as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    promptFeedback?: { blockReason?: unknown };
  };
  const candidates = v?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const reason = v?.promptFeedback?.blockReason;
    throw new Error(
      typeof reason === 'string'
        ? `resposta bloqueada pelo provedor: ${reason}`
        : 'sem `candidates` na resposta',
    );
  }
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error('sem `content.parts` no candidate');
  }
  const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  if (text.trim().length === 0) {
    throw new Error('resposta de texto vazia');
  }
  return text;
}

/**
 * Transporte Gemini (`fetch`): monta o corpo `generateContent` a partir do `system`/`user`
 * do `AiWebRequest` (ESPELHANDO `gemini_body` PRIVADO do core) e extrai a interpretação. O
 * modelo vai na URL; a chave vai no header `x-goog-api-key` — NUNCA na URL nem em log.
 */
async function geminiComplete(
  fetchImpl: AiFetch,
  key: string,
  request: AiWebRequest,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
    system_instruction: { parts: [{ text: request.system }] },
    generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS },
  };
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Mensagem cita o status HTTP — NUNCA a chave.
    throw new Error(`provedor "gemini" respondeu HTTP ${res.status}`);
  }
  const raw: unknown = await res.json();
  return geminiExtract(raw);
}

/**
 * Despacha o transporte por provedor. `"mock"` = determinístico offline (sem rede/chave).
 * `"gemini"` = `fetch` real (MVP web, F2.6). Demais provedores reais são follow-up
 * (ADR-0025). A chave é exigida só para provedores de rede.
 */
async function webTransport(
  fetchImpl: AiFetch,
  provider: string,
  key: string | undefined,
  request: AiWebRequest,
): Promise<string> {
  if (provider === 'mock') {
    return MOCK_INTERPRETATION;
  }
  if (provider === 'gemini') {
    if (key == null || key.trim().length === 0) {
      // Não vaza a chave (nem sua ausência de valor) — cita só o provedor.
      throw new Error('Configure a chave do provedor "gemini" para usar a IA no web.');
    }
    return geminiComplete(fetchImpl, key, request);
  }
  throw new Error(
    `Provedor "${provider}" ainda não tem transporte web (F2.7b MVP = Gemini). Use "gemini" ou "mock".`,
  );
}

/**
 * Seleciona os versículos da referência a partir das linhas do capítulo lidas do store
 * (TEXTO verbatim). Single → o versículo; Range → o intervalo inclusivo; WholeChapter →
 * todos. Espelha a semântica de `EmbeddedSource::passage` (recorte por `VerseRange`).
 */
function versesForReference(ref: Reference, rows: ChapterRow[]): AiVerseInput[] {
  const v = ref.verses;
  const wanted =
    v.tag === 'Single'
      ? (verse: number) => verse === v.inner.verse
      : v.tag === 'Range'
        ? (verse: number) => verse >= v.inner.start && verse <= v.inner.end
        : () => true; // WholeChapter
  return rows.filter((r) => wanted(r.verse)).map((r) => ({ number: r.verse, text: r.text }));
}

/**
 * PIPELINE web do `ask` ancorado sobre um handle de leitura ABERTO + um `fetch`
 * INJETÁVEL — a função de PRODUÇÃO exercitada pela prova headless (VFS de memória + fetch
 * MOCK) e pelo browser (OPFS + `globalThis.fetch`, via `reading.web.ts`). Passos:
 *   1) `parseReference` (wasm) → book/chapter/verse canônico;
 *   2) `hasTranslation` ANTES (paridade com o nativo → `UnknownTranslation`);
 *   3) `queryChapter` (SELECT existente, SEM novo SQL) + recorte → `verses` do STORE;
 *   4) `aiWebPrepare` (wasm) → `cited_text` (store, numerado) + `system`/`user` (ai-pure);
 *   5) transporte TS (`fetch`) → `interpretation` (a única rede, opt-in, com a chave);
 *   6) `aiWebFinalize` (wasm) → `AiAnswer` (citação anti-alucinação em Rust; cited_text
 *      SEPARADO da interpretation).
 * Anti-alucinação COM ZERO DRIFT: o texto bíblico vem SEMPRE do store; prompt+citação do
 * MESMO Rust `ai-pure` no web e no nativo.
 */
export async function askAnchoredOnHandle(
  handle: ReadingDb,
  fetchImpl: AiFetch,
  translation: string,
  reference: string,
  question: string,
  provider: string,
  key: string | undefined,
  model: string | undefined,
  lang: string,
): Promise<AiAnswer> {
  const ref = parseReference(reference);
  if (!(await hasTranslation(handle, translation))) {
    // Espelha `SourceError::UnknownTranslation` propagado pelo nativo.
    throw new Error(`versão desconhecida: ${translation}`);
  }
  const rows = await queryChapter(handle, translation, ref.book, ref.chapter);
  const verses = versesForReference(ref, rows);
  const request = aiWebPrepare(reference, question, provider, model, lang, verses);
  const interpretation = await webTransport(fetchImpl, provider, key, request);
  return aiWebFinalize(
    reference,
    request.citedText,
    request.provider,
    request.model,
    interpretation,
  );
}
