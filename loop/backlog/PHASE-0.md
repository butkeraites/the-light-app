# Backlog — Fase 0 (Prova da ponte Rust → Expo)

> Rascunhos de tarefa redigidos pelo Guia. Cada bloco vira um arquivo
> `queue/<ID>.task.md` quando liberado. **Uma de cada vez** (ver PROTOCOL.md).
> A Fase 0 existe para provar a viabilidade técnica antes de qualquer UI.

---

## F0.0 — Confirmar toolchain e versões
**Objetivo:** levantar e fixar as versões das ferramentas; não codar produto.
**Aceite:**
- `rustup target list --installed` inclui `wasm32-unknown-unknown` e os targets
  de iOS/Android necessários.
- Node LTS, gerenciador de pacotes e Expo SDK identificados.
- `uniffi-bindgen-react-native` (ou nome sucessor `uniffi-bindgen-javascript`)
  localizado, com versão e fluxo de build (`ubrn`?) anotados.
- Xcode + Android SDK/NDK presentes (ou lacunas registradas como bloqueio).
**Verificação:** `DECISIONS.md` (a criar na F0.1, ou um rascunho em `done/`)
contém uma tabela com cada ferramenta e versão; lacunas viram `blocked`.

## F0.1 — Bootstrap do repo + docs de processo
**Objetivo:** criar a árvore da seção 1 do plano, `DECISIONS.md`, `PROGRESS.md`,
`.gitignore`; referenciar `the-light` como dependência pinada por commit.
**Aceite:** árvore criada; docs presentes; `the-light-core` resolvível.
**Verificação:** `git status` limpo após commit; `cargo metadata` resolve o core.
**Depende:** F0.0.

## F0.2 — Crate `core/` com UniFFI compilando (sem lógica)
**Objetivo:** `core/` compila com uma função UniFFI trivial (ex.: `ping() -> String`).
**Aceite:** build do crate ok; interface UniFFI válida; padrão de erro definido.
**Verificação:** `cargo build -p the-light-app-core` verde.
**Depende:** F0.1.

## F0.3 — `parse_reference` na fronteira + teste
**Objetivo:** expor `parse_reference(input) -> Reference` delegando ao
`the-light-core::reference`; retorno serializável via UniFFI.
**Aceite:** "Jo 3.16" e "John 3:16" resolvem corretamente; erros mapeados.
**Verificação:** `cargo test -p the-light-app-core`.
**Depende:** F0.2.

## F0.4 — Script de geração de bindings TS
**Objetivo:** script reproduzível que gera os bindings TS (web/wasm + nativo).
**Aceite:** `bindings/` populado; tipos batem com a interface Rust.
**Verificação:** rodar o script limpa e regenera sem erro; `tsc --noEmit` nos bindings.
**Depende:** F0.3.

## F0.5 — App Expo mínimo + tela
**Objetivo:** projeto Expo (expo-router) com uma tela que tenha input + área de
resultado (ainda sem chamar o core).
**Aceite:** app sobe em web/iOS/Android (tela vazia funcional).
**Verificação:** `npx expo start --web`, `run:ios`, `run:android` abrem a tela.
**Depende:** F0.1.

## F0.6 — Ligar core no WEB (WASM)  — **BLOQUEADA → RE-ESCOPADA (ADR-0005)**
A F0.6 original bloqueou no portão decisivo (fricção SQLite-no-WASM): o
`the-light-core` arrasta `rusqlite`/`reqwest` incondicionais e não compila p/
`wasm32` sem ser modificado (ver `loop/archive/F0.6.result.md`, `loop/HALT`,
ADR-0005). Resolvida via **feature-gating no core (PR — `loop/proposals/the-light-PR-feature-gating.md`)**
+ matriz de features por alvo no app. Re-escopada em F0.6a e F0.6b.

### F0.6a — Consumir o core com features por alvo + compilar a fronteira p/ wasm
**Estado:** a mudança de habilitação no core **JÁ FOI IMPLEMENTADA e verificada**
(branch `the-light` `feat/core-wasm-feature-gating`, commit `8f66004`; feature
única `embedded` default-on; `the-light-core --no-default-features` compila p/
`wasm32`). Ver ADR-0005 → "Implementação".
**Pré-condição restante (humano/coordenada):** **push + merge** do branch no GitHub
e obtenção do **rev mesclado**, para então **re-pinar** `core/Cargo.toml` (ADR-0002 =
git dep por commit). **NÃO semear na queue antes do rev estar no remoto** (senão a
git-dep pinada não resolve). Alternativa de verificação local: `[patch]`/`path` para
o core local (usado temporariamente já na validação; revertido).
**Objetivo:** re-pinar `core/Cargo.toml` no rev pós-PR com `default-features = false`
e configurar a **matriz de features por alvo** (web/wasm: sem features pesadas → só
`reference`/`model`; nativo: `["store","net"]`); compilar a fronteira para
`wasm32-unknown-unknown`.
**Aceite:** `cargo build -p the-light-app-core --target wasm32-unknown-unknown` verde
(sem `rusqlite`/`reqwest` no grafo wasm — `cargo tree` confirma); `cargo build`/`test`
nativos seguem verdes; `parse_reference` continua delegando ao core (uma fonte da
verdade); fmt/clippy limpos; working tree limpo.
**Verificação:** `cargo build --target wasm32-unknown-unknown` + `cargo tree
--target wasm32-unknown-unknown` sem `rusqlite`/`reqwest` + `cargo test` (host).
**Depende:** F0.4, F0.5 **e** o PR ao core mesclado (pré-condição externa).

### F0.6b — Bindings web (ubrn) + glue + ligar a tela + prova headless
**Objetivo:** gerar os bindings **web/wasm** via o caminho web do `ubrn` (não o
`jsi`), criar o glue em `app/web/` (carregar o módulo wasm + wrapper sobre
`parseReference`), ligar `app/app/index.tsx` para resolver a referência pelo Rust no
web, e provar de forma **headless**.
**Aceite:** teste headless (node) prova `parseReference("Jo 3.16")` e `("John 3:16")`
→ `book=43, chapter=3, verses=Single 16` via wasm+bindings; a tela web exibe a
referência resolvida pelo Rust (não eco/lógica TS); `npx expo export --platform web`
(de `app/`) sai 0; working tree limpo (wasm/bindings ignorados).
**Verificação:** script de bindings web + teste node headless + expo export web.
**Depende:** F0.6a. **Achado já registrado (ADR-0005):** um `cargo build` cru da
fronteira p/ `wasm32-unknown-unknown` falha em `uniffi_core 0.31.2`
(`UniffiCompatibleFuture: …+Send`; wasm é single-thread). Portanto a F0.6b **deve**
usar o **caminho web do `ubrn`** (não build cru), possivelmente com feature/config do
`uniffi` p/ wasm. Se o caminho web do `ubrn 0.31.0-3` for imaturo/inoperante →
`blocked` legítimo com erro exato (decisão sobre o caminho web do ubrn) — **não** é
bloqueio do core (esse já foi resolvido na F0.6a).

## F0.7 — Ligar core no iOS
**Objetivo:** `parse_reference` via Turbo Module nativo no simulador iOS.
**Aceite:** mesmo fluxo da F0.6 no iOS.
**Verificação:** `npx expo run:ios` + teste manual.
**Depende:** F0.4, F0.5.

## F0.8 — Ligar core no Android
**Objetivo:** `parse_reference` via Turbo Module nativo no emulador Android
(provável uso de `cargo-ndk`).
**Aceite:** mesmo fluxo no Android.
**Verificação:** `npx expo run:android` + teste manual.
**Depende:** F0.4, F0.5.

## F0.9 — Store nativo (`rusqlite`): ler 1 passagem
**Objetivo:** gerar `assets/data/sample.sqlite` (subset KJV) e ler "John 3:16"
via `rusqlite` (bundled) no nativo.
**Aceite:** `getPassage("John 3:16")` retorna o texto correto em iOS e Android.
**Verificação:** teste da camada store + teste manual por alvo.
**Depende:** F0.6/F0.7/F0.8 (ao menos a ponte provada).

## F0.10 — Store web (`wa-sqlite` + OPFS): ler 1 passagem
**Objetivo:** mesma leitura no web, com `wa-sqlite`+OPFS e store injetado no core;
interface de store idêntica ao nativo.
**Aceite:** `getPassage("John 3:16")` retorna o texto correto no browser.
**Verificação:** teste manual web documentado.
**Depende:** F0.9.

## F0.11 — Marco 0: revisão + ADR + PROGRESS
**Objetivo:** confirmar ponte + store nos três alvos; registrar ADRs (store no
WASM, transporte futuro de IA, lib de bindings) e atualizar `PROGRESS.md`.
**Aceite:** checklist do Marco 0 verde; ADRs escritos.
**Verificação:** revisão do Guia; `PROGRESS.md` atualizado.
**Depende:** F0.9, F0.10.

> **Gate do Marco 0:** se F0.6/7/8 ou F0.9/10 falharem, o Guia reavalia a
> estratégia (ex.: web como "leitura + IA" com dados pré-indexados) antes da Fase 1.
