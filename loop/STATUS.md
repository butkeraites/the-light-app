# Loop — Board de status

> **Modo autônomo:** o Claude Code (Driver + planner/executor/reviewer) mantém
> esta tabela a cada ciclo. O Guia só audita. Legenda: ⬜ backlog · 🟡 ready ·
> 🔵 in_progress · 🔴 blocked/failed · ✅ aceito · ⛔ gate (HALT p/ sign-off)

Última atualização: 2026-06-30 03:10 UTC · Estado do loop: **▶️ RODANDO — F0.6b falhou (conflito uniffi); correção F0.6c semeada**
Heartbeat: ver `HEARTBEAT` · HALT: **ausente** · F0.6b attempt 1 → **failed** (conflito de versão `uniffi_core` 0.31.2 vs runtime web do ubrn `=0.31.0`; correção em escopo) · Elegível agora: **F0.6c** (alinhar `uniffi` da fronteira a `=0.31.0`) → depois **retry F0.6b**

## Fase 0 — Prova da ponte Rust → Expo

| ID | Tarefa | Estado | Depende de | Resultado |
|----|--------|--------|------------|-----------|
| F0.0 | Confirmar toolchain e versões; registrar ADR | ✅ aceito | — | passed (efe334f) |
| F0.1 | Bootstrap do repo + docs de processo (DECISIONS/PROGRESS/.gitignore) | ✅ aceito | F0.0 | passed (595c70c) |
| F0.2 | Crate `core/` com UniFFI compilando (sem lógica) | ✅ aceito | F0.1 | passed (7b922eb) |
| F0.3 | `parse_reference` na fronteira + teste | ✅ aceito | F0.2 | passed (9881c72) |
| F0.4 | Script de geração de bindings TS | ✅ aceito | F0.3 | passed (e19064a) |
| F0.5 | App Expo mínimo (expo-router) + tela | ✅ aceito | F0.1 | passed (3262f56) |
| F0.6 | Ligar core no **web (WASM)** | 🔴 blocked → ♻️ re-escopada | F0.4, F0.5 | blocked (SQLite-no-WASM); ADR-0005 |
| F0.6a | Consumir core c/ features por alvo (re-pin `8f66004`) | ✅ aceito | F0.4, F0.5, core | matriz por alvo OK; SQLite-no-WASM resolvido |
| F0.6c | Alinhar `uniffi` da fronteira a `=0.31.0` (compat. ubrn web) | 🟡 ready | F0.6a | correção da F0.6b/attempt1 |
| F0.6b | Bindings web (ubrn) + glue + tela + prova headless | 🔴 failed(1) → retry | F0.6a, F0.6c | attempt1: conflito uniffi_core 0.31.2 vs =0.31.0 (runtime ubrn) |
| F0.7 | Ligar core no **iOS**: chamar parse_reference | ⬜ | F0.4, F0.5 | — |
| F0.8 | Ligar core no **Android**: chamar parse_reference | ⬜ | F0.4, F0.5 | — |
| F0.9 | Store nativo (`rusqlite`): ler 1 passagem do sample.sqlite | ⬜ | F0.6/7/8 | — |
| F0.10 | Store web (`wa-sqlite`+OPFS): ler 1 passagem | ⬜ | F0.9 | — |
| F0.11 | **Marco 0** (⛔ gate): revisão dos 3 alvos + store; ADR + PROGRESS | ⬜⛔ | F0.9, F0.10 | — |

## Fases seguintes

F1 (leitura offline), F2 (IA BYOK + Gemini), F3 (estudo profundo), F4 (refino)
— ver `IMPLEMENTATION_PLAN.md`. Serão decompostas em `backlog/` conforme a Fase 0
fechar.

## Log de ciclos

| Data | Evento |
|------|--------|
| 2026-06-29 | Loop criado; PROTOCOL.md e backlog da Fase 0 escritos; F0.0 semeada na queue. |
| 2026-06-29 | Migrado p/ **modo autônomo**: subagentes, run-loop.sh, journal/heartbeat/HALT, gate no Marco 0. Guia vira auditor. |
| 2026-06-29 | Ciclo 1: F0.0 executada (executor) e verificada (reviewer) → **passed** (efe334f); arquivada. Lacunas registradas: targets Rust, ubrn, Xcode (F0.7), Android NDK (F0.8). |
| 2026-06-29 | Ciclo 2: queue vazia → planner semeou F0.1. |
| 2026-06-29 | Ciclo 3: F0.1 executada e verificada → **passed** (595c70c); arquivada. Repo estruturado; DECISIONS/PROGRESS/.gitignore criados. ADR-0002: consumir `the-light` como git dep pinada; resolução real pendente p/ F0.2. |
| 2026-06-29 | Planner semeou **F0.2** na `queue/` (crate `core/` com UniFFI trivial `ping`, SEM lógica e SEM dep do `the-light-core`). Resolução real do `the-light-core` transferida da F0.2 p/ a **F0.3** (onde `parse_reference` delega ao core). |
| 2026-06-29 | Ciclo 5: F0.2 executada e verificada → **passed** (7b922eb); arquivada. Crate `the-light-app-core` compila com uniffi 0.31.2 (modo library); ADR-0003. |
| 2026-06-29 | Planner semeou **F0.3** na `queue/` (`parse_reference` delegando ao `the-light-core::reference`). Git dep pinada no rev `0888ac0…` (the-light público); API descoberta via fonte clonada em `~/.cargo/git/checkouts/`. |
| 2026-06-29 | Ciclo 7: F0.3 executada e verificada → **passed** (9881c72); arquivada. **Ponte real ao core provada**: git dep pinada (the-light-core v1.2.0), `parse_reference` delega ao core, "Jo 3.16"=="John 3:16" → (43,3,Single 16). Sem fork/cópia. |
| 2026-06-29 | Planner semeou **F0.4** na `queue/` (status ready): script reproduzível `scripts/gen-bindings.sh` que instala+fixa o `ubrn`, configura e gera os bindings TS da fronteira UniFFI em `bindings/`. Escopo atômico = só os `.ts` (não liga app ainda; isso é F0.6/7/8). `.ts` gerados são ignorados por design; ADR-0004 fixará a versão do `ubrn`. Bloqueio legítimo se o `ubrn` não instalar/rodar/gerar (maturidade / incompat. com uniffi 0.31.2). |
| 2026-06-29 | Ciclo 9: F0.4 executada e verificada → **passed** (e19064a); arquivada. **Risco #1 (maturidade do ubrn) vencido**: ubrn 0.31.0-3 gera `bindings/*.ts` (parseReference/ping/tipos) de forma reprodutível; compat. com uniffi 0.31.2 sem tocar a fronteira; ADR-0004. |
| 2026-06-29 | Planner semeou **F0.5** na `queue/` (status ready): app Expo mínimo (SDK 56, expo-router) em `app/` (package.json próprio, independente da raiz/ubrn) com UMA tela `TextInput` + área de resultado (`testID="result"`) placeholder — **sem** chamar o core (guarda de escopo: ligar core é F0.6/web, F0.7/iOS, F0.8/Android). Verificação **não-interativa**: `tsc --noEmit` + `expo export --platform web` (gera `app/dist/`, sai 0). RUN nativo (`run:ios`/`run:android`) **adiado p/ F0.7/F0.8** (Xcode completo/Android NDK ausentes). `app/node_modules`,`.expo`,`dist` ignorados por design. |
| 2026-06-29 | Ciclo 11: F0.5 executada e verificada → **passed** (3262f56); arquivada. App Expo SDK 56 (expo-router) em `app/` com tela input+resultado; export web compila (769 módulos), `tsc` limpo. **Node 25 compatível com SDK 56** (risco descartado). |
| 2026-06-29 | Planner semeou **F0.6** na `queue/` (status ready, gate:false): ligar o core no **web/WASM** — `Jo 3.16` na tela web → referência resolvida pelo Rust (livro 43, cap. 3, v. 16) via wasm+bindings web, com **prova headless** (teste node). Portão decisivo = compilar a fronteira p/ `wasm32-unknown-unknown` **sem `rusqlite`**. **Risco alto de HALT (blocked):** o `the-light-core` (rev 0888ac0) **não tem `[features]` nem deps `optional`** — `rusqlite{bundled}`+`reqwest{blocking,default-tls}` são incondicionais; excluí-los exigiria **modificar o core (PR+ADR=HALT)**. Task instrui `blocked` com erro EXATO = gate estratégico de Fase 0 (Apêndice A #1 / VISION §4 fricção #1). |
| 2026-06-29 | Ciclo 13: executor tentou F0.6, reviewer confirmou de forma independente → **`blocked`**. `cargo build --target wasm32-unknown-unknown` falha (exit 101) no `sqlite-wasm-rs` (SQLite-C). Core sem `[features]` → impossível excluir `rusqlite` sem PR ao `the-light`. **⛔ `loop/HALT` escrito — loop PARADO p/ decisão estratégica (store-web: wa-sqlite/OPFS, PR ao core, ou web leitura+IA pré-indexada → ADR-0005).** Core/fronteira intactos. |
| 2026-06-30 | **Resolução de direção (humano aprovou):** ADR-0005 — feature-gating `store`/`net` no `the-light-core` (PR não-quebrante, spec em `loop/proposals/the-light-PR-feature-gating.md`) + matriz de features por alvo no app. Verificado que `reference`/`model` são puros/desacoplados. F0.6 arquivada (blocked) e **re-escopada em F0.6a/F0.6b** (backlog). HALT **ajustado**: retomar exige PR mesclado + re-pin do rev. Core ainda intocado (PR é ação humana). |
| 2026-06-30 | F0.6a aceita (re-pin `8f66004`, matriz por alvo: web puro / nativo embedded). Planner semeou **F0.6b** na `queue/` (status ready, gate:false, depende de F0.6a): caminho **web** do `ubrn 0.31.0-3` (subcomando `ubrn web build`, wasm-pack/wasm-bindgen) → bindings wasm + glue em `app/web/` + ligar `app/app/index.tsx` (a guarda "sem core" da F0.5 não vale mais) + **prova headless** (node: `parseReference` via wasm = book 43/cap 3/v Single 16 p/ "Jo 3.16" e "John 3:16") + `expo export --platform web` sai 0. **Achado embutido (ADR-0005):** build cru falha em `uniffi_core 0.31.2` (`UniffiCompatibleFuture: …+Send`) → DEVE usar caminho web do ubrn, não build cru. Risco de `blocked` por imaturidade do caminho web do ubrn / uniffi-wasm: instrui `blocked` com saída EXATA (decisão estratégica; ADR-0006 se decidido). |
