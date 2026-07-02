# Backlog — Fase 3 (Estudo profundo: léxico Strong verificado + `study` ancorado + pesquisa assistida opt-in)

> Rascunhos de tarefa redigidos pelo Planner. Cada bloco vira um arquivo
> `queue/<ID>.task.md` quando elegível (deps aceitas). **Uma de cada vez** (ver
> `PROTOCOL.md`). A Fase 3 acrescenta uma camada de **estudo profundo** por cima
> da leitura (Fase 1) e da IA BYOK ancorada (Fase 2, aprovada no Marco 2): estudo
> de uma passagem por **modo × lente × profundidade**, com **léxico Strong
> verificado** (grego/hebraico) e **citações verificáveis**, conversa com
> follow-up (`ask_session`), **comparação multi-IA** e **exportação acadêmica**
> (SBL). Uma **pesquisa web opt-in** (rede) é um *plus* — nunca essencial.

## O que a investigação da fonte do core (`c8ecb2f`) determinou (dimensiona toda a fase)

Leitura só-permitida do checkout do cargo
`~/.cargo/git/checkouts/the-light-9eb8809a6d68281a/c8ecb2f/crates/the-light-core/src/ai/`
(**não** o `/Users/butkeraites/Documents/the-light` bloqueado). O core pinado
(`core/Cargo.toml` rev `c8ecb2f`) já tem TODA a superfície de estudo profundo sob
a feature `embedded` (nativo). Símbolos/arquivos citados:

- **`ai::study` (`study.rs`):**
  - `study(provider, &StudyRequest) -> Result<StudyResult>` (l.294), `StudyRequest`
    (l.28), `StudyResult` (l.79), `StudyResult::to_markdown` (l.432),
    `to_academic_markdown(lang)` (l.508) — **TODOS `#[cfg(feature="embedded")]`**
    (nativo). `study()` monta: `system_prompt` da lente/modo/profundidade + texto
    **numerado do banco** (`numbered_passage`) + xrefs locais + **bloco léxico
    verificado** (só com passagem e `mode.wants_lexical()`) + **fontes web opt-in**
    (`[W:n]`) e chama **`provider.complete(system, user)`** (síncrono — não há
    variante streaming de `study`). Devolve `StudyResult{ passage_text (do banco),
    interpretation (do modelo), sections, warnings, citations, provider, model }`.
    **Anti-alucinação embutida:** `lexicon::verify` sinaliza Strong `[V:...]`
    citado fora do acervo; `cited_web_indices` sinaliza `[W:n]` fora do intervalo;
    `citations` são construídas **do banco/URLs, NUNCA pelo modelo**.
  - **PUROS (compilam sob `ai-pure`/wasm — já disponíveis no web):**
    `numbered_verses`/`numbered_passage`/`ask_context`/`split_sections`/`ask`
    **e `ask_session(provider, lang, context, turns, study)` (l.626)** (conversa
    multi-turno ancorada) **e `refine_scope`/`parse_refinement`** (refinamento de
    escopo). → A **conversa com follow-up já é pura** e roda no web sem PR.
- **`ai::lexicon` (`lexicon.rs`):**
  - `verified_lexicon(conn, &Reference, verse_numbers, lang, limit) -> VerifiedLexicon`
    (l.175) é **`#[cfg(feature="embedded")]`** — lê do **SQLite** (não precisa de
    DB separado): tabelas **`original_tokens`** (Strong por token) + **`lexicon`**
    (glosa TBESH/TBESG, `gloss_pt`→`gloss`→token) + **`scholarly_sources`**
    (atribuição). `collect`/`resolve_verses`/`attributions_for` idem (embedded).
  - **PUROS (ai-pure):** `LexicalEntry`, `VerifiedLexicon`, `format_verified_block`,
    `verify`, `EMPTY_SENTINEL`. → No web, a **recuperação** do léxico se espelha em
    TS (precedente Opção A / ADR-0011, como a passagem F1.13); os **tipos e a
    verificação** são a mesma impl Rust (sem drift).
  - **O léxico NÃO exige DB próprio — usa o MESMO `bible.sqlite`.** As tabelas
    `original_tokens`/`lexicon`/`scholarly_sources` são criadas por `Store::open`
    (migrações v2) e **populadas por dados** (ver `import-scholarly`, F3.1). Sem
    esses dados, `verified_lexicon` devolve **vazio** → o prompt declara "sem base"
    (honesto), **não** inventa (anti-alucinação).
- **`ai::research` (`research.rs`) — pesquisa web OPT-IN:** todo o módulo é
  **`#[cfg(feature="embedded")]`** (usa `reqwest::blocking`). `WebSource` (struct
  pura serde), `ResearchProvider`, `build_research_provider(backend, key, lang)`.
  Backends: **`wikipedia`** (keyless, rede), **`tavily`** (BYOK **chave** em
  `research.tavily`), **`mock`** (sem rede). → Pesquisa web = **rede opt-in**,
  possivelmente **chave** (Tavily) → **decisão estratégica (gate F3.9)**.
- **Dados do léxico — `xtask import-scholarly`** (existe, confirmado
  `xtask/src/main.rs:29` → `xtask/src/scholarly_import.rs` → `the_light_core::scholarly`):
  importa **STEP Bible / STEPBible-Data** (TAHOT/TAGNT tokens + TBESH/TBESG léxico)
  para as tabelas acima. Fonte **CC BY 4.0** (Tyndale House, Cambridge) — **NÃO é
  domínio público**: a **numeração de Strong** é PD, mas os **tokens e glosas
  amalgamados** (TAHOT/TAGNT/TBESH/TBESG) usados pelo core são **CC-BY** →
  **atribuição obrigatória** (molde ADR-0016). String verbatim (`scholarly::ATTRIBUTION`,
  gravada em `scholarly_sources`): `Credit it to 'STEP Bible' linked to
  www.STEPBible.org (data based on work at Tyndale House, Cambridge; CC BY 4.0)`.

### Consequência arquitetural (o que precisa — e o que NÃO precisa — de PR ao core)

- **Nativo (iOS/Android): NENHUM PR ao `the-light`.** `study`/`StudyResult`/
  `verified_lexicon`/`research`/`build_provider`/`to_academic_markdown` já estão
  **`pub` sob `embedded`** no rev pinado `c8ecb2f`. A Fase 3 nativa é fronteira +
  UI que **consomem** o core pinado (molde F1.x/F2.x), com **prova por MOCK** do
  provedor (nunca LLM real no CI).
- **Web (wasm): a paridade do estudo profundo depende de decisão/PR.** `study`/
  `StudyRequest`/`StudyResult`/`user_prompt` são **embedded-only e o `user_prompt`
  é privado** → montar o estudo no web exige **ou** (a) espelhar em TS a
  recuperação do léxico + reproduzir a montagem com as peças puras `pub`
  (`format_verified_block`, `prompts::*`) — risco de **drift** da estrutura de
  estudo; **ou** (b) um **PR ao core** que torne a superfície de `study`
  **`ai-pure`** (molde F2.7). Essa escolha é parte do **gate F3.9**; se for a via
  PR, é o **handoff bloqueante F3.11**. A **conversa (`ask_session`) já é pura** →
  roda no web sem PR.

## Princípios da Fase 3 (não negociáveis — registrados no cabeçalho)

1. **Estudo profundo é OPCIONAL e ADITIVO (BYOK).** Toda a Fase 1 (leitura,
   versões, tema, busca, xref, notas) segue **100% offline sem IA**; a Fase 2 (IA
   ancorada) segue opt-in. O estudo profundo só liga com a **API key do usuário**.
   **Nenhuma** capacidade essencial passa a exigir rede/conta.
2. **Léxico (Strong) é DADO local, offline, verificado.** Molde F1.1/F1.7: se
   exigir dados, gerá-los via o **xtask pinado** do `the-light` (`import-scholarly`)
   **sem tocar/forkar** o `the-light`. Origem **STEP Bible CC-BY 4.0** — **livre
   com atribuição obrigatória** (a numeração de Strong é PD; os tokens/glosas
   amalgamados são CC-BY). Só **dados livres** (PD/CC0/CC-BY). **Anti-alucinação:**
   as definições/glosas/lemas vêm do **léxico local verificado** (`verified_lexicon`),
   **nunca** do LLM; o LLM só cita `[V:Strong]` e é **sinalizado** se inventar um
   Strong fora do acervo (`lexicon::verify`).
3. **Estudo profundo = `ai::study`.** Combina **passagem (store)** + **léxico
   (verificado)** + **[pesquisa web opcional]** + **LLM** → `StudyResult` com
   **citações verificáveis**. O LLM **interpreta/organiza**; os FATOS (texto,
   léxico, refs, fontes) vêm de **fontes locais/citadas**. `passage_text` (do banco)
   é separado de `interpretation` (do modelo); `citations` construídas do banco.
4. **Pesquisa web = OPCIONAL e opt-in (rede).** Nada essencial do estudo exige
   rede: a pesquisa web (`ai::research`) é um *plus* que, quando usado, **cita as
   fontes** (`WebSource`/`[W:n]`, trecho **verbatim** na nota) e **nunca** deixa o
   LLM inventar URL/fonte (sinaliza `[W:n]` fora do intervalo). Pode exigir
   **provedor/chave** (Wikipedia keyless vs Tavily BYOK) → **decisão estratégica
   (gate F3.9)**; rede opt-in, como a IA BYOK.
5. **`the-light` só via PR + ADR (`c8ecb2f` até um eventual re-pin).** O estudo
   profundo **nativo** NÃO toca o core. Se a **paridade web** do estudo exigir
   tornar `study`/`StudyResult` **`ai-pure`** (não-`pub`/não-wasm hoje), é **PR
   sancionado** (branch no repo `the-light` autorizado + **push/merge humano** +
   **re-pin** — molde F2.7/F0.6a), com prova **determinística por MOCK** no CI; o
   **LLM real** (com a chave do usuário) é **validação humana à parte** (molde
   F2.6, gate). Qualidade por tarefa (Rust `fmt`/`clippy -D warnings`/`test`; TS
   `tsc`/`eslint`) verde. Diante de conflito com qualquer regra: **HALT**, não
   improviso.

## Decomposição (F3.1 → F3.13; **RE-ESCOPADA per ADR-0028/ADR-0029** após o sign-off do gate F3.9)

> **Gate F3.9 DECIDIDO (sign-off humano, 2026-07-02):**
> - **D1 (ADR-0028):** pesquisa web assistida no estudo = **Wikipedia keyless, OPT-IN**
>   (padrão desligado + aviso de privacidade; Tavily BYOK fica como opção futura). →
>   nova tarefa **NÃO-BLOQUEANTE F3.9a** (fronteira nativa + MOCK).
> - **D2 (ADR-0029):** paridade web do estudo/léxico/conversa = **PR `ai-pure` COMPLETO
>   ao core** (fonte única, zero drift). → **F3.11 deixa de ser condicional** e vira o
>   handoff **BLOQUEANTE** obrigatório (branch + merge humano + re-pin, molde F2.7).
>   Espelhar o anti-alucinação do estudo em TS app-side está **PROIBIDO** (drift).
> - **D3 (ADR-0029):** validação real do que é nativo (estudo + conversa + comparação
>   multi-IA + **pesquisa web Wikipedia** se ligada) = **F3.10** (gate de chave real).
>
> **Ordem re-escopada (molde Fase 2: F2.6 validação real → F2.7 PR ai-pure → F2.7b web
> → F2.8 marco):** **F3.9a** (D1-nativo, NÃO-BLOQUEANTE, semeada agora) → **F3.10**
> (validação real do nativo, ⛔ gate/chave) → **F3.11** (PR `ai-pure` completo,
> BLOQUEANTE, toca the-light) → re-pin → **F3.12** (paridade web, não-bloqueante) →
> **F3.13** (Marco 3, ⛔ gate). Handoffs bloqueantes: **F3.10** (chave real) e **F3.11**
> (PR + merge humano + re-pin).

### Paradas (gates/handoffs): **F3.10 validação real (gate)**, **F3.11 PR ao core (handoff BLOQUEANTE)**, **F3.13 Marco 3 (gate)**

Padrão de fase (herdado): **dados** (se preciso) → **fronteira nativa + teste de
host com MOCK** → **UI nativa (MOCK)** → **gate estratégico** → **validação real
(gate)** → **[PR ao core] + paridade web** → **Marco 3**. Anti-alucinação em
todas: o texto do versículo e as glosas do léxico vêm do **store local**; o LLM só
interpreta e é sinalizado se inventar Strong/fonte.

### Mapa (id · título · deps · bloqueante? · toca the-light? · gate?)

| ID | Título | Deps | Bloqueante? | Toca the-light? | gate? |
|----|--------|------|-------------|-----------------|-------|
| **F3.1** | **Dados de léxico** — `import-scholarly` (TAHOT/TAGNT + TBESH/TBESG, STEP Bible CC-BY 4.0) no `bible.sqlite` via xtask pinado; ADR-0026 | — | possível **blocked** (rede/seed) | não | não ← **1ª A SEMEAR** |
| F3.2 | Fronteira de léxico (nativo): `lexical_entries` → `ai::lexicon::verified_lexicon`; teste host | F3.1 | não | não | não |
| F3.3 | Fronteira de estudo profundo (nativo): `deep_study` → `ai::study::study` → StudyResult; **MOCK**; anti-alucinação | F3.2 | não | não | não |
| F3.4 | Fronteira de conversa/refinamento (**pura**, nativo+web): `ask_session`/`refine_scope`; **MOCK** | F3.3 | não | não | não |
| F3.5 | UI nativa: painel de estudo profundo (modos×lentes×profundidades + léxico Strong inline + citações + avisos) + atribuição STEP CC-BY; **MOCK** | F3.2, F3.3 | não | não | não |
| F3.6 | UI nativa: conversa com follow-up (`ask_session`, mantém âncora); **MOCK** | F3.4, F3.5 | não | não | não |
| F3.7 | UI nativa: **modo comparação multi-IA** (Claude/GPT/Gemini lado a lado); **MOCK** | F3.5 | não | não (app-side) | não |
| F3.8 | Exportação acadêmica (SBL): `to_academic_markdown` → Markdown + sidecar de citações; UI | F3.3, F3.5 | não | não | não |
| **F3.9** | **⛔ GATE estratégico** — pesquisa web opt-in + via de paridade web — **✅ DECIDIDO** (ADR-0028 D1 Wikipedia keyless · ADR-0029 D2 PR ai-pure completo · D3 validação F3.10) | F3.3 | gate (decidido) | decisão | ✅ gate |
| **F3.9a** | **Fronteira nativa** — pesquisa web **Wikipedia (keyless, opt-in)** no `deep_study`: novo `research_backend: Option<String>` → `build_research_provider("wikipedia", None, lang)`→`search`→`web_sources`→`study()` (hoje `vec![]`); prova por **MockResearchProvider** (sem rede/chave); corpo `cfg(not wasm32)` + stub web; grafo wasm puro | F3.3, F3.9 | **não** | não | não ← **PRÓXIMA A SEMEAR** |
| **F3.10** | **⛔ Validação real** com a chave do usuário: estudo profundo + conversa + comparação multi-IA + **pesquisa web Wikipedia** reais (Claude/GPT/Gemini) | F3.5, F3.9, F3.9a | **SIM** (chave/rede) | não | **gate:true** |
| **F3.11** | **PR ao `the-light-core`** — ampliar `ai-pure` p/ **`study` + `verified_lexicon` + partes puras da pesquisa web** (wasm-safe), fonte única/zero drift — **INCONDICIONAL** (ADR-0029 D2) | F3.9, F3.10 | **SIM** (branch+merge humano+re-pin) | **SIM** | não |
| F3.12 | Paridade web: estudo profundo + léxico + conversa + **pesquisa web (fetch Wikipedia)** + export no browser (per ADR-0029/F3.11 re-pinado) | F3.11, F3.5, F3.6, F3.8 | não (app-side) | não | não |
| **F3.13** | **⛔ Marco 3:** plataforma de estudo profundo completa | F3.5, F3.6, F3.7, F3.8, F3.10, F3.12 | **SIM** gate | não | **gate:true** |

> **Relação com o `IMPLEMENTATION_PLAN.md` (F3.1–F3.4 grossos):** o plano lista 4
> tarefas grossas (modos×lentes×profundidades; `ask_session`; comparação multi-IA;
> export acadêmico). Esta decomposição as **refina** em tarefas atômicas seguindo
> o molde de fase (dados → fronteira+MOCK → UI → gate → real → web → marco), como
> a Fase 1 (F1.1–F1.17) e a Fase 2 (F2.1–F2.8) fizeram. Nada de escopo novo além
> do plano: F3.5 = plano F3.1; F3.6 = plano F3.2; F3.7 = plano F3.3; F3.8 = plano
> F3.4. As tarefas de dados/fronteira/gate/validação/PR/web são o **como** honesto.

---

## F3.1 — Dados de léxico (import-scholarly) · **PRÓXIMA A SEMEAR**
**Objetivo:** popular as tabelas **`original_tokens`** (Strong por token) +
**`lexicon`** (glosas TBESH/TBESG) + **`scholarly_sources`** (atribuição) do
`assets/data/bible.sqlite`, **rodando o importador canônico `xtask import-scholarly`**
do `the-light` (rev pinado **`c8ecb2f`**, o mesmo de `core/Cargo.toml`) — **sem
modificar/forkar `the-light`**, reprodutível e idempotente. Fonte **STEP Bible /
STEPBible-Data (CC BY 4.0)** — livre **com atribuição obrigatória**. Tarefa de
**DADOS/pipeline** (molde F1.1/F1.7): sem UI, sem fronteira. Já semeada em
`queue/F3.1-dados-lexico.task.md`.
**Aceite:** `import-scholarly` do rev pinado popula o `bible.sqlite`;
`count(*) FROM original_tokens` ≳ **400.000** (guarda; xtask aborta se abaixo do
mínimo), `count(*) FROM lexicon` ≳ **20.000**, `scholarly_sources` ≥ 4 (tahot/
tagnt/tbesh/tbesg) com a atribuição STEP; sanidade Gênesis 1:1 tem tokens com
Strong; idempotente; **ADR-0026** (origem/licença **CC-BY**/atribuição verbatim/
como o xtask roda sem tocar the-light/tamanho/armazenamento gerar-ignorado).
**Verificação:** ver `queue/F3.1-dados-lexico.task.md`.
**Depende:** — (primeira da Fase 3). **Risco/blocked legítimo:** os datasets STEP
(~dezenas de MB) **não estão em cache** (`data/seed/scholarly` vazio) → o xtask
**baixa por rede em build**. Offline sem seed → `blocked` (decisão: origem/seed).

## F3.2 — Fronteira de léxico (core — nativo)
**Objetivo:** expor `lexical_entries(db_path, book, chapter, verse: Option<u16>,
limit: Option<u32>) -> Result<VerifiedLexiconOut, CoreError>` **delegando** a
`the_light_core::ai::lexicon::verified_lexicon(store.conn(), &Reference, &[verse],
lang, limit)` (via `Store::open`). Novos Records `VerifiedLexiconOut{ entries:
Vec<LexEntry>, sources: Vec<String> }` e `LexEntry{ strongs, lemma, translit,
gloss, occurrences, testament }` com `From<ai::LexicalEntry>` (tipo **puro** →
seguro no wasm; o Record em si é puro). Molde F1.8: export em todos os alvos, o
**corpo** que abre o store/lê SQLite sob `cfg(not(wasm32))` + stub web; a
recuperação real no web fica para a F3.12 (per F3.9). **Anti-alucinação:** as
glosas vêm do acervo verificado; passagem sem cobertura → lista vazia (o estudo
declara "sem base").
**Aceite:** léxico de Gênesis 1:1 (após F3.1) retorna entradas com Strong base
(ex.: `H7225`) + glosa + fonte STEP; passagem sem cobertura → vazio sem panic;
`limit` respeitado. Web puro (`cargo tree --target wasm32…` sem `rusqlite`;
`gen-bindings-web.sh` verde).
**Verificação:** `cargo test -p the-light-app-core` (host, `embedded`) com fixture
das tabelas `original_tokens`/`lexicon`/`scholarly_sources` (molde do teste do
core `lexicon.rs::seeded`) **e** bônus `if bible.sqlite exists`. **Depende:** F3.1.

## F3.3 — Fronteira de estudo profundo (core — nativo) + MOCK
**Objetivo:** expor `deep_study(db_path, translation, book, chapter, verse:
Option<u16>, mode, lens, depth, lang, provider_name, key: Option<String>, model:
Option<String>) -> Result<StudyResultOut, CoreError>` **delegando** a
`ai::study::study(provider, &StudyRequest)`. A fronteira **monta** o `StudyRequest`
com fatos **do banco**: `passage` (via `BibleSource::passage`), `cross_references`
(rótulos via `xref::for_verse`/`passage_labels`), `verified_lexicon` (F3.2) e
`web_sources: vec![]` (offline; a pesquisa entra per F3.9). Enums UniFFI
`StudyMode`/`StudyLens`(Denomination)/`StudyDepth`; Record `StudyResultOut{
reference_label, passage_text, interpretation, sections, warnings, citations,
provider, model }`. `cfg(not(wasm32))` + stub web (paridade = F3.12). **Prova
determinística com MOCK** (`build_provider("mock", …)`/`MockLlmProvider`): sem
rede/chave.
**Aceite:** `deep_study(db,"kjv",43,3,Some(16), Academic, Presbyterian, Exegetical,
En, "mock", None, None)` devolve `passage_text` **verbatim do store** (João 3:16
numerado), `interpretation` = resposta do MOCK, `citations`/`warnings` conforme o
léxico (Strong inventado sinalizado), **sem** rede. Web puro; `gen-bindings-web.sh`
verde. **Anti-alucinação provada:** `passage_text`≠modelo; `citations` do banco.
**Verificação:** `cargo test -p the-light-app-core` (host, MOCK) + `cargo tree
--target wasm32…` sem `reqwest`/`rusqlite`. **Depende:** F3.2. **Não-bloqueante.**

## F3.4 — Fronteira de conversa/refinamento (pura — nativo+web) + MOCK
**Objetivo:** expor a **conversa com follow-up** e o **refinamento de escopo**,
**puros** (ai-pure → nativo E web): `ask_session_anchored(context, turns: Vec<
ChatTurn>, study: Option<(mode,lens)>, provider, key?, model?, lang)` delegando a
`ai::study::ask_session`, e `refine_scope(...)` delegando a
`ai::study::refine_scope`. Record `ChatTurn{ role, content }`. O `context` (âncora)
é montado do store (capítulo numerado + xrefs) — a **âncora** é local; o LLM só
conversa. Corpo do provedor real sob `cfg(not(wasm32))` (rede nativa)/`fetch` web
(F3.12), mas a **montagem** (`ask_session`) é pura. **MOCK** para o teste.
**Aceite:** `ask_session_anchored` com MOCK mantém o contexto embutido **só no 1º
turno de usuário** (invariante do core); `refine_scope` devolve pergunta+opções
parseadas. Sem rede no teste. Web: a montagem compila em wasm (pura).
**Verificação:** `cargo test -p the-light-app-core` (host, MOCK) + grafo wasm puro.
**Depende:** F3.3. **Não-bloqueante.** **Não toca the-light.**

## F3.5 — UI nativa: painel de estudo profundo (modos×lentes×profundidades + léxico + citações) — MOCK
**Objetivo:** no Reader (painel F1.9/F2.5), painel de **estudo profundo**:
seletores de **modo** (Acadêmico/Devocional/Introdutório/Sermão), **lente** (6
denominações) e **profundidade** (3), chamando `deep_study` (F3.3) via o glue
nativo → JSI. Exibir: **texto citado** (store, verbatim) separado da
**interpretação** (LLM) por **seções**; **léxico Strong inline** (`lexical_entries`
F3.2 — lema/transliteração/glosa por versículo) com **atribuição STEP CC-BY
visível** (molde F1.9); **avisos** de verificação (Strong inventado). Rótulo
"interpretação gerada por IA — confira as Escrituras". Só nativo (web = F3.12).
**Bundling do léxico:** o app empacota o subset `reading-sample.sqlite` (ADR-0014);
esta tarefa **propaga** as tabelas `original_tokens`/`lexicon`/`scholarly_sources`
das passagens do subset para ele (molde F1.9 propagou xref) — decisão de tamanho
em ADR (molde ADR-0014). **Prova determinística com MOCK** (`TLA_STUDY`): self-test
no device chama `deep_study(db,"kjv",43,3,16,…,"mock",…)` e emite `TLA_STUDY
ref="John 3:16" cited="16 For God so loved..." interp_len=<n> lex_strongs=<N>
provider="mock"` (do retorno real); `run-ios-selftest.sh` asserta `cited` verbatim
+ `provider="mock"` + `lex_strongs≥1` (se o subset tiver léxico de João 3) + sem
regressão de `TLA_ASK/READ/SEARCH/XREF/NOTES`. Bindings nativos regenerados.
**Aceite:** estudar uma passagem no device (≥1 nativo) variando modo/lente/
profundidade, com texto citado do store separado da interpretação do MOCK, léxico
Strong inline + atribuição STEP CC-BY, avisos; **nenhuma** rede com o MOCK.
**Verificação:** self-test headless (`TLA_STUDY`, MOCK) + `tsc`/eslint. **Depende:**
F3.2, F3.3.

## F3.6 — UI nativa: conversa com follow-up (`ask_session`) — MOCK
**Objetivo:** UI de conversa multi-turno sobre a passagem/estudo, mantendo a
**âncora local** (contexto do store) e usando `ask_session_anchored` (F3.4);
follow-ups coerentes sem perder a âncora. Só nativo (web = F3.12; a montagem já é
pura). **MOCK** (`TLA_SESSION`).
**Aceite:** follow-up no device mantém o contexto ancorado (invariante: contexto
só no 1º turno); resposta do MOCK exibida; sem rede com o MOCK.
**Verificação:** self-test headless (`TLA_SESSION`, MOCK) + `tsc`/eslint.
**Depende:** F3.4, F3.5.

## F3.7 — UI nativa: modo comparação multi-IA (Claude/GPT/Gemini) — MOCK
**Objetivo (diferencial de produto):** enviar a **mesma** pergunta/estudo ancorado
a **Claude, GPT e Gemini** e exibir as respostas **lado a lado** (contexto
RAG/âncora idêntico, montado localmente uma vez). App-side: N chamadas a
`deep_study`/`ask_anchored` com N provedores; **não toca o core**. **MOCK** (3
mocks) para o teste determinístico.
**Aceite:** 3 respostas comparáveis para a **mesma âncora** no device (MOCK), com
o **mesmo** texto citado do store nas 3; seletor de quais provedores comparar;
custo por provedor visível (`estimate_cost_usd`). Sem rede com MOCK.
**Verificação:** self-test headless (3 MOCKs, mesma âncora) + `tsc`/eslint.
**Depende:** F3.5.

## F3.8 — Exportação acadêmica (SBL → Markdown + sidecar de citações)
**Objetivo:** expor na fronteira `study_academic_markdown(StudyResult-like) ->
String` (delegando a `StudyResult::to_academic_markdown`) e, na UI, **exportar** o
estudo como **Markdown acadêmico** (notas SBL ancoradas de forma determinística às
citações verificáveis — o modelo só emite âncoras `[V:Strong]`, o core valida e
troca por `[^chave]`, descartando inválidas) + **sidecar de citações**. PDF/DOCX
via pipeline (pandoc) é **opcional/futuro** (Markdown é o mínimo do aceite).
**Aceite:** arquivo Markdown exportado com **texto citado do store**, análise com
notas de rodapé SBL, bibliografia e rodapé de procedência (com a atribuição STEP
CC-BY); citações **do banco**, nenhuma inventada; sidecar de citações gerado.
**Verificação:** conferência do arquivo gerado (host: `to_academic_markdown` sobre
um `StudyResult` de fixture com léxico) + `tsc`/eslint. **Depende:** F3.3, F3.5.

## F3.9 — ⛔ GATE estratégico: pesquisa web opt-in + via de paridade web — ✅ DECIDIDO
**Decisão (sign-off humano, 2026-07-02):**
- **D1 (ADR-0028):** pesquisa web assistida = **Wikipedia keyless, OPT-IN** (padrão
  desligado + aviso de privacidade; **Tavily BYOK** fica como opção futura). Rede
  opt-in, nunca essencial; anti-alucinação: `WebSource` citado `[W:n]`, sinalizado
  fora do intervalo, citações montadas **das URLs** (nunca do modelo).
- **D2 (ADR-0029):** paridade web do estudo/léxico/conversa = **PR `ai-pure` COMPLETO
  ao core** (fonte única, zero drift). Espelhar o estudo em TS app-side é **PROIBIDO**
  (drift do anti-alucinação; `study`/`verified_lexicon`/`StudyResult` são
  embedded-only e `user_prompt` é privado → não há entrada pública pura). A **conversa**
  (`ask_session`/`refine_scope`/`parse_refinement`) **já é `ai-pure`** (F3.4).
- **D3 (ADR-0029):** validação real do nativo (estudo + conversa + comparação multi-IA
  + pesquisa web Wikipedia se ligada) = **F3.10** (gate de chave real).

**Consequência de re-escopo:** nova **F3.9a** (D1-nativo, NÃO-BLOQUEANTE); **F3.11**
deixa de ser condicional e vira o PR `ai-pure` **incondicional** (BLOQUEANTE, toca
the-light). **Status:** ✅ aceito (gate de sign-off). **Depende:** F3.3.

## F3.9a — Fronteira nativa: pesquisa web Wikipedia (keyless, opt-in) no `deep_study` · **PRÓXIMA A SEMEAR**
**Objetivo (D1-nativo, ADR-0028):** ligar a **pesquisa web opt-in** ao `deep_study`
(`core/src/lib.rs`): um novo parâmetro `research_backend: Option<String>` que, quando
`Some(...)`, roda `the_light_core::ai::build_research_provider(backend, None, lang_code)`
+ `provider.search(query, limit)` → o `Vec<WebSource>` resultante é passado ao
`StudyRequest.web_sources` (hoje **`vec![]`**), que `ai::study::study` injeta no prompt
como "FONTES SECUNDÁRIAS" citáveis por `[W:n]` e transforma em citações **das URLs**
(`CitationCollector::from_web_results`, nunca do modelo). `None` → mantém `vec![]`
(comportamento atual, offline). **Backend padrão do usuário = `"wikipedia"`** (keyless,
opt-in, rede real — validação humana na F3.10); a **prova determinística** usa
`research_backend = Some("mock")` → `build_research_provider("mock", …)` =
`MockResearchProvider::canned()` (2 fontes fixas, **sem rede/chave**).
**Assinaturas REAIS (fonte `c8ecb2f`, só-leitura):**
- `pub fn build_research_provider(backend:&str, key:Option<String>, lang:&str) ->
  Result<Box<dyn ResearchProvider>>` (`ai/research.rs:268`) — `"mock"`→canned;
  `"wikipedia"|"wiki"`→`WikipediaProvider::new(lang)` (chave ignorada);
  `"tavily"`→exige chave; `other`→`UnknownProvider`. **`build_research_provider`/
  `ResearchProvider`/`WebSource` são `pub` re-exportados em `ai::` sob
  `#[cfg(feature="embedded")]`** (`ai/mod.rs:40`) → disponíveis no corpo nativo
  (`embedded` ativo); `research` é **embedded-only** (reqwest) → NÃO compila em wasm.
- `trait ResearchProvider { fn name(&self)->&str; fn search(&self, query:&str,
  limit:usize)->Result<Vec<WebSource>>; }` (`research.rs:41`).
- `MockResearchProvider::canned()` (`research.rs:101`): 2 `WebSource` fixos
  (`https://example.org/grace`, `https://example.org/sola-gratia`), timestamp fixo.
- `study()` (`study.rs:294`): `from_web_results` adiciona **1 citação `Web` por fonte**
  (key `W1`/`W2`, `url`/`quote`/`accessed`/`attribution`) **quando `mode.emits_apparatus()`**
  (Academic) — independe do modelo citar. `cited_web_indices` sinaliza `[W:n]` fora do
  intervalo (anti-fabricação).
**Gating (molde F3.3):** `deep_study` já tem corpo `cfg(not(target_arch="wasm32"))` +
stub web. A busca web entra **dentro** do bloco nativo (research é embedded-only) → o
grafo wasm segue **puro**; o novo param é aceito na assinatura de todos os alvos e o
stub web só o adiciona ao `let _ = (...)` (busca web no browser = `fetch`, F3.12). Sem
novo Record UniFFI (`WebSource` fica interno; não atravessa a fronteira).
**Query da busca:** o `reference_label` já montado (ex.: `"John 3.16"`) — determinístico,
sem modelo (o Mock ignora a query; a query real importa só na F3.10/Wikipedia). `limit`
= um default local pequeno (ex.: `DEFAULT_LEXICON_LIMIT`/const própria).
**Higiene TS (manter `tsc` verde, sem UI):** estender o wrapper `deepStudy` em
`app/web/reading.ts` (l.296) e o stub `app/web/reading.web.ts` (l.365) com um param
**opcional final** `researchBackend?: string` (default `undefined` = comportamento
atual) e repassá-lo ao binding nativo; **regenerar bindings** (gerados, ignorados). Os
self-tests/UI existentes (`study-selftest.ts`/`export-selftest.ts`/`ReaderStudyPanel`)
**não mudam** (o param é opcional). UI de pesquisa web = F3.5 futura/F3.10 real (fora
de escopo aqui).
**Aceite:** (1) `deep_study(db,"kjv",43,3,Some(16),Academic,…,"mock",None,None,
Some("mock"))` devolve `StudyResultOut.citations` com **≥1** citação `kind="Web"` cujo
`url` contém `example.org` (prova que `web_sources` fluiu do research provider ao
`study()`, vs. o `vec![]` de hoje) — **sem rede**; (2) com `research_backend=None`
(ou omitido) **nenhuma** citação `Web` (comportamento atual preservado); (3)
`passage_text` verbatim do store ≠ `interpretation` (mock) — anti-alucinação mantida;
(4) grafo wasm **puro** (`cargo tree --target wasm32…` sem `reqwest`/`rusqlite`);
`tsc`/eslint verdes.
**Verificação:** `cargo test -p the-light-app-core` (host, `embedded`, MOCK) + `cargo
tree --target wasm32-unknown-unknown` sem `reqwest`/`rusqlite` + `gen-bindings-web.sh` +
`tsc --noEmit`. **Depende:** F3.3, F3.9 (ambas aceitas). **NÃO-BLOQUEANTE** (só mock,
sem chave/rede). **NÃO exige PR** (`build_research_provider`/`ResearchProvider`/
`WebSource`/`MockResearchProvider` já `pub` sob `embedded` em `c8ecb2f`). **Não toca
`the-light`** (`c8ecb2f` intacto). Rede real via `"wikipedia"` = **opt-in do usuário**,
validado na **F3.10**.

## F3.10 — ⛔ Validação real com a chave do usuário (estudo + conversa + comparação + pesquisa web)
**Objetivo (D3/ADR-0029):** validar o **nativo real** (rede + chave do usuário) em ≥1
alvo: **estudo profundo** (modo×lente×profundidade, léxico Strong do store, citações
verificáveis), **conversa** com follow-up, **comparação multi-IA** (Claude/GPT/Gemini)
e a **pesquisa web Wikipedia** (`deep_study(..., research_backend=Some("wikipedia"))`,
rede keyless opt-in) — tudo com provedor de verdade. A chave vem do secure-store (F2.4),
a chamada é rede opt-in; o texto citado, as glosas e as URLs de `[W:n]` continuam do
**store/da busca real**, só a interpretação vem do modelo. Harness molde F2.6
(`ask_real.rs`) — **a chave NUNCA passa pelo loop** (o humano executa localmente).
**Aceite:** com a chave real, `deep_study(..., provider real, research_backend=
Some("wikipedia"))` devolve um estudo ancorado/citado com fontes web reais citadas
`[W:n]`; **nenhuma** alucinação de texto/léxico/URL (vêm do store/da busca); Strong e
`[W:n]` inventados são sinalizados; a chave não vaza em log.
**Verificação:** teste manual documentado no device com a chave do humano (≥1
provedor). **gate: true** — exige **chave real** (segredo) + rede → o loop **NÃO** roda
isto sozinho (HALT p/ o humano). O MOCK (F3.3/F3.5/F3.9a) já provou o determinístico.
**Depende:** F3.5, F3.9, F3.9a. **BLOQUEANTE** (chave/rede).

## F3.11 — PR ao `the-light-core`: `ai-pure` completo (study + verified_lexicon + pesquisa web pura) — **INCONDICIONAL** (ADR-0029 D2)
**Objetivo (D2/ADR-0029):** num **único PR sancionado ao `the-light`** (branch
autorizado; **push/merge humano**; **re-pin** pelo Driver — molde F2.7/F0.6a/ADR-0024),
**ampliar a feature `ai-pure`** para cobrir as **partes puras do estudo profundo** —
tornar `study`/`StudyRequest`/`StudyResult`/`to_academic_markdown` e a recuperação/tipos
de `verified_lexicon` **compiláveis em `wasm32`** sob `ai-pure` (sem `reqwest`/`rusqlite`)
— e as **partes puras da pesquisa web** que a paridade web exigir (montagem do bloco
`[W:n]`/citação de `WebSource`; o **transporte** LLM+Wikipedia fica em `fetch`/TS, molde
F2.7b/ADR-0025). Provável escopo (molde exato F2.7/ADR-0024): expor sob `ai-pure` a
superfície de `study` (hoje embedded-only) + tornar acessível o `user_prompt` (hoje
privado) ou uma entrada pública equivalente de montagem; gatear por `embedded` só o que
puxa SQLite (queries de `verified_lexicon`) / reqwest (research transporte). **Não-quebrante**
(`default=["embedded"]` intacto, byte-a-byte). Prova **determinística por MOCK**; LLM
real = F3.10.
**Aceite:** no `the-light`, branch: `cargo test --workspace` + `clippy -D warnings`
verdes + `cargo build -p the-light-core --no-default-features --features ai-pure
--target wasm32-unknown-unknown` compila a superfície de estudo/léxico/pesquisa pura +
`cargo tree` do grafo `ai-pure`/wasm **sem** `reqwest`/`rusqlite`/`chrono`/`directories`/
`toml`; spec em `loop/proposals/` + **ADR novo**. Após **push/merge humano**, o Driver
**re-pina** o rev e revalida a fronteira.
**Verificação:** (no `the-light`) `cargo test`/`clippy -D warnings`/build wasm `ai-pure`;
(na fronteira, pós re-pin) `cargo test -p the-light-app-core` + grafo wasm puro.
**Depende:** F3.9, F3.10. **BLOQUEANTE** (implementa no branch; `blocked`/HALT no
handoff = aguardando push/merge humano + re-pin). **Toca `the-light`** (via PR + ADR).
**Não** stubar/forkar/copiar; **não** espelhar o anti-alucinação do estudo em TS (drift
PROIBIDO — ADR-0029).

## F3.12 — Paridade web do estudo (FATIADA pelo planner em F3.12a + F3.12b)
> **Fatiada (2026-07-02)** por tamanho (estudo + léxico + conversa + pesquisa web +
> export + 4 painéis compartilhados = muito para uma tarefa atômica). A **fronteira
> web nova** (`study_web_prepare`/`study_web_finalize`, molde EXATO F2.7b/`ai_web_prepare`)
> nasce na F3.12a e **já aceita `web_sources`** (vazio) para que a F3.12b seja
> **app-side apenas** (fetch Wikipedia → passar `web_sources`), sem re-tocar o Rust.
> Anti-alucinação ZERO-DRIFT (ADR-0029): prompt/citação/aparato/verify do MESMO Rust
> `ai-pure` (`04b9b24`); só recuperação de store (SELECT léxico, ADR-0011) e transporte
> (`fetch`, ADR-0025) são infra TS.

### F3.12a — estudo profundo + léxico + export acadêmico (**SEMEADA** em `queue/`)
Estudo profundo web via `ai-pure` **prepare→fetch→finalize** (fronteira web nova em
`core/src/lib.rs`; recuperação de léxico do subset em TS = ADR-0011; export reusa
`buildStudyExport`/`academicMarkdown`). Prova headless node = `deepStudy` web (fetch
MOCK): João 3:16 do store + citações do léxico STEP CC-BY + `academic_markdown>0` +
paridade nativo↔web (host). **Depende:** F3.11, F3.5, F3.8. **Não-bloqueante** (só o
`core/src/lib.rs` da fronteira web; the-light `04b9b24`/`core/Cargo.toml` intactos).
Ver `queue/F3.12a-paridade-web-estudo.task.md`.

### F3.12b — conversa ancorada + pesquisa web Wikipedia (opt-in) + comparação
**Objetivo:** completar a paridade web (app-side, sobre a fronteira da F3.12a):
- **Conversa ancorada** (`askSessionAnchored` web): `ask_session` **já é pura** (F3.4);
  o web monta o `context` (âncora) do store web (capítulo numerado + xrefs, molde
  `ask_context`) + prepare/fetch/finalize multi-turno → destubar `askSessionAnchored`
  em `reading.web.ts`; `ReaderChatPanel` funciona no web pelo glue.
- **Pesquisa web Wikipedia (opt-in, ADR-0028):** `research.web.ts` faz `fetch` à API
  pública da Wikipedia (keyless) → `WebSource[]` → alimenta `web_sources` do
  `study_web_prepare`/`study_web_finalize` da F3.12a (padrão DESLIGADO + aviso de
  privacidade; `WikipediaProvider`/`build_research_provider` do core são `embedded`-only
  → no web a busca é `fetch` TS, a montagem `[W:n]`/citação segue o MESMO Rust `ai-pure`).
- **Comparação multi-IA web:** `askAnchored` já destubada (F2.7b) → un-SKIP do
  `compare-selftest.web.ts`; `ReaderComparePanel` funciona no web.
**Aceite:** conversa/pesquisa/comparação no browser com texto/glosas do store,
separando citado/interpretação; prova **headless node** (fetch MOCK): conversa web
mantém a âncora; Wikipedia fetch mock → `WebSource` → citações `[W:n]` do estudo web;
comparação web (≥2 provedores, mesma âncora). `tsc`/`expo export web` 0; chave
session-only nunca logada; pesquisa web opt-in (padrão desligado).
**Verificação:** headless node (conversa/pesquisa/comparação, MOCK) + `expo export web` 0.
**Depende:** F3.11, F3.6, F3.7, **F3.12a**. **Não-bloqueante** (app-side; NÃO toca
the-light nem — em princípio — a fronteira Rust, que a F3.12a já entrega).

## F3.13 — ⛔ Marco 3: plataforma de estudo profundo completa
**Objetivo:** confirmar a **plataforma de estudo profundo** funcionando: estudo
por **modo×lente×profundidade** com **léxico Strong verificado** e **citações
verificáveis** (texto/glosas **do store**, anti-alucinação), **conversa** com
follow-up, **comparação multi-IA** (Claude/GPT/Gemini), **export acadêmico** (SBL),
**pesquisa web Wikipedia opt-in** (keyless, padrão desligado — ADR-0028); IA opt-in
(o app segue 100% offline sem IA);
chave em armazenamento seguro (nunca em git/log); atribuições (STEP CC-BY, OpenBible
CC-BY) visíveis; `the-light` consumido pinado (PRs registrados + re-pin). Atualizar
`PROGRESS.md`; consolidar ADRs.
**Aceite:** checklist do Marco 3 verde (≥ alvos decididos); estudo opt-in
(desligado, o app segue offline); sem vazamento de chave; anti-alucinação provada.
**Verificação:** revisão do Guia; `PROGRESS.md` atualizado.
**Depende:** F3.5, F3.6, F3.7, F3.8, F3.10, F3.12. **gate: true** — marco; HALT
para sign-off humano/auditoria.

---

> **Regras rígidas da Fase 3 (do `IMPLEMENTATION_PLAN.md` §0):** offline-first
> (estudo profundo **opt-in**; rede em runtime **só** para a chamada de IA e para
> a **pesquisa web opt-in**, ambas com decisão/chave do usuário); **BYOK** (chave
> do usuário, **nunca** em git/log; secure-store nativo / web session-only);
> **anti-alucinação** (texto do versículo e **glosas/léxico** **sempre** do store
> local; o LLM só interpreta e é **sinalizado** se inventar Strong/fonte;
> `passage_text`/`citations` separados de `interpretation`); só **dados livres**
> (léxico STEP **CC-BY** com atribuição obrigatória; xref OpenBible CC-BY);
> **`the-light` só via PR + ADR** (estudo nativo **não** toca o core; paridade web
> só via PR sancionado se F3.9 assim decidir; consumo pinado `c8ecb2f`); **prova
> determinística com MOCK** (nunca o LLM real no CI). Diante de conflito com
> qualquer regra: **HALT**, não improviso.
