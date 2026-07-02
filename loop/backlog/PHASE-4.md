# Backlog — Fase 4 (Polimento da IA: streaming web real · multi-provedor · Tavily BYOK · multi-IA de conteúdo real)

> Rascunhos de tarefa redigidos pelo Planner. Cada bloco vira um arquivo
> `queue/<ID>.task.md` quando elegível (deps aceitas). **Uma de cada vez** (ver
> `PROTOCOL.md`). A Fase 4 (**Polimento da IA**, direção aprovada no sign-off do
> Marco 3, 2026-07-02) **refina** a camada de IA já entregue (Fases 2–3, aprovadas
> nos Marcos 2 e 3) sem escopo novo de produto: **streaming web token-a-token**
> (SSE/`ReadableStream` via `fetch`, realizando o follow-up adiado em ADR-0025),
> **transporte web multi-provedor** (anthropic/openai/ollama, além do Gemini MVP),
> **Tavily BYOK** (2º backend de pesquisa web, chave session-only), **streaming
> NATIVO real por provedor (SSE)** e a **validação de conteúdo real** (multi-IA +
> Tavily reais). Tudo **OPT-IN**; a Fase 1 segue 100% offline sem IA.

## Princípios da Fase 4 (não negociáveis — registrados no cabeçalho)

1. **Anti-alucinação ZERO-DRIFT — o streaming só muda o TRANSPORTE.** O texto do
   versículo, as glosas do léxico e as citações **continuam** vindo do store local
   / do Rust `ai-pure` (`ai_web_prepare`/`study_web_prepare`/`session_web_prepare`
   montam `cited_text`/prompt/citação; `ai_web_finalize`/`study_web_finalize`
   aplicam `rewrite_anchors`/`verify`/aparato). Os **tokens** emitidos incremental­
   mente são **apenas** da INTERPRETAÇÃO do modelo (nunca texto bíblico). O
   `cited_text` viaja SEPARADO da `interpretation`, inclusive no stream. Streaming
   real = quebrar a `interpretation` completa em N incrementos; **o texto final
   concatenado passa pela MESMA `finalize` (mesma impl Rust)** → nenhum novo caminho
   de anti-alucinação em TS. Espelhar prompt/citação/aparato em TS é **PROIBIDO**
   (ADR-0029).
2. **BYOK — chave nunca em git/log.** A chave do LLM vai **só no header** do `fetch`
   (nunca na URL/log), session-only no web (`keystore.web`, ADR-0025). O **Tavily**
   é BYOK (chave `research.tavily`): **nativo** = Keychain/Keystore (`expo-secure-
   store`, F2.4); **web** = session-only (mesma política do LLM, ADR-0025). A
   **Wikipedia** segue keyless (ADR-0028). Chave real = **tarefa de validação
   bloqueante** (molde F3.10/F2.6): o loop NUNCA roda a chave real sozinho.
3. **Offline-first — IA e pesquisa são OPT-IN.** Toda a Fase 1 (leitura, versões,
   tema, busca, xref, notas) segue **100% offline, sem IA e sem rede**. Streaming,
   multi-provedor e Tavily só ligam com a chave/opção do usuário. Tavily = padrão
   DESLIGADO + aviso de privacidade (molde Wikipedia, ADR-0028); **nenhuma**
   capacidade essencial passa a exigir rede/conta.
4. **`the-light` só via PR + ADR (`04b9b24` até um eventual re-pin).** O que é
   **app-side** (transporte `fetch`, streaming TS, multi-provedor web, Tavily web,
   `research_key` na fronteira que já consome `build_research_provider`/`Tavily`
   `pub`/embedded) **NÃO** toca o core. O **streaming NATIVO real (SSE)** exige
   sobrescrever `LlmProvider::complete_stream` nos provedores reais (hoje só o
   **default não-quebrante** existe) → **PR sancionado** (branch + push/merge humano
   + re-pin, molde F2.3/F2.7). Prova **determinística por MOCK** por tarefa (nunca o
   LLM real no CI). Qualidade por tarefa (Rust `fmt`/`clippy -D warnings`/`test`; TS
   `tsc`/`eslint`) verde. Diante de conflito com qualquer regra: **HALT**, não
   improviso.

## Investigação da fonte do core (`04b9b24`, só-leitura) — dimensiona toda a fase

Leitura só-permitida do checkout do cargo
`~/.cargo/git/checkouts/the-light-9eb8809a6d68281a/04b9b24/crates/the-light-core/src/ai/`
(**não** o `/Users/butkeraites/Documents/the-light` bloqueado). Achados que fixam
bloqueante/toca-the-light de cada candidato:

- **Streaming — `LlmProvider::complete_stream` tem SÓ o default não-quebrante; NENHUM
  provedor sobrescreve com SSE.** `mod.rs:378` define `complete_stream(&self, system,
  user, on_token: &mut dyn FnMut(&str)) -> Result<String>` cujo **default** chama
  `complete` e emite a String inteira **1×** (`mod.rs:383-386`). Os provedores reais
  (`AnthropicProvider`/`OpenAiProvider`/`OllamaProvider`/`GeminiProvider`,
  `providers.rs:205/275/347/459`) **não** sobrescrevem `complete_stream` e enviam
  **`"stream": false`** no corpo (`providers.rs:321/332`). → **Streaming NATIVO real
  (SSE) = PR ao the-light** (override `complete_stream` com `reqwest` SSE `"stream":
  true`) → **F4.6, BLOQUEANTE, toca the-light**. **Streaming WEB real** independe do
  core: a fronteira `ai_web_prepare`/`ai_web_finalize` (cfg-free, `ai-pure`) **não
  muda**; só o **transporte TS** (`webLlmTransport`/`geminiComplete`) passa a ler o
  `ReadableStream`/SSE do provedor (endpoint `:streamGenerateContent?alt=sse`) e
  chamar um callback de token → **F4.1, NÃO-BLOQUEANTE, não toca the-light**.
- **Tavily — `pub struct TavilyProvider` existe, BYOK, mas é `embedded`-only.**
  `research.rs:221` `#[cfg(feature="embedded")] pub struct TavilyProvider`;
  `TavilyProvider::new(key)` (`research.rs:227`); `build_research_provider("tavily",
  key, lang)` **exige a chave** (`Err(AiError::NoKey("research.tavily"))` se `None`,
  `research.rs:296-305`). `WebSource` é **`pub`/`ai-pure`** (`research.rs:37`), mas
  `TavilyProvider`/`WikipediaProvider`/`build_research_provider` são **embedded-only
  (reqwest)** → NÃO compilam em wasm. Consequências: **nativo** = a fronteira
  `deep_study` já chama `build_research_provider(&backend, None, lang.code())`
  (`core/src/lib.rs:1438`, **chave `None` hard-coded**) → Tavily nativo só precisa
  **threading de um `research_key: Option<String>`** na fronteira (app-side, o core
  já expõe tudo `pub`/embedded) → **F4.3, NÃO-BLOQUEANTE, não toca the-light**;
  **web** = `fetch` à API Tavily em TS (molde Wikipedia `research.web.ts::
  wikipediaSearch`, mas **com chave** session-only) → **F4.4, NÃO-BLOQUEANTE**. A
  **validação com a chave Tavily REAL** = **bloqueante** (parte da F4.5).
- **Mais provedores — `PROVIDERS=["anthropic","openai","ollama","gemini"]`** (`mod.rs:60`);
  `build_provider`/`default_model`/`estimate_cost_usd` `pub` (`providers.rs:40/60/94`).
  O **transporte WEB** (`app/web/ai-anchored.web.ts::webLlmTransport`) hoje só trata
  **`gemini`+`mock`** (MVP F2.6/ADR-0025) → estender p/ **anthropic/openai/ollama**
  (que **já existem no core**, nativo já funciona) = **app-side** (espelhar os
  `*_body`/`*_extract` privados por provedor, como já se fez p/ Gemini) → **F4.2,
  NÃO-BLOQUEANTE, não toca the-light**. Um provedor **novo, inexistente no core**
  (ex.: um LLM não suportado) exigiria `impl LlmProvider` no core → **PR**
  (BLOQUEANTE) — fica como **opção futura** (fora desta fase; se acionada, é uma
  tarefa `gate:true` de decisão de qual provedor + PR).
- **Multi-IA de CONTEÚDO real** — o wiring de comparação existe e é `pub`
  (`askAnchored` nativo F3.7 + web F3.12b, mesma âncora, N provedores). Provar que
  provedores **reais** devolvem interpretações **diferentes** exige **chaves reais**
  → **validação humana bloqueante** (molde F3.10), parte da **F4.5**.

### Consequência arquitetural (o que precisa — e o que NÃO precisa — de PR ao core)

- **NÃO precisa de PR (app-side, prova por MOCK):** streaming web real (F4.1),
  transporte web multi-provedor (F4.2), `research_key` na fronteira p/ Tavily nativo
  (F4.3 — o core já expõe `TavilyProvider`/`build_research_provider` `pub`/embedded),
  Tavily web via `fetch` (F4.4). Nenhuma toca o `the-light` (`04b9b24` intacto) nem
  `core/Cargo.toml`; grafo wasm segue **puro**.
- **Precisa de PR (BLOQUEANTE, handoff humano):** streaming NATIVO real por provedor
  (F4.6 — override `complete_stream` com SSE nos providers reais). Molde F2.3/F2.7:
  branch autorizado no `/Users/butkeraites/Documents/the-light`, **push/merge
  humano**, **re-pin** do Driver; spec em `loop/proposals/` + ADR novo.
- **Precisa de chave/segredo real (BLOQUEANTE, gate):** validação de conteúdo real
  (F4.5 — multi-IA real + Tavily real + streaming real de rede), molde F3.10/F2.6.
  O MOCK (F4.1–F4.4) já prova o determinístico.

## Decomposição (F4.1 → F4.7)

Padrão de fase (herdado das Fases 1–3): **capacidade testável por MOCK** (app-side,
prova headless/host determinística) → **UI** → **validação real (gate, chave/rede)**
→ **[PR ao core] + re-pin** → **Marco**. Front-load das tarefas NÃO-BLOQUEANTES para
o loop avançar até o 1º ponto bloqueante (a validação real F4.5). Anti-alucinação em
todas: o texto/glosas/citações vêm do store/`ai-pure`; o streaming só fatia a
interpretação do modelo em incrementos.

### Paradas (gates/handoffs): **F4.5 validação real (gate)**, **F4.6 PR ao core (handoff BLOQUEANTE)**, **F4.7 Marco 4 (gate)**

### Mapa (id · título · deps · bloqueante? · toca the-light? · gate?)

| ID | Título | Deps | Bloqueante? | Toca the-light? | gate? |
|----|--------|------|-------------|-----------------|-------|
| **F4.1** | **Streaming WEB real (token-a-token)** — `webLlmTransport`/`geminiComplete` leem SSE/`ReadableStream` (`:streamGenerateContent?alt=sse`) e chamam um callback de token; `askAnchoredStream` web emite N incrementos reais; `ai_web_prepare`/`finalize` (Rust) **inalterados**; prova por **MOCK de stream** | — | **não** | não | não ← **1ª A SEMEAR** |
| F4.2 | **Transporte web multi-provedor** — `webLlmTransport` passa a tratar **anthropic/openai/ollama** (espelha `*_body`/`*_extract` privados por provedor, como o Gemini) além de `gemini`/`mock`, com streaming (F4.1); prova por **MOCK** por provedor | F4.1 | não | não | não |
| F4.3 | **Fronteira nativa: Tavily BYOK** — `deep_study` ganha `research_key: Option<String>` → `build_research_provider(backend, key, lang)` (hoje `None`); `"tavily"` sem chave → CoreError; prova por **MOCK** (backend `"mock"` ignora a chave; grafo wasm puro) | — | não | não | não |
| F4.4 | **Tavily web** — `research.web.ts::tavilySearch(fetch, key, query, lang, limit)` (molde `wikipediaSearch`, **com chave** session-only só no header) → `web_sources` do `study_web_prepare`/`finalize`; UI toggle opt-in DESLIGADO + aviso; prova por **MOCK** de `fetch` | F4.3 | não | não | não |
| **F4.5** | **⛔ Validação real** com as chaves do usuário: streaming real (web+nativo), **multi-IA de conteúdo real** (Claude/GPT/Gemini devolvem interpretações diferentes p/ a mesma âncora), **Tavily real** (fontes reais citadas `[W:n]`) | F4.1, F4.2, F4.3, F4.4 | **SIM** (chaves/rede) | não | **gate:true** |
| **F4.6** | **PR ao `the-light-core`: streaming NATIVO real por provedor (SSE)** — override `LlmProvider::complete_stream` em anthropic/openai/gemini/ollama com `reqwest` SSE `"stream": true`; **não-quebrante** (default intacto); re-pin | F4.5 | **SIM** (branch+merge humano+re-pin) | **SIM** | não |
| **F4.7** | **⛔ Marco 4 (Polimento da IA):** streaming real (web+nativo), multi-IA real, Tavily BYOK, transporte web multi-provedor | F4.1–F4.6 | **SIM** gate | não | **gate:true** |

> **Relação com o `IMPLEMENTATION_PLAN.md`:** o plano §FASE 4 lista "Refinamento e
> abertura" (planos de leitura, i18n, performance, sync). O **sign-off do Marco 3**
> (2026-07-02) redirecionou a Fase 4 imediata para o **Polimento da IA** (streaming
> web real, multi-IA de conteúdo real, Tavily BYOK, mais provedores) — refino da
> camada de IA já entregue, **sem** escopo novo de produto. Os itens F4.1–F4.7 são o
> **como** honesto desse polimento; planos de leitura/i18n/performance/sync
> permanecem como fase posterior a decompor quando/ se retomados.

---

## F4.1 — Streaming WEB real (token-a-token via `fetch` SSE/ReadableStream) · **PRÓXIMA A SEMEAR**
**Objetivo:** fazer o **transporte web de IA** (`app/web/ai-anchored.web.ts`) streamar
a resposta do provedor **token-a-token** (SSE/`ReadableStream`) e chamar um **callback
de token**, para a UI web (`ReaderAskPanel`) exibir a interpretação incremental como o
nativo. Realiza o follow-up **explicitamente adiado** em ADR-0025 ("`askAnchoredStream`
web é não-streaming ... SSE/`ReadableStream` = follow-up"). **App-side apenas:** a
fronteira Rust `ai_web_prepare`/`ai_web_finalize` (`ai-pure`, cfg-free) **NÃO muda**;
só o TRANSPORTE TS passa a fatiar a interpretação em incrementos. Semeada em
`queue/F4.1-streaming-web-real.task.md`.
**Aceite (MOCK de stream):** um `fetch` MOCK que devolve um corpo em `ReadableStream`
com **N chunks** (SSE Gemini `data: {...}`) faz o transporte chamar `onToken` **N
vezes**; a concatenação dos tokens == `AiAnswer.interpretation`; `cited_text` == "16
<João 3:16 KJV VERBATIM do store>" (via `ai_web_prepare`, **inalterado**); âncoras
`[V:...]` espúrias do modelo removidas pela `ai_web_finalize` (Rust, mesma impl);
**1** chamada `fetch` ao endpoint de streaming (`:streamGenerateContent?alt=sse`), a
chave só no header `x-goog-api-key` (nunca na URL/log); sem `onToken` (ou caminho
não-streaming) o `askAnchored` segue funcionando (sem regressão). `tsc`/`eslint` +
`expo export --platform web` 0.
**Verificação:** ver `queue/F4.1-streaming-web-real.task.md` (BLOCO DE VERIFICAÇÃO).
**Depende:** — (1ª da Fase 4; consome a fronteira web da F2.7b/F3.12a, aceita).
**NÃO-BLOQUEANTE** (só mock, sem chave/rede real). **NÃO toca `the-light`**
(`04b9b24` intacto; `ai_web_prepare`/`finalize` inalterados). Possível **ADR-0033**
(forma do streaming web: SSE `alt=sse` + parsing de `ReadableStream` + prova por
mock stream).

## F4.2 — Transporte web multi-provedor (anthropic/openai/ollama)
**Objetivo:** estender `webLlmTransport` (`app/web/ai-anchored.web.ts`) para tratar os
provedores **anthropic**, **openai** e **ollama** — que **já existem no core**
(`PROVIDERS`, nativo já funciona) — além de `gemini`/`mock`, **espelhando** os
`*_body`/`*_extract` privados de cada provedor (mesmo padrão do `geminiComplete`) e
reusando o streaming da F4.1 (SSE/`ReadableStream` por provedor). A chave vai só no
header apropriado de cada provedor (`x-api-key`/`authorization`/…), nunca na URL/log.
O `ReaderAskPanel`/`ReaderComparePanel` já têm o seletor de provedor (F2.5/F3.7).
**Aceite (MOCK por provedor):** prova headless por provedor (anthropic/openai/ollama)
com `fetch` MOCK do respectivo corpo de stream → `onToken` recebe os incrementos;
concatenação == interpretation; `cited_text` do store inalterado; chave só no header.
`tsc`/`eslint` + `expo export web` 0. **Anti-alucinação:** prompt/citação seguem do
`ai_web_prepare`/`finalize` (Rust) — só o corpo/extração de transporte é por provedor.
**Verificação:** headless node por provedor (MOCK) + `expo export web` 0.
**Depende:** F4.1. **NÃO-BLOQUEANTE** (app-side; provedores já no core). **NÃO toca
`the-light`.** (Provedor **novo, inexistente no core** = PR futuro, fora de escopo.)

## F4.3 — Fronteira nativa: Tavily BYOK no `deep_study` (`research_key`)
**Objetivo:** permitir o backend de pesquisa **Tavily (BYOK)** no `deep_study`
(`core/src/lib.rs`): adicionar um parâmetro **opcional final** `research_key:
Option<String>` que é repassado a `the_light_core::ai::build_research_provider(&backend,
research_key, lang.code())` (hoje `None` hard-coded, `lib.rs:1438`). `"tavily"` sem
chave → `CoreError` (espelha `AiError::NoKey("research.tavily")`); `"wikipedia"`/`"mock"`
ignoram a chave (keyless/sem rede). Corpo `cfg(not(wasm32))` + stub web (Tavily web =
`fetch`, F4.4); grafo wasm segue **puro** (`build_research_provider`/`TavilyProvider`
são embedded-only). Higiene TS: `deepStudy` (`app/web/reading.ts`) + stub
(`reading.web.ts`) ganham `researchKey?: string` opcional final; bindings regenerados.
**Aceite (MOCK, sem rede/chave):** `deep_study(...,research_backend=Some("mock"),
research_key=None)` mantém o comportamento F3.9a (2 `WebSource` fixos, sem rede);
`research_backend=Some("tavily"), research_key=None` → `CoreError` (sem panic);
`passage_text` do store ≠ `interpretation` (mock); grafo wasm puro (`cargo tree
--target wasm32…` sem `reqwest`/`rusqlite`); `tsc`/`eslint` verdes.
**Verificação:** `cargo test -p the-light-app-core` (host, `embedded`, MOCK) + `cargo
tree --target wasm32-unknown-unknown` sem `reqwest`/`rusqlite` + `gen-bindings-web.sh`
+ `tsc --noEmit`. **Depende:** — . **NÃO-BLOQUEANTE** (`TavilyProvider`/
`build_research_provider` já `pub`/embedded em `04b9b24`; MOCK não usa chave). **NÃO
toca `the-light`.** Rede/chave Tavily real = **F4.5**.

## F4.4 — Tavily web (`fetch` + chave session-only) + UI toggle opt-in
**Objetivo:** paridade web da pesquisa **Tavily**: `app/web/research.web.ts::
tavilySearch(fetchImpl, key, query, lang, limit) -> StudyWebSourceInput[]` (molde
`wikipediaSearch` da F3.12b, mas **com chave** — `TavilyProvider`/`build_research_
provider` são embedded-only → no web a busca é `fetch` TS; a montagem `[W:n]`/citação
segue o MESMO Rust `ai-pure`, ZERO drift). `study.web.ts::deepStudyOnHandle` resolve
`web_sources` quando `researchBackend === 'tavily'` (chave session-only só no header,
nunca na URL/log). UI: `ReaderStudyPanel` ganha a opção **Tavily** no seletor de
pesquisa (opt-in DESLIGADO + aviso de privacidade + input de chave session-only,
molde do toggle Wikipedia F3.12b + chave web ADR-0025). Sem chave/backend → `[]`
(offline). Backend desconhecido → erro explícito.
**Aceite (MOCK de `fetch`):** estudo Acadêmico com `researchBackend="tavily"` + fetch
MOCK Tavily+LLM → ≥1 citação `kind="Web"` com URL do resultado Tavily; `academic_markdown`
cita `[W`; sem `researchBackend` → 0 citação Web; chave só no header do `fetch`
Tavily, nunca na URL/log; `tsc`/`eslint` + `expo export web` 0.
**Verificação:** headless node (`research.web`, MOCK Tavily) + `expo export web` 0.
**Depende:** F4.3. **NÃO-BLOQUEANTE** (app-side, MOCK). **NÃO toca `the-light`.**
Validação com chave Tavily real = **F4.5**.

## F4.5 — ⛔ Validação real (streaming real · multi-IA de conteúdo real · Tavily real)
**Objetivo:** validar o **conteúdo real** (rede + chaves do usuário) em ≥1 alvo:
(1) **streaming real** — os tokens chegam **incrementais** de um provedor de verdade
(web via SSE/F4.1–F4.2; nativo pela via atual/F4.6 quando mesclada); (2) **comparação
multi-IA de conteúdo real** — Claude/GPT/Gemini devolvem **interpretações diferentes**
para a **mesma âncora** (mesmo `cited_text` do store nas N colunas); (3) **Tavily
real** — `deep_study(...,research_backend="tavily", research_key=<chave real>)` (nativo)
e `tavilySearch` (web) trazem **fontes reais** citadas `[W:n]`, sem alucinação de
URL/texto (vêm do store/da busca). As chaves vêm do secure-store/session-only; a
chamada é rede opt-in; o texto citado/glosas/URLs continuam do store/da busca, só a
interpretação vem do modelo. Harness molde F3.10/F2.6 — **a chave NUNCA passa pelo
loop** (o humano executa localmente).
**Aceite:** com as chaves reais, streaming incremental visível; comparação com
respostas distintas por provedor e mesmo `cited_text`; Tavily com fontes reais `[W:n]`;
nenhuma alucinação de texto/léxico/URL; chaves não vazam em log.
**Verificação:** teste manual documentado no device/browser com as chaves do humano
(≥1 provedor + Tavily). **gate: true** — exige **chaves reais** (segredo) + rede → o
loop **NÃO** roda isto sozinho (HALT p/ o humano). O MOCK (F4.1–F4.4) já provou o
determinístico. **Depende:** F4.1, F4.2, F4.3, F4.4. **BLOQUEANTE** (chaves/rede).

## F4.6 — PR ao `the-light-core`: streaming NATIVO real por provedor (SSE)
**Objetivo:** num **único PR sancionado ao `the-light`** (branch autorizado em
`/Users/butkeraites/Documents/the-light`; **push/merge humano**; **re-pin** do Driver
— molde F2.3/F2.7/ADR-0005), **sobrescrever `LlmProvider::complete_stream`** nos
provedores reais (`AnthropicProvider`/`OpenAiProvider`/`GeminiProvider`/`OllamaProvider`)
com `reqwest` **SSE** (`"stream": true`, parsing de `text/event-stream`), emitindo cada
delta por `on_token` e devolvendo a resposta completa ao final. **Não-quebrante:** o
**default** de `complete_stream` (emite 1×, `mod.rs:378`) permanece para o `mock` e
qualquer provedor sem override; `complete` (não-streaming) intacto; `default=["embedded"]`
byte-a-byte. Prova **determinística por MOCK/parse puro** (parsing de um corpo SSE
fixo → N deltas, sem rede); LLM real = F4.5.
**Aceite:** no `the-light`, branch sobre `04b9b24`: `cargo test --workspace` +
`clippy -D warnings` + `fmt --check` verdes (com testes puros do parser SSE); os
provedores emitem N incrementos de um corpo SSE de fixture; `default` intacto
(mock/CLI/TUI inalterados). Spec em `loop/proposals/the-light-PR-native-sse-streaming.md`
+ **ADR novo**. Após **push/merge humano**, o Driver **re-pina** o rev e revalida a
fronteira (`cargo test -p the-light-app-core` + grafo wasm puro).
**Verificação:** (no `the-light`) `cargo test`/`clippy -D warnings`/`fmt --check` +
parser SSE puro; (na fronteira, pós re-pin) `cargo test -p the-light-app-core` + grafo
wasm puro. **Depende:** F4.5. **BLOQUEANTE** (branch + push/merge humano + re-pin).
**Toca `the-light`** (via PR + ADR). **Não** stubar/forkar/copiar.

## F4.7 — ⛔ Marco 4: Polimento da IA completo
**Objetivo:** confirmar o **polimento da IA**: **streaming real** (web SSE + nativo
SSE), **comparação multi-IA de conteúdo real** (Claude/GPT/Gemini), **Tavily BYOK**
(2º backend de pesquisa, chave session-only web / Keychain nativo, opt-in), **transporte
web multi-provedor**; IA opt-in (o app segue 100% offline sem IA); chave em
armazenamento seguro / session-only (nunca em git/log); atribuições (STEP CC-BY,
OpenBible CC-BY, Wikipedia) visíveis; `the-light` consumido pinado (PRs registrados +
re-pin). Atualizar `PROGRESS.md`; consolidar ADRs.
**Aceite:** checklist do Marco 4 verde (≥ alvos decididos); IA opt-in (desligada, o
app segue offline); sem vazamento de chave; anti-alucinação ZERO-DRIFT provada
(streaming só fatia a interpretação; texto/glosas/citações do store/`ai-pure`).
**Verificação:** revisão do Guia; `PROGRESS.md` atualizado. **Depende:** F4.1, F4.2,
F4.3, F4.4, F4.5, F4.6. **gate: true** — marco; HALT para sign-off humano/auditoria.

---

> **Regras rígidas da Fase 4 (do `IMPLEMENTATION_PLAN.md` §0):** offline-first (IA e
> pesquisa **opt-in**; rede em runtime **só** para a chamada de IA e para a pesquisa
> web, ambas com decisão/chave do usuário); **BYOK** (chave do LLM e do **Tavily**
> **nunca** em git/log; secure-store nativo / web session-only; só no header do
> `fetch`); **anti-alucinação ZERO-DRIFT** (o streaming muda **só o transporte**; o
> texto do versículo, glosas e citações **sempre** do store/`ai-pure`; os tokens são
> só da interpretação do modelo; `cited_text`/`citations` separados de
> `interpretation`; espelhar prompt/citação/aparato em TS é **PROIBIDO**); só **dados
> livres** (STEP CC-BY, OpenBible CC-BY, Wikipedia keyless com atribuição); **`the-
> light` só via PR + ADR** (app-side não toca o core; streaming NATIVO SSE = PR
> sancionado + re-pin; consumo pinado `04b9b24`); **prova determinística com MOCK**
> (nunca o LLM/Tavily real no CI; a chave real é validação humana à parte, F4.5).
> Diante de conflito com qualquer regra: **HALT**, não improviso.
