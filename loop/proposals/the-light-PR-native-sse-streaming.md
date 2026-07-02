# PR ao `the-light-core` — streaming NATIVO real por provedor (SSE/NDJSON via `complete_stream`)

> ⚠️ **PROPOSTA — NÃO COMPILADA AQUI.** O código Rust abaixo deve ser
> **compilado e testado no `the-light`** (`cargo fmt --check` / `clippy -D warnings`
> / `test --workspace`) **antes do merge**. As assinaturas/tipos foram confirmados
> **byte-a-byte** na fonte pinada (`04b9b24`, checkout só-leitura do cargo em
> `~/.cargo/git/checkouts/the-light-9eb8809a6d68281a/04b9b24/crates/the-light-core/`),
> mas **não** foram compilados no repo do app (o loop não toca o `the-light`). Ajustes
> mecânicos de `fmt`/`clippy` que o compilador exigir são esperados no branch.

- **Repo alvo:** `the-light` (core pinado do The Light)
- **Branch:** `feat/native-sse-streaming` (partindo de `04b9b24a990bb78c5e7cf2fffd9cc1571dc68376`)
- **Sancionado por:** ADR-0035 (esta tarefa, F4.6). Precedente EXATO: ADR-0005 (PR de
  feature-gating) e ADR-0024/F2.7 (PR `ai-pure`). Realiza a **D4** do ADR-0023 (streaming)
  no transporte **nativo**.
- **Tipo:** **aditivo, não-quebrante, embedded-only.** Só sobrescreve um método de trait
  com implementação **default** já existente. Nada removido/renomeado; assinatura pública
  intacta; `default = ["embedded"]` byte-a-byte.
- **Escopo:** SÓ `crates/the-light-core/src/ai/mod.rs` (1 teste) e
  `crates/the-light-core/src/ai/providers.rs` (helpers + overrides + testes). **Nenhum**
  outro arquivo; **sem** mudança em `Cargo.toml`/`lib.rs`.
- **Handoff:** push/merge é **ação humana**; o Driver re-pina a fronteira depois (2 linhas
  de `core/Cargo.toml` → novo rev). A chave/LLM real **nunca** passa pelo loop; a prova é
  **determinística por parser puro sobre fixture** (sem rede/chave).

---

## 1. Motivação

Este é o **último caminho de IA ainda não-streaming**. Hoje **nenhum** provedor do core
sobrescreve `LlmProvider::complete_stream`: todos caem no **default não-quebrante**
(`ai/mod.rs:378-387`), que chama `self.complete()` e emite a **String inteira 1×** por
`on_token`. O nativo, portanto, "streama" em **um único incremento**. O web já streama de
verdade token-a-token (SSE/NDJSON via transporte TS — F4.1/F4.2, ADR-0033/ADR-0034).

Esta proposta faz os **4 provedores reais** (`AnthropicProvider`, `OpenAiProvider`,
`GeminiProvider`, `OllamaProvider`) abrirem a conexão de **streaming do provedor** com
`reqwest::blocking`, emitindo **cada delta** por `on_token` e devolvendo a **resposta
completa** (concatenação) ao final — **idêntica** à do `complete` não-streaming
(zero-drift). Transporte: **SSE** (`text/event-stream`) para anthropic/openai/gemini;
**NDJSON** para ollama.

**Não-quebrante:** o `default` permanece (o `MockLlmProvider` e qualquer provedor sem
override continuam emitindo 1×); `complete`/`chat` intactos; `default = ["embedded"]`
byte-a-byte; a **assinatura** de `complete_stream` fica **exatamente** a mesma
(`&self, &str, &str, &mut dyn FnMut(&str)) -> Result<String>`) → a fronteira do app
(`ask_anchored_stream` + `AiTokenCallback` UniFFI) e os bindings **não** mudam — só passam
a receber **N tokens reais** em vez de 1.

---

## 2. Fatos confirmados na fonte (`04b9b24`, byte-a-byte)

- **Trait/default (`ai/mod.rs:360, 378-387`):**
  ```rust
  pub trait LlmProvider {
      fn name(&self) -> &str;
      fn model(&self) -> &str;
      fn complete(&self, system: &str, user: &str) -> Result<String>;

      fn complete_stream(
          &self,
          system: &str,
          user: &str,
          on_token: &mut dyn FnMut(&str),
      ) -> Result<String> {
          let full = self.complete(system, user)?;
          on_token(&full);          // emite a resposta INTEIRA 1× (default)
          Ok(full)
      }
      // fn chat(&self, ...) { ... }
  }
  ```
  O trait é da superfície **PURA** (`ai-pure`, sem `#[cfg]`) → o **default** compila em
  wasm; qualquer **override que use `reqwest` deve ficar sob `#[cfg(feature = "embedded")]`**.
- **`type Result<T> = std::result::Result<T, AiError>` (`ai/mod.rs:328`).** As variantes de
  erro necessárias **já existem e são puras**: `AiError::Http(String)` (l.308) e
  `AiError::BadResponse(String)` (l.311). **NÃO** se cria variante nova → **sem mudança de
  assinatura/erro**.
- **Providers (`ai/providers.rs`), TODOS `#[cfg(feature = "embedded")]`; NENHUM sobrescreve
  `complete_stream` hoje:**
  - `AnthropicProvider::post` (l.224): `POST https://api.anthropic.com/v1/messages`, headers
    `x-api-key`/`anthropic-version: 2023-06-01`/`content-type`. `anthropic_body` (l.155):
    `{model, max_tokens, system, thinking:{type:"adaptive"}, messages:[{role:"user",
    content:user}]}` — **sem** chave `stream`. `anthropic_extract` (l.182): concat dos blocos
    `content[type=="text"].text`; `stop_reason=="refusal"` → erro.
  - `OpenAiProvider::post` (l.297): `POST https://api.openai.com/v1/chat/completions`, header
    `authorization: Bearer {key}`. `openai_body` (l.246): `{model, max_tokens, messages:
    [{system},{user}]}`. `openai_extract` (l.263): `/choices/0/message/content`.
  - `OllamaProvider::post` (l.364): `POST {host}/api/chat` (**sem chave**). `ollama_body`
    (l.318): `{model, "stream": false, messages:[…]}` — **já tem `"stream": false`**.
    `ollama_extract` (l.335): `/message/content`.
  - `GeminiProvider::post` (l.481): `POST …/v1beta/models/{model}:generateContent`, header
    `x-goog-api-key`. `gemini_body` (l.391): `{contents:[…], system_instruction:{…},
    generationConfig:{maxOutputTokens}}` (modelo vai na **URL**, não no corpo).
    `gemini_extract` (l.427): concat de `candidates[0].content.parts[*].text`;
    `promptFeedback.blockReason` → erro.
- **Infra de POST existente:** `blocking_client()` (l.115, `timeout(120s)`), `send_json`
  (l.126, lê o corpo INTEIRO via `resp.text()`), `parse_api_response` (l.134, puro),
  `api_error_msg` (l.497, puro). **Não há** leitura por linha/evento hoje → o PR a adiciona.
- **Leitura incremental sem `stream` async:** `reqwest::blocking::Response` implementa
  `std::io::Read` → `std::io::BufReader::new(resp).lines()` serve para SSE **e** NDJSON.
  `reqwest = "0.13.3"` com `["blocking","json","default-tls"]` (Cargo.toml do core l.61).
  **NÃO** é preciso a feature async `stream`.
- **`#![cfg_attr(not(feature = "embedded"), allow(dead_code))]`** já está no topo de
  `providers.rs` (l.13) → as **helpers puras novas** (parsers de delta) podem ficar
  **un-gated** (como os `*_body`/`*_extract`) sem quebrar `-D warnings` no caminho `ai-pure`
  (onde ainda não têm chamador).

---

## 3. Design

Duas camadas, espelhando a separação já usada no core (`send_json` embedded ↔
`parse_api_response` puro):

1. **Parsers de delta — PUROS, un-gated** (só `serde_json::Value`, já em `ai-pure`):
   `sse_data`, `anthropic_stream_delta`, `openai_stream_delta`, `gemini_stream_delta`,
   `ollama_stream_delta`, e o utilitário `with_stream`. Cobertos pelo
   `allow(dead_code)` sob `ai-pure`; exercitados por testes/overrides sob `embedded`.
2. **Leitor de linhas — `stream_reader` (puro, `std::io::BufRead`)** + **`stream_response`
   (`#[cfg(embedded)]`, faz o I/O `reqwest`)** + os **overrides** de `complete_stream`
   e os métodos `post_stream` por provedor (`#[cfg(embedded)]`).

O `stream_reader` é **genérico sobre `BufRead`** (não sobre `reqwest::blocking::Response`),
então é **testável com um `Cursor` de fixture, sem rede**. Só o `stream_response` (checagem
de status HTTP + `BufReader::new(resp)`) fica preso ao `reqwest`.

### 3.1 `crates/the-light-core/src/ai/providers.rs` — helpers novos

Adicionar (perto de `parse_api_response`/`api_error_msg`, mantendo o estilo do módulo):

```rust
// ---------------------------------------------------------------------------
// Streaming (SSE / NDJSON) — leitura por linha e parsers de delta por provedor.
//
// O `stream_reader` é PURO (std::io::BufRead) → testável com um `Cursor` de
// fixture, sem rede. Só `stream_response` faz o I/O `reqwest` (embedded). Os
// parsers de delta são PUROS (serde_json) e un-gated (como os `*_body`/`*_extract`);
// sob `ai-pure` ficam dead-code (coberto pelo `allow` do topo do arquivo).
// ---------------------------------------------------------------------------

/// Payload de uma linha SSE `data: …` (com espaço opcional após o `:`). `None`
/// para linhas que NÃO são `data:` (`event:`/`id:`/comentários `:`/linhas vazias).
fn sse_data(line: &str) -> Option<&str> {
    line.strip_prefix("data:").map(str::trim)
}

/// Acrescenta `"stream": true` a um corpo JSON de objeto, REUSANDO o `*_body` do
/// não-streaming (zero-drift do payload; só o flag muda). Substitui o valor se a
/// chave já existir (caso do `ollama_body`, que tem `"stream": false`).
fn with_stream(mut body: Value) -> Value {
    if let Some(obj) = body.as_object_mut() {
        obj.insert("stream".to_string(), Value::Bool(true));
    }
    body
}

/// Lê `reader` LINHA a LINHA (SSE `text/event-stream` OU NDJSON), aplicando
/// `parse_line` a cada linha; para cada delta não-vazio chama `on_token` e ACUMULA
/// na String de retorno (== a resposta de `complete`). `parse_line` devolve
/// `Ok(None)` para linhas a ignorar (`event:`/vazias/`[DONE]`/parciais/pings) e
/// `Err(..)` para recusa/bloqueio do modelo. Puro: testável com um `Cursor`.
fn stream_reader<R: std::io::BufRead>(
    reader: R,
    on_token: &mut dyn FnMut(&str),
    mut parse_line: impl FnMut(&str) -> Result<Option<String>>,
) -> Result<String> {
    let mut full = String::new();
    for line in reader.lines() {
        let line = line.map_err(|e| AiError::Http(e.to_string()))?;
        if let Some(delta) = parse_line(&line)? {
            if !delta.is_empty() {
                full.push_str(&delta);
                on_token(&delta);
            }
        }
    }
    if full.trim().is_empty() {
        return Err(AiError::BadResponse("resposta de texto vazia".into()));
    }
    Ok(full)
}

/// Abre a resposta de streaming: verifica o **status HTTP** (erro → `AiError::Http`
/// com a mensagem da API, como `send_json`) e delega a leitura por linha ao
/// `stream_reader`. A chave NUNCA é logada aqui (só viajou nos headers do request).
#[cfg(feature = "embedded")]
fn stream_response(
    resp: reqwest::blocking::Response,
    on_token: &mut dyn FnMut(&str),
    parse_line: impl FnMut(&str) -> Result<Option<String>>,
) -> Result<String> {
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .map(|v| api_error_msg(&v))
            .unwrap_or_else(|_| text.trim().to_string());
        return Err(AiError::Http(format!("HTTP {}: {msg}", status.as_str())));
    }
    stream_reader(std::io::BufReader::new(resp), on_token, parse_line)
}

// ---- Parsers de delta por provedor (puros; espelham os `*_extract`) ----

/// Anthropic (SSE): emite o texto de `content_block_delta` com
/// `delta.type == "text_delta"` (IGNORA `thinking_delta`, como `anthropic_extract`
/// ignora blocos não-`text`). `message_delta` com `stop_reason == "refusal"` → erro
/// (mesma política do não-streaming). Linha não-JSON (ping) → `Ok(None)`.
fn anthropic_stream_delta(data: &str) -> Result<Option<String>> {
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    match v.get("type").and_then(Value::as_str) {
        Some("content_block_delta") => {
            if v.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                Ok(v.pointer("/delta/text").and_then(Value::as_str).map(str::to_string))
            } else {
                Ok(None)
            }
        }
        Some("message_delta") => {
            if v.pointer("/delta/stop_reason").and_then(Value::as_str) == Some("refusal") {
                Err(AiError::BadResponse(
                    "o modelo recusou a solicitação (refusal)".into(),
                ))
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}

/// OpenAI (SSE): `choices[0].delta.content`; sentinela `[DONE]` e linhas
/// não-JSON → `Ok(None)`.
fn openai_stream_delta(data: &str) -> Result<Option<String>> {
    if data == "[DONE]" {
        return Ok(None);
    }
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    Ok(v.pointer("/choices/0/delta/content").and_then(Value::as_str).map(str::to_string))
}

/// Gemini (SSE, `:streamGenerateContent?alt=sse`): concat de
/// `candidates[0].content.parts[*].text`. `promptFeedback.blockReason` → erro
/// (mesma política de `gemini_extract`).
fn gemini_stream_delta(data: &str) -> Result<Option<String>> {
    let v: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    if let Some(reason) = v.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(AiError::BadResponse(format!(
            "resposta bloqueada pelo provedor: {reason}"
        )));
    }
    let parts = match v.pointer("/candidates/0/content/parts").and_then(Value::as_array) {
        Some(p) => p,
        None => return Ok(None),
    };
    let text: String = parts
        .iter()
        .filter_map(|p| p.get("text").and_then(Value::as_str))
        .collect();
    Ok(if text.is_empty() { None } else { Some(text) })
}

/// Ollama (NDJSON, SEM prefixo `data:`): a linha INTEIRA é um objeto JSON;
/// emite `message.content`. Linha em branco/parcial → `Ok(None)`.
fn ollama_stream_delta(line: &str) -> Result<Option<String>> {
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    Ok(v.pointer("/message/content")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string))
}
```

### 3.2 Overrides de `complete_stream` (dentro dos `impl LlmProvider` existentes)

Cada override **reusa o `*_body`** do não-streaming (zero-drift) + o flag/endpoint de
streaming e delega a `post_stream`. **Mesmos URL/headers/chave** do `post` não-streaming; a
chave vai **só no header** (nunca URL/log).

**Anthropic** — adicionar ao `impl LlmProvider for AnthropicProvider` (l.205) e ao
`impl AnthropicProvider` (l.223):

```rust
// dentro de `impl LlmProvider for AnthropicProvider`
fn complete_stream(
    &self,
    system: &str,
    user: &str,
    on_token: &mut dyn FnMut(&str),
) -> Result<String> {
    let body = with_stream(anthropic_body(&self.model, system, user, DEFAULT_MAX_TOKENS));
    self.post_stream(body, on_token)
}

// dentro de `impl AnthropicProvider`
fn post_stream(&self, body: Value, on_token: &mut dyn FnMut(&str)) -> Result<String> {
    let req = blocking_client()?
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &self.key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body);
    let resp = req.send().map_err(|e| AiError::Http(e.to_string()))?;
    stream_response(resp, on_token, |line| match sse_data(line) {
        Some(data) => anthropic_stream_delta(data),
        None => Ok(None),
    })
}
```

**OpenAI** — `impl LlmProvider for OpenAiProvider` (l.275) + `impl OpenAiProvider` (l.296):

```rust
fn complete_stream(
    &self,
    system: &str,
    user: &str,
    on_token: &mut dyn FnMut(&str),
) -> Result<String> {
    let body = with_stream(openai_body(&self.model, system, user, DEFAULT_MAX_TOKENS));
    self.post_stream(body, on_token)
}

fn post_stream(&self, body: Value, on_token: &mut dyn FnMut(&str)) -> Result<String> {
    let req = blocking_client()?
        .post("https://api.openai.com/v1/chat/completions")
        .header("authorization", format!("Bearer {}", self.key))
        .header("content-type", "application/json")
        .json(&body);
    let resp = req.send().map_err(|e| AiError::Http(e.to_string()))?;
    stream_response(resp, on_token, |line| match sse_data(line) {
        Some(data) => openai_stream_delta(data),
        None => Ok(None),
    })
}
```

**Gemini** — `impl LlmProvider for GeminiProvider` (l.459) + `impl GeminiProvider` (l.480).
Gemini **não** usa `"stream"` no corpo; o streaming é selecionado pelo **endpoint**
`:streamGenerateContent?alt=sse` (corpo idêntico ao não-streaming):

```rust
fn complete_stream(
    &self,
    system: &str,
    user: &str,
    on_token: &mut dyn FnMut(&str),
) -> Result<String> {
    // Corpo IDÊNTICO ao não-streaming; o modelo vai na URL, o streaming no endpoint.
    self.post_stream(gemini_body(&self.model, system, user, DEFAULT_MAX_TOKENS), on_token)
}

fn post_stream(&self, body: Value, on_token: &mut dyn FnMut(&str)) -> Result<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
        self.model
    );
    let req = blocking_client()?
        .post(url)
        .header("x-goog-api-key", &self.key)
        .header("content-type", "application/json")
        .json(&body);
    let resp = req.send().map_err(|e| AiError::Http(e.to_string()))?;
    stream_response(resp, on_token, |line| match sse_data(line) {
        Some(data) => gemini_stream_delta(data),
        None => Ok(None),
    })
}
```

**Ollama (NDJSON)** — `impl LlmProvider for OllamaProvider` (l.347) + `impl OllamaProvider`
(l.363). Cada **linha** é o JSON (sem `data:`); reusa `ollama_body` e liga `stream:true`:

```rust
fn complete_stream(
    &self,
    system: &str,
    user: &str,
    on_token: &mut dyn FnMut(&str),
) -> Result<String> {
    // ollama_body tem `"stream": false`; `with_stream` sobrescreve p/ true.
    let body = with_stream(ollama_body(&self.model, system, user));
    self.post_stream(body, on_token)
}

fn post_stream(&self, body: Value, on_token: &mut dyn FnMut(&str)) -> Result<String> {
    let url = format!("{}/api/chat", self.host.trim_end_matches('/'));
    let req = blocking_client()?
        .post(url)
        .header("content-type", "application/json")
        .json(&body);
    let resp = req.send().map_err(|e| AiError::Http(e.to_string()))?;
    // NDJSON: a linha inteira É o JSON (sem `data:`).
    stream_response(resp, on_token, ollama_stream_delta)
}
```

> Nota de implementação: `.lines()` exige `std::io::BufRead` em escopo — declarado
> localmente onde necessário (ex.: `use std::io::BufRead;` no topo de `stream_reader`, ou
> caminho completo). `json!`/`Value` já estão importados (l.18); `LlmProvider` já está em
> escopo sob `embedded` (l.23-24). Nenhum `use` novo de crate externo.

### 3.3 Decisão explícita — **Ollama: INCLUIR o override NDJSON** (recomendado)

**Decisão: incluir** o override do Ollama nesta PR (NDJSON), e **não** deixá-lo no default.

- **Justificativa:** (1) o NDJSON é **mais simples** que o SSE (um JSON por linha, sem
  `data:`/`event:`/`[DONE]`), então o custo marginal é mínimo; (2) o transporte **web já
  streama Ollama** (ADR-0034) — manter só o nativo em 1× criaria uma **assimetria
  web↔nativo** sem benefício; (3) o objetivo da tarefa é **fechar o último caminho
  não-streaming** — deixar 1 dos 4 no default o manteria aberto. O `ollama_body` já traz
  `"stream": false`, então a mudança é trocar o flag e trocar o parse. Reversível
  trivialmente (remover o override → volta ao default).

---

## 4. Garantias de princípio

- **Não-quebrante:** só se **acrescenta** o override de um método de trait que já tem
  **default**. O `MockLlmProvider` (e qualquer provedor futuro sem override) continua no
  default (emite 1×). `complete`/`chat`/`*_body`/`*_extract` **intactos**. **Nenhuma**
  mudança em `Cargo.toml`/`lib.rs`/`[features]`; `default = ["embedded"]` **byte-a-byte**.
  API pública **nativa** preservada (nada removido/renomeado; nenhuma variante de erro nova).
- **Zero-drift (anti-alucinação):** a **concatenação dos deltas == a resposta de
  `complete`**. Cada parser espelha o `*_extract` correspondente:
  `text_delta`↔`content[type=="text"].text` (Anthropic), `delta.content`↔`message.content`
  (OpenAI), `parts[].text`↔`candidates[0].content.parts[].text` (Gemini),
  `message.content`↔`message.content` (Ollama). O streaming muda **só o TRANSPORTE nativo**;
  a interpretação final é a MESMA, e o `cited_text`/citações continuam vindo do store /
  `ai-pure` na fronteira (fora deste PR). Os deltas são **só** texto da interpretação do
  modelo — **nunca** texto bíblico.
- **Embedded-only / wasm PURO:** tudo que usa `reqwest` (`stream_response`, `post_stream`,
  os overrides) está sob `#[cfg(feature = "embedded")]`. Os parsers puros usam só
  `serde_json` (já em `ai-pure`) e ficam cobertos pelo `allow(dead_code)` de topo. **Nada
  novo** entra no grafo `ai-pure`/wasm; o `complete_stream` **default** segue puro; o web
  segue com o transporte TS (F4.1/F4.2).
- **BYOK:** a chave vai **só no header** (anthropic `x-api-key`; openai `authorization:
  Bearer`; gemini `x-goog-api-key`; ollama **sem chave**), **nunca** na URL/log/git. O
  Gemini mantém o modelo na URL e a chave no header. `stream_response` loga só status +
  mensagem da API (nunca a chave).
- **Offline-first:** streaming é opt-in e só melhora o transporte de uma chamada de IA que
  **já** é opt-in; nenhuma capacidade essencial passa a exigir rede.
- **Assinatura da fronteira inalterada:** `complete_stream` mantém
  `(&self, &str, &str, &mut dyn FnMut(&str)) -> Result<String>`. Logo `ask_anchored_stream`
  (`core/src/lib.rs`) + `AiTokenCallback` (UniFFI/JSI) e os bindings **não** mudam — só
  recebem N tokens reais em vez de 1. **Sem** regeneração de bindings.

**Risco registrado (para o humano):** o zero-drift *de fixture* prova que o **parser** não
diverge; a igualdade *em rede real* (stream vs não-stream) depende do provedor (ordenação de
partes/whitespace). A validação com **chave real** é etapa humana (F4.5, já aceita). Se, ao
compilar, ficar comprovado que a assinatura de `complete_stream` PRECISA mudar (novo
tipo de erro/sink) → é **decisão para o humano**: parar e registrar, não improvisar.

---

## 5. Testes do core propostos (sem rede)

Todos rodam sob `cargo test` (default = `embedded`). Parsers puros são exercitados por
**fixture** via `Cursor` — **sem rede/chave**.

### 5.1 `providers.rs` — parser SSE/NDJSON por provedor (N deltas; concat == full)

```rust
#[cfg(test)]
mod stream_tests {
    use super::*;
    use std::io::Cursor;

    /// Roda o `stream_reader` sobre um corpo de fixture, devolvendo (deltas, full).
    fn run(body: &str, parse: impl FnMut(&str) -> Result<Option<String>>) -> (Vec<String>, String) {
        let mut deltas: Vec<String> = Vec::new();
        let full = {
            let mut on = |t: &str| deltas.push(t.to_string());
            stream_reader(Cursor::new(body.as_bytes()), &mut on, parse).unwrap()
        };
        (deltas, full)
    }

    #[test]
    fn anthropic_sse_text_deltas_concat_to_full() {
        // Inclui um `thinking_delta` (deve ser IGNORADO) e linhas `event:`/vazias.
        let body = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\"}\n",
            "\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Deus \"}}\n",
            "\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"...\"}}\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"amou \"}}\n",
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"o mundo.\"}}\n",
            "event: message_stop\n",
            "data: {\"type\":\"message_stop\"}\n",
        );
        let (deltas, full) = run(body, |l| match sse_data(l) {
            Some(d) => anthropic_stream_delta(d),
            None => Ok(None),
        });
        assert_eq!(deltas, ["Deus ", "amou ", "o mundo."]);
        assert_eq!(full, "Deus amou o mundo.");
    }

    #[test]
    fn openai_sse_deltas_concat_and_done_ignored() {
        let body = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Deus \"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"amou \"}}]}\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"o mundo.\"}}]}\n",
            "data: [DONE]\n",
        );
        let (deltas, full) = run(body, |l| match sse_data(l) {
            Some(d) => openai_stream_delta(d),
            None => Ok(None),
        });
        assert_eq!(deltas, ["Deus ", "amou ", "o mundo."]);
        assert_eq!(full, "Deus amou o mundo.");
    }

    #[test]
    fn gemini_sse_parts_concat_to_full() {
        let body = concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Deus \"}]}}]}\n",
            "\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"amou \"}]}}]}\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"o mundo.\"}]}}]}\n",
        );
        let (deltas, full) = run(body, |l| match sse_data(l) {
            Some(d) => gemini_stream_delta(d),
            None => Ok(None),
        });
        assert_eq!(deltas, ["Deus ", "amou ", "o mundo."]);
        assert_eq!(full, "Deus amou o mundo.");
    }

    #[test]
    fn ollama_ndjson_deltas_concat_to_full() {
        // NDJSON: 1 objeto por linha, SEM `data:`; a última traz done:true e content vazio.
        let body = concat!(
            "{\"message\":{\"role\":\"assistant\",\"content\":\"Deus \"},\"done\":false}\n",
            "{\"message\":{\"content\":\"amou \"},\"done\":false}\n",
            "{\"message\":{\"content\":\"o mundo.\"},\"done\":false}\n",
            "{\"message\":{\"content\":\"\"},\"done\":true}\n",
        );
        let (deltas, full) = run(body, ollama_stream_delta);
        assert_eq!(deltas, ["Deus ", "amou ", "o mundo."]);
        assert_eq!(full, "Deus amou o mundo.");
    }

    #[test]
    fn anthropic_refusal_in_stream_is_error() {
        let body = "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\"}}\n";
        let mut on = |_: &str| {};
        let err = stream_reader(Cursor::new(body.as_bytes()), &mut on, |l| match sse_data(l) {
            Some(d) => anthropic_stream_delta(d),
            None => Ok(None),
        });
        assert!(matches!(err, Err(AiError::BadResponse(_))));
    }

    #[test]
    fn gemini_block_reason_in_stream_is_error() {
        let body = "data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}\n";
        let mut on = |_: &str| {};
        let err = stream_reader(Cursor::new(body.as_bytes()), &mut on, |l| match sse_data(l) {
            Some(d) => gemini_stream_delta(d),
            None => Ok(None),
        });
        assert!(matches!(err, Err(AiError::BadResponse(_))));
    }

    #[test]
    fn with_stream_sets_flag_true() {
        // Reusa o corpo do não-streaming e liga o flag (ollama já vem com false).
        let b = with_stream(ollama_body("llama3", "sys", "user"));
        assert_eq!(b.pointer("/stream"), Some(&Value::Bool(true)));
    }
}
```

### 5.2 `ai/mod.rs` — default preservado + zero-drift (via `MockLlmProvider`, sem override)

```rust
#[test]
fn default_complete_stream_matches_complete_for_mock() {
    let m = MockLlmProvider::new("uma interpretação de teste");
    let full_direct = m.complete("sys", "user").unwrap();

    let mut deltas: Vec<String> = Vec::new();
    let full_stream = {
        let mut on = |t: &str| deltas.push(t.to_string());
        m.complete_stream("sys", "user", &mut on).unwrap()
    };

    // Default NÃO-QUEBRANTE: emite a resposta INTEIRA 1× → exatamente 1 delta.
    assert_eq!(deltas, ["uma interpretação de teste"]);
    // Zero-drift: o retorno do stream == o retorno do complete.
    assert_eq!(full_stream, full_direct);
}
```

### 5.3 Como rodar (no `the-light`, branch `feat/native-sse-streaming`)

```sh
cd /Users/butkeraites/Documents/the-light
cargo fmt --all --check
cargo clippy --workspace -- -D warnings
cargo test --workspace                 # inclui os novos testes de parser SSE/NDJSON
# default preservado (embedded) — byte-a-byte:
cargo build -p the-light-core          # default-features on (embedded)
# grafo puro intacto (nada novo em ai-pure/wasm):
cargo build -p the-light-core --no-default-features --features ai-pure \
  --target wasm32-unknown-unknown
```

---

## 6. Checklist pós-merge (Driver)

1. **Re-pin** `core/Cargo.toml` — **2 linhas** (web `ai-pure` na l.37 e nativa `embedded`
   na l.44): `rev = "04b9b24…"` → **novo rev do merge**; regenerar `core/Cargo.lock`.
2. **Fronteira intacta:** `cargo test -p the-light-app-core` verde;
   `ask_anchored_stream` passa a emitir **tokens reais** (provedor real) SEM mudança de
   assinatura/bindings (o mock cai no default → 1×; os self-tests TLA_* seguem verdes).
3. **wasm PURO:** `cd core && cargo tree --target wasm32-unknown-unknown
   --no-default-features --features ai-pure | grep -E "reqwest|rusqlite"` → **vazio**.
4. **Web/app:** `cd app && npx tsc --noEmit` 0; `npx expo export --platform web` 0
   (nenhum símbolo de fronteira novo; streaming web segue transporte TS).
5. **Secret-scan:** o diff do PR e os logs de teste **não** contêm chave (chave só no
   header; ollama sem chave).
6. **Validação REAL** de streaming nativo com **chave** (SSE/NDJSON em rede) = **etapa
   humana** (fora do loop; base de conteúdo real já aceita na F4.5).
