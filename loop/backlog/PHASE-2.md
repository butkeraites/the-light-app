# Backlog — Fase 2 (Camada de IA BYOK — Claude · GPT · Gemini · estudo assistido ancorado)

> **RE-ESCOPADA em 2026-07-01 após o gate F2.2 (ADR-0023).** Rascunhos de tarefa
> redigidos pelo Planner. Cada bloco vira um arquivo `queue/<ID>.task.md` quando
> elegível (deps aceitas). **Uma de cada vez** (ver `PROTOCOL.md`). A Fase 2
> acrescenta uma **camada de IA OPCIONAL** por cima do app de leitura offline da
> Fase 1 (aprovado no Marco 1): perguntar/estudar uma passagem com um LLM da
> **própria chave do usuário** (BYOK), com o **texto do versículo sempre vindo do
> store local** (anti-alucinação) — o LLM só **interpreta**. Adiciona o provedor
> **Gemini** e a gestão segura de chaves.

## O que o gate F2.2 DECIDIU (ADR-0023) — decisões fixas aplicadas nesta re-escopagem

- **D1 — Gemini vive no `the-light-core` (PR + ADR).** `GeminiProvider: LlmProvider`
  + entradas em `PROVIDERS`/`default_model`/`estimate_cost_usd`. Fonte única
  (CLI/TUI também ganham). Precedente ADR-0005. Muda o `the-light` ⇒ handoff humano.
- **D2 — IA no web via PR ao core.** Desacoplar `ai::study`/`ai::citation` de
  `super::research::WebSource` (que puxa `reqwest`) para que a **montagem de
  prompt/RAG/citação** compile em `wasm32`; a chamada HTTP ao provedor no web é
  feita por `fetch` (infra, precedente ADR-0011). Anti-alucinação numa **única
  impl Rust** compartilhada nativo/web (sem drift). Muda o `the-light`.
- **D3 — BYOK **API key** indolor.** Colar a key 1×, guardada em
  **Keychain/Keystore** via `expo-secure-store` (nativo; F2.4), nunca re-inserida,
  **nunca em git/log**; deep-link p/ a página de key de cada provedor.
  **Login-de-conta (OAuth) foi REJEITADO** (banido em Anthropic/Google, só-identidade
  na OpenAI — arriscaria banir a conta do usuário). App-side; **não** toca o `the-light`.
- **D4 — Streaming (tokens incrementais).** A fronteira expõe a resposta da IA em
  streaming (callback/observer sobre UniFFI/JSI); o `AiAnswer` **não-streaming** da
  F2.1 permanece como caminho base. **Investigação (abaixo) confirma que D4 EXIGE
  mudar o trait no core** ⇒ entra no MESMO PR de D1+D2.

## Princípios da Fase 2 (não negociáveis — registrados no cabeçalho)

1. **IA é OPCIONAL e ADITIVA (BYOK).** Toda a Fase 1 (leitura, versões, tema,
   busca FTS5, xref CC-BY, notas/marcações) continua **100% offline, sem IA e
   sem rede**. A IA só liga quando o usuário fornece a **própria API key**
   (Gemini/Claude/GPT). **Nenhuma** capacidade essencial passa a exigir rede/conta.
2. **Chave do usuário NUNCA em git/log.** Armazenamento seguro: **nativo** =
   Keychain (iOS)/Keystore (Android) via `expo-secure-store` (D3/F2.4); **web** =
   sem chave persistida na Fase 2 (política web decidida na F2.7, junto do caminho
   de IA web). A chave **nunca** é logada nem impressa; trafega da UI direto para
   `build_provider(name, key, model)` (a fronteira a recebe como argumento e
   **não** a persiste). O `KeyStore`/`secrets.toml` do core **não** é usado no app.
3. **Anti-alucinação é LEI.** O texto do versículo **sempre** vem do store local
   (verbatim, domínio público), é numerado por `ai::numbered_passage` e injetado
   no prompt como **contexto** via `ai::ask_context`. O LLM **apenas interpreta**
   — **nunca** gera/edita texto bíblico. A referência é **canônica**. A resposta da
   IA separa, no **tipo de retorno** (`AiAnswer`), o **texto citado** (do store) da
   **interpretação** (do modelo). Isso vale inclusive no streaming (D4) e no web (D2).
4. **Rede só para a IA opt-in.** A chamada ao LLM é a **ÚNICA** rede em runtime, e
   só ocorre com a chave do usuário. **Nativo:** transporte `reqwest` (core, feature
   `embedded`). **Web:** `fetch` (D2/ADR-0011). Leitura/busca/xref/notas permanecem
   offline/local.
5. **`the-light` só via PR + ADR (`8f66004` até o re-pin).** D1+D2+D4 mudam o core
   ⇒ **um único PR consolidado** (F2.3), implementado em BRANCH no repo
   `/Users/butkeraites/Documents/the-light` (autorizado), com **push+merge pelo
   humano** e **re-pin** do rev na fronteira (molde F0.6/ADR-0005) — **ponto de
   handoff BLOQUEANTE**. Prova **determinística** por tarefa com **MOCK** do provedor
   (`MockLlmProvider` / `build_provider("mock", …)`) — **NUNCA** chamar
   Gemini/Claude/GPT **real** no CI/loop. A chamada real (com a chave do usuário) é
   um **ponto bloqueante** validado à parte (F2.6). Qualidade por tarefa (Rust
   `fmt`/`clippy -D warnings`/`test`; TS `tsc`/`eslint`) verde. Diante de conflito
   com qualquer regra: **HALT**, não improviso.

## Investigação na fonte do core (8f66004) — o que dimensiona D1/D2/D4

Leitura só-permitida do checkout do cargo
`~/.cargo/git/checkouts/the-light-9eb8809a6d68281a/8f66004/crates/the-light-core/src/ai/`
(**não** o `../the-light` bloqueado). Símbolos/arquivos citados:

- **`LlmProvider` (`ai/mod.rs:327`) é PÚBLICO e 100% SÍNCRONO/NÃO-STREAMING:**
  `name()`, `model()`, **`complete(&self, system, user) -> Result<String>`** (linha
  335, devolve a String **completa**), `chat(&self, system, &[ChatMessage])` (default
  dobra em `complete`), `estimate_tokens`. **NÃO há** `stream`/callback/observer, nem
  `async`; os provedores concretos setam **`"stream": false`** (`providers.rs:281`
  ollama). **`MockLlmProvider`** (`ai/mod.rs:360`) devolve resposta fixa (sem rede).
  → **D4 (streaming) EXIGE mudar o trait no core** (novo método de streaming, ex.
  `complete_stream(&self, system, user, on_token: &mut dyn FnMut(&str)) -> Result<String>`
  com **default não-quebrante** que chama `complete` e emite a String inteira 1×;
  sobrescrito nos provedores reais com `reqwest` **SSE** `"stream": true`). Por isso
  D4 entra no MESMO PR de D1+D2 (item "se necessário" do Driver = **necessário**).

- **`build_provider`/`default_model`/`estimate_cost_usd` (`providers.rs`):**
  `default_model` (l.26) casa `"anthropic"/"openai"/"ollama"`; `build_provider`
  (l.39) roteia por nome e **recebe a `key` como argumento** (BYOK; `AiError::NoKey`
  se ausente p/ anthropic/openai); `estimate_cost_usd` (l.69) tem preços claude/gpt.
  `PROVIDERS = ["anthropic","openai","ollama"]` (`mod.rs:30`) — **sem Gemini**.
  → **D1 (Gemini)** encaixa mecanicamente (molde `AnthropicProvider`,
  `providers.rs:116-197`): novo `struct GeminiProvider { key, model }` +
  `impl LlmProvider` com **funções PURAS** `gemini_body(model, system, user, max) ->
  Value` e `gemini_extract(&Value) -> Result<String>` (testáveis SEM rede, molde
  `anthropic_body`/`anthropic_extract`) + `post()` via `blocking_client`/`send_json`
  ao endpoint `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`;
  + arms em `default_model`/`estimate_cost_usd` + entrada em `PROVIDERS`.

- **Acoplamento que D2 precisa desacoplar (o que barra a IA no wasm):** todo o
  módulo `ai` é `#[cfg(feature = "embedded")]` (core `lib.rs:19-20`), e `embedded`
  ativa `reqwest`/`rusqlite`/`chrono`/... (core `Cargo.toml [features]`). Mesmo as
  partes **logicamente puras** da IA estão presas ao `reqwest`:
  - `study.rs:11` `use super::research::WebSource;` e `study.rs:42`
    `pub web_sources: Vec<WebSource>` em `StudyRequest`;
  - `citation.rs:18` `use super::research::WebSource;` e `citation.rs:166`
    `CitationCollector::from_web_results(&[WebSource])`;
  - `research.rs:48` `blocking_client()` = **`reqwest::blocking`** vive nesse módulo
    (e `WebSource` — struct pura de dados, `chrono`/`serde` — mora **junto** dele).
  → As funções que a Fase 2 realmente usa — `study::{numbered_passage (l.114),
  ask_context (l.127), ask (l.591)}` e `citation` — são puras, mas o `use
  super::research::WebSource` no topo de `study.rs`/`citation.rs` arrasta
  `research.rs` → `reqwest` p/ o grafo wasm. **D2 = PR** que (a) separa `WebSource`
  (dado puro) do código `reqwest` de `research.rs`; (b) introduz uma feature fina
  (ex. `ai-core`/`net`) para compilar `ai::{mod-types, prompts, study(puro),
  citation}` em `wasm32` **sem** `reqwest`; (c) mantém o transporte nativo atrás da
  feature e delega `fetch` no web. Refator **não trivial** (mexe em tipos de
  módulo), mas não-quebrante (defaults intactos).

## Decomposição RE-ESCOPADA (F2.1 → F2.8; paradas: F2.2 gate [feito], **F2.3 PR/handoff**, F2.6 bloqueante, F2.8 Marco 2)

Padrão Fase 2 (herdado da Fase 1): capacidade testável por **MOCK** antes da UI →
gate estratégico [feito] → **PR consolidado ao core** (Gemini+wasm+streaming) →
fronteira que consome o re-pin → chave BYOK nativa (paralela, não-bloqueante) → UI
nativa (MOCK) → validação real (chave, bloqueante) → paridade web → Marco 2.
Anti-alucinação em todas: o texto do versículo vem do store local; o LLM só interpreta.

### Mapa (id · título · deps · bloqueante? · toca the-light?)

| ID | Título | Deps | Bloqueante? | Toca the-light? |
|----|--------|------|-------------|-----------------|
| F2.1 | `ask_anchored` na fronteira + MOCK | — | não | não | ✅ aceito |
| F2.2 | GATE arquitetura IA (ADR-0023) | F2.1 | gate | decisão | ✅ decidido |
| **F2.3** | **PR consolidado ao `the-light-core`: Gemini (D1) + IA-pura-wasm (D2) + streaming no trait (D4)** | F2.2 | **SIM** (branch + push/merge humano + re-pin) | **SIM** |
| **F2.3a** | Fronteira: rotear `"gemini"` no `ask_anchored` + expor **streaming** (callback UniFFI), consumindo o core re-pinado; prova por MOCK | F2.3 | não | não |
| **F2.4** | **BYOK chave nativa (`expo-secure-store`)** — `app/lib/keystore.ts` + stub web; prova headless com fake + auditoria de log | F2.2 | **não** (app-side, testável SEM chave real) | **não** ← **PRÓXIMA A SEMEAR** |
| F2.5 | UI nativa: `ask` ancorado (seletor provedor/modelo incl. Gemini + custo + streaming + citado/interpretação); MOCK, `TLA_ASK` | F2.1, F2.3a, F2.4 | não | não |
| F2.6 | **Validação real** com a chave do usuário (Claude/GPT/Gemini) | F2.5 | **SIM** (chave/segredo/rede) → gate | não |
| **F2.7** | **PR ao `the-light-core`: IA pura em wasm (D2, feature `ai-pure`) + fix `default_model` gemini `2.0`→`2.5-flash`** | F2.6 | **SIM** (branch + push/merge humano + re-pin) | **SIM** |
| F2.7b | Paridade web de IA: `ai-pure` wasm (prompt/RAG/citação) + `fetch` ao provedor + política de chave web | F2.7, F2.5 | não | não |
| F2.8 | **Marco 2** (gate) | F2.5, F2.6, F2.7, F2.7b | **SIM** gate | não |

> **Mudanças de numeração vs. o backlog pré-ADR-0023 (explicadas):**
> a numeração F2.4–F2.8 é **estável**. **F2.3** deixa de ser "Provedor Gemini
> isolado" e passa a ser o **PR consolidado** ao core (D1 Gemini **+** D2 wasm **+**
> D4 streaming) — um único handoff humano em vez de três (diretriz do Driver:
> minimizar handoffs). **Acrescenta-se F2.3a** (fronteira que consome o re-pin:
> roteia Gemini + expõe streaming) — molde F0.6a (consumir o core re-pinado é
> app-side, não-bloqueante). **F2.6** vira `gate: true` (era bloqueante "de fato";
> agora o loop PARA formalmente por precisar da chave real). Os pontos das antigas
> F2.3–F2.7 (Gemini, chave, UI, real, web) foram **preservados**, apenas
> reorganizados conforme as 4 decisões de ADR-0023.

---

## F2.3 — PR consolidado ao `the-light-core`: Gemini (D1) + IA pura em wasm (D2) + streaming no trait (D4)
**Objetivo:** num **único PR ao `the-light`** (branch no repo
`/Users/butkeraites/Documents/the-light`, autorizado; **push+merge é do humano**;
**re-pin** do rev em `core/Cargo.toml` — molde F0.6a/ADR-0005), entregar as três
mudanças de core decididas em ADR-0023:
1. **D1 — `GeminiProvider`.** Novo `struct GeminiProvider { key, model }` +
   `impl LlmProvider` em `ai/providers.rs` (molde `AnthropicProvider`), com funções
   **puras** `gemini_body`/`gemini_extract` (endpoint
   `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`); arms
   em `default_model` (`"gemini" => "<modelo atual>"`) e `estimate_cost_usd` (preços
   gemini); entrada `"gemini"` em `PROVIDERS` (`ai/mod.rs:30`); arm em
   `build_provider` (`"gemini" => { let key = key.ok_or(NoKey("gemini"))?; … }`).
2. **D2 — IA pura compilável em wasm.** Desacoplar `WebSource` (dado puro) do código
   `reqwest` de `research.rs`; introduzir uma **feature fina** (ex. `ai-core`) que
   compile `ai::{tipos de mod, prompts, study::{numbered_passage, ask_context, ask},
   citation}` para `wasm32-unknown-unknown` **sem** `reqwest`; manter o transporte
   nativo (`reqwest::blocking`) atrás da feature `embedded`/`net`. **Não-quebrante:**
   defaults (CLI/TUI/xtask) idênticos.
3. **D4 — streaming no trait.** Adicionar ao `LlmProvider` um método de streaming
   (ex. `complete_stream(&self, system, user, on_token: &mut dyn FnMut(&str)) ->
   Result<String>`) com **default não-quebrante** (chama `complete`, emite a String
   inteira 1×); sobrescrever nos provedores reais (anthropic/openai/gemini/ollama)
   com `reqwest` **SSE** (`"stream": true`).
**Aceite:** no repo `the-light`, branch novo sobre `8f66004`: `cargo build`/`test
-p the-light-core` (default) verde (paridade com os 177 testes + novos testes puros
de `gemini_body`/`gemini_extract` e de `complete_stream` default); `cargo build -p
the-light-core --no-default-features --target wasm32-unknown-unknown` compila as
partes puras da IA (D2); `clippy -D warnings` + `fmt --check` limpos; workspace
(CLI/TUI/xtask) compila. **Não-quebrante confirmado.** Escrever a **spec do PR** em
`loop/proposals/the-light-PR-ai-gemini-wasm-streaming.md` e **ADR novo** no
`DECISIONS.md`. Após **push+merge humano**, **re-pin** do `rev` em `core/Cargo.toml`
(as duas linhas: pura + `[target… embedded]`) e revalidar a fronteira
(`cargo test -p the-light-app-core` + grafo wasm puro + `gen-bindings-web.sh`).
**Verificação:** (no `the-light`) `cargo test`/`clippy -D warnings`/`fmt --check` +
`cargo build --no-default-features --target wasm32-unknown-unknown`; (na fronteira,
pós re-pin) `cargo test -p the-light-app-core` + `cargo tree --target
wasm32-unknown-unknown` sem `reqwest`/`rusqlite`.
**Depende:** F2.2. **BLOQUEANTE** — o PR só é mesclado por **push+merge humano**; a
tarefa implementa no branch, roda a bateria, e escreve `blocked`/HALT no ponto de
handoff (aguardando merge + re-pin). **Não** stubar, **não** forkar, **não** copiar.

## F2.3a — Fronteira: rotear Gemini + expor streaming (consumir o core re-pinado) + MOCK
**Objetivo:** com o core re-pinado (F2.3), consumir as novas capacidades **na
fronteira** (`core/src/lib.rs`), sem tocar o `the-light`:
1. **Gemini:** garantir que `ask_anchored(..., provider_name="gemini",
   key=Some("k"), model=None)` **constrói** o provedor via `ai::build_provider`
   (sem enviar rede no teste); surfacear `default_model`/`estimate_cost_usd` gemini
   se a UI precisar (F2.5). Como `ask_anchored` já repassa `provider_name`, o esforço
   é validar + expor custo/modelo, não reescrever ancoragem.
2. **Streaming:** expor um caminho de streaming na fronteira UniFFI — um
   **callback interface** (ex. `#[uniffi::export(callback_interface)] pub trait
   AiStreamObserver { fn on_token(&self, chunk: String); }`) e uma função
   `ask_anchored_stream(..., observer: Box<dyn AiStreamObserver>) -> Result<AiAnswer,
   CoreError>` que delega ao `complete_stream` do core, emitindo tokens e devolvendo
   o `AiAnswer` final (mesma anti-alucinação: `cited_text` do store, `interpretation`
   do modelo). Corpo `cfg(not(wasm32))` + stub web (streaming web = F2.7).
**Aceite:** teste de host determinístico com **MOCK** (via `MockLlmProvider` ⇒
`complete_stream` default emite a resposta fixa 1×): o observer recebe ≥1 chunk cujo
concatenado == `interpretation` do `AiAnswer`; `cited_text` verbatim do store;
`provider_name="gemini"` **constrói** sem rede (teste do body/parse puro já vive no
core/F2.3). Grafo wasm puro; `gen-bindings-web.sh` verde.
**Verificação:** `cargo test -p the-light-app-core` (streaming+gemini, MOCK, sem
rede) + `cargo tree --target wasm32-unknown-unknown` sem `reqwest`/`rusqlite` +
`gen-bindings-web.sh` (+ regenerar bindings nativos p/ F2.5). **Não-bloqueante.**
**Depende:** F2.3.

## F2.4 — Gestão segura de chaves (BYOK) — nativo (`expo-secure-store`) · **PRÓXIMA A SEMEAR**
**Objetivo:** serviço `app/lib/keystore.ts` (nativo) sobre **`expo-secure-store`**
(Keychain iOS / Keystore Android): `setKey(provider, key)` / `getKey(provider)` /
`deleteKey(provider)` / `listProviders()` (nomes de provedores **com** chave, nunca
valores). A chave **nunca** é logada; é lida sob demanda e passada à fronteira
(`ask_anchored(..., key)`); **não** é persistida pela fronteira nem escrita em
`bible.sqlite`/userdata. **Web = stub** (`app/lib/keystore.web.ts`, molde
`db.web.ts`): sem chave persistida na Fase 2 (política web = F2.7). **Decisão de
escopo:** F2.4 entrega **serviço + teste** (a UI mínima de configuração de chave —
colar 1×, deep-link — fica na **F2.5**, onde o painel de `ask` já tem o seletor de
provedor/modelo; acoplar a entrada da chave ao painel de IA é mais coeso e mantém a
F2.4 como infra determinística sem UI de device). Ver a task semeada em
`queue/F2.4-byok-key-native-securestore.task.md`. **Não-bloqueante** (app-side; não
toca o `the-light`; testável **sem** chave real com um fake injetável).
**Depende:** F2.2.

## F2.5 — UI nativa: `ask` ancorado (provedor/modelo + custo + streaming + citado/interpretação)
**Objetivo:** ao selecionar um versículo/capítulo no Reader (painel da F1.9/F1.11),
painel de **estudo assistido**: entrada de chave (colar 1×, deep-link p/ a página de
key do provedor; guarda via `keystore.ts` da F2.4), **seletor de provedor/modelo**
(inclui **Gemini** da F2.3, `listProviders`), **estimativa de custo visível**
(`estimate_cost_usd`), campo de pergunta → `ask_anchored`/`ask_anchored_stream`
(F2.1/F2.3a) via o glue nativo (`app/web/reading.ts` estendido → JSI), **exibindo os
tokens em streaming** (D4) e separando o **texto citado** (store, verbatim) da
**interpretação** (LLM), com rótulo "interpretação gerada por IA — confira as
Escrituras". Só nativo (web = F2.7). **Prova determinística com MOCK** (sem
chave/rede): self-test no device chama `ask_anchored(db, "kjv", "John 3:16", "What
does this mean?", "mock", null, null, "en")` e emite `TLA_ASK ref="John 3:16"
cited="16 For God so loved..." interp_len=<n> provider="mock"` (do retorno real);
`run-ios-selftest.sh` asserta `cited` verbatim do store + `provider="mock"` + sem
regressão de `TLA_READ/PARALLEL/SEARCH/XREF/NOTES/parse`. Bindings nativos
regenerados p/ `askAnchored`/`AiAnswer`/streaming.
**Aceite:** perguntar sobre uma passagem retorna, no device (≥1 nativo), a resposta
com **texto citado do store** separado da **interpretação** do MOCK; seletor de
provedor/modelo, custo e stream de tokens visíveis; **nenhuma** chamada de rede com
o MOCK; a chave (quando houver) nunca é logada.
**Verificação:** self-test headless por alvo (`TLA_ASK`, MOCK) + `tsc`/eslint +
`expo export --platform web` 0 (stub web). **Depende:** F2.1, F2.3a, F2.4.

## F2.6 — ⛔ Validação real com a chave do usuário (Claude · GPT · Gemini) — BLOQUEANTE
**Objetivo:** validar uma pergunta ancorada **real** (rede + chave do usuário) num
provedor de verdade (Claude/GPT/Gemini) em ≥1 alvo nativo: a chave vem do
secure-store (F2.4), a chamada é a **única** rede em runtime, o texto citado
continua do store e só a interpretação (streaming) vem do modelo.
**Aceite:** com a chave real do usuário, `ask_anchored[_stream](..., provider_name
real)` devolve uma interpretação ancorada e citada; nenhuma alucinação de texto
bíblico (o `cited_text` é do store); a chave não vaza em log.
**Verificação:** teste manual documentado no device com a chave do humano (≥1
provedor). **Ponto BLOQUEANTE:** exige a **chave real** (segredo) + rede →
**`gate: true`** (o loop **NÃO** roda isto sozinho; HALT p/ o humano fornecer a
chave/validar). O MOCK (F2.1/F2.3a/F2.5) já provou o determinístico.
**Depende:** F2.5. **gate: true**.

## F2.7 — PR ao `the-light-core`: IA pura em wasm (D2) + fix `default_model` gemini · **SEMEADA (ready)**
**Objetivo:** num **único PR ao `the-light`** (branch `feat/ai-pure-wasm` no repo
`/Users/butkeraites/Documents/the-light`, autorizado; **push+merge é do humano**;
**re-pin** do rev pelo Driver — molde F2.3/F0.6a), entregar as duas mudanças de core:
1. **D2 (ADR-0023) — IA pura compilável em wasm.** Introduzir uma **feature fina
   `ai-pure`** que compila só a superfície PURA do `ai` (montagem de prompt/RAG +
   `ask` ancorado + stripping de citação anti-alucinação) para `wasm32` **sem**
   `reqwest`/`rusqlite`/`chrono`/`directories`/`toml`, gateando por `embedded` os
   módulos `research`+`keys` inteiros e as funções pontuais pesadas de
   `providers`/`lexicon`/`study`/`citation`/`prompts`. `lib.rs` passa `ai` a
   `#[cfg(any(feature="embedded", feature="ai-pure"))]`. Anti-alucinação numa **única
   impl Rust** (nativo+wasm), sem drift. **Não-quebrante:** `default=["embedded"]`
   intacto; `embedded` inclui `ai-pure`.
2. **FIX batendo junto — `default_model` gemini.** `gemini-2.0-flash` (RETIRADO
   3/mar/2026) → `gemini-2.5-flash`; ajustar testes que fixavam o antigo; **não
   inventar preço** para 2.5-flash (fica `None`, honesto).
**Aceite:** no repo `the-light`, branch sobre `133077a`: `cargo test --workspace`
(defaults, ~184 testes) verde + **`cargo build -p the-light-core --no-default-features
--features ai-pure --target wasm32-unknown-unknown` compila** (partes puras do `ai` no
wasm) + `cargo tree` do build `ai-pure`/wasm **sem** `reqwest`/`rusqlite` +
`clippy -D warnings`/`fmt --check` limpos + `default_model("gemini")=="gemini-2.5-flash"`.
Spec do PR em `loop/proposals/the-light-PR-ai-pure-wasm.md` + **ADR novo**. Após
**push+merge humano**, o **Driver re-pina** as 2 linhas de `core/Cargo.toml` (web
`default-features=false` + nativa `["embedded"]`) e revalida a fronteira. **Ligar
`features=["ai-pure"]` na linha web + consumir o prompt/citação puros = F2.7b.**
**Verificação:** ver `queue/F2.7-pr-core-ai-wasm.task.md` (BLOCO DE VERIFICAÇÃO).
**Depende:** F2.6. **BLOQUEANTE** (implementa no branch, roda a bateria, `blocked`/HALT
no ponto de handoff = aguardando merge + re-pin). **Não** stubar/forkar/copiar.

## F2.7b — Paridade web de IA via core `ai-pure` (wasm) + `fetch`  *(backlog; NÃO semear até F2.7 mergeada+re-pinada)*
**Objetivo:** com as partes puras da IA compilando em wasm (D2/F2.7 mergeada e
re-pinada, com `features=["ai-pure"]` ligada na linha web do `core/Cargo.toml`),
destubar o caminho web de IA em `app/web/reading.web.ts`: `ask` ancorado no browser
montando o prompt/RAG/citação **pelo Rust wasm** (uma fonte da verdade, sem drift),
transporte por **`fetch`** (delegado ao JS; CORS/TLS do browser), com o texto do
versículo vindo do **store web** (`wa-sqlite`/OPFS, F1.13–F1.16). Fixar aqui a
**política de chave no web** (web keystore session-only em memória + aviso, ou sem IA
web) — decisão registrada em ADR. Streaming web via `fetch` streaming (`ReadableStream`)
se viável; senão, não-streaming no web (registrado). Bindings web regenerados
(`gen-bindings-web.sh`) expondo a superfície `ai-pure`; stub→real.
**Aceite:** `ask` ancorado no browser com o texto do store, separando
citado/interpretação, prova **headless node** com **MOCK de `fetch`** (sem rede real);
política de chave web registrada; `expo export web` 0; anti-alucinação = mesma impl Rust.
**Verificação:** prova headless node com MOCK + `expo export web` 0.
**Depende:** F2.7 (mergeada + re-pinada), F2.5. **Não-bloqueante** (app-side).

## F2.8 — ⛔ Marco 2: IA BYOK ancorada com Claude/GPT/Gemini
**Objetivo:** confirmar a **camada de IA BYOK ancorada** funcionando: `ask` numa
passagem com **Claude, GPT e Gemini** (chave do usuário), streaming, texto **sempre
do store** (anti-alucinação), custo visível, chave em armazenamento seguro (nunca em
git/log), Fase 1 intacta e **offline sem IA**; `the-light` consumido pinado (PR de
F2.3 registrado + re-pin). Atualizar `PROGRESS.md`; consolidar ADRs.
**Aceite:** checklist do Marco 2 verde (≥ alvos decididos); IA opt-in (desligada, o
app segue 100% offline); atribuições preservadas; sem vazamento de chave.
**Verificação:** revisão do Guia; `PROGRESS.md` atualizado.
**Depende:** F2.5, F2.6, F2.7, F2.7b. **gate: true** — marco; HALT para sign-off.

---

> **Regras rígidas da Fase 2 (do `IMPLEMENTATION_PLAN.md` §0):** offline-first (IA
> **opt-in**; rede em runtime **só** para a chamada de IA com a chave do usuário);
> **BYOK API key** (chave do usuário, **nunca** em git/log; secure-store nativo;
> login-de-conta OAuth REJEITADO — ADR-0023 D3); **anti-alucinação** (texto do
> versículo **sempre** do store local; o LLM só interpreta; referência canônica;
> `cited_text` separado de `interpretation`, inclusive no streaming e no web);
> **`the-light` só via PR + ADR** (D1+D2+D4 = **um** PR consolidado F2.3 = handoff
> humano; consumo pinado até o re-pin); **prova determinística com MOCK** (nunca o
> LLM real no CI). Diante de conflito com qualquer regra: **HALT**, não improviso.
