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

## F0.6 — Ligar core no WEB (WASM)
**Objetivo:** chamar `parse_reference` a partir da tela no alvo web (WASM).
**Aceite:** digitar "Jo 3.16" mostra a referência resolvida pelo Rust no browser.
**Verificação:** `npx expo start --web` + teste manual documentado.
**Depende:** F0.4, F0.5.

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
