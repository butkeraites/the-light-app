# PR ao `the-light-core` — `ai-pure` do estudo profundo (wasm-safe)

- **Repo alvo:** `the-light` (core pinado do The Light)
- **Branch:** `feat/ai-pure-study` (partindo de `main`@`c8ecb2fcef60847a2fddf68aa03b8a5eceea54f6`)
- **Sancionado por:** ADR-0029 (D2), precedente EXATO ADR-0024/F2.7. Tarefa F3.11.
- **Tipo:** aditivo, **não-quebrante**, opt-in (`default = ["embedded"]` intacto).
- **Handoff:** push/merge é ação humana; o Driver re-pina a fronteira depois.

## Objetivo

Tornar as **partes puras do estudo profundo** (Fase 3) compiláveis em
`wasm32-unknown-unknown` sob a feature `ai-pure` (ADR-0024), para a paridade web
(F3.12) usar a **mesma impl Rust** do nativo (anti-alucinação com **zero drift**).
O transporte HTTP (LLM + Wikipedia) permanece em `fetch`/TS (F2.7b/ADR-0025) — **não**
se implementa transporte wasm aqui.

## Estratégia (widening de `#[cfg]` + 1 `pub` novo)

Espelha o precedente ADR-0024: em vez de mover código, **ampliar o gate**
`#[cfg(feature = "embedded")]` → `#[cfg(any(feature = "embedded", feature = "ai-pure"))]`
na superfície **pura** do estudo, gateando por `embedded` apenas o que puxa
reqwest/rusqlite/disco/clock.

### `crates/the-light-core/Cargo.toml`
- `ai-pure = ["dep:serde_json", "dep:chrono"]` — `chrono` entra no grafo puro
  (necessário por `WebSource.fetched_at: DateTime<Utc>` e `from_web_results`), mas
  **clock-free**: `chrono = { …, default-features = false, features = ["serde", "std"] }`.
  Sem `clock`, o chrono **não** puxa `wasm-bindgen`/`js-sys` no wasm.
- `embedded = ["ai-pure", "chrono/clock", …]` — o nativo **reativa** o `clock`
  (usado por `Utc::now()` em `WikipediaProvider`/`TavilyProvider`), preservando o
  comportamento nativo **byte-a-byte**.
- `default = ["embedded"]` **intacto**; `ai-pure` **fora** do default.

### `src/ai/mod.rs`
- `pub mod research` passa de `embedded` para `any(embedded, ai-pure)` (o pesado é
  gateado dentro do módulo).
- Re-exports movidos para `ai-pure`: `research::{WebSource, ResearchProvider,
  MockResearchProvider, RESEARCH_BACKENDS}` e `study::{StudyRequest, StudyResult}`.
- Permanecem `embedded`: `study::study`, `research::build_research_provider`,
  `providers::build_provider`, `lexicon::verified_lexicon`, `keys::KeyStore`.

### `src/ai/study.rs`
- Widening para `ai-pure`: `StudyRequest`, `StudyResult`, `impl StudyResult`
  (`to_markdown`/`to_academic_markdown`/`warnings_block`), `user_prompt`,
  `cited_web_indices`, e os `use` de topo puros (`WebSource`, `VerifiedLexicon`,
  `Citation`/`CitationKind`/`citation`, `Reference`, `StudyDepth`, `HashSet`).
- **`user_prompt` de `fn` privado → `pub fn`** (a única mudança de visibilidade;
  entrada pública mínima nova). `cited_web_indices` de `fn` privado → `pub fn`.
- Permanecem `embedded`: `study()` (provider real + `system_prompt` de disco +
  `lexicon::verify`) e `use CitationCollector` (só `study()` o usa).

### `src/ai/research.rs`
- Puros/`ai-pure` (via módulo): `WebSource`, `ResearchProvider` (trait),
  `MockResearchProvider` (usa `from_timestamp`, sem clock), `RESEARCH_BACKENDS`.
- Gateados por `embedded`: `RESEARCH_TIMEOUT`/`USER_AGENT`/`blocking_client`/
  `urlencode`/`strip_html` (usados só pelos providers de rede), `WikipediaProvider`,
  `TavilyProvider`, `build_research_provider`; imports `Duration`/`serde_json::Value`/
  `AiError`.

### `src/ai/citation.rs`
- `use super::research::WebSource` e `CitationCollector::from_web_results` passam
  de `embedded` para `any(embedded, ai-pure)` (`ws.fetched_at.format(...)` compila
  com chrono `std`, sem clock). O resto já era puro.

### `src/lib.rs`
- **Sem mudança** — `pub mod ai` já estava sob `any(embedded, ai-pure)` (F2.7).

## Superfície pública nova

- **1 `pub` novo real:** `ai::study::user_prompt` (`fn` → `pub fn`).
- Widening (aditivo) de itens já `pub` para `ai-pure`: `study::{StudyRequest,
  StudyResult}` + `StudyResult::{to_markdown, to_academic_markdown}`;
  `study::cited_web_indices` (também `fn` → `pub fn`); `research::{WebSource,
  ResearchProvider, MockResearchProvider, RESEARCH_BACKENDS}`;
  `citation::from_web_results`.
- API pública **nativa** inalterada (nada removido/renomeado).

## Verificação (executada no branch)

- `cargo fmt --all --check` → exit 0.
- `cargo clippy --workspace --all-targets -- -D warnings` → limpo.
- `cargo test --workspace` → todos verdes (core lib **184**; workspace 0 falhas).
- **Portão D2:** `cargo build -p the-light-core --no-default-features --features
  ai-pure --target wasm32-unknown-unknown` → **compila** (com as peças do estudo).
- `cargo tree` do grafo `ai-pure`/wasm → **sem** `reqwest`/`rusqlite` (e sem
  `wasm-bindgen`/`js-sys`; chrono presente é **clock-free**). Deps: chrono, regex,
  serde, serde_json, thiserror.
- `cargo build -p the-light-core` (default/embedded) → OK; chrono nativo mantém
  `clock` (`iana-time-zone` presente).
- `main` intacto em `c8ecb2f`; **sem push**.

## Desfecho / handoff

Branch verde → HALT: humano faz **push do branch + merge na `main`** do `the-light`
e informa o rev mergeado. O Driver re-pina a linha WEB de `core/Cargo.toml` para
`features = ["ai-pure"]` no novo rev (a nativa segue `["embedded"]`) e revalida a
fronteira. **Consumir** a superfície nova (montar/finalizar o estudo web
prepare→fetch→finalize) é a **F3.12**.
