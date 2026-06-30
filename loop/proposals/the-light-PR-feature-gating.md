> ## ✅ STATUS: IMPLEMENTADO (2026-06-30) — branch `feat/core-wasm-feature-gating` (`8f66004`)
> A mudança foi feita e **verificada** no `the-light` (autorizada pelo humano).
> **Ajuste vs. esta spec original:** adotada **UMA feature `embedded`** (default-on),
> não `store`+`net` separados — porque `store`/`net` estão entrelaçados
> (`source::SourceError` referencia `rusqlite`/`store` estruturalmente; `scholarly`
> e `ai` misturam ambos). Detalhes e verificação em `DECISIONS.md` (ADR-0005 →
> "Implementação"). **Falta:** push + merge no GitHub e re-pin do rev no
> `the-light-app` (F0.6a). A seção 2/3 abaixo é a proposta original (store/net);
> o que foi de fato aplicado é o recorte `embedded`.

---

# Proposta de PR ao `the-light` — feature-gating no `the-light-core`

> **Quem executa:** humano (Renan), no repositório `the-light` (o loop **não** toca
> o core). Este documento é a especificação do PR; ao mesclar, re-pinar o `rev` no
> `the-light-app` (ver ADR-0005 / F0.6a).
>
> **Objetivo:** permitir que um consumidor (a fronteira `the-light-app-core`) compile
> o `the-light-core` para `wasm32-unknown-unknown` **sem** arrastar `rusqlite`
> (SQLite-C) nem `reqwest` (blocking+TLS), tornando essas deps **opcionais atrás de
> features**, com **defaults ligados** (mudança **aditiva e não-quebrante**).
>
> **Base:** `the-light` rev `0888ac0bfed15222874c5462902a61ac3a39147c` (v1.2.0).

## 1. Por que (resumo)

`crates/the-light-core/Cargo.toml` declara `rusqlite` e `reqwest` como dependências
**incondicionais** e o crate **não** tem `[features]`. O cargo compila o crate
inteiro mesmo quando o consumidor usa só o parser puro, então o build wasm falha em
`sqlite-wasm-rs` (SQLite-C via clang) e em `reqwest` (blocking/TLS). Verificação do
desacoplamento (no próprio core, rev acima):

| Módulo (`src/`) | usa `rusqlite` | usa `reqwest` |
|---|---|---|
| `reference.rs` (parser) | — | — |
| `model.rs` | — | — |
| `config.rs`, `util.rs`, `export.rs` | (conferir) | (conferir) |
| `store.rs` | ✓ | — |
| `search.rs` | ✓ | — |
| `xref.rs` | ✓ | — |
| `source/embedded.rs`, `source/mod.rs` | ✓ | — |
| `source/http.rs` | — | ✓ |
| `scholarly.rs` | ✓ | ✓ |
| `ai/lexicon.rs` | ✓ | — |
| `ai/research.rs`, `ai/providers.rs` | — | ✓ |

`reference` + `model` são **puros** (`regex`/`chrono`/`serde`/`thiserror`/`std`) →
wasm-safe. As deps pesadas vivem só nos módulos acima.

## 2. Mudança no `Cargo.toml` (`crates/the-light-core/Cargo.toml`)

```diff
 [package]
 name = "the-light-core"
 ...

+[features]
+# Defaults ligados: comportamento atual (CLI/TUI/xtask) inalterado.
+default = ["store", "net"]
+# Store local em SQLite (rusqlite bundled): store, search, xref, source embedded, lexicon.
+store = ["dep:rusqlite"]
+# Conector HTTP (reqwest): provedores de IA, pesquisa, source HTTP.
+net   = ["dep:reqwest"]
+
 [dependencies]
 chrono = { version = "0.4.45", default-features = false, features = ["serde", "clock"] }
 directories = "6.0.0"
 regex = "1.12.4"
-reqwest = { version = "0.13.3", default-features = false, features = ["blocking", "json", "default-tls"] }
-rusqlite = { version = "0.40.1", features = ["bundled"] }
+reqwest = { version = "0.13.3", default-features = false, features = ["blocking", "json", "default-tls"], optional = true }
+rusqlite = { version = "0.40.1", features = ["bundled"], optional = true }
 serde = { version = "1.0.228", features = ["derive"] }
 serde_json = "1.0.150"
 tempfile = "3.27.0"
 thiserror = "2.0.18"
 toml = "1.0.7"
```

> Nota: `directories`/`tempfile`/`toml` podem estar acopladas ao store/config local;
> se forem usadas só por módulos `store`-gated, considere torná-las opcionais também
> (decisão do mantenedor — não bloqueia o objetivo wasm desde que não puxem C/TLS).

## 3. Gating dos módulos (`crates/the-light-core/src/lib.rs` e usos)

Estratégia: gatear na **declaração do módulo** quando o módulo é single-dep; para os
módulos **mistos** (`scholarly`, `source`, `ai`), gatear no nível de **submódulo/item**.

```diff
 // src/lib.rs
 pub mod config;
 pub mod model;       // puro — sempre disponível
 pub mod reference;   // puro — sempre disponível
 pub mod util;
+
+#[cfg(feature = "store")]
 pub mod store;
+#[cfg(feature = "store")]
 pub mod search;
+#[cfg(feature = "store")]
 pub mod xref;
+
+// 'source' tem embedded (store) e http (net): gatear por submódulo dentro de source/mod.rs
 pub mod source;
+
+// 'scholarly' usa store E net: requer ambas, ou gating fino interno.
+#[cfg(all(feature = "store", feature = "net"))]
 pub mod scholarly;
+
+// 'ai' tem lexicon (store) e research/providers (net): gatear por submódulo em ai/mod.rs
 pub mod ai;
+
 pub mod export;      // conferir deps (export pode depender de store p/ ler dados)
```

Dentro de `source/mod.rs` e `ai/mod.rs`, aplicar o mesmo padrão por submódulo:

```rust
// source/mod.rs
#[cfg(feature = "store")] pub mod embedded;
#[cfg(feature = "net")]   pub mod http;

// ai/mod.rs
#[cfg(feature = "store")] pub mod lexicon;
#[cfg(feature = "net")]   pub mod research;
#[cfg(feature = "net")]   pub mod providers;
```

> O recorte exato (quais reexports/itens em `lib.rs`/`mod.rs` referenciam tipos
> gated) cabe ao mantenedor, que conhece as interdependências. O critério é: com
> `--no-default-features`, o crate expõe **ao menos** `reference` + `model` e compila
> sem `rusqlite`/`reqwest`.

## 4. Critério de aceite do PR (no `the-light`)

- [ ] `cargo build -p the-light-core` (defaults) — **inalterado**, verde.
- [ ] `cargo test -p the-light-core` (defaults) — suíte atual passa.
- [ ] `cargo build -p the-light-core --no-default-features` — verde, **sem** compilar
      `rusqlite`/`reqwest`/`sqlite-wasm-rs` (checar `cargo tree --no-default-features`
      não lista `rusqlite`/`reqwest`).
- [ ] `cargo build -p the-light-core --no-default-features --target wasm32-unknown-unknown`
      — **verde** (com `wasm32-unknown-unknown` instalado).
- [ ] CLI/TUI (`the-light-cli`, `the-light-tui`) compilam e funcionam como antes
      (eles habilitam `the-light-core` com defaults).
- [ ] `clippy -D warnings` limpo em todas as combinações de features acima.

## 5. Pós-merge (no `the-light-app`, via loop)

1. Re-pinar `core/Cargo.toml`: `the-light-core = { git = "…/the-light", rev = "<rev do merge>", package = "the-light-core", default-features = false }`.
2. **F0.6a:** matriz de features por alvo (web sem features; nativo `["store","net"]`)
   + `cargo build -p the-light-app-core --target wasm32-unknown-unknown` verde.
3. **F0.6b:** bindings web do `ubrn` + glue `app/web/` + ligar a tela + prova headless.
4. Remover/ajustar `loop/HALT` e retomar o loop.

## 6. Garantias de princípio

- **Não-quebrante:** defaults preservam o core atual; tornar deps `optional` é aditivo.
- **Uma fonte da verdade:** o parser continua no Rust; nada é reimplementado no app.
- **Offline-first:** features de build; nenhuma rede entra no runtime do produto.
- **Sem fork:** mudança no core só via este PR (ADR-0002/ADR-0005), nunca fork divergente.
