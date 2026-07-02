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

/**
 * Partes mínimas de um request de LLM que o transporte web precisa: os prompts
 * `system`/`user` (montados pelo Rust `ai-pure` — ZERO drift) + o `model` resolvido.
 * Tanto `AiWebRequest` (ask, F2.7b) quanto `StudyWebRequest` (estudo, F3.12a) são
 * estruturalmente compatíveis → o MESMO transporte (`webLlmTransport`) serve aos dois,
 * sem espelhar prompt/citação em TS.
 */
export interface LlmRequestParts {
  system: string;
  user: string;
  model: string;
}

// `DEFAULT_MAX_TOKENS` do core (providers.rs:29) — o corpo Gemini o inclui em
// `generationConfig.maxOutputTokens`, espelhando `gemini_body`.
const GEMINI_MAX_TOKENS = 8192;

// `DEFAULT_MAX_TOKENS` do core (providers.rs:29) — `anthropic_body`/`openai_body` o incluem
// em `max_tokens` (mesmo valor que o Gemini usa em `maxOutputTokens`). O `ollama_body` NÃO
// tem `max_tokens` (espelha `ollama_body` do core). O `model` já vem RESOLVIDO no
// `request.model` (o `ai_web_prepare` aplica o `default_model` por provedor).
const DEFAULT_MAX_TOKENS = 8192;

// Endpoints FIXOS por provedor (transporte = infra, ADR-0025). A chave BYOK NUNCA aparece na
// URL — vai SÓ no header apropriado (ver `*Headers`). Ollama é LOCAL (localhost) e não usa
// BYOK: no web não há env `LIGHT_OLLAMA_HOST` → host default `http://localhost:11434`.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OLLAMA_URL = 'http://localhost:11434/api/chat';

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
 * Extrai o texto dos `parts` de UM `GenerateContentResponse` — parcial (um evento SSE do
 * `streamGenerateContent`) ou completo (`generateContent`): `candidates[0].content.parts[*]
 * .text` concatenado. LENIENTE: devolve `''` quando o evento não tem texto (ex.: um evento
 * SSE só com `usageMetadata`/`safetyRatings`, ou `finishReason` sem `parts`), SEM lançar —
 * é o extrator de DELTA do stream, chamado por evento. Mesmo shape do `gemini_extract`
 * PRIVADO do core (providers.rs); a versão ESTRITA (`geminiExtract`) valida/agrega em cima.
 */
function geminiPartText(raw: unknown): string {
  const v = raw as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  };
  const parts = v?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }
  return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
}

/**
 * Extrai `candidates[0].content.parts[*].text` (concatenado) da resposta COMPLETA (caminho
 * NÃO-streaming) — ESPELHA o `gemini_extract` PRIVADO do core (providers.rs). Sem
 * `candidates`, tenta `promptFeedback.blockReason` (resposta bloqueada por segurança) para
 * uma mensagem clara; texto vazio → erro. REUSA `geminiPartText` na agregação.
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
  const text = geminiPartText(raw);
  if (text.trim().length === 0) {
    throw new Error('resposta de texto vazia');
  }
  return text;
}

/**
 * Corpo do request Gemini (`contents`/`system_instruction`/`generationConfig`) a partir do
 * `system`/`user`/`model` do `AiWebRequest` — ESPELHA `gemini_body` PRIVADO do core. O MESMO
 * corpo serve ao endpoint `:generateContent` (não-streaming) e `:streamGenerateContent`
 * (streaming, SSE) — só a URL muda.
 */
function geminiBody(request: LlmRequestParts): string {
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
    system_instruction: { parts: [{ text: request.system }] },
    generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS },
  });
}

/**
 * `POST` genérico do transporte web de IA (REUSADO por todos os provedores de rede). Envia
 * `body` (JSON já serializado) a `url` com os `headers` do provedor — a chave BYOK vai SÓ no
 * header (nunca na URL/log). Em `!res.ok`, lança um erro que cita o provedor + o status HTTP —
 * NUNCA a chave. Devolve o `Response` cru (o chamador faz `res.json()` no não-streaming ou lê
 * `res.body` no streaming).
 */
async function postJson(
  fetchImpl: AiFetch,
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<Response> {
  const res = await fetchImpl(url, { method: 'POST', headers, body });
  if (!res.ok) {
    // Mensagem cita o provedor + o status HTTP — NUNCA a chave.
    throw new Error(`provedor "${provider}" respondeu HTTP ${res.status}`);
  }
  return res;
}

/**
 * Lê um `ReadableStream` de resposta LINHA a LINHA (`getReader()` + `TextDecoder` + buffer),
 * chamando `onLine` para cada linha completa (quebra por `\n`) e, ao fim, para a última linha
 * sem `\n` final (flush). Reconstrói linhas QUEBRADAS através de fronteiras de chunk (buffer).
 * NÃO interpreta o conteúdo — é o esqueleto de leitura COMPARTILHADO pelos transportes de
 * streaming: SSE (gemini/anthropic/openai) e NDJSON (ollama) diferem só no `onLine`.
 */
async function readLineStream(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      onLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  // Flush do decoder + eventual última linha sem `\n` final.
  buffer += decoder.decode();
  if (buffer.length > 0) {
    onLine(buffer);
  }
}

/**
 * Parseia UMA linha SSE `data: {…}` (formato compartilhado por gemini/anthropic/openai):
 * devolve o objeto JSON parseado, ou `undefined` quando a linha NÃO é um `data:` JSON útil —
 * linha vazia, `event:`/`id:`/`:`comentário, `data: [DONE]`, ou JSON inválido (ruído/parcial
 * tolerado pelo parser incremental). O DELTA por provedor é extraído pelo chamador (cada API
 * tem seu shape). `JSON.parse` nunca devolve `undefined` → o sentinela é seguro.
 */
function parseSseData(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('data:')) {
    return undefined;
  }
  const payload = trimmed.slice('data:'.length).trim();
  if (payload.length === 0 || payload === '[DONE]') {
    return undefined;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/**
 * Transporte Gemini (`fetch`): monta o corpo `generateContent` a partir do `system`/`user`
 * do `AiWebRequest` (ESPELHANDO `gemini_body` PRIVADO do core) e extrai a interpretação. O
 * modelo vai na URL; a chave vai no header `x-goog-api-key` — NUNCA na URL nem em log.
 */
async function geminiComplete(
  fetchImpl: AiFetch,
  key: string,
  request: LlmRequestParts,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent`;
  const res = await postJson(
    fetchImpl,
    'gemini',
    url,
    { 'x-goog-api-key': key, 'content-type': 'application/json' },
    geminiBody(request),
  );
  const raw: unknown = await res.json();
  return geminiExtract(raw);
}

/**
 * Transporte Gemini STREAMING (`fetch` + `ReadableStream`): usa o endpoint
 * `:streamGenerateContent?alt=sse` (mesmo corpo do não-streaming). Lê `res.body` incremental
 * (`getReader()` + `TextDecoder`), quebra por linha, parseia cada evento SSE `data: {…}` (um
 * `GenerateContentResponse` PARCIAL com o MESMO shape), extrai o DELTA de texto
 * (`geminiPartText`), chama `onToken(delta)` por evento e ACUMULA o texto completo — que é o
 * MESMO que o `:generateContent` devolveria e que segue para `ai_web_finalize` (ZERO drift).
 * O modelo vai na URL; a chave vai SÓ no header `x-goog-api-key` — NUNCA na URL nem em log.
 * ANTI-ALUCINAÇÃO: os deltas são só da INTERPRETAÇÃO do modelo; nenhum texto bíblico é
 * streamado (o `cited_text` viaja SEPARADO, do store, via `ai_web_prepare`/`finalize`).
 */
async function geminiCompleteStream(
  fetchImpl: AiFetch,
  key: string,
  request: LlmRequestParts,
  onToken: (token: string) => void,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:streamGenerateContent?alt=sse`;
  const res = await postJson(
    fetchImpl,
    'gemini',
    url,
    { 'x-goog-api-key': key, 'content-type': 'application/json' },
    geminiBody(request),
  );
  if (res.body == null) {
    throw new Error('resposta de streaming do provedor "gemini" sem corpo (`body`)');
  }

  // Cada evento SSE `data: {…}` é um `GenerateContentResponse` parcial (mesmo shape) → extrai
  // o delta (`geminiPartText`) e, se houver texto, emite + acumula. `[DONE]`/linhas vazias/
  // parciais são ignoradas por `parseSseData`.
  let full = '';
  await readLineStream(res.body, (line) => {
    const parsed = parseSseData(line);
    if (parsed === undefined) {
      return;
    }
    const delta = geminiPartText(parsed);
    if (delta.length > 0) {
      full += delta;
      onToken(delta);
    }
  });

  if (full.trim().length === 0) {
    throw new Error('resposta de texto (streaming) vazia');
  }
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Anthropic (Messages API) — ESPELHA `anthropic_body`/`anthropic_extract` PRIVADOS do core
// (providers.rs). Endpoint único (não-stream E stream): `POST /v1/messages`. Chave BYOK no
// header `x-api-key` (+`anthropic-version`) — NUNCA na URL/log.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Headers do request Anthropic — a chave BYOK vai SÓ em `x-api-key` (nunca na URL/log). */
function anthropicHeaders(key: string): Record<string, string> {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

/**
 * Corpo do request Anthropic (`model`/`max_tokens`/`system`/`thinking`/`messages`) — ESPELHA
 * `anthropic_body` PRIVADO do core: o `user` vai como ÚNICA mensagem `role:"user"`; o `system`
 * é campo próprio; `thinking:{type:"adaptive"}` (pensamento adaptativo do core). `stream`
 * (streaming) adiciona `"stream": true` — o MESMO endpoint serve aos dois caminhos.
 */
function anthropicBody(request: LlmRequestParts, stream: boolean): string {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: request.system,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: request.user }],
  };
  if (stream) {
    body.stream = true;
  }
  return JSON.stringify(body);
}

/**
 * Extrai a interpretação da resposta COMPLETA (não-streaming) do Anthropic — ESPELHA
 * `anthropic_extract` PRIVADO do core: `stop_reason=="refusal"` → erro; concatena os blocos
 * `content[]` onde `type=="text"` → `text` (ignora blocos de pensamento); texto vazio → erro.
 */
function anthropicExtract(raw: unknown): string {
  const v = raw as {
    stop_reason?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
  };
  if (v?.stop_reason === 'refusal') {
    throw new Error('o modelo recusou a solicitação (refusal)');
  }
  const blocks = v?.content;
  if (!Array.isArray(blocks)) {
    throw new Error('sem `content` na resposta');
  }
  const text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => (typeof b?.text === 'string' ? b.text : ''))
    .join('');
  if (text.trim().length === 0) {
    throw new Error('resposta de texto vazia');
  }
  return text;
}

/**
 * Extrai o DELTA de UM evento SSE do Anthropic (`content_block_delta` com
 * `delta.type=="text_delta"` → `delta.text`). LENIENTE: devolve `''` para eventos que NÃO são
 * delta de texto (`message_start`/`content_block_start`/`message_delta`/`message_stop`/`ping`).
 */
function anthropicDelta(raw: unknown): string {
  const v = raw as { type?: unknown; delta?: { type?: unknown; text?: unknown } };
  if (
    v?.type === 'content_block_delta' &&
    v?.delta?.type === 'text_delta' &&
    typeof v.delta.text === 'string'
  ) {
    return v.delta.text;
  }
  return '';
}

/** Transporte Anthropic não-streaming: `POST /v1/messages` → `res.json()` → `anthropicExtract`. */
async function anthropicComplete(
  fetchImpl: AiFetch,
  key: string,
  request: LlmRequestParts,
): Promise<string> {
  const res = await postJson(
    fetchImpl,
    'anthropic',
    ANTHROPIC_URL,
    anthropicHeaders(key),
    anthropicBody(request, false),
  );
  const raw: unknown = await res.json();
  return anthropicExtract(raw);
}

/**
 * Transporte Anthropic STREAMING (SSE): body com `stream:true`, lê `res.body` linha a linha
 * (`readLineStream`), parseia cada evento SSE (`parseSseData`), extrai o DELTA de texto
 * (`anthropicDelta`), `onToken(delta)` na ORDEM e ACUMULA o texto completo (idêntico ao
 * não-streaming) → segue para `ai_web_finalize` (ZERO drift). Chave SÓ no header.
 */
async function anthropicCompleteStream(
  fetchImpl: AiFetch,
  key: string,
  request: LlmRequestParts,
  onToken: (token: string) => void,
): Promise<string> {
  const res = await postJson(
    fetchImpl,
    'anthropic',
    ANTHROPIC_URL,
    anthropicHeaders(key),
    anthropicBody(request, true),
  );
  if (res.body == null) {
    throw new Error('resposta de streaming do provedor "anthropic" sem corpo (`body`)');
  }
  let full = '';
  await readLineStream(res.body, (line) => {
    const parsed = parseSseData(line);
    if (parsed === undefined) {
      return;
    }
    const delta = anthropicDelta(parsed);
    if (delta.length > 0) {
      full += delta;
      onToken(delta);
    }
  });
  if (full.trim().length === 0) {
    throw new Error('resposta de texto (streaming) vazia');
  }
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// OpenAI (Chat Completions) — ESPELHA `openai_body`/`openai_extract` PRIVADOS do core. Chave
// BYOK no header `authorization: Bearer <key>` — NUNCA na URL/log.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Headers do request OpenAI — a chave BYOK vai SÓ em `authorization: Bearer` (nunca na URL/log). */
function openaiHeaders(key: string): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };
}

/**
 * Corpo do request OpenAI (`model`/`max_tokens`/`messages`) — ESPELHA `openai_body` PRIVADO do
 * core: `system` e `user` como duas mensagens (`role:"system"`, `role:"user"`). `stream`
 * (streaming) adiciona `"stream": true`.
 */
function openaiBody(request: LlmRequestParts, stream: boolean): string {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  };
  if (stream) {
    body.stream = true;
  }
  return JSON.stringify(body);
}

/**
 * Extrai a interpretação da resposta COMPLETA (não-streaming) do OpenAI — ESPELHA
 * `openai_extract` PRIVADO do core: `choices[0].message.content`; ausente → erro; vazio → erro.
 */
function openaiExtract(raw: unknown): string {
  const v = raw as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = v?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('sem `choices[0].message.content`');
  }
  if (content.trim().length === 0) {
    throw new Error('resposta de texto vazia');
  }
  return content;
}

/**
 * Extrai o DELTA de UM evento SSE do OpenAI (`choices[0].delta.content`). LENIENTE: devolve
 * `''` quando o evento não tem texto (eventos só-`role`/`finish_reason`).
 */
function openaiDelta(raw: unknown): string {
  const v = raw as { choices?: Array<{ delta?: { content?: unknown } }> };
  const content = v?.choices?.[0]?.delta?.content;
  return typeof content === 'string' ? content : '';
}

/** Transporte OpenAI não-streaming: `POST /v1/chat/completions` → `res.json()` → `openaiExtract`. */
async function openaiComplete(
  fetchImpl: AiFetch,
  key: string,
  request: LlmRequestParts,
): Promise<string> {
  const res = await postJson(
    fetchImpl,
    'openai',
    OPENAI_URL,
    openaiHeaders(key),
    openaiBody(request, false),
  );
  const raw: unknown = await res.json();
  return openaiExtract(raw);
}

/**
 * Transporte OpenAI STREAMING (SSE): body com `stream:true`, lê `res.body` linha a linha,
 * parseia cada `data: {choices:[{delta:{content}}]}` (+`data: [DONE]`), extrai o DELTA
 * (`openaiDelta`), `onToken` na ORDEM e ACUMULA. Chave SÓ no header.
 */
async function openaiCompleteStream(
  fetchImpl: AiFetch,
  key: string,
  request: LlmRequestParts,
  onToken: (token: string) => void,
): Promise<string> {
  const res = await postJson(
    fetchImpl,
    'openai',
    OPENAI_URL,
    openaiHeaders(key),
    openaiBody(request, true),
  );
  if (res.body == null) {
    throw new Error('resposta de streaming do provedor "openai" sem corpo (`body`)');
  }
  let full = '';
  await readLineStream(res.body, (line) => {
    const parsed = parseSseData(line);
    if (parsed === undefined) {
      return;
    }
    const delta = openaiDelta(parsed);
    if (delta.length > 0) {
      full += delta;
      onToken(delta);
    }
  });
  if (full.trim().length === 0) {
    throw new Error('resposta de texto (streaming) vazia');
  }
  return full;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Ollama (local) — ESPELHA `ollama_body`/`ollama_extract` PRIVADOS do core. É LOCAL
// (localhost) e NÃO usa BYOK: header só `content-type`, SEM chave. Streaming é NDJSON (JSON
// por linha, sem prefixo `data:`), NÃO SSE.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Headers do request Ollama — SÓ `content-type` (Ollama é local, sem BYOK; NENHUM header de chave). */
function ollamaHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' };
}

/**
 * Corpo do request Ollama (`model`/`stream`/`messages`) — ESPELHA `ollama_body` PRIVADO do
 * core: `system` e `user` como duas mensagens. O flag `stream` vai no corpo (`false`
 * não-streaming, `true` streaming) — Ollama NÃO tem `max_tokens` no corpo.
 */
function ollamaBody(request: LlmRequestParts, stream: boolean): string {
  return JSON.stringify({
    model: request.model,
    stream,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
  });
}

/**
 * Extrai a interpretação da resposta COMPLETA (não-streaming) do Ollama — ESPELHA
 * `ollama_extract` PRIVADO do core: `message.content`; ausente → erro; vazio → erro.
 */
function ollamaExtract(raw: unknown): string {
  const v = raw as { message?: { content?: unknown } };
  const content = v?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('sem `message.content`');
  }
  if (content.trim().length === 0) {
    throw new Error('resposta de texto vazia');
  }
  return content;
}

/**
 * Extrai o DELTA de UMA linha NDJSON do Ollama (`message.content`). LENIENTE: devolve `''`
 * quando a linha não tem texto (ex.: a linha final `{"message":{"content":""},"done":true}`).
 */
function ollamaDelta(raw: unknown): string {
  const v = raw as { message?: { content?: unknown } };
  const content = v?.message?.content;
  return typeof content === 'string' ? content : '';
}

/** Transporte Ollama não-streaming: `POST {host}/api/chat` (SEM chave) → `res.json()` → `ollamaExtract`. */
async function ollamaComplete(fetchImpl: AiFetch, request: LlmRequestParts): Promise<string> {
  const res = await postJson(
    fetchImpl,
    'ollama',
    OLLAMA_URL,
    ollamaHeaders(),
    ollamaBody(request, false),
  );
  const raw: unknown = await res.json();
  return ollamaExtract(raw);
}

/**
 * Transporte Ollama STREAMING (NDJSON, NÃO SSE): body com `stream:true`, lê `res.body` linha a
 * linha — CADA linha é um JSON completo (sem prefixo `data:`) → parseia a linha inteira,
 * extrai o DELTA (`ollamaDelta`), `onToken` na ORDEM e ACUMULA. SEM chave (Ollama é local).
 */
async function ollamaCompleteStream(
  fetchImpl: AiFetch,
  request: LlmRequestParts,
  onToken: (token: string) => void,
): Promise<string> {
  const res = await postJson(
    fetchImpl,
    'ollama',
    OLLAMA_URL,
    ollamaHeaders(),
    ollamaBody(request, true),
  );
  if (res.body == null) {
    throw new Error('resposta de streaming do provedor "ollama" sem corpo (`body`)');
  }
  let full = '';
  await readLineStream(res.body, (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Linha NDJSON parcial/ruído — ignora (robustez do parser incremental).
      return;
    }
    const delta = ollamaDelta(parsed);
    if (delta.length > 0) {
      full += delta;
      onToken(delta);
    }
  });
  if (full.trim().length === 0) {
    throw new Error('resposta de texto (streaming) vazia');
  }
  return full;
}

/**
 * Emite o `MOCK_INTERPRETATION` OFFLINE em ≥1 incrementos (fatiado por palavra, preservando
 * os separadores → a concatenação é IDÊNTICA ao texto completo) via `onToken`, exercitando o
 * caminho de STREAM sem rede/chave. Devolve o texto completo (o MESMO do caminho
 * não-streaming) para a `ai_web_finalize`.
 */
function emitMockStream(onToken: (token: string) => void): string {
  const chunks = MOCK_INTERPRETATION.match(/\S+\s*/g) ?? [MOCK_INTERPRETATION];
  for (const chunk of chunks) {
    onToken(chunk);
  }
  return MOCK_INTERPRETATION;
}

/**
 * Despacha o transporte por provedor (REUSADO por `ask` e `estudo`). `"mock"` =
 * determinístico offline (sem rede/chave). `"gemini"`/`"anthropic"`/`"openai"`/`"ollama"` =
 * `fetch` real (F2.7b + F4.2). Cada provedor tem endpoint/headers/body/extract próprios,
 * ESPELHANDO os `*_body`/`*_extract` PRIVADOS do core (transporte = infra, ADR-0025). A chave
 * BYOK é exigida só para provedores de rede COM chave e vai SÓ no header apropriado — nunca na
 * URL/log: `x-goog-api-key` (gemini), `x-api-key`+`anthropic-version` (anthropic),
 * `authorization: Bearer` (openai); Ollama é LOCAL (localhost) e NÃO usa chave. É a ÚNICA rede
 * em runtime da IA web (opt-in); o prompt/citação vêm do Rust `ai-pure` (parts).
 *
 * `onToken` (F4.1/F4.2, opcional): quando presente, o transporte STREAMA a interpretação
 * token-a-token — SSE (`ReadableStream`) p/ gemini (`:streamGenerateContent?alt=sse`),
 * anthropic (`content_block_delta`) e openai (`choices[0].delta.content`); NDJSON p/ ollama
 * (JSON por linha); `"mock"` fatiando o texto offline. Sem `onToken`, mantém o caminho
 * NÃO-streaming (sem regressão). Em AMBOS os casos o texto COMPLETO acumulado é o mesmo → a
 * MESMA `ai_web_finalize` (ZERO drift). Os tokens são só da INTERPRETAÇÃO do modelo — nunca
 * texto bíblico (que viaja SEPARADO, do store).
 */
export async function webLlmTransport(
  fetchImpl: AiFetch,
  provider: string,
  key: string | undefined,
  parts: LlmRequestParts,
  onToken?: (token: string) => void,
): Promise<string> {
  if (provider === 'mock') {
    return onToken ? emitMockStream(onToken) : MOCK_INTERPRETATION;
  }
  if (provider === 'gemini') {
    if (key == null || key.trim().length === 0) {
      // Não vaza a chave (nem sua ausência de valor) — cita só o provedor.
      throw new Error('Configure a chave do provedor "gemini" para usar a IA no web.');
    }
    return onToken
      ? geminiCompleteStream(fetchImpl, key, parts, onToken)
      : geminiComplete(fetchImpl, key, parts);
  }
  if (provider === 'anthropic') {
    if (key == null || key.trim().length === 0) {
      // Não vaza a chave (nem sua ausência de valor) — cita só o provedor.
      throw new Error('Configure a chave do provedor "anthropic" para usar a IA no web.');
    }
    return onToken
      ? anthropicCompleteStream(fetchImpl, key, parts, onToken)
      : anthropicComplete(fetchImpl, key, parts);
  }
  if (provider === 'openai') {
    if (key == null || key.trim().length === 0) {
      // Não vaza a chave (nem sua ausência de valor) — cita só o provedor.
      throw new Error('Configure a chave do provedor "openai" para usar a IA no web.');
    }
    return onToken
      ? openaiCompleteStream(fetchImpl, key, parts, onToken)
      : openaiComplete(fetchImpl, key, parts);
  }
  if (provider === 'ollama') {
    // Ollama é LOCAL (localhost) e NÃO usa BYOK — sem chave (nem header de chave).
    return onToken
      ? ollamaCompleteStream(fetchImpl, parts, onToken)
      : ollamaComplete(fetchImpl, parts);
  }
  throw new Error(
    `Provedor "${provider}" ainda não tem transporte web. Use "anthropic", "openai", "gemini", "ollama" ou "mock".`,
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
 *
 * `onToken` (F4.1, opcional): quando presente, o transporte STREAMA a interpretação
 * token-a-token (SSE/`ReadableStream`) e chama `onToken(delta)` a cada incremento — para a
 * UI web exibir a interpretação incremental (como o nativo). O texto COMPLETO acumulado é
 * IDÊNTICO ao caminho não-streaming e vai à MESMA `aiWebFinalize` (ZERO drift). O streaming
 * muda SÓ o transporte: `cited_text` (store) e `finalize` (Rust) são inalterados.
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
  onToken?: (token: string) => void,
): Promise<AiAnswer> {
  const ref = parseReference(reference);
  if (!(await hasTranslation(handle, translation))) {
    // Espelha `SourceError::UnknownTranslation` propagado pelo nativo.
    throw new Error(`versão desconhecida: ${translation}`);
  }
  const rows = await queryChapter(handle, translation, ref.book, ref.chapter);
  const verses = versesForReference(ref, rows);
  const request = aiWebPrepare(reference, question, provider, model, lang, verses);
  const interpretation = await webLlmTransport(fetchImpl, provider, key, request, onToken);
  return aiWebFinalize(
    reference,
    request.citedText,
    request.provider,
    request.model,
    interpretation,
  );
}
