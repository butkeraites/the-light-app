# Backlog — Fase 2 (Camada de IA BYOK — Claude · GPT · Gemini · estudo assistido ancorado)

> Rascunhos de tarefa redigidos pelo Planner. Cada bloco vira um arquivo
> `queue/<ID>.task.md` quando elegível (deps aceitas). **Uma de cada vez**
> (ver `PROTOCOL.md`). A Fase 2 acrescenta uma **camada de IA OPCIONAL** por
> cima do app de leitura offline da Fase 1 (aprovado no Marco 1): perguntar/
> estudar uma passagem com um LLM da **própria chave do usuário** (BYOK), com o
> **texto do versículo sempre vindo do store local** (anti-alucinação) — o LLM
> só **interpreta**. Adiciona o provedor **Gemini** e a gestão segura de chaves.

## Princípios da Fase 2 (não negociáveis — registrados no cabeçalho)

1. **IA é OPCIONAL e ADITIVA (BYOK).** Toda a Fase 1 (leitura, versões, tema,
   busca FTS5, xref CC-BY, notas/marcações) continua **100% offline, sem IA e
   sem rede**. A IA só liga quando o usuário fornece a **própria chave**
   (Gemini/Claude/GPT). **Nenhuma** capacidade essencial passa a exigir
   rede/conta.
2. **Chave do usuário NUNCA em git/log.** Armazenamento seguro: **nativo** =
   Keychain (iOS)/Keystore (Android) via `expo-secure-store`; **web** = decisão
   explícita (session-only em memória + aviso, pois `localStorage`/`IndexedDB`
   são inseguros para chaves) — ver F2.2. A chave **nunca** é logada nem impressa;
   trafega da UI direto para `build_provider(name, key, model)` (a fronteira a
   recebe como argumento e **não** a persiste). O `KeyStore`/`secrets.toml` do
   core **não** é usado no app.
3. **Anti-alucinação é LEI.** O texto do versículo **sempre** vem do store local
   (verbatim, domínio público), é numerado por `ai::numbered_passage` e injetado
   no prompt como **contexto** via `ai::ask_context`. O LLM **apenas interpreta**
   — **nunca** gera/edita texto bíblico. A referência é **canônica** (via a
   fronteira/`parse_reference`). A resposta da IA separa, no **tipo de retorno**,
   o **texto citado** (do store) da **interpretação** (do modelo).
4. **Rede só para a IA opt-in.** A chamada ao LLM é a **ÚNICA** rede em runtime,
   e só ocorre com a chave do usuário; leitura/busca/xref/notas permanecem
   offline/local. No **nativo** o transporte é `reqwest` (embutido no core, feature
   `embedded`); no **web** a `ai` do core não compila (embedded off) → o caminho
   web de IA é decisão de arquitetura (F2.2), como foi o store web (F1.12).
5. **`the-light` intocado** (`8f66004`). Se a IA exigir mudar o core (ex.: Gemini
   no core; partes puras da IA compiláveis em wasm), é **PR + ADR** (HALT). Prova
   **determinística** por tarefa com **MOCK** do provedor (`MockLlmProvider` do
   core / `build_provider("mock", …)`) — **NUNCA** chamar o Gemini/Claude/GPT
   **real** no CI/loop. A chamada real (com a chave do usuário) é um **ponto
   bloqueante** validado à parte (F2.6). Qualidade por tarefa (Rust
   `fmt`/`clippy -D warnings`/`test`; TS `tsc`/`eslint`) verde. Diante de conflito
   com qualquer regra acima: **HALT**, não improviso.

## O que o `the-light-core` JÁ entrega (reaproveitar — NÃO reimplementar)

Investigação na fonte pinada (`8f66004`, `crates/the-light-core/src/ai/`, leitura
só-permitida do checkout do cargo — **não** o `../the-light` bloqueado):

- **Módulo `ai` COMPLETO, porém `#[cfg(feature = "embedded")]`** (lib.rs l.20 →
  **só nativo**; no web/wasm o `ai` **não existe**, igual a store/search/xref/
  userdata — matriz de features do ADR-0005). Consequência-chave: a IA do core é
  consumível **no nativo** pela fronteira; o **web precisa de outro caminho** (F2.2).
- **Trait `LlmProvider`** (`ai::mod.rs`): `name()`, `model()`,
  `complete(system, user) -> Result<String>`, `chat(system, &[ChatMessage])`,
  `estimate_tokens`. **`MockLlmProvider`** (resposta fixa, **sem rede**) para
  testes/demos.
- **Fábrica `build_provider(name, key: Option<String>, model: Option<String>) ->
  Result<Box<dyn LlmProvider>>`** (`ai::providers`) — roteia `"anthropic"` /
  `"openai"` / `"ollama"` / `"mock"`. **A CHAVE É ARGUMENTO** (BYOK; não lê
  `secrets.toml`). Também: `default_model(provider)`, `estimate_cost_usd(model,
  in, out)`.
- **`GEMINI NÃO EXISTE`**: `ai::PROVIDERS = ["anthropic", "openai", "ollama"]`;
  `default_model`/`estimate_cost_usd` **sem** entrada gemini. Adicionar Gemini =
  novo `impl LlmProvider` (endpoint `generativelanguage.googleapis.com`) +
  `default_model`/`estimate_cost_usd` gemini. **Onde ele vive** (PR ao core vs.
  impl local na fronteira do app) é a decisão da F2.2.
- **Ancoragem/anti-alucinação (funções PURAS, `ai::study`)**: `numbered_verses` /
  `numbered_passage(&Passage)` (texto do store, numerado por versículo);
  `ask_context(label, numbered_passage, related) -> String` (monta o bloco RAG,
  `related` vazio → "(nenhuma)"); `ask(provider, question, context, lang) ->
  Result<String>` (system de `prompts::ask_system_prompt`, injeta o contexto,
  devolve **só a interpretação**); `ask_session` (conversa — Fase 3). O `Passage`
  vem de `BibleSource::passage` (o mesmo store da F0.9/F1.2).
- **Stripping/citação (`ai::citation`)**: `Citation`/`CitationCollector`/
  `rewrite_anchors`/`provenance_footer` — invariante "o LLM nunca produz uma
  `Citation`". Usado sobretudo pelo **estudo acadêmico** (`study`, modos×lentes) =
  **Fase 3**; a Fase 2 entrega o **`ask` ancorado** (mais simples).
- **Estudo por modo×lente×profundidade** (`StudyMode`/`Denomination`/`StudyDepth`,
  `study()`, `StudyRequest`/`StudyResult`, `to_markdown`/`to_academic_markdown`) —
  existe e é rico, mas é **Fase 3** (VISION §8). A **Fase 2** foca no `ask`
  ancorado + BYOK + Gemini (IMPLEMENTATION_PLAN §Fase 2).
- **Transporte**: os provedores concretos usam `reqwest::blocking` (nativo). No
  wasm nem compila (VISION §4 fricção #2) → transporte plugável (`reqwest` nativo
  / `fetch` web) é parte da decisão da F2.2.

## Decomposição (F2.1 → F2.8; 3 pontos de parada: gate F2.2, bloqueante F2.6, Marco 2 F2.8)

Padrão Fase 2 (herdado da Fase 1): a capacidade nasce na **fronteira (nativo)**
com **teste Rust de host determinístico usando o MOCK** (sem chave, sem rede) →
**gate estratégico** (Gemini/web/keys) → **gestão de chave + UI nativa** →
**validação real com a chave do usuário** (bloqueante) → **paridade web** (per
decisão) → **Marco 2**. Anti-alucinação em todas: o texto do versículo vem do
store local; o LLM só interpreta.

---

## F2.1 — Pergunta ancorada (`ask`) na fronteira (core — nativo) + MOCK + anti-alucinação
**Objetivo:** expor na fronteira UniFFI (`core/src/lib.rs`) uma função
`ask_anchored(db_path, translation, reference, question, provider_name, key:
Option<String>, model: Option<String>, lang) -> Result<AiAnswer, CoreError>` que
**delega** ao `the_light_core::ai`: (1) canonicaliza `reference` (via
`reference::parse_reference`, como `get_passage`); (2) **lê a passagem do store
local** (`BibleSource::passage`, texto **verbatim** — F1.2); (3) monta o contexto
RAG com `ai::numbered_passage` + `ai::ask_context` (funções puras); (4) constrói o
provedor com `ai::build_provider(provider_name, key, model)`; (5) chama
`ai::ask(provider, question, context, lang)`; (6) devolve um novo Record
`AiAnswer { reference, cited_text: String (numerado, do store), interpretation:
String (do LLM), provider: String, model: String }` — o **tipo separa** texto
citado (store) de interpretação (LLM). Molde F0.9/F1.2/F1.5: export em todos os
alvos, **corpo** que toca store/`ai` sob `cfg(not(target_arch = "wasm32"))` +
stub web (paridade web de IA = F2.7 pós-gate F2.2); `AiError → CoreError`.
**Aceite:** com `provider_name = "mock"` (e `key = None`), `ask_anchored` sobre um
fixture com João 3:16 KJV retorna `cited_text` **verbatim do store** ("16 For God
so loved the world...") **numerado**, `interpretation == ` a resposta canônica do
`MockLlmProvider` (do modelo, **não** do store), `provider == "mock"`; o texto do
versículo **nunca** vem do LLM (anti-fake). Web permanece **puro** (sem `rusqlite`/
`reqwest` no grafo wasm). **NÃO** precisa de chave real nem de rede.
**Verificação:** `cargo test -p the-light-app-core` (host, `embedded` on) sobre um
fixture determinístico (Store::open + DML KJV João 3:16, domínio público),
`provider_name = "mock"`: asserta `cited_text` verbatim numerado, `interpretation`
== mock, `provider == "mock"`, e que o texto bíblico é do store (não do mock).
`cargo tree --target wasm32-unknown-unknown` sem `rusqlite`/`reqwest`;
`scripts/gen-bindings-web.sh` verde (surface uniforme; stub web).
**Depende:** — (primeira da Fase 2; prerequisitos F1.2/F0.9 já arquivados).
**Não-bloqueante:** roda com MOCK, **sem** chave e **sem** rede → é a **1ª tarefa
semeada**. **NÃO** reimplementar prompt/ancoragem/RAG em TS/na fronteira (vem do
`ai::study`); **NÃO** tocar `the-light`; anti-alucinação; offline-first;
`blocked`+HALT com erro EXATO se a IA ancorada exigir mudar o core.

## F2.2 — ⛔ GATE estratégico: arquitetura da IA da Fase 2 (Gemini · web · chave · streaming)
**Objetivo (decisão humana/arquitetural):** com a fronteira `ask` ancorada provada
com MOCK (F2.1), decidir **como a Fase 2 entrega IA BYOK** mantendo offline-first/
anti-alucinação/`the-light` intacto. **Pontos a decidir (com evidência):**
1. **Onde vive o provedor Gemini?** (A) **PR ao `the-light`** adicionando
   `GeminiProvider` ao `LlmProvider` + `default_model`/`estimate_cost_usd`/
   `PROVIDERS` (molde ADR-0005; core change → CLI/TUI também ganham; "uma fonte da
   verdade"), **ou** (B) **impl local na fronteira do app** (`core/src/` implementa
   `impl the_light_core::ai::LlmProvider for GeminiProvider` — o trait é público —
   sem tocar o core; a fronteira roteia "gemini" e provê `default_model`/custo
   gemini). Ambas preservam anti-alucinação (RAG/prompt/citação continuam no core).
2. **Caminho de IA no WEB.** O módulo `ai` é `embedded`-only → **web/wasm não tem
   `build_provider`/`ask`**. Opções: (A) **nativo-primeiro**, IA no web adiada
   (Fase 3 ou gate posterior — como a Fase 1 fez leitura nativa antes do store web
   F1.12); (B) **PR ao `the-light`** tornando as partes **puras** da IA (montagem
   de prompt + citação) **wasm-safe** + transporte que delega `fetch` (VISION §4
   fricção #2); (C) reimplementar montagem de prompt fina na fronteira p/ web.
3. **Transporte** (VISION §4 fricção #2): nativo = `reqwest::blocking` (já no
   core); web = provider que delega `fetch` ao JS (CORS/TLS do browser). Amarrado a
   #2. **Nota de runtime:** `reqwest::blocking` numa chamada JSI **bloqueia** —
   avaliar se a chamada nativa é aceitável síncrona ou exige async/streaming.
4. **Armazenamento seguro da chave (BYOK).** Nativo = `expo-secure-store`
   (Keychain/Keystore) — claro. **Web** = **decisão**: session-only em memória +
   aviso (localStorage/IndexedDB inseguros), Web Crypto, ou **sem IA no web** na
   Fase 2. A chave **nunca** é logada; **nunca** vai ao git.
5. **Streaming?** Os provedores do core são **não-streaming** (`complete` devolve
   String completa). Decisão: **não-streaming na Fase 2** (casa com o core);
   streaming exigiria core change (adiar).
6. **Validação real (bloqueante).** A chamada real ao Gemini/Claude/GPT exige a
   **chave do usuário + rede** → **não roda no CI**. O **MOCK** cobre a prova
   determinística; a chamada real é validada à parte (F2.6), com a chave que o
   humano fornecer.
**Aceite:** ADR novo (**ADR-0023**) registrando 1–6 com evidência; se (1A) ou (2B)
forem escolhidas, abrir spec de PR ao `the-light` em `loop/proposals/` — **núcleo
só via PR humano**. O escopo de IA no web (F2.7) é fixado aqui.
**Verificação:** auditoria humana do ADR; gate de sign-off.
**Depende:** F2.1. **gate: true** — o loop **PARA** aqui (decisão estratégica) antes
de construir Gemini/keys/UI. F2.3–F2.8 dependem desta decisão.

## F2.3 — Provedor Gemini (conforme a decisão da F2.2)
**Objetivo:** disponibilizar o provedor **Gemini** (`generativelanguage.
googleapis.com`) como novo `LlmProvider`, com `default_model` e `estimate_cost_usd`
gemini. **Ramo (A) impl local na fronteira** (recomendado se F2.2 evitar tocar o
core): `struct GeminiProvider { key, model }` + `impl the_light_core::ai::
LlmProvider` em `core/src/`; a fronteira roteia `provider_name == "gemini"`. **Ramo
(B) PR ao core:** vira spec de PR ao `the-light` (`loop/proposals/`) → HALT p/
merge humano (como ADR-0005). **Prova determinística SEM rede/chave** (molde dos
testes do core `anthropic_body`/`openai_extract`): funções **puras** de montagem do
corpo da requisição e de parsing da resposta testadas com JSON fixo; **nenhuma**
chamada real ao Gemini no teste.
**Aceite:** paridade com anthropic/openai (corpo/parse por função pura testável);
`ask_anchored(..., provider_name="gemini", key=Some("k"))` **constrói** o provedor
sem erro (sem enviar); teste do corpo/parse verde; o texto do versículo continua do
store (anti-alucinação). Web conforme F2.2.
**Verificação:** `cargo test -p the-light-app-core` (corpo/parse Gemini puros, MOCK);
sem rede. Se ramo (B): PR spec + HALT.
**Depende:** F2.2.

## F2.4 — Gestão segura de chaves (BYOK) — nativo
**Objetivo:** serviço `app/lib/keys.ts` sobre **`expo-secure-store`** (Keychain no
iOS / Keystore no Android): `setKey(provider, key)` / `getKey(provider)` /
`deleteKey(provider)` / `listProviders()` (nomes, **nunca** valores). A chave
**nunca** é logada; é lida sob demanda e passada à fronteira (`ask_anchored(...,
key)`); **não** é persistida pela fronteira nem escrita no `bible.sqlite`/userdata.
Web = conforme a política decidida na F2.2 (session-only/aviso ou sem IA web).
**Aceite:** a chave **sobrevive a reinício** do app (iOS/Android) via secure-store;
`listProviders` não expõe valores; **auditoria de logs** não mostra a chave.
**Verificação:** teste de persistência por alvo (secure-store) + `tsc`/eslint +
grep de auditoria (nenhum `console.log`/marcador com a chave). `expo-secure-store` a
adicionar (dep).
**Depende:** F2.2.

## F2.5 — UI nativa: `ask` ancorado numa passagem (provedor/modelo + custo + citado/interpretação)
**Objetivo:** ao selecionar um versículo/capítulo no Reader (gesto/painel da F1.9/
F1.11), painel de **estudo assistido**: campo de pergunta → `ask_anchored` (F2.1)
via o glue nativo (`app/web/reading.ts` estendido → JSI → `ai::ask`), **seletor de
provedor/modelo** (BYOK da F2.4; inclui Gemini da F2.3), **estimativa de custo
visível** (`estimate_cost_usd`), e a resposta **separa** o **texto citado** (do
store, verbatim — o app já o tem da F1.2) da **interpretação** (do LLM). Rótulo
explícito "interpretação gerada por IA — confira as Escrituras". Só nativo (web =
F2.7 per F2.2). **Prova determinística com MOCK** (sem chave/rede): self-test no
device chama `ask_anchored(db, "kjv", "John 3:16", "What does this mean?", "mock",
null, null, "en")` e emite `TLA_ASK ref="John 3:16" cited="16 For God so loved..."
interp_len=<n> provider="mock"` (do retorno real); `run-ios-selftest.sh` asserta o
`cited` verbatim do store + `provider="mock"` + sem regressão de
`TLA_READ/PARALLEL/SEARCH/XREF/NOTES/parse`. Bindings nativos regenerados
(`gen-bindings-ios.sh`) p/ `askAnchored`/`AiAnswer`.
**Aceite:** perguntar sobre uma passagem retorna, no device (≥1 nativo), a resposta
com **texto citado do store** separado da **interpretação** do MOCK; seletor de
provedor/modelo e custo visíveis; **nenhuma** chamada de rede com o MOCK.
**Verificação:** self-test headless por alvo (`TLA_ASK`, MOCK) + `tsc`/eslint +
`expo export --platform web` 0 (stub web).
**Depende:** F2.1, F2.3, F2.4.

## F2.6 — ⛔ Validação real com a chave do usuário (Claude · GPT · Gemini) — BLOQUEANTE
**Objetivo:** validar uma pergunta ancorada **real** (rede + chave do usuário) num
provedor de verdade (Claude/GPT/Gemini) em ≥1 alvo nativo: a chave vem do
secure-store (F2.4), a chamada é a **única** rede em runtime, o texto citado
continua do store e só a interpretação vem do modelo.
**Aceite:** com a chave real do usuário, `ask_anchored(..., provider_name real)`
devolve uma interpretação ancorada e citada; nenhuma alucinação de texto bíblico
(o `cited_text` é do store); a chave não vaza em log.
**Verificação:** teste manual documentado no device com a chave do humano (≥1
provedor). **Ponto BLOQUEANTE:** exige a **chave real** (segredo) + rede →
**`gate: true`** (o loop **NÃO** roda isto sozinho; HALT p/ o humano fornecer a
chave/validar). O MOCK (F2.1/F2.5) já provou o determinístico; aqui é a única
validação que precisa da chave.
**Depende:** F2.5. **gate: true** — precondição humana (chave/segredo) → HALT.

## F2.7 — Paridade web de IA (conforme a decisão da F2.2)
**Objetivo:** IA no **web** conforme a F2.2: se **nativo-primeiro** foi escolhido,
esta tarefa é **adiada** (registrada, fora do escopo da Fase 2); se **IA no web**
está no escopo, implementar o caminho web (transporte `fetch`-delegado; política de
chave web; partes puras da IA via PR ao core, ramo 2B). O texto do versículo vem do
store web (`wa-sqlite`/OPFS, F1.13–F1.16); o LLM só interpreta.
**Aceite:** conforme F2.2 — ou "adiada e registrada", ou `ask` ancorado no browser
com chave web (política decidida), texto do store, separando citado/interpretação.
**Verificação:** per F2.2 (prova headless node com MOCK + `expo export web`), ou
nota de adiamento no Marco 2.
**Depende:** F2.2, F2.5.

## F2.8 — ⛔ Marco 2: IA BYOK ancorada com Claude/GPT/Gemini
**Objetivo:** confirmar a **camada de IA BYOK ancorada** funcionando: `ask` numa
passagem com **Claude, GPT e Gemini** (chave do usuário), texto **sempre do store**
(anti-alucinação), custo visível, chave em armazenamento seguro (nunca em git/log),
Fase 1 intacta e **offline sem IA**; `the-light` intocado (consumo pinado / PRs
registrados). Atualizar `PROGRESS.md`; consolidar ADRs.
**Aceite:** checklist do Marco 2 verde (≥ alvos decididos na F2.2); IA opt-in
(desligada, o app segue 100% offline); atribuições preservadas; sem vazamento de
chave.
**Verificação:** revisão do Guia; `PROGRESS.md` atualizado.
**Depende:** F2.5, F2.6, F2.7.
**gate: true** — marco; HALT para sign-off humano/auditoria.

---

> **Regras rígidas da Fase 2 (do `IMPLEMENTATION_PLAN.md` §0):** offline-first
> (IA **opt-in**; nada essencial exige rede/conta; rede em runtime **só** para a
> chamada de IA com a chave do usuário); **BYOK** (chave do usuário, **nunca** em
> git/log; secure-store nativo; política web explícita); **anti-alucinação**
> (texto do versículo **sempre** do store local; o LLM só interpreta; referência
> canônica); **não modificar/forkar `the-light`** (consumo pinado `8f66004`;
> Gemini/partes-puras-web só via **PR + ADR** se a F2.2 assim decidir);
> **prova determinística com MOCK** (nunca o LLM real no CI). Diante de conflito
> com qualquer regra: **HALT**, não improviso.
