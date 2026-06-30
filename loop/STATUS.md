# Loop — Board de status

> **Modo autônomo:** o Claude Code (Driver + planner/executor/reviewer) mantém
> esta tabela a cada ciclo. O Guia só audita. Legenda: ⬜ backlog · 🟡 ready ·
> 🔵 in_progress · 🔴 blocked/failed · ✅ aceito · ⛔ gate (HALT p/ sign-off)

Última atualização: 2026-06-30 06:00 UTC · Estado do loop: **▶️ RODANDO — store nativo provado (F0.9 passed); próxima F0.10 (store web)**
Heartbeat: ver `HEARTBEAT` · HALT: **ausente** · **F0.9 passed** (`1d16897`; get_passage lê João 3:16 do store via the-light-core; wasm puro) · Provados: web+iOS+Android + store nativo; próxima elegível: **F0.10 (store web `wa-sqlite`+OPFS)** → **F0.11 (gate Marco 0)**

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
| F0.6c | Alinhar `uniffi` da fronteira a `=0.31.0` (compat. ubrn web) | ✅ aceito | F0.6a | passed (7b98644) |
| F0.6b | Bindings web (ubrn) + glue + tela + prova headless | ✅ aceito | F0.6a, F0.6c | passed (1cdde6c) — web/WASM ponta a ponta |
| F0.7 | Ligar core no **iOS**: chamar parse_reference | ✅ aceito | F0.4, F0.5 | passed (a6f6797) — Turbo Module nativo, run real no sim |
| F0.8 | Ligar core no **Android**: chamar parse_reference | ✅ aceito | F0.4, F0.5 | passed (36af016) — Turbo Module nativo, run real no emulador |
| F0.9 | Store nativo (`rusqlite`): ler 1 passagem do sample.sqlite | ✅ aceito | F0.6b, F0.7, F0.8 | passed (1d16897) — get_passage lê João 3:16 do store |
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
| 2026-06-30 | F0.6b aceita (web ponta a ponta; ADR-0006/0007). Planner semeou **F0.7** na `queue/` (status ready, gate:false, depende de F0.4+F0.5, aceitas): ligar o core no **iOS** via **Turbo Module nativo** (`ubrn build ios --sim-only --and-generate`, schema `ios:` em `ubrn.config.yaml`) + integração Expo (`expo prebuild`/`pod install`/`run:ios`) + glue nativo (`app/web/reference.ts`) ligando a tela ao binding nativo + **run real no simulador iOS 26.5** com **prova headless** (self-test no launch que loga `TLA_SELFTEST PT/EN book=43 chapter=3 verse=16`, ou XCTest). Ambiente PRONTO (Xcode 26.6 + sim iPhone 17 + targets iOS). Gerados ignorados (app/ios, Pods, xcframework, codegen). **Risco de `blocked`** por imaturidade do caminho iOS do ubrn / integração Expo-prebuild-autolink: instrui `blocked` com erro EXATO (decisão estratégica = ADR-0008). |
| 2026-06-30 | F0.7 aceita (`a6f6797`; Turbo Module nativo iOS, run real no sim, prova headless PT==EN; ADR-0008). Planner semeou **F0.8** na `queue/` (status ready, gate:false, depende de F0.4+F0.5, aceitas): **ESPELHO da F0.7 no Android**. O Turbo Module (spec `NativeTheLightAppCore`, `cpp/`/`src/`/`bindings/`, autolink `react-native.config.js`, glue `app/web/reference.ts`/`selftest.ts`) **já existe e é compartilhado** — F0.8 só adiciona o **caminho de BUILD Android**: bloco `android:` em `ubrn.config.yaml`, `scripts/gen-bindings-android.sh` (`ubrn build android --and-generate --targets aarch64-linux-android` via `cargo-ndk` → `.so` em jniLibs + glue Gradle/CMake/Kotlin), `npx expo prebuild -p android` + Gradle, e `scripts/run-android-selftest.sh` (emulador **headless** `thelight_avd`, prova via `adb logcat` dos marcadores `TLA_SELFTEST PT/EN book=43 chapter=3 verse=16`). Ambiente PRONTO (NDK 27.1 + cargo-ndk 4.1.2 + JDK 17 + emulador headless; smoke test do core verde). Gerados ignorados (app/android, /android, jniLibs/.so, build, .gradle). **Risco MENOR que F0.7** (integração Turbo Module já feita); residual: caminho Android do ubrn + autolink Gradle/emulador → `blocked` com erro EXATO se hack proibido (decisão estratégica = ADR-0009). |
| 2026-06-30 | F0.8 aceita (`36af016`); **3 alvos provados** (web+iOS+Android). Planner semeou **F0.9** na `queue/` (status ready, gate:false, depende de F0.6b/F0.7/F0.8 — todas aceitas): **store nativo** — expor `get_passage`/`getPassage` na fronteira UniFFI que **lê 1 passagem** (`John 3:16`) de um `assets/data/sample.sqlite` (subset **KJV domínio público**) **delegando ao store do `the-light-core`** (`store::Store` + `source::EmbeddedSource::passage`, `rusqlite`, feature `embedded` ativa só no nativo). API/schema **descobertos na fonte** (`store.rs`/`source/embedded.rs`/`model.rs`/`migrations/v1_initial.sql`): `Store::open(path)` migra o schema; `passage()` lê `translations`+`verses`. Prova **determinística** = **teste Rust de host** (`embedded` on) abrindo o sample → `get_passage("John 3:16")` == texto KJV verbatim + `book=43/chapter=3/verse=16`; run nativo = adicional opcional. **`cfg(not(wasm32))` obrigatório** (web/F0.6b permanece puro; sem `rusqlite` no grafo wasm). Anti-alucinação: texto vem do store local; só domínio público. Decisão versionado-vs-gerado do `sample.sqlite` + origem do texto + API/schema → **ADR-0010**. `blocked` com erro EXATO se o store exigir mudar core/fronteira de forma proibida ou dados protegidos. |
