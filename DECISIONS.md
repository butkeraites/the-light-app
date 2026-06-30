# DECISIONS.md — Registro de decisões (ADRs) do `the-light-app`

> ADRs curtos. Cada escolha relevante de arquitetura/processo é registrada aqui,
> conforme a regra 8 da seção 0 do `IMPLEMENTATION_PLAN.md`. Formato: contexto →
> decisão → consequências. Tabelas de ambiente migram para cá quando confirmadas.

---

## Tabela de ambiente — versões confirmadas (migrada da F0.0)

Fonte: `loop/archive/F0.0.result.md` (auditada de forma independente pelo
Reviewer em 2026-06-29, macOS Darwin 25.5.0). Estas versões são a base de
referência (BYOK / offline-first; nada aqui exige rede ou conta).

| Ferramenta                              | Versão / valor detectado            | Status        |
| --------------------------------------- | ----------------------------------- | ------------- |
| rustc                                   | **1.96.0** (ac68faa20 2026-05-25)   | OK            |
| cargo                                   | **1.96.0** (30a34c682 2026-05-25)   | OK            |
| rustup                                  | 1.29.0 (28d1352db 2026-03-05)       | OK            |
| Target Rust `aarch64-apple-darwin`      | instalado                           | OK            |
| Target Rust `wasm32-unknown-unknown`    | ausente                             | PENDÊNCIA     |
| Targets Rust iOS (`aarch64-apple-ios`,  | ausentes                            | PENDÊNCIA     |
| `aarch64-apple-ios-sim`)                |                                     |               |
| Targets Rust Android                    | ausentes                            | PENDÊNCIA     |
| (`aarch64-linux-android`, `armv7-…`)    |                                     |               |
| Node                                    | **v25.8.1**                         | OK            |
| npm                                     | 11.11.0                             | OK            |
| pnpm                                    | 11.3.0                              | OK            |
| yarn / bun                              | ausentes                            | não usados    |
| Expo SDK                                | **56** (`expo@56.0.12` via npm)     | OK (a instalar na F0.5) |
| Gerador de bindings UniFFI              | `uniffi-bindgen-react-native` (CLI `ubrn`) **`0.31.0-3`** (devDependency npm, versão exata pinada em `package.json`+`package-lock.json`) | INSTALADO na F0.4 (ADR-0004) |
| `uniffi-bindgen`                        | ausente do PATH                     | PENDÊNCIA     |
| `cargo-ndk`                             | ausente                             | PENDÊNCIA (build Android) |
| Xcode completo (`xcodebuild`)           | ausente (só Command Line Tools em `/Library/Developer/CommandLineTools`) | BLOQUEIO futuro (build iOS, ~F0.7) |
| Android SDK/NDK (`ANDROID_HOME`, `adb`) | não configurados                    | BLOQUEIO futuro (build Android, ~F0.8) |

Pendências leves (`rustup target add ...`, instalar `ubrn`/`cargo-ndk`) são
resolvíveis por script na tarefa que precisar de cada alvo. Os dois BLOQUEIOS
reais (Xcode completo e Android SDK/NDK) exigem setup humano de máquina e
deverão disparar HALT nas tarefas F0.7/F0.8 se ainda não resolvidos.

### Atualização do ambiente — 2026-06-30 (instalação de toolchains)

Para destravar os alvos nativos, foram **instalados** (rede em dev/build):

| Ferramenta | Versão / valor | Status |
| --- | --- | --- |
| Targets Rust `wasm32-unknown-unknown` | instalado (F0.6a) | OK |
| Targets Rust iOS (`aarch64-apple-ios`, `-ios-sim`) | instalados | OK |
| Targets Rust Android (`aarch64-linux-android`, `armv7-`, `x86_64-`) | instalados | OK |
| `cargo-ndk` | **4.1.2** | OK |
| OpenJDK | **17.0.19** (`/opt/homebrew/opt/openjdk@17`) | OK |
| Android cmdline-tools / `sdkmanager` | brew cask; `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` | OK |
| Android platform-tools (`adb`) | 37.0.0 / adb 1.0.41 | OK |
| Android platform | `platforms;android-35` | OK |
| Android build-tools | `35.0.0` | OK |
| **Android NDK** | **`27.1.12297006`** (`ANDROID_NDK_HOME`) | OK |
| **Xcode completo (`xcodebuild`)** | **26.6** (Build 17F113); `xcode-select` → `/Applications/Xcode.app` | OK (instalado pelo humano) |
| Runtime simulador iOS | **iOS 26.5** (simuladores iPhone 17 disponíveis) | OK |
| Emulador Android | `emulator` + `system-images;android-35;google_apis;arm64-v8a`; AVD `thelight_avd` **boota headless** (`boot_completed=1`) | OK |

Env persistido em `~/.zshrc` (bloco marcado "The Light App"): `JAVA_HOME`,
`ANDROID_HOME`, `ANDROID_SDK_ROOT`, `ANDROID_NDK_HOME`, `PATH` — herdado por sessões
novas do loop. **Smoke test verde (2026-06-30):** `cargo ndk -t arm64-v8a build -p
the-light-app-core` compila a fronteira (com `embedded` → rusqlite SQLite-C +
reqwest) para **Android arm64** em ~24s → o toolchain Android está **provado** para o
core. **Atualização (humano instalou o Xcode):** os **3 alvos** agora têm toolchain
funcional (web, iOS com Xcode 26.6 + simulador iOS 26.5, Android com NDK + emulador
headless). **F0.7 (iOS) e F0.8 (Android) destravadas** — o HALT de toolchains foi
resolvido; o loop pode rodar os alvos nativos com **run real** em simulador/emulador.

---

## ADR-0001 — Stack e fronteira (core Rust + Expo/RN/TS via UniFFI)

- **Data:** 2026-06-29 · **Status:** aceito · **Tarefa:** F0.1

### Contexto
O produto precisa rodar em **Web, iOS e Android** com lógica de domínio bíblica
única (parsing de referência, busca, estudo, IA ancorada) e regra rígida de
**anti-alucinação**: o texto de versículo vem sempre de um store local, o LLM só
interpreta. Reescrever a lógica por plataforma multiplicaria bugs e divergências.

### Decisão
1. **Core em Rust** consumindo `the-light-core` (ver ADR-0002), exposto numa
   crate de fronteira `core/` (`the-light-app-core`), sem reimplementar lógica.
2. **App em Expo / React Native + TypeScript**, alvos Web · iOS · Android, com
   `expo-router`.
3. **Fronteira via UniFFI**, gerando bindings TS com `uniffi-bindgen-react-native`
   (CLI **`ubrn`**, em transição para `uniffi-bindgen-javascript`). Bindings
   ficam em `bindings/` e são **gerados** (não editados à mão; ver `.gitignore`).
4. **Store** (recomendação inicial a confirmar na fase de store):
   - **Nativo (iOS/Android):** `rusqlite` com SQLite **bundled**.
   - **Web:** **`wa-sqlite` + OPFS**, com a mesma interface de store injetada no
     core.
5. **Transporte de IA plugável** (BYOK): `reqwest` no nativo, `fetch` no web,
   atrás de uma abstração `LlmProvider`. Nenhuma chave em git/log; armazenamento
   seguro do dispositivo (Keychain/Keystore; cofre apropriado no web).

### Consequências
- A questão "SQLite no WASM" é o principal risco técnico da Fase 0 e será
  validada antes de qualquer UI.
- Bindings gerados não são versionados (placeholder `bindings/.gitkeep`); a
  geração reprodutível é tarefa da F0.4.
- A versão exata de `ubrn`/`uniffi` é fixada na tarefa que instalar a ferramenta
  (provável F0.2/F0.4), não aqui.

---

## ADR-0002 — Consumo do `the-light` (git dependency pinada por commit)

- **Data:** 2026-06-29 · **Status:** aceito · **Tarefa:** F0.1

### Contexto
A regra é **não modificar nem forkar `the-light`**: ele permanece intacto e a
fronteira nova evolui em `the-light-app`. O crate `core/` precisará depender de
`the-light-core`. Há duas formas usuais de consumir um repositório externo sem
alterá-lo: **git dependency pinada por commit** (Cargo) ou **submódulo git**.

A F0.0 registrou que **ainda não há crate Rust publicado/resolvível** no estado
auditado. O repositório `the-light` existe localmente como diretório irmão
(`../the-light`), porém sua inspeção/leitura é deliberadamente bloqueada por
política (não tocar o core), e a **resolução real** depende de o crate
`the-light-core` existir com um `Cargo.toml` resolvível.

### Decisão
- **Consumir `the-light-core` como git dependency do Cargo, pinada por commit**
  (`{ git = "…/the-light", rev = "<commit>" }`), e **não** como submódulo.
- **Justificativa:**
  - **Reprodutibilidade sem subárvore:** o `rev` fixo dá build determinístico sem
    arrastar a história do core para dentro deste repo (como faria um submódulo).
  - **Atualização explícita e auditável:** subir de versão é trocar um `rev` num
    commit/ADR — fácil de revisar — em vez de `git submodule update`, mais
    propenso a estados inconsistentes/“detached” esquecidos.
  - **Fronteira limpa:** mantém `the-light` 100% intacto e externo; qualquer
    mudança no core, se um dia necessária, é **PR no repo `the-light` + ADR aqui**,
    nunca um fork divergente.
  - **Tooling padrão:** `cargo metadata`/`cargo build` resolvem git deps
    nativamente; CI não precisa de passo extra de submódulo.
- **Trade-off aceito:** git deps por `rev` não permitem editar o core localmente
  com a mesma fluidez de um submódulo. Para desenvolvimento simultâneo do core,
  usa-se um `[patch]` temporário apontando para um checkout local — **sem**
  alterar o core no repositório versionado e **sem** commitar o patch.

### PENDÊNCIA explícita para a F0.2 (não bloqueia a F0.1)
A **resolução real** de `the-light-core` (via `cargo metadata` a partir de um
`core/Cargo.toml`) **não** é exercida na F0.1 — esta tarefa entrega apenas a
estrutura e a decisão. Ela será **exercida na F0.2**, quando o crate `core/`
nascer. No momento da F0.1:

- Não existe `core/Cargo.toml` (guarda de escopo da F0.1; pertence à F0.2).
- O `the-light-core` ainda não foi confirmado como resolvível (F0.0 não achou
  crate Rust; o conteúdo de `../the-light` não pode ser inspecionado por política).

→ **A F0.2 deve:** (1) localizar o commit/`rev` exato e a URL/caminho do repo
`the-light` que expõe `the-light-core`; (2) declarar a git dependency pinada no
`core/Cargo.toml`; (3) provar a resolução com `cargo metadata`. Se nesse momento
o crate ainda não existir/for resolvível, **aí sim** é bloqueio da F0.2 (decisão
humana: publicar/expor o crate no `the-light`), **não** da F0.1.

> **Atualização (F0.2):** a *resolução real* do `the-light-core` (git dep pinada +
> `cargo metadata`) foi **transferida para a F0.3**. A definição autoritativa da
> F0.2 (backlog `PHASE-0.md`) é "crate com UniFFI compilando, **SEM LÓGICA**";
> adicionar a dependência do core já na F0.2 seria escopo da F0.3, onde
> `parse_reference` de fato delega ao `the-light-core::reference`. Por isso a F0.2
> **não** declara `the-light` como dependência — só prova a fronteira UniFFI vazia.

---

## ADR-0003 — Caminho e versão do UniFFI na fronteira `core/`

- **Data:** 2026-06-29 · **Status:** aceito · **Tarefa:** F0.2

### Contexto
A F0.2 cria o crate `core/` (`the-light-app-core`) com **uma** função UniFFI
trivial que apenas compila, fixando o esqueleto da fronteira e o **padrão de
erro**. O UniFFI oferece dois fluxos de scaffolding: (a) **modo *library***
(proc-macros `#[uniffi::export]` + `uniffi::setup_scaffolding!()`, sem `.udl`),
ou (b) **UDL + `build.rs`** (`uniffi::generate_scaffolding`, feature `build`). A
versão exata do crate `uniffi` ficou para ser fixada na instalação (ADR-0001).

### Decisão
- **Caminho UniFFI:** modo *library* / proc-macros, **sem UDL e sem `build.rs`**.
  O `core/src/lib.rs` usa `uniffi::setup_scaffolding!();` + `#[uniffi::export]`.
- **Versão fixada:** `uniffi = "0.31.2"` (sem `*`), última estável no crates.io no
  momento desta tarefa (índice esparso: `0.31.0/0.31.1/0.31.2`). `Cargo.lock`
  (`core/Cargo.lock`) é **versionado** para travar a resolução de forma
  reprodutível.
  - **Nota (F0.6c, 2026-06-30):** esta versão foi **re-alinhada** para o pin
    EXATO `uniffi = "=0.31.0"` por compatibilidade com o **runtime web do `ubrn`
    0.31.0-3** (`uniffi-runtime-javascript` fixa `uniffi_core = "=0.31.0"`): no
    grafo do wasm-crate, `=0.31.2` (fronteira) vs `=0.31.0` (runtime web) sobre o
    mesmo `uniffi_core` eram irreconciliáveis. Mudou só a **versão** (não a forma
    da fronteira); F0.2/F0.3 (build+test) e F0.4 (geração JSI) revalidados verdes
    sob 0.31.0. Ver **ADR-0006**.
- **Erro da fronteira:** enum `CoreError` derivando `thiserror::Error`
  (`thiserror = "2.0.18"`, para `Display`/`std::error::Error`) + `uniffi::Error`.
  Exercitado por `ping_checked(ok: bool) -> Result<String, CoreError>`, que
  constrói a variante de erro e evita `dead_code` sob `clippy -D warnings`.

### Justificativa
- **Menos peças móveis:** sem `.udl` nem `build.rs`, a fronteira é só Rust +
  proc-macros — compila limpo neste ambiente (verificado: `fmt`/`clippy -D
  warnings`/`build`/`test` verdes) e é o fluxo recomendado pelo UniFFI moderno.
- **Compatível com a F0.4:** o gerador de bindings TS
  (`uniffi-bindgen-react-native`/`-javascript`) consome o scaffolding do modo
  library a partir da `cdylib`; já deixamos `crate-type = ["lib","cdylib",
  "staticlib"]`.

### Consequências
- A geração de bindings TS e a instalação do `ubrn` continuam sendo da **F0.4**.
- Subir a versão do `uniffi` é trocar a linha no `core/Cargo.toml` + `Cargo.lock`
  num commit/ADR — auditável.
- A **resolução real do `the-light-core`** permanece transferida para a **F0.3**
  (ver atualização no ADR-0002); a F0.2 não adiciona essa dependência.

---

## ADR-0004 — Geração reprodutível dos bindings TS (`ubrn 0.31.0-3`)

- **Data:** 2026-06-29 · **Status:** aceito · **Tarefa:** F0.4

### Contexto
A ADR-0001 fixou `uniffi-bindgen-react-native` (CLI `ubrn`, em transição para
`uniffi-bindgen-javascript`) como gerador dos bindings TypeScript da fronteira
UniFFI, deixando a **versão exata** para ser fixada na instalação. A F0.0 havia
confirmado o `ubrn` **NÃO INSTALADO**. A VISION §9 marca **risco #1 = maturidade
do `ubrn`** (release inicial) — a mitigação é provar a geração já na Fase 0. A
fronteira do core usa `uniffi = "0.31.2"` (modo *library*, ADR-0003).

### Decisão
- **Ferramenta + versão exata:** `uniffi-bindgen-react-native@0.31.0-3`
  (sem `^`/`~`/`*`), a última publicada no npm (dist-tag `latest`).
- **Mecanismo de instalação:** **devDependency npm**, fixada em
  `package.json` (`"uniffi-bindgen-react-native": "0.31.0-3"`) **e**
  `package-lock.json` (resolução travada). Não via `cargo install`. O pacote npm
  embute o código Rust do CLI; o wrapper `bin/cli.cjs` compila o binário `ubrn`
  sob demanda na **primeira** invocação (`cargo run -p ubrn_cli`, dentro de
  `node_modules/`, ignorado pelo git). Rede em dev/build é permitida (ADR-0001);
  nada de rede entra no código gerado (offline-first é regra de runtime).
- **Invocação (host-only, modo *library*):** `scripts/gen-bindings.sh` faz
  `cargo build --manifest-path core/Cargo.toml` (cdylib do host) e então
  `ubrn generate jsi bindings --library --no-format --ts-dir <ts> --cpp-dir
  <cpp> <cdylib>`, rodando a partir de `core/` (para `cargo metadata` resolver
  `core/Cargo.toml`). NÃO se compila wasm/iOS/Android aqui (isso é F0.6/7/8).
  `--no-format` evita depender de `prettier`/`clang-format`.
- **Config:** `ubrn.config.yaml` (schema `ProjectConfig` do `ubrn_cli`, chaves
  camelCase) é a **fonte da verdade** dos caminhos: `rust.directory: core`,
  `bindings.ts: bindings`, `bindings.cpp: bindings/cpp`. O script extrai daí os
  diretórios de saída. As fases de build móvel reutilizarão este mesmo arquivo.
- **Saída versionada vs. gerada:** os `.ts` (e o C++ JSI em `bindings/cpp/`) são
  **gerados e IGNORADOS** pelo git (`.gitignore` da F0.1: `/bindings/*` +
  `!/bindings/.gitkeep`). Toda a saída fica **sob `bindings/`** — nada vaza para
  fora, então **não** foi preciso estender o `.gitignore`. Versiona-se apenas:
  `scripts/gen-bindings.sh`, `ubrn.config.yaml`, `package.json`,
  `package-lock.json` e este ADR.
- **`tsc --noEmit`: ADIADO.** Não se inclui `tsconfig.json`/`typescript` agora.
  Os `.ts` gerados importam o runtime `@ubjs/core` (do próprio `ubrn`), que só
  será instalado com o app na F0.5. A porta dura da F0.4 é o script rodar limpo
  e popular `bindings/`; o type-check nasce com o app.

### Compatibilidade com `uniffi 0.31.2` (ADR-0003)
- O `ubrn 0.31.0-3` embute `uniffi*/uniffi_bindgen = "=0.31.0"`. O core compila
  com `uniffi 0.31.2`. **Verificado empiricamente:** a geração leu a metadata da
  cdylib `0.31.2` **sem erro de contrato/checksum** e produziu `parseReference`,
  `ping`, `pingChecked`, `Reference`, `VerseRange`, `CoreError`. As releases
  `0.31.x` compartilham o mesmo *contract version*, então o patch diverge sem
  quebrar a metadata. **Não** foi necessário (nem permitido) mudar `uniffi` nem a
  forma da fronteira do core.

### Consequências
- `./scripts/gen-bindings.sh` regenera `bindings/` de forma determinística
  (limpa preservando `.gitkeep`, rebuilda a cdylib, gera os `.ts`), saindo 0.
- Subir o `ubrn` é trocar a versão exata em `package.json` + `package-lock.json`
  num commit/ADR — auditável. Se o pacote for renomeado para
  `uniffi-bindgen-javascript`, troca-se a dependência num novo ADR.
- A F0.5 (app Expo) instalará `@ubjs/core` e poderá adicionar `tsc --noEmit`
  sobre os bindings como validação extra.

---

## ADR-0005 — Fricção SQLite-no-WASM: feature-gating no core + matriz de features por alvo

- **Data:** 2026-06-29 · **Status:** aceito (decisão de direção) · **Tarefa:** F0.6
  (bloqueada → re-escopada em F0.6a/F0.6b) · **Depende de:** PR de habilitação no
  `the-light` (ver `loop/proposals/the-light-PR-feature-gating.md`).

### Contexto
A F0.6 (ligar o core no alvo **web/WASM**) bloqueou no portão decisivo:
`cargo build -p the-light-app-core --target wasm32-unknown-unknown` falha
(`exit 101`) porque o `the-light-core` (rev `0888ac0`, v1.2.0) arrasta
`rusqlite = { features = ["bundled"] }` (SQLite-C) e
`reqwest = { features = ["blocking","json","default-tls"] }`, **ambas
incondicionais**. No alvo wasm, `rusqlite["bundled"]` resolve para
`sqlite-wasm-rs v0.5.5`, cujo build script compila SQLite-C via `cc`/clang e
falha; `reqwest` (blocking + TLS nativo) também não é compatível com
`wasm32-unknown-unknown`. Evidência completa em `loop/done/F0.6.result.md` (e no
arquivo, ver `loop/archive/F0.6.result.md`) e em `loop/HALT`.

**Apuração na fonte do core** (checkout consumido em `~/.cargo/git/checkouts/…/0888ac0`,
leitura permitida — **não** é o `../the-light` bloqueado):

- `crates/the-light-core/Cargo.toml` **não tem `[features]`**; `rusqlite`/`reqwest`
  **não** são `optional`; não há `[target.'cfg(...)']`.
- **Desacoplamento verificado** (chave da viabilidade): `reference.rs` (o parser)
  importa **apenas** `crate::model` + `regex` + `std`; `model.rs` **não** usa
  `rusqlite`/`reqwest`. As deps pesadas vivem só em módulos *separados*:
  - `rusqlite` → `store`, `search`, `xref`, `source/{embedded,mod}`, `scholarly`,
    `ai/lexicon`.
  - `reqwest` → `scholarly`, `ai/research`, `ai/providers`, `source/http`.
- Como o cargo compila o **crate inteiro** e não há feature para opt-out, **nenhuma**
  configuração de consumo (`default-features = false`/seleção de features na git dep)
  exclui `rusqlite`/`reqwest` a partir do `the-light-app`. Excluí-los exige mudar o
  **próprio** core ⇒ PR + ADR (decisão humana). Confirma a fricção #1 da VISION §4.

### Decisão
1. **Habilitação (PR mínimo e não-quebrante ao `the-light`):** tornar as deps
   pesadas **opcionais atrás de features** no `the-light-core`, com defaults ligados
   (CLI/TUI/`xtask` seguem idênticos):
   - `[features] default = ["store", "net"]`; `store = ["dep:rusqlite"]`;
     `net = ["dep:reqwest"]`.
   - `rusqlite`/`reqwest` marcados `optional = true`.
   - `#[cfg(feature = "store")]` / `#[cfg(feature = "net")]` nos `pub mod` pesados
     em `lib.rs` (e nos pontos de uso). `reference`/`model` permanecem **sem** deps
     pesadas, sempre disponíveis. Detalhe completo do diff proposto em
     `loop/proposals/the-light-PR-feature-gating.md`.
2. **Consumo (no `the-light-app`):** após o PR mesclado e o **rev re-pinado**, o
   `core/Cargo.toml` passa a depender com `default-features = false` e **matriz de
   features por alvo**:
   - **web/wasm:** sem features pesadas → só `reference`/`model` → compila p/
     `wasm32-unknown-unknown`.
   - **nativo (iOS/Android):** `features = ["store", "net"]` → capacidade completa.
3. **Seams para o futuro:** `core/src/store_bridge.rs` (store `rusqlite` nativo /
   `wa-sqlite`+OPFS web) e `core/src/transport.rs` (`LlmProvider` `reqwest` nativo /
   `fetch` web), já previstos na seção 1 do `IMPLEMENTATION_PLAN.md`, concretizam o
   store/transporte plugável **quando o web precisar** de store (F0.10) e IA (F2) —
   **não** são necessários para destravar a F0.6 (parse_reference é puro).
4. **Re-escopo da F0.6** (ver `loop/backlog/PHASE-0.md`):
   - **F0.6a** — consumir o core com matriz de features por alvo + compilar a
     fronteira p/ `wasm32-unknown-unknown` (depende do PR mesclado + re-pin).
   - **F0.6b** — bindings web do `ubrn` + glue `app/web/` + ligar a tela + prova
     headless de `parseReference` via wasm.

### Justificativa
- **Cirúrgico e não-quebrante:** features default-on preservam o comportamento atual
  do core; tornar deps `optional` é mudança aditiva. O desacoplamento
  `reference/model` ↔ módulos pesados foi **verificado**, então o gating é mecânico.
- **Alinhado ao design:** mantém **uma fonte da verdade** (parsing continua no Rust),
  **offline-first** (nada de rede no runtime do produto), e realiza o ADR-0001 §4/§5
  e o layout `core/src/{store_bridge,transport}.rs` do plano. Mudança no core pela
  via sancionada (**PR + ADR**, nunca fork silencioso — ADR-0002).
- **Destrava agora e prepara depois:** F0.6 (puro) compila p/ wasm; F0.9/F0.10
  (store) e F2 (IA) ganham os seams corretos.

### Alternativas rejeitadas
- **Compilar o core inteiro p/ wasm** (corrigindo só o clang): ❌ `reqwest`
  blocking+TLS não compila p/ wasm32; e embutir SQLite incha o bundle — contra o
  design (VISION quer `wa-sqlite` no web).
- **`[patch]` nas deps transitivas** (`rusqlite`/`reqwest`): ❌ frágil, não é
  target-scoped, equivale a forkar terceiros.
- **Web como "leitura+IA pré-indexada" apenas:** ❌ não resolve o grafo de compilação
  (parse_reference é puro, mas o crate ainda arrasta as deps).
- **Copiar/reimplementar o parser:** ❌ viola "uma fonte da verdade" (inegociável).

### Consequências / pré-condições
- A F0.6a **não** é elegível até o PR de feature-gating ser **mesclado** no
  `the-light` e o `rev` ser **re-pinado** no `core/Cargo.toml`. Até lá, o
  **`loop/HALT` permanece** (ajustado para refletir este plano). Quem abre/mescla o
  PR é o humano (Renan); o loop não toca o `the-light`.
- Decisão sobre o recorte das features: ver "Implementação" abaixo — adotado
  **um único `embedded`** (não `store`+`net`), por causa do entrelaçamento real.

### Implementação (2026-06-30) — feita no `the-light` (autorizada pelo humano)

O humano autorizou trabalhar diretamente no repositório `the-light` (sign-off do
HALT). A mudança foi implementada e **verificada** num branch:

- **Repo/branch/commit:** `the-light` · `feat/core-wasm-feature-gating` · **`8f66004`**
  (sobre `0888ac0`). Pendente de **push + merge** no GitHub e **re-pin** do rev no
  `the-light-app` (ação humana/coordenada — ver F0.6a).
- **Recorte adotado: UMA feature `embedded` (default-on)**, não `store`+`net`
  separados. Motivo (apurado na fonte do core): as camadas store/net estão
  **entrelaçadas** — `source::SourceError` referencia `rusqlite::Error` e
  `store::StoreError` **estruturalmente**; `scholarly` usa store **e** net;
  `ai` mistura net (`providers`/`research`), store (`lexicon`) e tipos puros
  (`Denomination`/`StudyMode`, usados por `config`). Separar store/net exigiria
  refatorar tipos de erro e criaria estados intermediários frágeis. Um único
  `embedded` (toggle puro↔completo) é mínimo, robusto e **exatamente** o que os
  alvos precisam (web = parser puro; nativo = completo). Era a alternativa já
  registrada neste ADR.
- **O que mudou no core (2 arquivos, aditivo):**
  - `Cargo.toml`: `[features] default = ["embedded"]`; `embedded` ativa
    `rusqlite`/`reqwest`/`directories`/`tempfile`/`toml`/`serde_json`/`chrono`
    (todas marcadas `optional`). Sempre disponíveis (puras/wasm-safe):
    `regex`/`serde`/`thiserror`.
  - `lib.rs`: `model` e `reference` sempre; `ai`/`config`/`export`/`scholarly`/
    `search`/`source`/`store`/`userdata`/`util`/`xref` atrás de
    `#[cfg(feature = "embedded")]`.
- **Verificação (toda verde):** `cargo build`/`test -p the-light-core` (default) —
  **177 testes + 2 doc-tests** passam; `cargo build` (workspace CLI/TUI/xtask) OK;
  `cargo build -p the-light-core --no-default-features --target
  wasm32-unknown-unknown` **OK**; `cargo tree --no-default-features` sem
  `rusqlite`/`reqwest`/SQLite/`directories`/`tempfile`; `clippy` (default e
  `--no-default-features`) e `fmt --check` limpos. **Não-quebrante** confirmado.

### Achado downstream para a F0.6b — uniffi no wasm
Com o core puro destravado, um teste local da fronteira (`the-light-app-core`
consumindo o core com `default-features = false`) para `wasm32-unknown-unknown`
revelou um **segundo obstáculo, no nível do `uniffi`**, independente do SQLite:
`uniffi_core 0.31.2` não compila num `cargo build` cru para
`wasm32-unknown-unknown` (`UniffiCompatibleFuture: … + Send`; wasm é single-thread,
futures não são `Send`). Isso pertence à **F0.6b**, que deve usar o **caminho web
do `ubrn`** (não `cargo build` cru) — possivelmente com uma feature/config do
`uniffi` p/ wasm. Se o caminho web do `ubrn 0.31.0-3` não tratar isso, é `blocked`
legítimo da F0.6b (decisão sobre o caminho web do ubrn), **não** do core.

---

## ADR-0006 — Re-alinhamento do `uniffi` da fronteira para o pin EXATO `=0.31.0` (compat. com o runtime web do `ubrn`)

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F0.6c · **Atualiza:** ADR-0003

### Contexto
A F0.6b (attempt 1, ver `loop/archive/F0.6b.attempt1.result.md`) reprovou no
caminho **web/WASM** do `ubrn`. A causa-raiz é um conflito de **pins exatos** sobre
o mesmo `uniffi_core`, no grafo do wasm-crate gerado pelo `ubrn build web`:

- Nossa fronteira `the-light-app-core` fixava `uniffi = "0.31.2"` (ADR-0003) →
  arrasta `uniffi_core =0.31.2`.
- O runtime web do `ubrn 0.31.0-3`
  (`uniffi-bindgen-react-native/crates/uniffi-runtime-javascript`) fixa
  `uniffi_core = { version = "=0.31.0" }` (a feature `wasm32` encaminha
  `uniffi_core/wasm-unstable-single-threaded`, que resolve o `+Send` do achado
  downstream do ADR-0005 — **não** é o muro).
- Dois pins exatos divergentes (`=0.31.2` vs `=0.31.0`) sobre o **mesmo**
  `uniffi_core` são irreconciliáveis → o `cargo` não resolve o grafo wasm.

### Decisão
- **Fixar `uniffi = "=0.31.0"`** (pin EXATO, sem `^`/`~`/`*`) em `core/Cargo.toml`,
  casando com `uniffi_core =0.31.0` que a toolchain `ubrn 0.31.0-3` já usa nos dois
  caminhos (bindgen `=0.31.0` no host — ADR-0004 — e runtime `=0.31.0` no web).
- `core/Cargo.lock` regenerado (`cargo update -p uniffi --precise 0.31.0`):
  `uniffi`/`uniffi_core`/`uniffi_macros`/`uniffi_bindgen`/`uniffi_meta`/
  `uniffi_pipeline`/`uniffi_udl`/`uniffi_internal_macros` resolvem em **0.31.0**.
- **Só a versão muda.** A *forma* da fronteira (modo *library* /
  `setup_scaffolding!` / `#[uniffi::export]` / `CoreError` / `parse_reference` /
  `crate-type`) permanece intacta — é mudança no nosso `core/`, **não** no
  `the-light` (ADR-0002 preservado).

### Justificativa
- **Patch dentro de `0.31.x`:** `0.31.0`/`0.31.1`/`0.31.2` compartilham o mesmo
  *contract version* do UniFFI; descer um patch não muda a forma da fronteira nem a
  metadata lida pelo bindgen (o ADR-0004 já provou a leitura sem erro de contrato).
- **Alinha os dois caminhos do `ubrn`:** com `=0.31.0`, host (JSI) e web (WASM)
  consomem o mesmo `uniffi_core`, eliminando o conflito de resolução da F0.6b.
- **Baixo risco, reversível:** subir/baixar é trocar a linha + `Cargo.lock` num
  commit/ADR — auditável.

### Revalidação (toda verde sob 0.31.0)
- **Fronteira (F0.2/F0.3), de `core/`:** `cargo fmt --check`,
  `cargo clippy -- -D warnings`, `cargo build`, `cargo test` — limpos; **5 testes**
  passam, incluindo `pt_and_en_resolve_to_same_reference` ("Jo 3.16" == "John 3:16"
  → livro 43, cap. 3, versículo 16) e o mapeamento de erro para `CoreError`. Nenhum
  warning/erro novo de clippy ou compilação introduzido por 0.31.0 (zero ajustes na
  forma da fronteira).
- **JSI/nativo (F0.4):** `./scripts/gen-bindings.sh` sai **0** e repopula
  `bindings/` com `the_light_app_core.ts` + `the_light_app_core-ffi.ts`,
  referenciando `parseReference`/`ping`/`pingChecked`. Sem regressão da F0.4.

### Consequências
- Destrava a **F0.6b (retry)**: o caminho web do `ubrn` deixa de ter pins de
  `uniffi_core` irreconciliáveis. (A validação real do build wasm/glue web continua
  sendo escopo da F0.6b.)
- Rede usada apenas em **dev/build** (download de `uniffi 0.31.0`); nada de rede no
  runtime, nenhum segredo. Os `.ts` gerados seguem **ignorados** (não versionados).
- Versiona-se nesta tarefa: `core/Cargo.toml`, `core/Cargo.lock`, `DECISIONS.md`.

---

## ADR-0007 — Caminho WEB/WASM do `ubrn`: `build web`, config `wasm:`, manifest-patch do wasm-crate e prova headless

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F0.6b · **Depende:** ADR-0005, ADR-0006

### Contexto
A F0.6b fecha o caminho **WEB end-to-end** da ponte Rust→Expo. Com o pin de
`uniffi` alinhado a `=0.31.0` (ADR-0006), o `ubrn build web` (alias `wasm`,
v `0.31.0-3`) passa a poder compilar o wasm. O subcomando faz, em sequência:
(1) `cargo build` do host (`core/`) p/ extrair a metadata UniFFI; (2) gera os `.ts`
web (flavor wasm) + um **wasm-crate wrapper** (`rust_modules/wasm/`) que path-depende
da NOSSA fronteira (pura no wasm32) e do runtime web `uniffi-runtime-javascript`
(feature `wasm32` → `wasm-unstable-single-threaded`, que resolve o `+Send` do
achado do ADR-0005); (3) `cargo build --target wasm32-unknown-unknown` do wasm-crate;
(4) `wasm-bindgen` (CLI) → glue JS/`.wasm`. Três defeitos do template do wasm-crate
e dois fatos do ecossistema precisaram de decisão.

### Decisão
1. **Subcomando e config.** Usa-se `ubrn build web --config ubrn.config.yaml`
   (não `jsi`/nativo, não `cargo build` cru). O `ubrn.config.yaml` ganha o bloco
   top-level **`web:`** (alias de `wasm:`, schema `WasmConfig`): `manifestPath`
   (wasm-crate gerado em `rust_modules/wasm/Cargo.toml`), `manifestPatchFile`,
   `target: web`, `ts: app/web/generated` (destino dos `.ts` + `wasm-bindgen/`) e
   `entrypoint: app/web/generated/index.web.ts` (barrel gerado). Também foi
   necessário adicionar `repository.url` ao `package.json` raiz (o caminho web do
   `ubrn` exige esse campo p/ parsear o `package.json`).

2. **Manifest-patch do wasm-crate** (`wasm-crate.patch.toml`, mesclado via
   `serde_toml_merge` na geração) — corrige defeitos do template do `ubrn`, **sem
   tocar a fronteira**:
   - **(a) `opt-level` inválido:** o template emite `[profile.release] opt-level = "3"`
     (a STRING "3"), rejeitada pelo cargo 1.96 (`must be 0,1,2,3,s or z, but found
     the string`). Sobrescrito p/ `"s"`.
   - **(b) resolver de features v1:** o template gera o wasm-crate como
     `edition = "2018"` com `[workspace]` nu → resolver de features **v1**, que
     IGNORA o gate de alvo `cfg(not(wasm32))` da matriz de features da fronteira
     (ADR-0005) e ATIVA a feature `embedded` mesmo no wasm32 → puxa
     `rusqlite → sqlite-wasm-rs` (C/musl), que o clang não compila p/ wasm32
     (`No available targets are compatible with triple wasm32-unknown-unknown`).
     Opt-in explícito **`[workspace] resolver = "2"`** faz o cargo respeitar o gate
     e PODAR `embedded`/sqlite no wasm32. (É a feature-matriz do ADR-0005
     funcionando — bastou o wrapper gerado optar pelo resolver v2.)
   - **(c) `wasm-bindgen` NÃO é pinado no patch — de propósito.** O grafo de
     RESOLUÇÃO do cargo (lockfile é agnóstico de alvo) inclui, via a dep
     `cfg(not(wasm32))` em `the-light-core[embedded]`, a cadeia
     `rusqlite → sqlite-wasm-rs → js-sys`, e `js-sys` fixa `wasm-bindgen` em
     **lock-step** (hoje `=0.2.126`). Esses crates NÃO são COMPILADOS no wasm32
     (resolver v2), mas ENTRAM na seleção de versão. Pinar `wasm-bindgen` colidiria
     com o pin do `js-sys`. Mantém-se o `wasm-bindgen = "*"` do template.

3. **CLI `wasm-bindgen` em lock-step com o crate.** A versão do binário
   `wasm-bindgen` precisa BATER exatamente com a do crate (senão aborta por
   mismatch de schema). Como (c) deixa a versão emergir da resolução, o
   `scripts/gen-bindings-web.sh` **lê a versão de `wasm-bindgen` do `Cargo.lock`
   gerado** e instala `wasm-bindgen-cli` NESSA mesma versão (`cargo install
   --version <lock>`), de forma honesta e robusta a drift do registro. Por isso o
   script roda `ubrn build web --no-wasm-pack` (só gera) e executa os passos
   wasm32 + `wasm-bindgen` ele mesmo (controle total da ordem/versão).

4. **Alvo `wasm-bindgen = web` + prova headless por instanciação manual.** O alvo
   é **`web`** (ESM) — o que o Metro/Expo consome. O `web` não auto-carrega o
   `.wasm` (espera `fetch`), mas seu `init` aceita `{ module_or_path: <bytes> }`;
   logo a **prova headless** (`app/web/__tests__/parseReference.web.test.mjs`)
   roda em **node sem browser**: empacota o binding gerado com `esbuild`, lê os
   bytes de `index_bg.wasm`, instancia via `init({module_or_path: bytes})`, roda
   `mod.initialize()` (confere contrato/checksums) e chama `parseReference`. Prova
   que `"Jo 3.16"` (PT) e `"John 3:16"` (EN) resolvem AMBOS p/
   `book=43, chapter=3, verses=Single{verse:16}` — **pelo Rust**, sem eco/stub/TS.

5. **Metro e `.wasm`.** `app/metro.config.js` registra `.wasm` em
   `resolver.assetExts` (o barrel faz `import wasmPath from '…/index_bg.wasm'`). O
   `expo export --platform web` empacota o `.wasm` como **asset local** (servido
   pela própria origem do app) — offline-first preservado; single-thread, sem
   necessidade de `SharedArrayBuffer`/COOP-COEP.

### Consequências
- **Caminho web fecha de ponta a ponta:** `gen-bindings-web.sh` sai 0; prova
  headless verde (PT==EN); tela web (`app/app/index.tsx`) exibe a referência
  resolvida pelo Rust via glue `app/web/reference.web.ts`; `expo export --platform
  web` sai 0 com o `.wasm` em `dist/assets/.../index_bg.<hash>.wasm`.
- **Sem tocar a fronteira nem o `the-light`:** os ajustes vivem só no
  `the-light-app` (config do `ubrn`, patch do wasm-crate GERADO, glue, app). A
  matriz de features do core (ADR-0005) permaneceu correta — o resolver v2 do
  wrapper a faz valer no wasm32.
- **Gerados IGNORADOS:** `rust_modules/` e `app/web/generated/` no `.gitignore`.
  Versiona-se: `ubrn.config.yaml`, `wasm-crate.patch.toml`,
  `scripts/gen-bindings-web.sh`, `app/web/reference.{ts,web.ts}`,
  `app/web/__tests__/*`, `app/metro.config.js`, `app/app/index.tsx`,
  `app/package.json`(+lock, deps `@ubjs/core` e `esbuild`), `package.json`
  (`repository`), `DECISIONS.md`.
- **Rede só em dev/build** (instalar `wasm-bindgen-cli`/`@ubjs/core`/`esbuild`,
  resolver deps de cargo/npm). Nenhuma rede no runtime; nenhum segredo.
- **Risco a observar:** a versão de `wasm-bindgen` segue o `js-sys` que entra pela
  cadeia `embedded`/sqlite (presente só na RESOLUÇÃO). Se um dia a fronteira parar
  de declarar a dep `cfg(not(wasm32))` `embedded`, a versão de `wasm-bindgen`
  passará a ser ditada só pelo runtime web (`^0.2.97`); o script continua correto
  (lê do lock). A instanciação manual da prova depende do alvo `web` aceitar bytes
  no `init` — contrato estável do `wasm-bindgen`.

---

## ADR-0008 — Caminho iOS NATIVO do `ubrn`: `build ios`, config `ios:`/`turboModule:`, integração Expo (prebuild + autolink + New Arch codegen) e prova headless no simulador

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F0.7 · **Depende:** ADR-0004, ADR-0005, ADR-0006, ADR-0007

### Contexto
A F0.7 fecha o caminho **iOS NATIVO** end-to-end da ponte Rust→Expo: digitar
`"Jo 3.16"` (PT) / `"John 3:16"` (EN) num app Expo no **simulador iOS** resolve a
referência **pelo Rust** (`the-light-core::reference` via UniFFI → **Turbo Module
JSI** gerado pelo `ubrn 0.31.0-3`), não por wasm nem parsing em TS. O subcomando é
`ubrn build ios` (≠ `generate jsi bindings` host-only da F0.4; ≠ `build web` da
F0.6b). O guia oficial do `ubrn` assume um layout `create-react-native-library`;
**nosso app é Expo** (SDK 56, RN 0.85.3, New Arch), então a integração precisou de
decisões próprias, todas **no `the-light-app`** (core e fronteira intactos).

### Decisão

1. **Subcomando + config.** `ubrn build ios --sim-only --and-generate --config
   ubrn.config.yaml` (encapsulado em `scripts/gen-bindings-ios.sh`): `cargo build`
   p/ `aarch64-apple-ios-sim` → `xcodebuild -create-xcframework` →
   `--and-generate` gera os bindings TS/C++ (em `bindings/`, reusando o bloco
   `bindings:` — ADR-0004) **+** a glue do Turbo Module. O `ubrn.config.yaml`
   ganhou dois blocos novos (`rust:`/`bindings:`/`web:` **intactos**):
   - **`ios:`** (schema `IOsConfig`): `directory: ios`, `frameworkName:
     TheLightAppCoreFramework`, `codegenOutputDir: ios/generated`.
   - **`turboModule:`** (schema `TurboModulesConfig`): `cpp: cpp`, `ts: src`,
     `entrypoint: src/index.tsx`, `name: RNTheLightAppCoreSpec`.

2. **A RAIZ do repo é a "RN turbo-module library".** O `project_root` do `ubrn` é
   a pasta com o `package.json` mais próximo do cwd; como `rust.directory: core` é
   relativo a ele (e os scripts web/host rodam da raiz), o `project_root` **é a
   raiz**. As saídas da glue (`ios/`, `cpp/`, `src/`, `bindings/`) e — em locais
   **não-configuráveis** — a **podspec** (`TheLightAppCore.podspec`) e o
   **xcframework** aterrissam na raiz. Logo, a **raiz** é o "pacote" da library.
   O `package.json` da raiz ganhou `codegenConfig` (`name: RNTheLightAppCoreSpec`,
   `type: modules`, `jsSrcsDir: src`) + `homepage`/`license`/`author` (lidos pela
   podspec). Tudo gerado é **IGNORADO** (`.gitignore`: `/ios/`, `/cpp/`, `/src/`,
   `/TheLightAppCore*.podspec`/`.xcframework`, `/app/ios/`, `/app/web/native-generated/`).

3. **Autolinking no Expo via `app/react-native.config.js`.** A library **não** é um
   node_module publicado; o override `dependencies['the-light-app'].root = '..'`
   aponta o autolinking RN (consumido pelo `use_native_modules!` do Podfile do
   `expo prebuild`) para a raiz. **Verificado:** o
   `expo-modules-autolinking react-native-config` descobre a podspec
   `TheLightAppCore.podspec` (lib) **e** a `uniffi-bindgen-react-native.podspec`
   (runtime C++/JSI, adicionada como dependência normal do `app/`). O **RN New Arch
   codegen** lê o `codegenConfig` da raiz e gera `RNTheLightAppCoreSpec.h`/`…SpecJSI.h`
   (consumidos pela glue Obj-C++/C++ do `ubrn`) durante o `pod install`.

4. **Glue JS copiada p/ dentro de `app/` (resolução local do Metro/tsc).** O barrel
   gerado (`src/index.tsx`, que chama `installRustCrate()` no runtime JSI e
   reexporta os bindings) + os bindings TS importam `@ubjs/core` (em
   `app/node_modules`) e ficam **fora** de `app/`. Resolver cross-root pelo Metro é
   frágil (watchFolders ancestral quebra o file-map). Por isso o
   `gen-bindings-ios.sh` **copia** `src/` + `bindings/*.ts` para
   `app/web/native-generated/` (espelhando a estrutura, p/ o import relativo interno
   do barrel valer), e o glue nativo `app/web/reference.ts` importa
   `./native-generated/src/index`. Assim Metro e `tsc` resolvem tudo dentro do
   `projectRoot` (e `@ubjs/core` em `app/node_modules`), sem hacks de monorepo.
   `reference.web.ts` (wasm, F0.6b) **não** foi tocado — o Metro escolhe por
   extensão (`.web.ts` no web, `.ts` no nativo).

5. **Prova HEADLESS: build Debug + Metro + `simctl log stream`.** O
   `scripts/run-ios-selftest.sh` (determinístico): boota um **iPhone 17** (iOS
   26.5), buida o app (Debug, `iphonesimulator`) via `xcodebuild`, sobe o **Metro**
   em background com `EXPO_PUBLIC_TLA_SELFTEST=1`, instala+lança, captura o log
   unificado (`simctl spawn booted log stream`) e **asserta os DOIS marcadores**
   (sai 0 só se ambos baterem):
   `TLA_SELFTEST PT book=43 chapter=3 verse=16` **e**
   `TLA_SELFTEST EN book=43 chapter=3 verse=16`. O gancho de self-test
   (`app/web/selftest.ts`, disparado por `useEffect` na `HomeScreen` **só** sob o
   env) chama o **mesmo** `parseReference` da tela → Turbo Module → Rust (sem eco,
   sem parser TS). Optou-se por Debug+Metro (em vez de XCTest) por ser o caminho
   canônico "console.log → log do simulador" e provar a UI real do app.

6. **Ferramentas de build instaladas (dev/build, não-runtime):** **CocoaPods
   1.16.2** via Homebrew (Ruby próprio; o Ruby 2.6 do sistema não serve).

### Defeito de ambiente corrigido (configurável, não é muro)
O `xcodebuild` falhava ao **assinar** frameworks embarcados (`codesign`:
`"resource fork, Finder information, or similar detritus not allowed"`). Causa: o
repo está sob `~/Documents`, **gerenciado por file-provider (iCloud)** — todo
arquivo ali recebe xattrs `com.apple.FinderInfo`/`com.apple.fileprovider.fpfs#P`,
que o `codesign` rejeita. **Correção não-invasiva:** o `run-ios-selftest.sh` builda
com `-derivedDataPath` **FORA** do file-provider
(`~/Library/Developer/Xcode/DerivedData/thelight-f07-ios`), produzindo artefatos
limpos. Não toca a fronteira, o core, nem o autolinking.

### Resultado (verde)
- `gen-bindings-ios.sh` sai **0** → xcframework
  (`TheLightAppCoreFramework.xcframework`, staticlib `aarch64-apple-ios-sim` com a
  UniFFI scaffolding; o core arrasta a feature `embedded` → rusqlite SQLite-C +
  reqwest, compila p/ iOS-sim) + glue do Turbo Module + bindings.
- `expo prebuild -p ios` + `pod install` (100 deps, 99 pods) integram a library e o
  runtime; New Arch codegen gera o spec. `xcodebuild` (Debug) **compila e linka** a
  turbo-module C++/Obj-C++ contra os headers New Arch.
- App **roda no iPhone 17** e o `run-ios-selftest.sh` capturou, do log do
  simulador, **ambos** os marcadores PT e EN com `book=43 chapter=3 verse=16` —
  `parse_reference` pelo **Rust nativo** via Turbo Module (PT==EN), sem wasm/TS.
- **Sem regressão web** (F0.6b): `reference.web.ts`, `web:` do `ubrn.config.yaml`,
  `app/web/generated/` intactos. `tsc --noEmit` do `app/` verde. **Core e fronteira
  intactos** (`../the-light` e a forma de `core/` não mudaram).

### Consequências / riscos a observar
- **Versionado:** blocos `ios:`/`turboModule:` no `ubrn.config.yaml`;
  `scripts/gen-bindings-ios.sh`, `scripts/run-ios-selftest.sh`;
  `app/react-native.config.js`; `app/web/reference.ts` (glue nativo),
  `app/web/selftest.ts`; o gancho em `app/app/index.tsx`; `app/app.json`
  (`ios.bundleIdentifier`); `package.json` (raiz: `codegenConfig` + metadados da
  podspec); `app/package.json`(+lock: dep `uniffi-bindgen-react-native`); `.gitignore`.
- **Gerado/IGNORADO:** `ios/`/`cpp/`/`src/`/podspec/xcframework (raiz), `app/ios/`
  (prebuild), `Pods/`, `app/web/native-generated/`, `bindings/`.
- **Offline-first preservado:** rede só em dev/build (CocoaPods/cargo/npm); o
  runtime do self-test é **offline** (referência resolvida localmente no Rust).
  Nenhum segredo em git/log.
- **Risco:** o `-derivedDataPath` fora do file-provider é necessário enquanto o
  repo viver sob `~/Documents` (iCloud). A glue JS é **copiada** (não symlinkada):
  re-rodar `gen-bindings-ios.sh` após mudar a fronteira mantém `app/web/native-generated/`
  em sincronia. A `--sim-only` cobre o simulador; device físico exigirá o alvo
  `aarch64-apple-ios` (já no default de `targets`) + assinatura (fora do escopo F0.7).

---

## ADR-0009 — Caminho ANDROID NATIVO do `ubrn`: `build android`, config `android:`, integração Expo (prebuild + autolink + New Arch codegen) e prova headless no emulador

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F0.8 · **Depende:** ADR-0004, ADR-0005, ADR-0006, ADR-0008

### Contexto
A F0.8 é o **ESPELHO da F0.7 (iOS, ADR-0008)** no alvo **Android NATIVO**: digitar
`"Jo 3.16"` (PT) / `"John 3:16"` (EN) num app Expo no **emulador Android** resolve a
referência **pelo Rust** (`the-light-core::reference` via UniFFI → **Turbo Module
JSI/JNI** gerado pelo `ubrn 0.31.0-3`), não por wasm nem parsing em TS. O **Turbo
Module compartilhado** (spec `NativeTheLightAppCore`, C++/JSI em `cpp/`, TS em
`src/`, bindings em `bindings/`, glue `app/web/reference.ts`/`selftest.ts`,
autolink via `app/react-native.config.js`, `codegenConfig` da raiz) **já existe e
foi provado no iOS**; a F0.8 **só adiciona o caminho de BUILD Android** + a prova no
emulador. O subcomando é `ubrn build android` (≠ `build ios` da F0.7; ≠ `build web`
da F0.6b; ≠ `generate jsi bindings` host-only da F0.4). Tudo **no `the-light-app`**
(core e fronteira intactos — `parse_reference` segue delegando ao core).

### Decisão

1. **Subcomando + config.** `ubrn build android --and-generate --targets
   aarch64-linux-android --config ubrn.config.yaml` (encapsulado em
   `scripts/gen-bindings-android.sh`): p/ cada ABI, `cargo ndk --manifest-path
   core/Cargo.toml --target <abi> --platform 24 -- build` (a fronteira arrasta a
   feature `embedded` — rusqlite SQLite-C + reqwest → **staticlib**, com
   `CARGO_TARGET_<abi>_RUSTFLAGS=-C link-arg=-Wl,-z,max-page-size=16384` p/
   alinhamento de página 16KB do Android 15+) → copia p/
   `android/src/main/jniLibs/<abi>/libthe_light_app_core.a` → `--and-generate` gera
   os bindings TS/C++ (em `bindings/`, reusando ADR-0004) **+** a glue do Turbo
   Module Android. Novo bloco no `ubrn.config.yaml` (`rust:`/`bindings:`/`web:`/
   `ios:`/`turboModule:` **intactos**):
   - **`android:`** (schema `AndroidConfig`): `directory: android`, `jniLibs:
     src/main/jniLibs`, `targets: [arm64-v8a]` (o schema YAML aceita só os nomes
     estilo-Android; o script ainda passa `--targets aarch64-linux-android`, que o
     CLI aceita via `FromStr`), `platform: 24` (RN 0.85 pede ≥24; o default 23 do
     ubrn é p/ RN 0.75), `packageName: com.thelight.core` **explícito** (o default
     deriva do `package.json` e produziria `-` inválido em pacote Java),
     `codegenOutputDir: android/generated`, `useSharedLibrary: false` (staticlib,
     paridade com o iOS — o CMake linka o `.a`).

2. **A RAIZ do repo é a "RN turbo-module library"** (mesma da F0.7). O `ubrn build
   android --and-generate` gera, na raiz, o **módulo Gradle da library** em
   `android/`: `build.gradle` (variante Kotlin, `com.android.library` + plugin
   `com.facebook.react` sob New Arch), `CMakeLists.txt` (linka o staticlib Rust +
   o C++/JSI compartilhado), `cpp-adapter.cpp` (JNI), `src/main/AndroidManifest.xml`,
   e os Kotlin `TheLightAppCoreModule.kt`/`TheLightAppCorePackage.kt` em
   `src/main/java/com/thelight/core/`. Tudo é **GERADO e IGNORADO** (`.gitignore`:
   `/android/`). **Não foi preciso** `android/build.gradle` hand-written: o gerado é
   buildável no nosso Expo após dois patches de template (ver abaixo).

3. **Autolinking no Expo via `app/react-native.config.js`** (o **mesmo** da F0.7,
   `root: '..'`). O `expo-modules-autolinking react-native-config --platform android`
   descobre a library na raiz: `sourceDir: <root>/android`, `packageImportPath:
   import com.thelight.core.TheLightAppCorePackage;`, `packageInstance: new
   TheLightAppCorePackage()`, `libraryName: RNTheLightAppCoreSpec` (do
   `codegenConfig` da raiz), `cmakeListsPath: <root>/android/CMakeLists.txt`. O
   **New Arch codegen** (RN Gradle plugin, agregado no app) gera o spec
   `NativeTheLightAppCoreSpec` que o `TheLightAppCoreModule.kt` estende. O app ganhou
   `app/app.json` `android.package: com.thelight.app` (applicationId) e o build é
   restrito ao ABI da prova com `-PreactNativeArchitectures=arm64-v8a` (só geramos o
   staticlib p/ arm64-v8a).

4. **Glue JS copiada p/ `app/web/native-generated/`** — idêntico ao iOS (ADR-0008):
   o `gen-bindings-android.sh` copia `src/` + `bindings/*.ts` p/ dentro de `app/`,
   onde Metro/tsc resolvem (`@ubjs/core` em `app/node_modules`). É a **mesma** glue JS
   do iOS (Turbo Module compartilhado) — idempotente. `app/web/reference.ts`
   (glue nativo) e `reference.web.ts` (wasm) **não** mudaram; o Metro escolhe por
   extensão (`.ts` no nativo iOS/Android, `.web.ts` no web).

5. **Prova HEADLESS: emulador + Metro + `adb logcat`.** O
   `scripts/run-android-selftest.sh` (determinístico, `trap EXIT`): boota o AVD
   `thelight_avd` **headless** (`-no-window -gpu swiftshader_indirect -no-snapshot
   -no-audio`), aguarda `sys.boot_completed=1`, `gradlew :app:installDebug
   -PreactNativeArchitectures=arm64-v8a`, sobe o **Metro** com
   `EXPO_PUBLIC_TLA_SELFTEST=1` + `adb reverse tcp:8081`, limpa o logcat
   (`adb logcat -c`), lança o app (`am start`) e captura (`adb logcat -s
   ReactNativeJS:V`) — `console.log`/`error` do JS caem na tag `ReactNativeJS`.
   **Asserta os DOIS marcadores** (sai 0 só se ambos baterem):
   `TLA_SELFTEST PT book=43 chapter=3 verse=16` **e**
   `TLA_SELFTEST EN book=43 chapter=3 verse=16`. No fim: força-para o app, mata Metro
   + stream e **desliga o emulador** (`adb emu kill`). O self-test
   (`app/web/selftest.ts`, sob o env) chama o **mesmo** `parseReference` da tela →
   Turbo Module → Rust (sem eco, sem parser TS).

### Defeitos de template corrigidos (configuráveis, não são muro)
O `build android --and-generate` do `ubrn 0.31.0-3` pressupõe o layout
`create-react-native-library`; dois ajustes foram necessários, ambos em arquivos
**GERADOS** (sob `android/`, ignorados) e aplicados **dentro do
`gen-bindings-android.sh`** (reprodutíveis, sem tocar o core/fronteira nem o
`node_modules`):
- **`AndroidManifestNew.xml` ausente.** Sob AGP 8, o `build.gradle` gerado
  (`supportsNamespace()`) define `namespace` E aponta `manifest.srcFile` p/
  `src/main/AndroidManifestNew.xml`, mas o `ubrn` só emite `AndroidManifest.xml` (com
  `package`, que conflita com `namespace`). O script emite o manifest "new" **sem**
  `package` (convenção que o template pressupõe).
- **Resolução do runtime C++ sob Node ≥ 20.** O `CMakeLists.txt` localiza os headers
  do runtime (`uniffi-bindgen-react-native/cpp/includes`) via
  `node -p "require.resolve('uniffi-bindgen-react-native/package.json')"`, mas o
  pacote tem um campo `exports` que **não** expõe `./package.json`; o Node moderno
  (aqui v25) bloqueia o subpath (`ERR_PACKAGE_PATH_NOT_EXPORTED`), deixando
  `UNIFFI_BINDGEN_PATH` **vazio** → include `-I/cpp/includes` inválido → erro de
  compilação `'UniffiCallInvoker.h' file not found`. O script reescreve o comando p/
  resolver o **entrypoint exportado** (`require.resolve('uniffi-bindgen-react-native')`,
  permitido) e subir até a raiz do pacote — saída idêntica
  (`.../package.json`), de onde o `get_filename_component(DIRECTORY)` extrai a raiz.

### Resultado (verde)
- `gen-bindings-android.sh` sai **0** (reproduzível) → staticlib
  `android/src/main/jniLibs/arm64-v8a/libthe_light_app_core.a` + glue do Turbo Module
  (build.gradle/CMake/cpp-adapter/Kotlin) + bindings.
- `expo prebuild -p android` gera `app/android/`; o autolink descobre a library na
  raiz; `gradlew :app:installDebug -PreactNativeArchitectures=arm64-v8a` **compila e
  linka** o C++/JSI (CMake → `libthe-light-app-core.so`, ~34 MB com o staticlib Rust
  embarcado) + a Kotlin TurboModule contra os headers New Arch, e empacota o APK
  (`lib/arm64-v8a/libthe-light-app-core.so` presente).
- App **roda no emulador `thelight_avd`** (headless) e o `run-android-selftest.sh`
  capturou, do `adb logcat`, **ambos** os marcadores PT e EN com
  `book=43 chapter=3 verse=16` — `parse_reference` pelo **Rust nativo** via Turbo
  Module (PT==EN), sem wasm/TS.
- **Sem regressão** web (F0.6b) nem iOS (F0.7): `reference.web.ts`, blocos
  `web:`/`ios:`/`turboModule:` do `ubrn.config.yaml`, scripts iOS e
  `app/web/reference.ts`/`selftest.ts` intactos. `tsc --noEmit` do `app/` verde.
  **Core e fronteira intactos**.

### Consequências / riscos a observar
- **Versionado:** bloco `android:` no `ubrn.config.yaml`;
  `scripts/gen-bindings-android.sh`, `scripts/run-android-selftest.sh`;
  `app/app.json` (`android.package`); `.gitignore` (`/android/`, `/app/android/`,
  `**/build/`, `**/.gradle/`, `local.properties`, glob da podspec). **Nenhum**
  `android/build.gradle` hand-written foi necessário (o gerado basta com os patches
  do script).
- **Gerado/IGNORADO:** `android/` (Gradle/CMake/Kotlin/jniLibs/`.so`/`.a`/generated),
  `app/android/` (prebuild), `**/build/`, `**/.gradle/`, `cpp/`/`src/`/`bindings/`,
  `app/web/native-generated/`.
- **Offline-first preservado:** rede só em dev/build (cargo-ndk/Gradle/npm/Metro); o
  runtime do self-test é **offline** (referência resolvida localmente no Rust).
  Nenhum segredo em git/log (keystore/`local.properties` jamais commitados).
- **Risco:** só o ABI **arm64-v8a** é construído (casa o AVD arm64); device/emulador
  x86_64 ou armeabi exigiriam adicionar o ABI em `android.targets` + `--targets` e
  `-PreactNativeArchitectures`. Os dois patches de template são reaplicados a cada
  `gen-bindings-android.sh` (idempotentes); se o `ubrn` mudar o template, o script
  falha explícito ("linha … não encontrada") em vez de gerar build quebrado.

---

## ADR-0010 — Camada de store NO NATIVO: `get_passage` delega ao `the-light-core`, `sample.sqlite` versionado (KJV domínio público) e gating de **corpo** por alvo

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F0.9 · **Depende:** ADR-0001 (§4 store), ADR-0002 (git dep pinada), ADR-0005 (feature `embedded` + matriz por alvo), ADR-0007 (caminho web do `ubrn`)

### Contexto
A F0.9 prova a **leitura via store no nativo**: expor na fronteira UniFFI um
`get_passage` que lê uma passagem (`"John 3:16"`) de um SQLite pequeno (subset
KJV) **delegando** ao `the-light-core` (`store` + `source`, feature `embedded`,
nativo-only). Regra inegociável: o texto vem **sempre do store local**
(anti-alucinação), verbatim de **domínio público (KJV)**; a fronteira **não**
reimplementa SQL nem parsing.

### API/schema do store consumida (confirmada na fonte do core, leitura)
- `the_light_core::store::Store::open(path) -> Result<Store, StoreError>` — cria/
  abre/**migra** o schema (idempotente; aplica `migrations/v1_initial.sql` +
  `v2_scholarly.sql`, garante FTS5). `store.conn()` dá `&rusqlite::Connection`.
- `the_light_core::source::EmbeddedSource::new(&store)` + trait
  `BibleSource::passage(&Reference, &TranslationId) -> Result<Passage, SourceError>`
  (a trait precisa estar **em escopo** para chamar `.passage`). `passage` consulta
  só `translations` (has_translation) + `verses`.
- `the_light_core::model`: `Passage { reference, verses: Vec<Verse> }`,
  `Verse { reference, text, translation }`, `TranslationId::new("kjv")` (normaliza
  lowercase+trim). `model` é **puro** (sempre disponível, inclusive wasm).
- **Schema** (de `migrations/v1_initial.sql`, **não** escrito à mão):
  `translations(id,abbrev,name,language,license,embeddable)`,
  `books(id,translation_id,number,name,abbrev,testament)`,
  `verses(id,translation_id,book_number,chapter,verse,text)`.

### Decisão
1. **Fronteira (`core/src/lib.rs`):** Records UniFFI `Passage`/`Verse` espelhando
   o `model` do core (com `From<the_light_core::model::…>`), e
   `get_passage(db_path, reference, translation) -> Result<Passage, CoreError>`
   que faz `parse_reference` (delega) → `Store::open` → `EmbeddedSource::passage`
   → adapta tipos/erros. **Sem** SQL/parsing reimplementado.
   - **Ergonomia:** adotado o formulário **explícito de 3 args** (`translation`
     sem default, ex.: `"kjv"`) — sem sobrecarga/segunda função. Mais previsível
     para a UI e trivial de evoluir; um default `kjv` pode ser adicionado depois
     sem quebrar a forma.
2. **`sample.sqlite` → VERSIONADO** em `assets/data/sample.sqlite` (NÃO ignorado),
   subset mínimo KJV: 1 `translations` (`kjv`/KJV/en/`public-domain`/embeddable=1),
   1 `books` (43/John/Jhn/NT), 1 `verses` (43/3/16 + texto KJV verbatim).
   - **Reprodutível:** gerado por `scripts/gen-sample-db.sh` →
     `core/examples/gen_sample_db.rs`, que usa **`Store::open` do core** (schema =
     **uma fonte da verdade**, das migrações; nada de SQL de schema à mão) e insere
     só DML de dado público. O exemplo valida o texto inserido contra a constante
     KJV (guarda anti-typo). Regenerar produz um banco **equivalente em conteúdo**
     (a prova é o teste de leitura, não o byte-diff do arquivo SQLite).
   - **Versionado vs gerado-ignorado:** escolhido **versionar** porque (a) o teste
     de host fica **determinístico** sem passo de geração prévio; (b) o bloco de
     verificação (`test -f assets/data/sample.sqlite`) passa direto; (c) é um asset
     **pequeno** (≈128 KB — o tamanho vem do schema completo do core: FTS5 + tabelas
     v2 scholarly + índices, mesmo com 1 só versículo) e **100% domínio público**,
     então versioná-lo é seguro. O script garante que ninguém precisa confiar num
     "blob misterioso": é regerável a qualquer momento.
3. **Origem/licença do texto:** João 3:16 da **King James Version (KJV)**, **domínio
   público** (sem atribuição obrigatória). Único texto bíblico no repo; nenhum texto
   protegido/não-livre é embarcado.
4. **Gating por alvo = gating de CORPO, não da exportação (achado da F0.9):** a
   exportação `#[uniffi::export] get_passage` (e os Records) é definida em **todos**
   os alvos; **só o corpo que toca `store`/`source`/`rusqlite`** é
   `#[cfg(not(target_arch = "wasm32"))]`. No wasm, `get_passage` é um **stub** que
   retorna `CoreError` ("store web é F0.10: wa-sqlite+OPFS") sem referenciar o
   store — `rusqlite` **não** entra no grafo wasm.
   - **Por quê (regressão evitada):** gatear a *exportação inteira* por
     `cfg(not(wasm32))` **quebra o build web**. O `ubrn build web` extrai a
     metadata UniFFI no **host** (onde a função existe → `embedded` ligado) e gera o
     wrapper wasm referenciando o símbolo `uniffi_…_fn_func_get_passage`; ao compilar
     a fronteira p/ wasm32 com a função ausente, o link falha
     (`undefined symbol: uniffi_the_light_app_core_fn_func_get_passage`). Reproduzido
     na F0.9 e corrigido pelo gating de corpo. A forma da fronteira fica **uniforme**
     entre web e nativo (melhor para os bindings), e o web ganha `getPassage` (stub)
     até a F0.10.

### Prova / verificação (toda verde)
- **Teste Rust de host** (`core/`, `embedded` ligado): `store_tests::
  get_passage_reads_john_3_16_verbatim_from_sample` abre `assets/data/sample.sqlite`
  e assere `verses[0].text == <KJV verbatim>` + `book=43, chapter=3, verse=16`
  (+ testes de erro p/ tradução inexistente e referência inválida). `cargo test`:
  **8 passed**.
- **Qualidade host:** `cargo fmt --check`, `cargo clippy -- -D warnings`,
  `cargo build` — verdes.
- **Sem regressão web (store fora do wasm):** `cargo tree --target
  wasm32-unknown-unknown` **sem** `rusqlite`/`reqwest`; o **build web real**
  (`scripts/gen-bindings-web.sh` → `ubrn build web` + wasm-bindgen) compila a
  fronteira p/ wasm32 (com `get_passage` stub) e o wasm-crate
  (`rust_modules/wasm`) **sem** `rusqlite`/`sqlite`/`reqwest`; `getPassage` aparece
  nos bindings web gerados (consistência de surface).
  - **Nota sobre o passo 4 do bloco de verificação da task:** `cargo build
    --target wasm32-unknown-unknown` **cru** da fronteira **já falhava no HEAD**
    (antes da F0.9), no `uniffi_core` (`UniffiCompatibleFuture: …+Send`; wasm é
    single-thread) — limitação **pré-existente** documentada na ADR-0005/0007. O
    caminho web suportado é o **`ubrn build web`** (não `cargo build` cru), que usa o
    `uniffi-runtime-javascript` (feature wasm32). A regressão real a vigiar é a
    **pureza do grafo** (`cargo tree`, verde) e o **build web do ubrn** (verde).

### Consequências
- **Versionado:** `assets/data/sample.sqlite`, `scripts/gen-sample-db.sh`,
  `core/examples/gen_sample_db.rs`, `core/src/lib.rs` (Records + `get_passage`).
- **Gerado/IGNORADO (inalterado):** `rust_modules/`, `app/web/generated/`,
  `target/`, `bindings/`. O `the-light` permanece **intacto** (consumo pinado
  `rev 8f66004`); a forma da fronteira (modo library; `parse_reference` segue
  delegando) é preservada.
- **Offline-first:** `get_passage` não faz rede — só I/O local em `db_path`. Rede só
  em dev/build (cargo/ubrn). Nenhum segredo em git/log.
- **Escopo:** F0.9 prova a **leitura via store** (teste Rust de host). O **embarque**
  do `sample.sqlite` no app nativo (bundling iOS/Android) e o run nativo
  (`getPassage` via Turbo Module) são fase posterior / verificação adicional. O
  **store web** (`wa-sqlite`+OPFS) é a **F0.10** — `get_passage` no web é stub até lá.

---

## ADR-0011 — Store no alvo web: `wa-sqlite` + OPFS (query em TS)

- **Data:** 2026-06-30 · **Status:** aceito (decisão humana) · **Tarefa:** F0.10

### Contexto
A fricção #1 da VISION (§4, "SQLite no WASM") chega na F0.10. Apuração na fonte do
`the-light-core` (leitura-only, rev `8f66004`): o store é **concreto sobre
`rusqlite::Connection`** — `store::Store { conn: rusqlite::Connection }`,
`source::EmbeddedSource { conn: &rusqlite::Connection }`, e
`EmbeddedSource::passage` roda `SELECT verse,text FROM verses …` direto na
`Connection`. **Não há** trait/abstração de store que aceite uma conexão injetada.
No alvo web, `rusqlite` está fora do grafo por design (feature `embedded` off,
ADR-0005), e o `get_passage` web é hoje um **stub de erro** (F0.9). Provar a leitura
de passagem no web exige escolher como ter SQLite no web.

### Decisão (humano escolheu a Opção A)
**`wa-sqlite` + OPFS no web, com a leitura de passagem em TS** no glue do app — **sem
mudar o `the-light-core`**:
- O glue web abre um banco **`wa-sqlite`** persistido em **OPFS** com o **mesmo
  schema** do `assets/data/sample.sqlite` (gerado pelas migrações do core, F0.9), e
  roda o `SELECT verse,text FROM verses WHERE translation_id=? AND book_number=? AND
  chapter=? AND verse=?` (espelhando `EmbeddedSource::passage`).
- **`parse_reference` continua vindo do Rust (wasm)** — a resolução de referência
  (domínio) permanece uma fonte da verdade. O glue web compõe a `Passage` a partir
  da `Reference` (Rust) + o texto (lido do `wa-sqlite` local).
- **Anti-alucinação preservada:** o **texto do versículo vem do store local**
  (`wa-sqlite`/OPFS), verbatim de domínio público — nunca do LLM/código.

### Justificativa / trade-offs
- **Destrava o web na Fase 0 com baixo atrito**, sem PR ao core nem o difícil
  *bridge* Rust-síncrono ↔ JS-assíncrono (que a Opção B exigiria).
- **"Uma fonte da verdade" do domínio preservada:** parsing/RAG/citação seguem no
  Rust; o `SELECT` de passagem é **infraestrutura**, não lógica de domínio. Aceita-se
  uma leve duplicação (a query de passagem reimplementada em TS para o web).
- **Opções rejeitadas:** **B** (abstrair o store no core via PR) — ideal da VISION e
  future-proof (todo o store no web em Rust: passage+search+xref), mas refator
  substancial do core + sync↔async difícil; fica como evolução futura quando o web
  precisar de **todo** o store em Rust. **C** (pré-indexado sem SQLite) — diverge do
  data-model e não escala p/ Bíblia completa + busca FTS.

### Consequências
- F0.10 (re-escopada): glue `wa-sqlite`+OPFS no web (carregar o `sample.sqlite` em
  OPFS), `getPassage` web em TS lendo o versículo, ligado à tela; prova **headless**
  (node/headless) de que o web resolve João 3:16 com o texto KJV verbatim do store
  local. Artefatos web gerados continuam ignorados.
- Quando o web precisar de **search/xref** (Fase 1+), reavaliar a Opção B (store
  abstraído no core) — registrar novo ADR então.
- O `get_passage` nativo (F0.9, via `the-light-core`) e o web (wa-sqlite) convergem
  na mesma interface de glue (`app/web/reference.*`), com o texto sempre do store
  local em ambos.

---

## ADR-0012 — Implementação do store web (`wa-sqlite` 1.0.0, build sync): empacotamento do `.wasm`, symlink do `sample.sqlite`, OPFS-persistência + leitura em VFS de memória

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F0.10 · **Detalha:** ADR-0011

### Contexto
A ADR-0011 decidiu **Opção A** (`wa-sqlite` + OPFS, query de passagem em TS). A
implementação da F0.10 exigiu sub-decisões concretas de empacotamento (Metro/Expo
web), de carga do sample e do modo de execução do `wa-sqlite` no browser. Todas
vivem **só no `the-light-app`** (core/fronteira intactos).

### Decisão

1. **Lib/versão/build:** `wa-sqlite@1.0.0` (pin EXATO em `app/package.json` +
   `package-lock.json`). Usa-se o build **SYNC** (`wa-sqlite/dist/wa-sqlite.mjs` +
   `wa-sqlite.wasm`) — **sem Asyncify, sem `SharedArrayBuffer`, sem COOP/COEP**.
   Isso evita o gatilho de bloqueio da F0.10 (export web estático não serve
   COOP/COEP) e mantém a paridade entre o browser e a prova node.

2. **Query ISOLADA do VFS (`app/web/sqlite.web.ts`):** `queryPassage(handle,
   translationId, book, chapter, verse)` roda o **SELECT espelhado** de
   `EmbeddedSource::passage` (variante `Single`:
   `SELECT verse, text FROM verses WHERE translation_id=? AND book_number=? AND
   chapter=? AND verse=? ORDER BY verse`). `composePassage`/`readPassage` montam a
   `Passage` (Reference do **Rust** + texto do store). Sem parsing em TS; sem texto
   bíblico no produto.

3. **Empacotamento do `.wasm` e do sample (Metro):** `app/metro.config.js` registra
   `.sqlite` em `assetExts` (já havia `.wasm`, F0.6b). O `wa-sqlite.wasm` (de
   `node_modules`) e o `sample.sqlite` são **assets locais empacotados** (offline-
   first; no `dist/`: `assets/node_modules/wa-sqlite/dist/wa-sqlite.<hash>.wasm` e
   `assets/_assets/data/sample.<hash>.sqlite`). Como o `sample.sqlite` canônico vive
   **fora** do projectRoot (`<repo>/assets/data`, ADR-0010) e o resolver do Metro
   **recusa** imports que "escapam" o projectRoot com `../../` (e não indexa o
   arquivo cross-root no file-map → "Failed to get the SHA-1"), versiona-se um
   **symlink** `app/assets/data/sample.sqlite → ../../../assets/data/sample.sqlite`.
   O symlink mantém o asset **dentro** do projectRoot (Metro empacota sem hack de
   resolução) **preservando a única fonte da verdade** (os bytes vivem só no arquivo
   canônico; verificado: o asset no `dist/` é **byte-idêntico** ao canônico).

4. **Runtime no browser = OPFS-persistência + leitura em VFS de memória
   (`app/web/sqlite-opfs.web.ts`, guard `typeof navigator`):** na 1ª vez, os bytes
   do `sample.sqlite` (asset empacotado) são **persistidos em OPFS**
   (`navigator.storage.getDirectory` + `createWritable`, main-thread); nas próximas,
   lidos do OPFS. A **leitura SQLite** roda num **VFS de memória do `wa-sqlite`
   hidratado** com esses bytes. Motivo: o **VFS OPFS "ao vivo"** do `wa-sqlite` exige
   `FileSystemSyncAccessHandle` (`createSyncAccessHandle`), que só existe em **Web
   Worker** — usar VFS de memória hidratado do OPFS roda na **main thread sem Worker
   e sem `SharedArrayBuffer`**, mantendo: **store local = OPFS**, **leitura via
   `wa-sqlite`**, **texto verbatim do store**. (Um VFS OPFS em Worker é evolução
   futura, fora do escopo de viabilidade da Fase 0.)

5. **Prova HEADLESS honesta (node, `app/web/__tests__/getPassage.web.test.mjs`):**
   instancia `parseReference` via wasm (bytes do `index_bg.wasm`) **+** abre o
   `wa-sqlite` (build sync, bytes do `wa-sqlite.wasm`) sobre um **VFS de memória
   semeado com os BYTES de `assets/data/sample.sqlite`** **+** chama a **MESMA**
   `queryPassage`/`readPassage` de produção. Assere `text == <KJV verbatim>` e
   `book=43, chapter=3, verse=16`. OPFS **não existe em node**; o VFS de memória
   exercita a MESMA query e leitura do mesmo sample que o browser hidrata do OPFS.
   A constante KJV existe **só na asserção** do teste — nunca no produto.

### Consequências
- **Versionado:** `app/web/sqlite.web.ts`, `app/web/sqlite-opfs.web.ts`,
  `app/web/passage.web.ts`, `app/web/passage.ts` (stub nativo),
  `app/web/assets.d.ts` (tipos de import de asset),
  `app/web/__tests__/getPassage.web.test.mjs` + `getPassage-headless-entry.ts`,
  `app/app/index.tsx` (web → `getPassage`), `app/metro.config.js` (`.sqlite`),
  `app/assets/data/sample.sqlite` (**symlink**), `app/package.json`(+lock,
  `wa-sqlite@1.0.0`), `DECISIONS.md`.
- **Gerado/IGNORADO (inalterado):** `app/web/generated/`, `rust_modules/`,
  `dist/`, `node_modules/`. O `the-light` permanece **intacto** (consumo pinado
  `rev 8f66004`); a forma da fronteira (parse_reference no Rust) é preservada — a
  F0.10 vive **só** no glue TS de `app/` (o web **espelha** o SELECT, não consome o
  store do core — ADR-0011).
- **Offline-first:** nenhum recurso de rede externa em runtime (sample + `.wasm`
  são assets locais; a carga em OPFS é fetch da própria origem). Rede só em
  dev/build (npm/cargo/wasm-bindgen). Nenhum segredo em git/log.
- **Verde:** prova headless do store web (texto KJV verbatim + 43/3/16);
  `parseReference` web (F0.6b) e nativo (F0.7/F0.8) e store nativo (F0.9 `cargo
  test`) **sem regressão**; `tsc --noEmit` do `app/` verde; `expo export
  --platform web` **0** com `wa-sqlite` + `sample.sqlite` no bundle.
- **Quando o web precisar de search/xref ou de OPFS "ao vivo"** (Worker), reavaliar
  (Opção B da ADR-0011 / VFS OPFS em Worker) — novo ADR então.

---

## ADR-0013 — Banco bíblico COMPLETO embarcado: gerado pelo `xtask import` canônico (rev pinado `8f66004`) + armazenamento como artefato de build IGNORADO

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.1 · **Depende:** ADR-0002, ADR-0010

### Contexto
A F1.1 sobe do `sample.sqlite` (subset de 1 versículo, ~128 KB, versionado —
ADR-0010) para o **corpus completo embarcado**: duas versões de **domínio
público** — **KJV** (EN, 31.102 versículos) e **Almeida 1911** (PT, 31.101) — com
FTS5. A lógica de download/parse/insert e o registro das fontes livres (`SPECS`)
vivem **só** no member `xtask` do `the-light` (não no `the-light-core` que
consumimos como lib). Por isso o plano manda **rodar o importador canônico**, não
reimplementá-lo (uma fonte da verdade; anti-alucinação). Duas decisões eram
necessárias: **(1) como invocar o `xtask` sem tocar o `the-light`** (ADR-0002:
repo leitura-apenas, consumo via git dep pinada) e **(2) como armazenar** o asset
gerado (binário grande, ~27 MB) sem versionar um blob pesado.

### Decisão

1. **Invocação do `xtask` sem tocar o `the-light` — checkout PINADO do cargo +
   `CARGO_TARGET_DIR` fora.** O `scripts/gen-bible-db.sh` roda o member `xtask` do
   **checkout que o cargo já clonou** do GitHub para resolver a git dep pinada:
   `~/.cargo/git/checkouts/the-light-9eb8809a6d68281a/8f66004/xtask/Cargo.toml`
   (HEAD = `8f6600460c3680a537d2f5df81b6980ed7e630d5` — **mesmo rev** que
   `core/Cargo.toml` consome). Esse checkout é um **clone do `https://github.com/
   butkeraites/the-light`** gerenciado pelo cargo, **independente** do repo local
   protegido `/Users/butkeraites/Documents/the-light` (que **não** é tocado e
   permanece em `8f66004`, working tree limpo — verificado antes/depois).
   - `cargo run --quiet --locked --manifest-path <checkout>/xtask/Cargo.toml --
     import --version kjv,alm1911 --db assets/data/bible.sqlite --seed-dir .cache/seed`.
   - **`CARGO_TARGET_DIR=.cache/xtask-target`** (fora do checkout) → **nenhum**
     artefato de build é escrito no source do `the-light`; **`--locked`** → o
     `Cargo.lock` do checkout **não** é reescrito. Verificado: `git status` do
     checkout inalterado (só o `.cargo-ok` pré-existente).
   - **Subcomando/flags reais confirmados na fonte** (`xtask/src/{main,import}.rs`
     do rev `8f66004`): subcomando `import`; flags `--version <a,b>` (obrigatória),
     `--db <path>`, `--seed-dir <dir>`, `--force`, `--offline`. Versões livres no
     `SPECS`: `kjv` (`expected_verses` 31.102) e `alm1911` (31.101); o importador
     **falha** se < 30.000 e **avisa** se ≠ exato (guarda de drift). O script
     repassa só `--offline`/`--force` (validados); rede em **build** é permitida.

2. **Fontes (domínio público, URLs FIXADAS no `SPECS` do `xtask` — não
   parametrizáveis pelo app):**
   - `kjv` — *King James Version*, licença `public-domain`, formato scrollmapper:
     `https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json`
     (~8,4 MB; baixado: 8.395.929 bytes), **31.102** versículos.
   - `alm1911` — *Almeida 1911*, licença `public-domain`, formato
     thiagobodruk/damarals (segue redirects):
     `https://github.com/damarals/biblias/releases/download/v1.0.0/ALM1911.json`
     (~4 MB; baixado: 4.037.522 bytes), **31.101** versículos.
   - **Anti-alucinação / licenciamento:** o texto vem **sempre** do importador
     sobre essas fontes; **nenhum** texto bíblico hardcoded no app; **nenhuma**
     versão protegida (o `xtask` rejeita ids fora do `SPECS`).

3. **Armazenamento: gerar-por-script + IGNORAR `assets/data/bible.sqlite`.** O
   banco completo (2 versões + FTS5) mede **~27 MB** (medido: 28.012.544 bytes na
   geração fresca; ~31 MB após reimport idempotente, por páginas livres do SQLite
   no delete+reinsert — sem `VACUUM`, que não alteraria as contagens). Versionar um
   binário de dezenas de MB é indesejável (incha história/clone). Decisão: o
   `bible.sqlite` é **artefato de build** (como `bindings/`, `rust_modules/`),
   **gerado pelo `scripts/gen-bible-db.sh`** (a fonte reprodutível) e **IGNORADO**
   no git. O **seed-dir** (`.cache/seed/` — JSON brutos) e o `CARGO_TARGET_DIR`
   (`.cache/xtask-target/`) são **sempre ignorados**. O `.gitignore` ganha alvos
   **específicos** de `bible.sqlite` (+ `-wal`/`-shm`/`-journal`) e `/.cache/` —
   **sem** afetar o `sample.sqlite` ~128 KB, que **permanece VERSIONADO** (ADR-0010).
   O **bundling** do `bible.sqlite` no app nativo/web é fase posterior (F1.13+).

### Alternativas rejeitadas
- **Versionar `bible.sqlite` no git:** ❌ blob de ~27 MB infla o repo a cada
  regeneração; o script + as URLs pinadas já dão reprodutibilidade determinística.
- **Git LFS:** ❌ exige `git lfs` configurado por dev/CI e um remoto LFS; sem ganho
  sobre gerar-por-script enquanto o asset é 100% reconstruível a partir de fontes
  públicas pinadas. (Reavaliar se um dia o asset deixar de ser regenerável.)
- **Reimplementar o importador no app** (parse das fontes): ❌ viola "uma fonte da
  verdade" e o anti-alucinação — o `xtask` é o único que conhece os formatos.
- **Clone efêmero do `the-light` no rev `8f66004`** (alternativa do plano): viável,
  porém re-baixa o source; o checkout do cargo já é o **mesmo rev** e é mais barato.
  Mantida como fallback documentado no script se o checkout do cargo sumir.

### Consequências
- `./scripts/gen-bible-db.sh` (re)gera o `bible.sqlite` de forma **reprodutível** e
  **idempotente** (o `import_translation` do `xtask` apaga+reinsere por versão):
  2ª execução mantém `kjv`=31.102, `alm1911`=31.101, 66 livros/versão, `verses_fts`
  estável (62.203 linhas). FTS5 **acento-insensível** validada (`MATCH 'ceus'` casa
  384 versos com "céus" no `alm1911`, ex.: Gn 1:1).
- **Offline-first preservado:** a **única** rede é em **dev/build** (download dos
  datasets de domínio público para o seed-dir; deps de cargo). O app em **runtime
  não faz rede**. Nenhum segredo em git/log.
- **`the-light` intocado** (ADR-0002): rev `8f66004`, working tree limpo; o `xtask`
  roda do checkout do cargo com target/lock fora do source.
- **Versionado nesta tarefa:** `scripts/gen-bible-db.sh`, `.gitignore` (alvos de
  `bible.sqlite` + `/.cache/`), `DECISIONS.md` (este ADR), `PROGRESS.md`.
  **Gerado/IGNORADO:** `assets/data/bible.sqlite`, `.cache/`.
- **Escopo:** F1.1 entrega **pipeline + banco + validação de contagem**. A leitura
  via fronteira (`list_books`/`get_chapter`/…) é **F1.2**; o bundling do banco no
  app é F1.13+. Não antecipados aqui.

