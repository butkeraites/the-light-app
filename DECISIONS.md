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

---

## ADR-0014 — Bundling do banco no app NATIVO: subset de leitura como **asset** + **cópia p/ caminho gravável** no 1º boot (`expo-asset`/`expo-file-system`), e UI de leitura delegando à fronteira

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.3 · **Depende:** ADR-0010, ADR-0012, ADR-0013

### Contexto
A F1.3 entrega a **primeira UI de leitura NATIVA** (livro → capítulo → texto +
seletor de versão KJV ⇄ Almeida), lendo **do store no device** pela fronteira da
F1.2 (`list_books`/`get_chapter`/`chapter_count`/`list_translations` → Turbo
Module → JSI → `the-light-core`). O **subproblema central** é o **bundling do
banco**: `get_chapter(db_path, …)` (rusqlite, via core) exige um **caminho de
arquivo REAL e GRAVÁVEL** porque (1) no **Android** o asset vive **dentro do APK**
(não há path de arquivo p/ o rusqlite) e (2) `Store::open` roda **migrações
idempotentes** (precisa de **write**). O `bible.sqlite` completo (ADR-0013) mede
**~47 MB** — empacotá-lo inteiro infla o bundle. Era preciso decidir **o que
empacotar** e **como** levá-lo a um caminho gravável.

Observação de fronteira (sem violação): a F1.2 só alterou `core/src/lib.rs` + os
testes Rust; os **bindings nativos gerados** (xcframework + barrel TS em
`app/web/native-generated/`, IGNORADOS) ainda eram da F0.7 (só `parse_reference`).
A F1.3 **regenera** esses artefatos GERADOS via `scripts/gen-bindings-ios.sh`
(`ubrn build ios` rebuilda o staticlib do **mesmo** core pinado `8f66004` +
regenera os bindings) — **sem tocar** `the-light` nem `core/src/lib.rs`. Os
checksums UniFFI dos novos símbolos (`get_chapter`=24118, `list_books`=43013,
`chapter_count`=51215, `list_translations`=61181) batem entre o `.a` e o barrel
(gerados do mesmo build).

### Decisão

1. **Empacotar um SUBSET DE LEITURA, não o banco completo (trade-off de tamanho).**
   Gera-se `assets/data/reading-sample.sqlite` (**~1,8 MB**) com **KJV (en) +
   Almeida 1911 (pt)** dos livros **Gênesis (1)**, **Salmos (19)** e **João (43)** —
   9.746 versículos. **João KJV completo (21 capítulos)** é **obrigatório** p/ as
   asserções do self-test; Gênesis/Salmos dão navegação plausível em AT + NT nas
   duas traduções (o seletor de versão funciona em todos). O **banco completo
   (~47 MB)** fica para uma **otimização posterior** (download/expansão sob demanda
   ou empacotamento seletivo) — fora do escopo da F1.3.
   - **Geração (uma fonte da verdade + anti-alucinação):**
     `core/examples/gen_reading_sample_db.rs` (via `scripts/gen-reading-sample-db.sh`)
     abre o subset com **`Store::open`** (schema = **migrações do core**, nunca SQL
     à mão), **ATTACHa** o `bible.sqlite` e **copia o texto VERBATIM do store**
     (`INSERT … SELECT … WHERE book_number IN (1,19,43)`) — nenhum texto bíblico é
     inventado/hardcodado. Sanidade no próprio gerador: João KJV `max(chapter)==21`
     e João 3:16 == KJV verbatim.
   - **Armazenamento:** como deriva do `bible.sqlite` (ignorado, ADR-0013) e é
     **reprodutível por script**, o `reading-sample.sqlite` é **artefato de build
     IGNORADO** (`.gitignore`: `/assets/data/reading-sample.sqlite` + sidecars).

2. **Asset + resolução pelo Metro.** `app/metro.config.js` trata `sqlite`/`db`
   como **asset binário** (`assetExts`). Um **SYMLINK VERSIONADO**
   `app/assets/data/reading-sample.sqlite` → `../../../assets/data/reading-sample.sqlite`
   mantém o asset **dentro do projectRoot** (padrão do `sample.sqlite`, ADR-0012);
   o symlink é rastreado (a regra do `.gitignore` é **anchorada à raiz**, não casa
   o symlink em `app/`), com **alvo** ignorado/regenerável. `app/lib/db.ts` o
   referencia via `require('../assets/data/reading-sample.sqlite')` (tipado por
   `app/web/assets.d.ts`).

3. **Cópia p/ caminho GRAVÁVEL no 1º boot (`expo-asset` + `expo-file-system`).**
   Adicionados ao `app/package.json` (`expo-asset` `~56.0.17`, `expo-file-system`
   `~56.0.8`; já presentes como deps transitivas — autolinkados no prebuild).
   `app/lib/db.ts::ensureReadingDb()`: resolve o asset
   (`Asset.fromModule(…).downloadAsync()`), **copia** p/
   `FileSystem.documentDirectory + 'reading-sample.sqlite'` **só se ausente**
   (idempotente) e retorna o **caminho de arquivo real** — **removendo o esquema
   `file://`** (o rusqlite abre um path, não uma URI). Usa a **API legacy**
   (`expo-file-system/legacy`: `documentDirectory`/`getInfoAsync`/`copyAsync`),
   estável e suficiente. `app/lib/db.web.ts` é **stub** (não arrasta
   `expo-file-system` nem o asset p/ o bundle web).

4. **Glue de leitura delega à fronteira (sem SQL em TS).** `app/web/reading.ts`
   (nativo) embrulha `listBooks`/`getChapter`/`chapterCount`/`listTranslations` do
   **barrel gerado** (JSI → Rust); `reading.web.ts` é **stub** que lança erro
   explícito (**leitura web = F1.13**). UI em `app/app/read/` (expo-router:
   `index` → `[book]/index` → `[book]/[chapter]`) + componentes
   `app/components/Reader{BookList,ChapterGrid,ChapterView,VersionPicker}.tsx`
   (apresentacionais): a tela exibe **versículos numerados com texto verbatim do
   store**; trocar a versão recarrega o capítulo na outra tradução. `index.tsx`
   ganha o ponto de entrada "Ler a Bíblia" (oculto no web).

5. **Prova de leitura no device — alvo iOS.** `app/web/reading-selftest.ts`
   (par nativo; `.web.ts` = SKIP) roda sob `EXPO_PUBLIC_TLA_SELFTEST=1`: copia/abre
   o banco bundled e chama a fronteira nativa, emitindo o marcador **composto do
   RETORNO REAL** (texto **não** hardcoded):
   `TLA_READ books=66 john3_v16="For God so loved the world…" john_chapters=21`.
   `scripts/run-ios-selftest.sh` amplia o predicado de captura (`TLA_`) e **asserta
   também** `books=66`, o substring `For God so loved the world` e
   `john_chapters=21`, além de PT/EN (sem regressão F0.7). **Alvo da prova: iOS**
   (simulador iPhone 17). Android herda a mesma arquitetura (asset + copy + barrel)
   e fica como prova adicional opcional.

### Trade-off de tamanho (registrado)
- **(a) `bible.sqlite` completo (~47 MB):** prova trivial e cobre toda a Bíblia,
  mas **infla o bundle** (IPA/APK) e a cópia inicial. **Adiado** (otimização).
- **(b) subset de leitura (~1,8 MB) — ESCOLHIDA:** ~26× menor, contém **João KJV
  completo** (asserções) + Gênesis/Salmos (navegação plausível, 2 traduções);
  reprodutível do corpus completo. Custo: cobre **3 livros** (não a Bíblia inteira)
  até a otimização de bundling do corpus completo.
- **(c) gzip + descompactar no 1º boot:** reduz o asset, mas adiciona passo de
  descompressão/erro e mantém 47 MB descomprimidos no device. Desnecessário p/ a
  prova. Reavaliar junto da otimização (a).

### Alternativas rejeitadas
- **Abrir o asset read-only direto do bundle (sem copiar):** ❌ no Android o asset
  não tem path de arquivo (vive no APK) e `Store::open` precisa de **write**
  (migrações) → rusqlite falharia. A cópia p/ `documentDirectory` é necessária.
- **Passar `file://…` ao `get_chapter`:** ❌ o rusqlite espera um **path**; mantemos
  o strip de `file://` no `db.ts`.
- **Reimplementar SELECT/leitura em TS:** ❌ viola "uma fonte da verdade"; toda
  leitura passa pela fronteira (`get_chapter`/…).
- **Nova API do `expo-file-system` (`File`/`Paths`):** preterida pela **legacy**
  (mais simples e estável p/ `documentDirectory`/`copy`); reavaliável depois.
- **Versionar o subset (binário ~1,8 MB):** ❌ é regenerável do `bible.sqlite`;
  ignorado como ele (ADR-0013), com symlink versionado p/ o Metro.

### Consequências
- **Leitura REAL provada no device (iOS):** `TLA_READ books=66`,
  `john3_v16="For God so loved the world…"` (KJV verbatim do store) e
  `john_chapters=21`, capturados por `simctl log`; o script sai **0**. O texto vem
  do **retorno de `get_chapter`** (verificável no código — não hardcoded).
- **Offline-first:** **zero rede em runtime** (asset local + I/O no device). Rede só
  em dev/build (gen scripts, Metro, cargo/pods). Nenhum segredo em git/log.
- **`the-light` e `core/src/lib.rs` INTACTOS** (consumo pinado `8f66004`); só
  artefatos GERADOS (xcframework, barrel, jniLibs) e o subset são (re)gerados.
- **Sem regressão:** parse PT/EN (`TLA_SELFTEST`) intacto; `tsc --noEmit` 0; web
  com stubs (`reading.web.ts`/`db.web.ts`/`reading-selftest.web.ts`) mantém o
  bundle web sem `expo-file-system`/asset do banco (leitura web = F1.13).
- **Versionado nesta tarefa:** `core/examples/gen_reading_sample_db.rs`,
  `scripts/gen-reading-sample-db.sh`, `app/metro.config.js`, `app/package.json`
  (+ lock), `app/lib/db.ts`/`db.web.ts`, `app/web/reading.ts`/`reading.web.ts`/
  `reading-selftest.ts`/`reading-selftest.web.ts`, `app/web/selftest.ts`,
  `app/app/_layout.tsx`/`index.tsx`/`read/**`, `app/components/Reader*.tsx`,
  `app/assets/data/reading-sample.sqlite` (symlink), `scripts/run-ios-selftest.sh`,
  `.gitignore`, `DECISIONS.md`, `PROGRESS.md`. **Gerado/IGNORADO:**
  `assets/data/reading-sample.sqlite`, `app/web/native-generated/`, xcframework,
  `app/ios`/`app/android`, jniLibs.
- **Escopo:** F1.3 entrega **UI nativa + bundling + prova de leitura**. Paridade
  **web** (ler do store no browser) é a **F1.13**; bundling do **corpus completo**
  (otimização de tamanho) é posterior. Não antecipados aqui.

## ADR-0015 — UI de leitura F1.4: **lado a lado** (2× `get_chapter` + alinhamento de apresentação) e **tema claro/escuro** (tokens + `useColorScheme` + override por SESSÃO)

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.4 · **Depende:** ADR-0014

> **Amendment (F5.14 / ADR-0043, 2026-07-03).** A lacuna "persistência entre reinícios fica
> como melhoria futura" (ver alternativa rejeitada abaixo) está **FECHADA**. O override de tema
> agora PERSISTE no KV de prefs OFFLINE da F5.2 (arquivo nativo / localStorage web) sob
> `tla.pref.theme.mode` — REUSANDO a infra existente, **sem** `AsyncStorage`/`expo-secure-store`
> nem qualquer dep nova. Detalhes: **ADR-0043**.

### Contexto
A F1.4 estende a UI de leitura NATIVA da F1.3 com duas capacidades, **sem** tocar
o core/fronteira (`the-light` pinado `8f66004`, `core/src/lib.rs` intacto) e **sem**
reimplementar SQL/leitura/texto em TS:

1. **Múltiplas versões LADO A LADO:** o **mesmo capítulo** em **duas traduções**
   (ex.: KJV en | Almeida 1911 pt), com os versículos **alinhados pelo número**.
2. **Tema claro/escuro:** respeitar `useColorScheme()` do RN **+ um toggle** que
   alterna claro/escuro, migrando os `Reader*` (e a tela do capítulo) de **hex
   hardcoded** para **tokens de tema**.

A decisão registrada aqui é **de UI** (lado a lado = apresentação; tokens de
tema): nenhuma nova função de fronteira, nenhuma dependência nova, nenhuma
persistência em disco.

### Decisão

1. **Lado a lado = DUAS chamadas de `get_chapter` + alinhamento de APRESENTAÇÃO.**
   Nada de função nova no core: a tela `read/[book]/[chapter].tsx`, no modo
   paralelo, chama `getChapter(db, primária, …)` **e** `getChapter(db, secundária,
   …)` (uma por tradução, via `reading.ts` → JSI → Rust) e passa as **duas
   `Passage`** para `app/components/ReaderParallelView.tsx`. Esse componente
   monta a **UNIÃO ORDENADA dos números de versículo** (`Single`) das duas
   passagens e renderiza linhas com duas colunas; se um número existir só em uma
   tradução (o cânon Almeida tem 1 versículo a menos em alguns capítulos), a outra
   coluna mostra um **placeholder atenuado** (`—`). O alinhamento é
   **PRESENTAÇÃO** sobre o retorno da fronteira (números + textos vêm do store),
   **não** um SELECT/parser em TS. `testID` estáveis (`parallel-verse-<n>`).
   Anti-alucinação: o texto continua **verbatim do store** (`get_chapter`), nunca
   gerado na UI.

2. **Toggle "lado a lado" + seletor da 2ª versão.** A tela mantém o
   `ReaderVersionPicker` da F1.3 p/ a versão **primária** e ganha um **toggle**
   (`parallel-toggle`). Quando ativo, exibe um **segundo seletor** (`testIDPrefix`
   `version2`) com as traduções de `listTranslations(db)` **diferentes da
   primária**; um efeito mantém a 2ª seleção **sempre ≠ da 1ª** (auto-ajuste se a
   primária mudar p/ a mesma). O **modo simples** da F1.3 (`ReaderChapterView`)
   permanece o default — **sem regressão**.

3. **Tema = tokens light/dark + `useColorScheme` + override por SESSÃO.**
   `app/lib/theme.ts` define dois conjuntos de **tokens de cor** (`light`/`dark`:
   background, header, texto, versículo, número/`accent`, borda, divisória, chip
   ativo/inativo, idioma, erro) e um `ThemeProvider`/`useTheme()`:
   - **base** = `useColorScheme()` do RN (segue o sistema);
   - **override** opcional por **toggle**, mantido em **estado/contexto na
     SESSÃO** (memória) — **sem persistência em disco** e **sem nova dependência**.
   Os `Reader*` e a tela do capítulo passam a construir estilos via
   `makeStyles(colors)` (memoizado), **removendo os hex literais**. O
   `app/app/_layout.tsx` envolve o `Stack` no `ThemeProvider` e aplica nas telas
   de leitura `headerStyle`/`headerTintColor`/`contentStyle` temáticos + um
   `ThemeToggleButton` (`theme-toggle`) no `headerRight` (toggle **visível**).

4. **Prova determinística — leitura PARALELA no device (iOS).**
   `app/web/reading-selftest.ts` ganha, além do `TLA_READ` da F1.3, um bloco que
   lê `get_chapter(db,'kjv',43,3)` **e** `get_chapter(db,'alm1911',43,3)`, extrai o
   v16 de **cada** e emite o marcador **composto do RETORNO REAL**:
   `TLA_PARALLEL kjv_john3_16="…" alm_john3_16="…"` (ambos via `JSON.stringify`,
   **nunca** hardcoded). `scripts/run-ios-selftest.sh` **asserta também**
   `TLA_PARALLEL` + o substring KJV (`For God so loved the world`) + o substring
   Almeida (`Porque Deus amou o mundo de tal maneira`) — capturados pelo predicado
   `TLA_` existente — além de tudo que a F1.3 já assertava. Sai **0**.

### Alternativas rejeitadas
- **Nova função de fronteira `get_chapters_parallel`/`get_parallel`:** ❌
  desnecessária e violaria "não mexer no core" — o lado a lado é **2 chamadas** de
  `get_chapter` + alinhamento na view. Mudar o core seria **PR + ADR** (ação
  humana), não esta tarefa.
- **Alinhar versículos via SQL/JOIN ou parser em TS:** ❌ viola "uma fonte da
  verdade"/anti-alucinação; o alinhamento é só **apresentação** sobre os números
  (`Single`) que já vêm do `get_chapter`.
- **Persistir o tema em disco (`AsyncStorage`/`expo-secure-store`):** preterido —
  override **por sessão** (contexto) basta p/ a F1.4 e evita **nova dependência**.
  Persistência entre reinícios fica como melhoria futura (sem decisão pendente).
- **`Appearance`/lib de tema externa (ex.: `react-navigation` theming pesado):**
  preterido — `useColorScheme()` + tokens próprios é mínimo, offline e sem dep.
- **Migrar a HomeScreen (`index.tsx`) p/ tokens:** fora do escopo (F1.4 = UI de
  **leitura**); a home permanece como na F0.x. O toggle de tema fica nas telas de
  leitura.

### Consequências
- **Lado a lado provado no device (iOS):**
  `TLA_PARALLEL kjv_john3_16="For God so loved the world…" alm_john3_16="Porque
  Deus amou o mundo de tal maneira…"` capturado por `simctl log`; o script sai
  **0**. **Ambos** os textos vêm do **retorno de `get_chapter`** (verificável no
  código — não hardcoded), em DUAS traduções do MESMO capítulo.
- **Tema:** `Reader*` + tela do capítulo consomem **tokens** (sem hex literais);
  o app respeita o `useColorScheme` e o **toggle** alterna claro/escuro
  **persistindo na sessão**. Prova de tema é por `tsc` + a UI (tokens centralizados).
- **Sem regressão F1.3/F0.x:** `TLA_READ books=66 … john_chapters=21` e
  `TLA_SELFTEST PT/EN` seguem passando; navegação livro→capítulo→texto + seletor de
  versão intactos; `tsc --noEmit` 0; `expo export --platform web` 0 (stubs `.web`
  mantidos — leitura/lado-a-lado web = F1.13).
- **`the-light` e `core/src/lib.rs` INTACTOS** (`8f66004`); **nenhuma** função de
  fronteira nova; **nenhuma** dependência nova; **offline-first** (zero rede em
  runtime).
- **Versionado nesta tarefa:** `app/lib/theme.ts`,
  `app/components/ThemeToggleButton.tsx`, `app/components/ReaderParallelView.tsx`,
  `app/components/Reader{ChapterView,VersionPicker,BookList,ChapterGrid}.tsx`
  (tokens), `app/app/_layout.tsx`, `app/app/read/index.tsx`,
  `app/app/read/[book]/index.tsx`, `app/app/read/[book]/[chapter].tsx`,
  `app/web/reading-selftest.ts`, `scripts/run-ios-selftest.sh`, `DECISIONS.md`.
  **Gerado/IGNORADO** (inalterado): `assets/data/reading-sample.sqlite`,
  `app/web/native-generated/`, `app/ios`/`app/android`, jniLibs.
- **Escopo:** F1.4 entrega **lado a lado + tema no NATIVO**. Paridade **web**
  (leitura/lado-a-lado no browser) é a **F1.13**; persistência do tema entre
  reinícios é melhoria futura. Não antecipados aqui.

---

## ADR-0016 — Referências cruzadas (DADOS): `cross_references` populada pelo `xtask import-xref` canônico (OpenBible.info / TSK, CC-BY) + atribuição obrigatória + armazenamento gerar-ignorado

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.7 · **Depende:** ADR-0002, ADR-0013

### Contexto
A F1.7 popula a tabela **`cross_references`** do `assets/data/bible.sqlite`
(gerado pela F1.1, ADR-0013) com as **referências cruzadas** do **OpenBible.info /
Treasury of Scripture Knowledge (TSK)** (~344.799). Como na F1.1, a lógica de
download/parse/insert vive **só** no member `xtask` do `the-light` (não no
`the-light-core` que consumimos como lib): o subcomando **dedicado**
`import-xref` (≠ `import --xref`), confirmado na fonte do rev pinado `8f66004`
(`xtask/src/main.rs`: `Some("import-xref") => xref_import::run(&args[1..])`;
lógica em `xtask/src/xref_import.rs`). Por isso o plano manda **rodar o
importador canônico**, não reimplementá-lo (uma fonte da verdade;
anti-alucinação). A diferença-chave em relação à F1.1: os xrefs do OpenBible são
**CC-BY** (não domínio público) → exigem **atribuição obrigatória**, registrada
aqui (a exibição visível na UI é da **F1.9**).

### Decisão

1. **Popular `cross_references` rodando `xtask import-xref` do rev pinado `8f66004`
   — sem tocar o `the-light`.** O `scripts/gen-bible-db.sh` (molde da F1.1) foi
   **estendido**: **após** o `import` (verses + FTS), roda o **`import-xref`** no
   **mesmo** `--db assets/data/bible.sqlite` e **mesmo** `--seed-dir .cache/seed`,
   num **pipeline único** (evita o footgun de um banco só-com-xrefs sem versículos):
   - `CARGO_TARGET_DIR=.cache/xtask-target cargo run --quiet --locked
     --manifest-path <checkout 8f66004>/xtask/Cargo.toml -- import-xref
     --db assets/data/bible.sqlite --seed-dir .cache/seed [$EXTRA]`.
   - Mesmo isolamento da ADR-0013: o `xtask` roda do **checkout do cargo** (clone
     do GitHub gerenciado pelo cargo, independente do repo local protegido
     `/Users/butkeraites/Documents/the-light`), com **`CARGO_TARGET_DIR` fora** do
     checkout e **`--locked`** → **nenhum** artefato/lock escrito no source do
     `the-light`. **Verificado:** `the-light` em `8f66004`, working tree **limpo**,
     **sem** `target/` no checkout, antes e depois.
   - **Flags reais confirmadas na fonte** (`xref_import.rs::run`, parser próprio):
     `--db <path>`, `--seed-dir <dir>`, `--force`, `--offline`. **Não há
     `--version`** (xref é independente de tradução; chaveado pela tríade canônica
     `book/chapter/verse`) — o script **não** repassa `--version` ao `import-xref`,
     só `--offline`/`--force` (ambos válidos). Qualquer flag desconhecida → o xtask
     aborta.

2. **Fonte (CC-BY) — URL FIXADA no `xtask`, não parametrizável pelo app.** O
   `XREF_URL` (em `xref_import.rs`) é
   `https://raw.githubusercontent.com/scrollmapper/bible_databases/master/sources/extras/cross_references.txt`
   — TSV plano (`From Verse` OSIS, `To Verse` OSIS único/intervalo, `Votes`),
   espelho **raw** do scrollmapper dos dados **OpenBible.info**. **Atribuição é à
   OpenBible.info, NÃO ao scrollmapper** (o scrollmapper é só o mirror
   git-pinnable; a camada CC-BY votada/compilada é da OpenBible). O xtask
   grava/lê o arquivo em `<seed-dir>/cross_references.txt` (~8,3 MB; baixado:
   **8.293.834 bytes**) e baixa por rede **só** se ausente e **sem** `--offline`.
   - **Anti-alucinação / licenciamento:** os xrefs vêm **sempre** do importador
     canônico sobre essa fonte CC-BY; **nenhum** xref hardcoded/inventado no app;
     **nenhuma** fonte não-livre. Votos **negativos** (refs disputadas) são
     **preservados** verbatim (observados: 1.166 linhas com `votes < 0`); o
     threshold `min_votes` é decisão da fronteira **F1.8**.

3. **Atribuição CC-BY obrigatória (string canônica).** A licença CC-BY exige
   crédito. A **string canônica** a exibir (de `DATA_SOURCES.md` do core) é:
   **`Cross references courtesy of OpenBible.info (CC-BY)`**, com link para
   `https://www.openbible.info/labs/cross-references/`. A tabela
   `cross_references` **não** tem coluna de licença/atribuição (diferente de
   `translations.license`) → a atribuição é registrada **aqui** (ADR-0016) e a
   **exibição visível na UI** é responsabilidade da **F1.9**.

4. **Idempotência.** `import_rows` (no xtask) faz `DELETE FROM cross_references` +
   reinsert em transação → reimportar **não duplica**. **Verificado** rodando o
   script **2×**: a contagem permanece **estável** (`344799`) e João 3:16 estável
   (`23`).

5. **Armazenamento: continua gerar-ignorado (ADR-0013 mantém-se).** O xref só
   **popula** a tabela `cross_references` que já existia (vazia) no `bible.sqlite`
   (mesmo schema v1, aplicado por `Store::open`). O banco cresceu (com xrefs +
   índice `idx_xref_from` já presente): **53.481.472 bytes** (~51 MB) na geração
   fresca; ~59 MB após reimport idempotente, por páginas livres do SQLite no
   DELETE+reinsert (sem `VACUUM`, que não altera as contagens) — mesmo
   comportamento documentado na ADR-0013. O `bible.sqlite` segue **artefato de
   build IGNORADO** e o `seed-dir` (incl. `cross_references.txt`) **sempre
   ignorado** — `.gitignore` já cobre (`assets/data/bible.sqlite*` + `/.cache/`):
   **nenhuma** mudança de `.gitignore` foi necessária (verificado via
   `git check-ignore`). **Não** se versiona o binário.

### Verificação (lendo do banco, não hardcode)
- **Guarda de drift no xtask:** se `parse_tsv` der **< 300.000** linhas válidas, o
  `import-xref` **aborta** (`"apenas N … esperado ~344.799; fonte incompleta?"`).
- **Contagem observada:** `SELECT count(*) FROM cross_references` = **344.799**
  (igual ao esperado — snapshot atual do mirror, sem perdas por OSIS irresolúvel).
- **Sanidade João 3:16:** `from_book=43 AND from_chapter=3 AND from_verse=16` →
  **23** xrefs (top por votos: Rm 5:8 = 871; 1Jo 4:9-10 = 618; Jo 3:15 = 439).
- **Verses intactos:** o `import-xref` toca **só** `cross_references`; `verses`
  permanece com **62.203** linhas (kjv 31.102 + alm1911 31.101). 

### Alternativas rejeitadas
- **Versionar o `bible.sqlite` com os xrefs:** ❌ blob de dezenas de MB; o script +
  URL pinada já dão reprodutibilidade (mesma lógica da ADR-0013).
- **Script `gen-xref.sh` dedicado num `--db` próprio:** ❌ rodar `import-xref` num
  `--db` inexistente criaria um banco **só com xrefs** e **sem** versículos (footgun);
  o pipeline único (`import` → `import-xref` no mesmo `--db`) evita isso.
- **Reimplementar o parser de xref no app (ler o TSV/OSIS em TS/Rust local):** ❌
  viola "uma fonte da verdade"/anti-alucinação — o `xtask` é o único que conhece o
  formato OSIS + a guarda de drift; mudar o core seria **PR + ADR** (ação humana).
- **Filtrar votos negativos / aplicar `min_votes` aqui:** ❌ é decisão da fronteira
  **F1.8**; F1.7 só importa os dados **verbatim** (votos preservados).

### Consequências
- `./scripts/gen-bible-db.sh` (estendido) (re)gera o banco **completo** (verses +
  FTS + xrefs) de forma **reprodutível** e **idempotente**, rodando o `xtask import`
  **e** `xtask import-xref` do rev pinado `8f66004` **sem tocar** o `the-light`.
- **Offline-first preservado:** a **única** rede é em **dev/build** (download do TSV
  de xrefs ~8,3 MB para o seed-dir, **só na 1ª vez**; offline OK a partir da 2ª, com
  o `cross_references.txt` em cache). O app em **runtime não faz rede**. Nenhum
  segredo em git/log.
- **`the-light` intocado** (ADR-0002): rev `8f66004`, working tree limpo; o `xtask`
  roda do checkout do cargo com target/lock fora do source.
- **Versionado nesta tarefa:** `scripts/gen-bible-db.sh` (passo `import-xref`),
  `DECISIONS.md` (este ADR), `PROGRESS.md`. **Gerado/IGNORADO:**
  `assets/data/bible.sqlite` (agora com xrefs), `.cache/seed/cross_references.txt`.
  **`.gitignore` inalterado** (já cobre ambos).
- **Escopo:** F1.7 entrega **só os DADOS** (`cross_references` no `bible.sqlite`). A
  **leitura de xref na fronteira** (`cross_refs`/`for_verse`/`passage_labels`, com o
  threshold `min_votes`) é **F1.8**; a **UI + atribuição CC-BY visível** + a
  propagação dos xrefs ao `reading-sample.sqlite` (bundling) é **F1.9**. Não
  antecipados aqui.

## ADR-0017 — UI de notas/highlights nativa (F1.11): diretório de USERDATA gravável separado do conteúdo público + EXPORT como agregado dos Records (sem reimplementar serialização) + Share nativo

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.11 · **Depende:** ADR-0014 (bundling/`documentDirectory`), ADR-0015 (tema), ADR-0010/0005 (matriz por alvo + anti-alucinação), F1.10 (fronteira `userdata`)

### Contexto
A F1.10 entregou as **7 funções** de userdata na fronteira UniFFI (`put_note`/
`get_note`/`delete_note`/`list_notes`/`add_highlight`/`remove_highlight`/
`list_highlights`) + os Records `Note`/`Highlight`, delegando ao módulo `userdata`
do `the-light-core` (`NoteStore` file-based → `notes/<slug>.md`; `HighlightStore` →
um `highlights.json`). A F1.11 entrega a **UI nativa** ancorada no Reader e a
**persistência no device**, **sem reimplementar** I/O/serialização/slug/ordenação em
TS (uma fonte da verdade; anti-alucinação aplica-se à **referência**, não ao **corpo**
da nota, que é texto livre do usuário). Três subproblemas exigiram decisão: **onde
gravar** (diretório), **como exportar** e **como compartilhar**.

### Decisão

1. **Diretório de USERDATA gravável e SEPARADO do conteúdo público.** O
   `app/lib/userdata.ts` (`ensureUserDataDir()`, molde do `db.ts`) garante
   `${FileSystem.documentDirectory}userdata/` (`makeDirectoryAsync`,
   `intermediates:true`, **idempotente**) e devolve o **caminho real** (sem o esquema
   `file://`, que o `std::fs` do core espera). Esse caminho é o `data_dir` das 7
   funções. É **distinto** do `ensureReadingDb()` (que devolve o
   `reading-sample.sqlite` **só-leitura**, conteúdo de domínio público): nunca se
   passa o banco como `data_dir`. Sob `data_dir`, o **core** cria `notes/` (1 arquivo
   por referência) + o agregado de marcações — formato aberto, base do export. O par
   `app/lib/userdata.web.ts` é um **stub** (notas web = F1.16) que mantém
   `expo-file-system` fora do bundle web.

2. **EXPORT = agregado Markdown montado a partir dos Records (apresentação), não
   serialização do store.** O `app/lib/notesExport.ts` (`buildNotesExport`) é uma
   função **pura** (sem I/O) que recebe os Records de `list_notes`/`list_highlights`
   e produz um Markdown legível (cabeçalho + notas por referência + lista de
   marcações). **NÃO** reescreve os arquivos que o core já produziu no `data_dir`
   (nada de gerar `.md` por nota nem o agregado de marcações à mão) — é só
   apresentação dos Records. Reaproveita o que a fronteira retorna → preserva "uma
   fonte da verdade". Só vaza **dados do próprio usuário** (nenhum texto bíblico,
   nenhum segredo). A **prova é HEADLESS** (self-test `TLA_NOTES … export_ok=true`):
   confere que o exportável BATE com `list_notes`/`list_highlights`, sem abrir o Share
   sheet.

3. **Share nativo via `react-native` `Share` — SEM nova dependência.** O botão
   "Exportar minhas notas" passa o texto do agregado ao `Share.share({ message })` do
   **core do React Native**. **NÃO** foi adicionado `expo-sharing` (a UX de Share de
   texto já é coberta pelo `Share` embutido; evita dependência nova). `package.json`
   **inalterado**.

4. **UI ancorada no Reader, mesmo gesto da F1.9.** Ao selecionar um versículo, abre o
   `ReaderVersePanel` (bottom sheet, molde do `ReaderXrefPanel`) com: editor de
   **nota** (`TextInput` multiline; Salvar→`put_note`, Remover→`delete_note`),
   controles de **marcação** (paleta nomeada `highlightColors.ts`; chip→`add_highlight`,
   Desmarcar→`remove_highlight`), **export** e as **referências cruzadas** (F1.9, com a
   atribuição CC-BY ADR-0016 reusada via `XREF_ATTRIBUTION`). Indicadores por versículo
   (`ReaderChapterView`, props **opcionais** retrocompatíveis): cor de fundo do
   highlight do usuário (distinta da seleção e do realce de busca) + marcador de nota.
   Cores de highlight são **dado do usuário** (paleta própria, não tokens de tema);
   demais cores via `useTheme()` (sem hex hardcoded).

5. **Persistência provada por 2ª leitura independente.** Cada chamada da fronteira
   reabre o store a partir do disco → o self-test (`app/web/notes-selftest.ts`, dir
   ISOLADO `${documentDirectory}userdata-selftest/`, **limpo no início**) faz
   `put_note`→`get_note`/`list_notes`→`add_highlight`→`list_highlights` e depois uma
   **2ª leitura** (`persisted=true` sse reencontra nota+highlight). Emite
   `TLA_NOTES note_ref="John 3:16" note_len=<n> highlights=<m> persisted=true
   export_ok=true` — tudo do **retorno real** (não hardcoded). `run-ios-selftest.sh`
   asserta `note_ref="John 3:16"` + `highlights>=1` + `persisted=true`, **sem
   regressão** de `TLA_SELFTEST` PT/EN, `TLA_READ`, `TLA_PARALLEL`, `TLA_SEARCH`,
   `TLA_XREF`.

### Verificação (do RETORNO da fronteira, não hardcode)
- Bindings nativos **regenerados** (`gen-bindings-ios.sh`, exit 0): as 7 funções +
  tipos `Note`/`Highlight` passam a existir em `app/web/native-generated/bindings/`.
- `tsc --noEmit` (app) **verde**; `expo export --platform web` **exit 0** (glue web de
  userdata = stub que só lança em **runtime**, sem quebrar o bundle).
- Anti-fake: `app/app`/`app/components`/`reading.ts`/`reading.web.ts` **não** contêm
  reimplementação de I/O/serialização de userdata; a escrita passa **sempre** pela
  fronteira (glue delega aos bindings).
- `TLA_NOTES` capturado no simulador com `persisted=true` e `export_ok=true`.

### Alternativas rejeitadas
- **Gravar userdata no `reading-sample.sqlite`:** ❌ é conteúdo público **só-leitura**;
  misturar dado do usuário viola a separação (e o subset é regenerável/descartável).
- **Export reescrevendo `.md`/o agregado de marcações à mão em TS:** ❌ reimplementaria
  a serialização do core (proibido); o `data_dir` que o core produz **já é** o formato
  aberto, e o agregado dos Records é só apresentação.
- **Adicionar `expo-sharing`:** ❌ desnecessário — `Share` do React Native já
  compartilha texto; menos dependência.
- **Paridade web nesta tarefa:** ❌ é a **F1.16** (pós-gate F1.12); aqui o caminho web
  é stub.

### Consequências
- **Offline-first preservado:** userdata é I/O **100% local** (via a fronteira → core);
  export é local/Share sheet. **Zero rede** em runtime; sem segredos em git/log.
- **`the-light` e o core intactos:** rev pinado `8f66004`; `core/src/lib.rs`/
  `core/Cargo.toml` **não** modificados (a F1.10 já entregou as 7 funções; **nenhuma**
  função de fronteira nova). A F1.11 é só app/UI/glue/serviço/self-test/script +
  bindings **gerados-ignorados**.
- **Versionado nesta tarefa:** `app/web/reading.ts` + `reading.web.ts` (glue userdata),
  `app/lib/userdata.ts` + `.web.ts`, `app/lib/notesExport.ts`, `app/lib/highlightColors.ts`,
  `app/components/ReaderVersePanel.tsx`, `app/components/ReaderChapterView.tsx`,
  `app/app/read/[book]/[chapter].tsx`, `app/web/notes-selftest.ts` + `.web.ts`,
  `app/web/selftest.ts`, `scripts/run-ios-selftest.sh`, `DECISIONS.md` (este ADR).
  **Gerado/IGNORADO:** `app/web/native-generated/` (bindings regenerados),
  `app/dist/` (export web), userdata copiado em runtime. `.gitignore` **inalterado**.
- **Marco:** F1.11 é a **última tarefa nativa antes do gate estratégico F1.12** —
  após aceita, o loop **PARA (HALT)** p/ sign-off humano (store web do corpus completo).


## ADR-0018 — Gate F1.12: store WEB do corpus = **Opção A (wa-sqlite + OPFS, espelhando os SELECTs do core em TS)**, começando por **A1 (paridade com o subset ~4,4 MB)**

- **Data:** 2026-06-30 · **Status:** aceito (sign-off humano no gate F1.12) · **Tarefa:** F1.12 (gate estratégico) · **Depende:** ADR-0011 (wa-sqlite+OPFS, Opção A da Fase 0), ADR-0012 (build SYNC sem SharedArrayBuffer), ADR-0013 (`bible.sqlite` gerar-ignorado), ADR-0014 (subset `reading-sample.sqlite` bundled), ADR-0010/0005 (matriz por alvo / anti-alucinação) · **Habilita:** F1.13–F1.16 (paridade web)

### Contexto
Toda a Fase 1 **nativa** (F1.1–F1.11) está aceita e verde no device: leitura
(livro→cap→texto, versões lado a lado, tema), busca FTS5, referências cruzadas
(CC-BY OpenBible) e notas/highlights com export/persistência. No **web**, só estão
provados `parseReference` (F0.6b) e `getPassage` de **uma** passagem (F0.10) via
`wa-sqlite@1.0.0` (build SYNC, sem SharedArrayBuffer) + OPFS, **carregando o arquivo
inteiro num MemoryVFS no heap**. As demais funções web (`reading.web.ts`) são
**stubs**. O gate F1.12 decide **como o web entrega leitura + busca (FTS5) + xref +
notas sobre o corpus**, mantendo offline-first / BYOK / anti-alucinação e **sem tocar
o `the-light`**.

Fatos apurados (lidos do repo): `app/assets/data/bible.sqlite` = **~59 MB**
(61.833.216 B; 62.203 versículos KJV+ALM1911, `verses_fts` FTS5, **344.799**
`cross_references`); `reading-sample.sqlite` (subset que o nativo empacota hoje,
ADR-0014) = **~4,4 MB** (Gn/Sl/Jo; 22.413 xrefs). O MemoryVFS provado escala p/
~4,4 MB, **não** p/ ~59 MB sem um VFS-live em Worker/OPFS.

### Decisão
**Opção A — `wa-sqlite` + OPFS, espelhando em TS os mesmos SELECTs que a fronteira do
core executa no nativo.** Reaproveita a F0.10 e a semântica FTS5/xref do próprio
SQLite (sem reimplementar ranqueamento/lógica de domínio); **zero PR ao the-light**.

**Escopo da 1ª entrega = A1:** o web faz **paridade com o subset `reading-sample.sqlite`
(~4,4 MB)** — o MESMO que o nativo empacota hoje — usando o MemoryVFS já provado.
O **corpus completo (~59 MB)** com **VFS-live em Worker + gestão de cota OPFS +
indicador de download** fica como **decisão transversal separada** (vale também p/ o
nativo, que igualmente adia o corpus completo via ADR-0014) — **não** bloqueia a
paridade web.

### Alternativas rejeitadas (neste momento)
- **B — abstrair o store no `the-light-core` (PR + ADR):** fonte única e sem
  duplicação em TS, mas exige **tocar o `the-light`** (refactor pesado + bridge
  sync↔async) — fora do que o loop faz sozinho; reavaliável se o drift TS↔core doer.
- **C — chunking sob demanda (por livro/seção):** menor 1ª carga, mas coerência e
  busca parcial ficam complexas; desnecessário p/ o subset A1.
- **D — compressão/delta do `.sqlite`:** só um **modificador** de A/C p/ reduzir
  download — relevante quando o corpus completo entrar, não na paridade A1.

### Consequências
- **Risco aceito:** o web **espelha** os SELECTs de leitura/busca/xref em TS → risco de
  **drift** vs o SQL do core; mitigação = testes de **paridade** (mesma query, mesmo
  resultado que o nativo) nos self-tests web das F1.13–F1.16, e a regra de **não**
  reimplementar lógica de domínio (ranqueamento/ordenção vêm do SQLite, não de TS).
- **Perf de FTS5 no `wa-sqlite`** a confirmar na F1.14 (busca web) sobre o subset.
- **Anti-alucinação preservada:** texto sempre do store local (subset domínio público;
  xref CC-BY OpenBible com atribuição visível, ADR-0016).
- **Próximo:** o Driver re-escopa/semeia **F1.13** (leitura web) → **F1.14** (busca web)
  → **F1.15** (xref web + atribuição) → **F1.16** (notas web + export) sobre o subset
  A1; o **corpus completo (~59 MB)** vira item de backlog transversal (pós-paridade).
- **`loop/HALT` removido** (motivo do gate resolvido por este sign-off); loop retomado.

## ADR-0019 — Store WEB de LEITURA (A1): espelho TS dos SELECTs de capítulo/`chapter_count`/translations sobre o subset `reading-sample.sqlite` (wa-sqlite/OPFS+MemoryVFS), `listBooks` via wasm, `db.web.ts` sentinela

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.13 · **Depende:** ADR-0018 (Opção A/A1), ADR-0011/0012 (wa-sqlite+OPFS, build SYNC sem SharedArrayBuffer, MemoryVFS), ADR-0014 (subset bundled), ADR-0010/0005 (gating por alvo / anti-alucinação) · **Habilita:** F1.14 (busca web), F1.15 (xref web), F1.16 (notas web)

### Contexto
Decidida a Opção A/A1 (ADR-0018), a F1.13 dá **paridade web de LEITURA** (livro→cap→texto + versões + lado a lado) sobre o **subset `reading-sample.sqlite` (~4,4 MB)** — o MESMO que o nativo empacota (ADR-0014). `app/web/reading.web.ts` era **stub**; as telas `app/app/read/**` são compartilhadas com o nativo (`reading.ts` → Turbo Module → the-light-core). Era preciso espelhar em TS os SELECTs que a fronteira nativa (F1.2) delega ao `EmbeddedSource`, **sem** reimplementar domínio e **sem** tocar o `the-light`/core.

### Decisão
**Espelhar em TS, como pura INFRAESTRUTURA, os SELECTs de leitura do core** (fonte: `the-light-core/src/source/embedded.rs`), abrindo o subset via `wa-sqlite`:
- **`app/web/sqlite-reading.web.ts`** (par de `sqlite.web.ts`, VFS-agnóstico): constantes SQL espelhadas — `CHAPTER_SELECT_WHOLE` (`EmbeddedSource::passage`/`WholeChapter`), `CHAPTER_COUNT_SELECT` (`chapter_count`, NULL→0), `TRANSLATIONS_SELECT` (`translations`, ordem do SQLite), `HAS_TRANSLATION_SELECT` (`has_translation`); funções `queryChapter`/`queryChapterCount`/`queryTranslations`/`hasTranslation` + `composeChapterPassage` (Record `Passage` com referência `WholeChapter`; cada `Verse` com referência `Single` e `text` VERBATIM do store).
- **`app/web/sqlite-reading-opfs.web.ts`** (par de `sqlite-opfs.web.ts`, browser-only): persiste o subset em OPFS (dir `the-light`, arquivo `reading-sample.sqlite`, separado do `sample.sqlite` da F0.10) e lê via **MemoryVFS hidratado** (build SYNC, sem SharedArrayBuffer/COOP-COEP); `openReadingDbWeb()`.
- **`app/web/reading.web.ts`** destubado p/ leitura: `listTranslations`/`getChapter` (checa `has_translation` → tradução ausente lança `versão desconhecida: <id>`, espelhando `SourceError::UnknownTranslation`)/`chapterCount`; `search`/`crossRefs`/userdata **seguem stubs** (F1.14–F1.16).
- **`listBooks()` vem do RUST (wasm)** — `listBooks` dos bindings gerados, SÍNCRONO (não relista os 66 à mão nem lê a tabela `books`). Como o `listBooks` wasm exige init, **`app/web/wasm.web.ts`** pré-aquece o wasm e **`app/app/_layout.tsx`** gateia a stack via `useWasmReady()`; no NATIVO `app/web/wasm.ts` é no-op (`true`), sem regressão.
- **`app/lib/db.web.ts`** deixa de lançar: `ensureReadingDb()` devolve o **sentinela** `'web:reading-sample'` (as telas passam o valor; o glue abre o subset internamente). Sem `expo-file-system`/asset do banco no bundle web.
- **Prova determinística HEADLESS node** (`app/web/__tests__/reading.web.test.mjs` + `reading-headless-entry.ts`, molde F0.10): MemoryVFS sobre os bytes do subset + funções de produção → asserta, do RETORNO REAL: `getChapter('kjv',43,3)` v16 = KJV verbatim; `getChapter('alm1911',43,3)` v16 = Almeida verbatim; João 3 KJV = 36 versículos; `chapterCount('kjv',43)` = 21; `listTranslations` = kjv+alm1911; `listBooks` (wasm) = 66. **Paridade** com `TLA_READ`/`TLA_PARALLEL` do nativo.

### Alternativas rejeitadas
- **Reimplementar `listBooks` (66) ou ler a tabela `books` em TS:** duplicaria o cânon e divergiria do core — o cânon vem do RUST (uma fonte da verdade).
- **`getChapter`/`listTranslations` SÍNCRONOS abrindo o store no construtor:** o OPFS é assíncrono; manter as funções `async` (par do nativo embrulhado em Promise) e abrir/fechar por chamada (o lado a lado = 2× `getChapter`) é coerente com a assinatura compartilhada.
- **Corpus completo (~59 MB) com VFS-live em Worker:** fora de A1 (ADR-0018) — backlog transversal pós-paridade.

### Consequências
- **Drift mitigado:** os SELECTs citam a fonte do core em comentário; a prova de paridade trava os MESMOS valores do nativo. Nenhuma lógica de domínio (cânon/ranqueamento) em TS — só SELECT direto + composição de Records.
- **Anti-alucinação preservada:** o texto vem SEMPRE do store local (subset domínio público), verbatim; constantes de asserção existem só no teste.
- **Offline-first:** `.sqlite` (~4,4 MB) + `wa-sqlite.wasm` empacotados (asset local; `expo export --platform web` os inclui); zero rede em runtime.
- **Sem regressão nativa:** `reading.ts`/`reading-selftest.ts`/`db.ts`/core/fronteira intactos; o gate de `_layout.tsx` é no-op no nativo.

---

## ADR-0020 — Busca WEB (A1, FTS5): `wa-sqlite` rebuilt COM `-DSQLITE_ENABLE_FTS5` (build SYNC, asset local vendored) + espelho TS do SELECT de busca do core (`MATCH`/`bm25`/`highlight`), destubando `search`

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.14 · **Depende:** ADR-0018 (Opção A/A1), ADR-0019 (store WEB de leitura — REUSA `openReadingDbWeb`), ADR-0011/0012 (wa-sqlite+OPFS, build SYNC sem SharedArrayBuffer, MemoryVFS), ADR-0014 (subset bundled), ADR-0010/0005 (gating/anti-alucinação) · **Detalha o artefato wa-sqlite de:** ADR-0012

### Contexto
A F1.14 dá **paridade web de BUSCA** (FTS5) sobre o **subset `reading-sample.sqlite` (~4,4 MB)**, espelhando em TS o SELECT de busca do core (`the-light-core/src/search.rs`, rev pinado `8f66004`) e **destubando** `search` em `app/web/reading.web.ts` (era `throw WEB_SEARCH_MSG`). As telas da F1.6 (`app/app/search` + `ReaderSearchResultItem` + `app/lib/highlight.ts`) passam a funcionar no web só por esse glue.

**RISCO CRÍTICO confirmado (probe honesto, build SYNC em node + MemoryVFS):** o `wa-sqlite@1.0.0` do npm **NÃO compila FTS5** — `CREATE VIRTUAL TABLE … USING fts5` → **`FTS5_FAIL no such module: fts5`** (grep binário dos `.wasm` do `dist/` = 0 ocorrências de `fts5`/`bm25`/`highlight`). Sem FTS5, `verses_fts MATCH`/`bm25(...)`/`highlight(...)` não rodam. O pacote npm só traz `dist/` pré-compilado (sem Makefile/amalgamation); `emcc` ausente no ambiente, **`docker` presente** e rede de dev/build permitida (ADR-0001).

### Decisão
**Habilitar FTS5 no próprio `wa-sqlite` SYNC**, gerando um par `.mjs`+`.wasm` REPRODUZÍVEL a partir da FONTE e **vendorando-o como asset local** (offline-first; **sem** `SharedArrayBuffer`/COOP-COEP), e espelhar o SELECT de busca do core como pura infraestrutura.
- **`scripts/build-wa-sqlite-fts5.sh`** (versionado): roda o Makefile do wa-sqlite dentro do `emscripten/emsdk:3.1.61` (docker), com `make dist/wa-sqlite.mjs WASQLITE_EXTRA_DEFINES="-DSQLITE_ENABLE_FTS5"`. A amalgamação canônica do SQLite (gerada por `configure --enable-all && make sqlite3.c`) JÁ contém o código-fonte do FTS5, **compilado-fora por padrão e ATIVADO** só com a flag — então o build SYNC permanece SYNC (sem Asyncify/JSPI), só adiciona o módulo FTS5. `make` PURO (não `emmake`) para a amalgamação rodar com o `gcc` NATIVO do container (com `emmake`, o `configure` falha em "cannot run C compiled programs").
- **Pino do código-fonte = COMMIT do release npm `1.0.0`** (`514745479b0a4706793efa0a361c10d899166acd`, de `npm view wa-sqlite@1.0.0 gitHead`), **NÃO o tag `v1.0.0`** (mais novo, que renomeou a API JS `registerVFS` → `vfs_register`, incompatível com o `src/sqlite-api.js` do npm que MANTEMOS em `node_modules`). Assim o `.mjs` gerado expõe `registerVFS`, casando a API JS do npm. SQLite vem pinado pelo Makefile do wa-sqlite (`version-3.46.0`).
- **Artefato vendored:** `app/web/vendor/wa-sqlite-fts5/wa-sqlite.{mjs,wasm}` (versionado, NÃO gerar-ignorado — reprodutível pelo script, mas commitado p/ build determinístico/offline). **UM ÚNICO wasm p/ LEITURA E BUSCA:** `app/web/sqlite-reading-opfs.web.ts::openReadingDbWeb` (REUSADO da F1.13) passa a importá-lo; reading **não regride**. A API JS (`wa-sqlite`, `MemoryVFS`) segue do npm.
- **`app/web/sqlite-search.web.ts`** (par de `sqlite-reading.web.ts`, VFS-agnóstico): `SEARCH_SELECT_BASE` espelhando o SELECT do core (`highlight(verses_fts,0,?,?)` + `bm25(verses_fts)` + `verses_fts MATCH ?` + `translation_id` + filtro opcional `book` + `ORDER BY score LIMIT ?`); `buildMatchQuery` (espelho de `build_match_query`: cada termo entre aspas com `"`→`""`, AND implícito, vazio→`null`); `querySearch` (bind na ordem do core: HL_START U+0002, HL_END U+0003, match, translation, [book], limit clamp ≥1); `composeSearchHit` (Record `SearchHit` com `reference` Single, `text` verbatim/LIMPO, `highlighted` com marcadores, `score` BM25); `searchOnHandle` (orquestra: `has_translation` ANTES → ausente lança `versão desconhecida: <id>`; query vazia → `[]`; default limit 20).
- **`app/web/reading.web.ts::search`** destubado: abre o store via `openReadingDbWeb()` e delega a `searchOnHandle`, `finally { close() }`. **Nenhum** ranqueamento/semântica em TS — o índice FTS5, o BM25 e o highlight vivem no SQLite.
- **Prova determinística HEADLESS node** (`app/web/__tests__/search.web.test.mjs` + `search-headless-entry.ts`, molde F1.13): MemoryVFS sobre os bytes do subset + funções de produção + o wasm FTS5 vendored → asserta, do RETORNO REAL: `search("God","kjv",-,1000)` = **646 hits** e **LOCALIZA** João 3:16 (43/3/16, KJV verbatim, `highlighted` com `God`, `text` LIMPO); acento-insensível (`search("ceus","alm1911")` → hit com `céus`); vazio→`[]`; `limit=3`→3; filtro `book=43`→só João; tradução inexistente→lança. **Paridade** com o `TLA_SEARCH` nativo (mesmo SQL/dado, João 3:16 LOCALIZADO no conjunto, não como 1º — o 1º por BM25 é Salmos).

### Alternativas rejeitadas
- **Cair para `LIKE` no web:** diverge do FTS5/`bm25`/`highlight` do nativo (drift de ranking/destaque/acento-insensível) — **proibido sem sign-off**. Não foi necessário: o build FTS5 é viável.
- **`@sqlite.org/sqlite-wasm` (traz FTS5):** exige Worker + COOP-COEP / `SharedArrayBuffer` p/ OPFS ao vivo → conflita com o export web estático offline-first (ADR-0011/0012). Rejeitado.
- **Pinar o tag `v1.0.0`:** API JS incompatível (`vfs_register` vs `registerVFS` do `src/sqlite-api.js` do npm) → `Module.registerVFS is not a function` em runtime. Por isso pinamos o COMMIT do release npm.
- **Build assíncrono (Asyncify/JSPI) do wa-sqlite:** desnecessário (a leitura/busca rodam na main thread via MemoryVFS hidratado, ADR-0012) e mais pesado — mantido o SYNC.

### Consequências
- **FTS5 ATIVO e comprovado:** probe `MATCH`/`bm25`/`highlight` → `FTS5_OK`; a prova headless roda o SELECT real do core (646 hits) — sem o módulo, lançaria "no such module: fts5".
- **Drift mitigado:** o SELECT cita a fonte do core; a prova trava a paridade (João 3:16 no conjunto, acento-insensível, AND, limit, filtro de livro, UnknownTranslation). Ranking/destaque NÃO reimplementados (são do FTS5).
- **Anti-alucinação preservada:** texto/snippet SEMPRE do store local (verbatim); marcadores U+0002/U+0003 só em `highlighted` (a UI os vira estilo via `app/lib/highlight.ts`), nunca em `text`.
- **Offline-first:** `.mjs`+`.wasm` (FTS5) + subset empacotados como assets locais (`expo export --platform web` os inclui; o `.wasm` FTS5 confirmado no bundle); rede só em dev/build (docker/emscripten), zero em runtime; sem SharedArrayBuffer/COOP-COEP.
- **Sem regressão:** leitura web (`reading.web.test.mjs` verde com o wasm novo) e caminho NATIVO de busca (`core/src/lib.rs`/`app/web/reading.ts`/`app/web/search-selftest.ts` intactos; the-light em `8f66004`); `core/` não modificado.
- **Reprodutibilidade:** `scripts/build-wa-sqlite-fts5.sh` pina repo+commit+imagem emsdk+flags; o artefato é versionado p/ build determinístico (o ambiente de build — docker/emsdk — não é exigido no build do app nem em runtime).

---

## ADR-0021 — Xref WEB (A1): espelho TS do SELECT de `xref::for_verse` (votos DESC + `min_votes` + `LIMIT` + Single/Range) sobre o subset, REUSANDO `openReadingDbWeb`, destubando `crossRefs`; atribuição CC-BY (ADR-0016) renderizada no web

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.15 · **Depende:** ADR-0018 (Opção A/A1), ADR-0019 (store WEB de leitura — REUSA `openReadingDbWeb`), ADR-0020 (wa-sqlite vendored — MESMO wasm, sem recarregar o subset), ADR-0016 (atribuição CC-BY OpenBible.info obrigatória), ADR-0011/0012 (wa-sqlite+OPFS, build SYNC sem SharedArrayBuffer, MemoryVFS), ADR-0014 (subset bundled), ADR-0010/0005 (gating por alvo / anti-alucinação)

### Contexto
A F1.15 dá **paridade web de REFERÊNCIAS CRUZADAS (xref)** sobre o **subset `reading-sample.sqlite` (~4,4 MB)** — o MESMO que o nativo empacota (ADR-0014; 22.413 xrefs). `app/web/reading.web.ts::crossRefs` era **stub** (`throw WEB_XREF_MSG`); as telas da F1.9/F1.11 (`app/app/read/[book]/[chapter].tsx` + `ReaderXrefPanel`/`ReaderVersePanel`) são compartilhadas com o nativo (`reading.ts` → Turbo Module → `cross_refs` → `the_light_core::xref::for_verse`). Era preciso espelhar em TS o SELECT que a fronteira nativa (F1.8) delega ao `xref::for_verse`, **sem** reimplementar domínio (ordenação/filtro) e **sem** tocar o `the-light`/core.

### Decisão
**Destubar `crossRefs` espelhando, como pura infraestrutura, o SELECT de `xref::for_verse`** (`the-light-core/src/xref.rs`, rev pinado `8f66004`), REUSANDO o store das F1.13/F1.14 (`openReadingDbWeb` — MESMO wasm, sem recarregar o subset nem criar novo backend OPFS).
- **`app/web/sqlite-xref.web.ts`** (par de `sqlite-search.web.ts`, VFS-agnóstico): `XREF_SELECT` espelhando o SELECT do core (`SELECT to_book, to_chapter, to_verse_start, to_verse_end, votes FROM cross_references WHERE from_book = ? AND from_chapter = ? AND from_verse = ? AND votes >= ? ORDER BY votes DESC, to_book, to_chapter, to_verse_start LIMIT ?` — os tiebreakers `to_book, to_chapter, to_verse_start` fazem PARTE do mirror, anti-drift); `DEFAULT_MIN_VOTES = 1n` e `DEFAULT_LIMIT = 20` (espelham `xref::DEFAULT_*`); `queryCrossRefs` (bind na ordem do core: book/chapter/verse como int; `min_votes`/`limit` como `bind_int64`, com `limit` clampado `Math.max(1, …)` = `limit.clamp(1, i64::MAX)`; `votes` lido via `column_int64` → bigint); `composeCrossRef` (Record `CrossRef` com `reference` Single se `start >= end`, senão Range `{start,end}`, e `votes` bigint — espelha a regra de `xref.rs`); `crossRefsOnHandle` (aplica defaults `?? 1n`/`?? 20`, roda a query, mapeia). A xref é **INDEPENDENTE de tradução** → **SEM** `translation`/`has_translation` (≠ `getChapter`/`search`); versículo sem xref → `[]` (sem throw).
- **`app/web/reading.web.ts::crossRefs`** destubado: abre o store via `openReadingDbWeb()` e delega a `crossRefsOnHandle`, `finally { close() }`. **Nenhuma** ordenação/filtro/semântica em TS — a ordem por votos (com tiebreakers), o corte `votes >= ?` e o clamp do `LIMIT` vivem no SQLite.
- **Atribuição CC-BY (ADR-0016):** a string EXATA `Cross references courtesy of OpenBible.info (CC-BY)` (`XREF_ATTRIBUTION` em `ReaderXrefPanel.tsx`, reusada por `ReaderVersePanel.tsx`) renderiza no web sempre que xrefs aparecem — confirmada NO bundle `expo export --platform web` (componente compartilhado, sem reimplementação).
- **Prova determinística HEADLESS node** (`app/web/__tests__/xref.web.test.mjs` + `xref-headless-entry.ts`, molde F1.14): MemoryVFS sobre os bytes do subset + funções de produção + o wasm vendored → asserta, do RETORNO REAL: `crossRefs(43,3,16)` = **9 xrefs**; **1º por votos DESC = João 3:15** (Single, **439** votos bigint); ≥1 Range (João 11:25-26, 400 votos); versículo sem xref e `minVotes` acima do máximo → `[]` sem throw; `minVotes=400` → exatamente 2; `limit=1`→1 / `limit=3`→3. **Paridade** com o `TLA_XREF` nativo (F1.9: `first_ref="John 3:15" first_votes=439`).

### Alternativas rejeitadas
- **Ordenar/filtrar a xref em TS (`.sort`/`.filter` por votos):** drift do `ORDER BY votes DESC, …` e do `votes >= min_votes` do core — **proibido**. A ordem/corte/clamp vêm do SQLite.
- **Recarregar o subset / novo backend OPFS p/ xref:** desnecessário — o MESMO `openReadingDbWeb` (um único wasm/store p/ leitura+busca+xref, ADR-0019/0020) atende.
- **Checar `has_translation` (como em `getChapter`/`search`):** a tabela `cross_references` é chaveada por `from_*` e independe de tradução — adicionar o filtro divergiria do core.

### Consequências
- **Paridade comprovada:** João 3:15 é o 1º por votos (439), IGUAL ao nativo (`TLA_XREF`); Single vs Range provados (João 11:25-26); defaults/min_votes/limit travados pela prova.
- **Anti-drift/anti-stub:** `XREF_SELECT` cita a fonte do core; sem `.sort`/`.filter` de domínio em TS; `crossRefs` deixou de ser stub (sem `WEB_XREF_MSG`).
- **Anti-alucinação preservada:** xref é só referência+votos do store local (NENHUM texto bíblico); nada hardcoded no produto (constantes só nas asserções do teste); zero rede em runtime.
- **Atribuição CC-BY (ADR-0016) visível no web:** string EXATA no componente compartilhado, confirmada no bundle web.
- **Offline-first:** subset + wasm vendored empacotados como assets locais; sem SharedArrayBuffer/COOP-COEP. **Tipo `votes` i64 → bigint** (binding fiel via `column_int64`/`bind_int64`).
- **Sem regressão:** leitura/busca web (`reading.web.test.mjs`/`search.web.test.mjs` verdes) e caminho NATIVO (`core/src/lib.rs`/`app/web/reading.ts`/selftests nativos intactos; the-light em `8f66004`, working tree limpo); `core/` não modificado.

---

## ADR-0022 — Notas/marcações WEB (A1): I/O de userdata reimplementado em TS sobre OPFS ESPELHANDO o formato em disco do core (`notes/<slug>.md` + `highlights.json`), referência via wasm, export = agregado dos Records; destubando as 7 funções; ÚLTIMA paridade web da Fase 1

- **Data:** 2026-06-30 · **Status:** aceito · **Tarefa:** F1.16 · **Depende:** ADR-0011 (precedente: store/I/O reimplementado em TS como INFRA, não domínio), ADR-0017 (userdata nativo — formato `.md`/`highlights.json`, anti-alucinação NÃO se aplica ao corpo), ADR-0018 (Opção A/A1, subset), ADR-0019/0020/0021 (store/busca/xref web — espelho de infra; sentinela `db.web.ts`), ADR-0010/0005 (gating por alvo / `userdata` é `#[cfg(feature="embedded")]` → fora do wasm)

### Contexto
A F1.16 dá **paridade web de NOTAS/MARCAÇÕES (userdata) + EXPORT**, fechando a leitura offline da Fase 1 no browser. As **7 funções** de userdata em `app/web/reading.web.ts` (`putNote`/`getNote`/`deleteNote`/`listNotes` + `addHighlight`/`removeHighlight`/`listHighlights`) eram **stubs** (`throw WEB_NOTES_MSG`) e `app/lib/userdata.web.ts::ensureUserDataDir()` **lançava** em runtime. O módulo `userdata` do `the-light-core` é **`#[cfg(feature="embedded")]` (nativo-only)** → **NÃO entra no grafo wasm** (ADR-0005/0010) → o web **NÃO pode delegar** a ele (exatamente como leitura/busca/xref, em que o SQL do core foi espelhado em TS como INFRA, ADR-0011/0019/0020/0021).

### Decisão
**Reimplementar o I/O de userdata em TS no web, ESPELHANDO o FORMATO EM DISCO do core** (`the_light_core::userdata::{notes,highlights}`, rev pinado `8f66004`) — **infra de armazenamento, NÃO lógica de domínio**. Persistência em **OPFS** num `data_dir` web **SEPARADO** do conteúdo público só-leitura (`the-light/userdata/`, distinto de `the-light/reading-sample.sqlite`).
- **`app/web/userdata-fs.web.ts`** (VFS-agnóstico, par de `sqlite-xref.web.ts`): interface mínima `UserDataDir` (`readFile`/`writeFile`/`deleteFile`/`listDir`) + as 7 funções `*Fs` sobre ela. Espelha:
  - **Slug de nota** (`notes.rs::slug`): `formatReferenceEn(ref, nameEn).replace(/ /g,'_').replace(/:/g,'.') + '.md'` → `John 3:16`→`John_3.16.md`, Range `Genesis 1:1-3`→`Genesis_1.1-3.md` (`-` preservado), WholeChapter `Psalms 23`→`Psalms_23.md`. `formatReferenceEn` espelha `reference.rs::format_reference(_, Lang::En)` (sep `:`); `nameEn` vem de **`listBooks()` (wasm)**.
  - **`.md`** = só o **corpo verbatim** (sem título/front-matter); `get` devolve o arquivo inteiro como `body`. `list_notes` **ORDENADO** por `(book, chapter, verses.start)`; lê-de-volta o stem por `parseReference(stem.replace(/_/g,' '))` (**WASM**, ignora não-parseáveis). `delete`/`get` idempotentes (ausente → `false`/`undefined`).
  - **`highlights.json`** = array `{ "ref":<EN legível>, "color":<str>, "tag"?:<str> }`, `JSON.stringify(_, null, 2)` (2 espaços, ordem `ref`,`color`,`tag`); **`tag` OMITIDO** quando ausente (espelha `skip_serializing_if`); `ref` = `formatReferenceEn` (SEM `_`/`.`). `add` **substitui** a entrada de MESMA referência (ordem de **INSERÇÃO**); `list` re-analisa cada `ref` por `parseReference` (**WASM**, ignora inválidas) na ordem do array; `remove` devolve a contagem.
- **`app/web/userdata-opfs.web.ts`** (browser-only, molde `sqlite-reading-opfs.web.ts`): `openUserDataWeb()` devolve um `UserDataDir` sobre o OPFS (`navigator.storage.getDirectory` + `getDirectoryHandle`/`getFileHandle`/`createWritable`/`getFile`/`removeEntry`/`entries()`) na **MAIN THREAD** — sem Worker/SyncAccessHandle/SharedArrayBuffer; cria subdiretórios sob demanda (espelha `create_dir_all` do `atomic_write`).
- **`app/web/reading.web.ts`** destubado: cada função resolve a `Reference` por `parseReference` (**WASM**) ANTES do I/O (paridade com `put_note`/`add_highlight`, que parseiam antes de gravar), abre `openUserDataWeb()` e delega ao glue `*Fs`. **Sem `WEB_NOTES_MSG`.**
- **`app/lib/userdata.web.ts::ensureUserDataDir()`** deixa de lançar → devolve o **sentinela** `'web:userdata'` (molde `db.web.ts`), p/ a UI compartilhada (`ReaderVersePanel`) funcionar no web; o `dataDir` é IGNORADO pelas 7 funções (o store abre o OPFS internamente).
- **EXPORT web** reusa `app/lib/notesExport.ts::buildNotesExport` (agregado PURO dos Records — já existe), produzindo o **MESMO** agregado que o nativo (`Share.share` via react-native-web → Web Share API; sem dependência nova). **NÃO** reescreve serialização de domínio.
- **Prova determinística HEADLESS node** (`app/web/__tests__/notes.web.test.mjs` + `notes-headless-entry.ts`, molde F1.15): um `UserDataDir` EM MEMÓRIA (mock do OPFS, mesmo isolamento da F1.13/MemoryVFS — OPFS é browser-only) injetado nas MESMAS funções de produção. Asserta, do RETORNO REAL: `putNote('John 3:16')`/`getNote` round-trip (body verbatim, ref book 43/cap 3/Single 16); o arquivo é EXATAMENTE `notes/John_3.16.md` (**slug == nativo**); `listNotes` ordenado (Genesis(1) antes de John(43)); `highlights.json` = `[{ref:"John 3:16",color:"yellow"}]` (tag omitido, pretty 2sp); re-add MESMA ref substitui (yellow→green, ainda 1); `removeHighlight` 1→0 (idempotente); **PERSISTÊNCIA** num novo handle sobre o mesmo backing store; **EXPORT** agrega rótulo+corpo+cor → emite `WEB_NOTES note_ref="John 3:16" note_len=36 highlights=1 persisted=true export_ok=true` (paralelo ao `TLA_NOTES` nativo da F1.11).

### Alternativas rejeitadas
- **Delegar ao `userdata` do core no web:** impossível — o módulo é `#[cfg(feature="embedded")]`, fora do wasm (ADR-0005/0010).
- **Expor `format_reference` na fronteira `core/src/lib.rs` p/ o web reusar:** mudaria o núcleo/fronteira (só via PR + ADR) — desnecessário: o formato é aberto (`.md` + JSON) e a referência/cânon já vêm do wasm (`parseReference`/`listBooks`). A única "format" em TS é a convenção de nome de arquivo/`ref` (infra, nível de espelhar um `SELECT`).
- **Persistir userdata em `wa-sqlite`/no `reading-sample.sqlite`:** quebraria a paridade/portabilidade de FORMATO (o `.md`/JSON que o web grava o core lê e vice-versa) e misturaria userdata gravável com o conteúdo público só-leitura. Userdata web em `data_dir` OPFS próprio.
- **Reimplementar a serialização do export à mão (gerar `.md`/`highlights.json`):** proibido — o export é o agregado dos Records (`buildNotesExport`), IDÊNTICO ao nativo.
- **OPFS "ao vivo" (SyncAccessHandle):** exige Worker + SharedArrayBuffer/COOP-COEP → conflita com offline-first estático (ADR-0011/0012). APIs OPFS de arquivo inteiro na main thread bastam para userdata.

### Consequências
- **Paridade de FORMATO comprovada (export portável):** slug `John_3.16.md` e o `.md` só-corpo + `highlights.json` `{ref,color,tag?}` (pretty 2sp, tag omitido) que o web grava são os MESMOS do core → o export web é IDÊNTICO ao nativo e os arquivos são interoperáveis nativo↔web. `slug == nativo` e `WEB_NOTES …` provados pela prova headless (paralelo ao `TLA_NOTES`).
- **Anti-drift/anti-stub:** o glue cita a fonte do core (`notes.rs`/`highlights.rs`/`reference.rs`); as 7 funções deixaram de ser stub (sem `WEB_NOTES_MSG`); ordenação de notas × inserção de highlights espelhadas; a referência (slug + `ref` + read-back) vem SEMPRE do WASM, nunca inventada em TS.
- **Anti-alucinação preservada:** NÃO se aplica ao corpo da nota / `tag` (dado do usuário, igual ao nativo, ADR-0017); a referência é canônica (wasm); nenhum texto bíblico do banco vaza pelo export.
- **Offline-first:** OPFS local num `data_dir` web próprio (gravável, separado do subset só-leitura); zero rede em runtime; sem SharedArrayBuffer/COOP-COEP (APIs OPFS de arquivo inteiro na main thread). `expo export --platform web` sai 0; `tsc --noEmit` limpo.
- **Sem regressão:** leitura/busca/xref web (`reading.web.test.mjs`/`search.web.test.mjs`/`xref.web.test.mjs` verdes) e caminho NATIVO (`core/src/lib.rs`/`app/web/reading.ts`/`app/lib/userdata.ts`/selftests nativos intactos; the-light em `8f66004`, working tree limpo); `core/` não modificado.
- **ÚLTIMA paridade web da Fase 1:** com leitura/busca/xref/userdata no web, a F1.17 (Marco 1, `gate: true`) fica elegível → o loop PARA (HALT) para sign-off humano (leitura offline completa multiplataforma).

## ADR-0023 — Gate F2.2: arquitetura da IA — Gemini/IA-web via PR ao core, BYOK **API key** (login-de-conta REJEITADO por pesquisa), streaming

- **Data:** 2026-07-01 · **Status:** aceito (sign-off humano no gate F2.2) · **Tarefa:** F2.2 (gate estratégico) · **Depende:** ADR-0005 (precedente PR sancionado ao the-light p/ feature-gating), ADR-0011 (infra em TS no web), F2.1 (`ask_anchored` + mock) · **Habilita:** F2.3–F2.8

### Contexto
A F2.1 provou `ask_anchored` na fronteira delegando ao módulo `ai` do `the-light-core`
(provider **mock**, anti-alucinação: `cited_text` do store vs `interpretation` do LLM).
O core tem `LlmProvider` (público), `build_provider(name, key, model)`, providers
`anthropic`/`openai`/`ollama` — mas **não Gemini** — e todo o módulo `ai` é
`#[cfg(feature="embedded")]` (nativo-only; `reqwest::blocking` + `research::WebSource`
não compilam em wasm). O gate F2.2 decidiu 4 pontos de arquitetura.

### Decisões
- **D1 — Onde vive o Gemini = PR ao `the-light-core`.** Adicionar `GeminiProvider:
  LlmProvider` + entradas em `PROVIDERS`/`default_model`/`estimate_cost_usd`, via
  **PR + ADR sancionados** (precedente ADR-0005). Fonte única (CLI/TUI também ganham).
  Consequência de processo: mudança no the-light é ação outward — implementada em
  branch, **push+merge é do humano**, seguida de **re-pin** do rev (molde F0.6).
- **D2 — IA no web = PR ao core (partes puras no wasm).** Desacoplar `ai::study`/
  `ai::citation` de `super::research::WebSource` (que puxa `reqwest`) para que a
  montagem de prompt/RAG/citação compile em `wasm32`; a chamada HTTP ao provedor no
  web é feita via `fetch` (infra, precedente ADR-0011), mas o **anti-alucinação
  (prompt+citação) fica numa ÚNICA impl Rust** compartilhada nativo/web (sem drift).
- **D3 — Autenticação = BYOK **API key** indolor (login-de-conta REJEITADO).**
  Fluxo guiado: colar a key 1×, guardada em **Keychain/Keystore** via
  `expo-secure-store` (nativo; F2.4), nunca re-inserida, nunca em git/log; deep-link
  p/ a página de key de cada provedor. **Login-de-conta (OAuth) foi investigado e
  REJEITADO** — ver "Pesquisa" abaixo.
- **D4 — Streaming (tokens incrementais).** A fronteira expõe a resposta da IA em
  streaming (callback/observer sobre UniFFI/JSI) — melhor UX; o `AiAnswer`
  não-streaming da F2.1 permanece como caminho simples/base.

### Pesquisa que fundamentou D3 (rejeição do login-de-conta) — 2026
Login com a conta do usuário para **inferência** não é oferecido por nenhum dos três e
é **ativamente banido** em dois (com risco de banir a conta do próprio usuário):
- **OpenAI "Sign in with ChatGPT":** OAuth **só de identidade**; não libera uso de
  modelo na assinatura; em abr/2026 só no Codex. API exige **key** (faturamento à parte).
- **Anthropic (Claude):** **banido** (enforcement server-side desde 9/jan/2026);
  tokens OAuth de planos de consumidor só valem no Claude Code/Claude.ai — usar em app
  de terceiros **viola os Termos**. Oficial = **API key** (console.anthropic.com).
- **Google (Gemini):** **banido** (fev/2026, detecção 25/mar/2026); contas reais
  (incl. Ultra) perderam acesso. "Sign in with Google" = **só identidade**. Oficial =
  **API key** (ou Vertex AI pago pelo desenvolvedor).
→ Construir login-de-conta arriscaria **banir a conta do usuário** e violaria ToS.
BYOK **API key** é o único caminho oficial/seguro p/ Claude+GPT+Gemini.

### Alternativas rejeitadas (D3)
- **Login-de-conta (OAuth p/ inferência):** ❌ indisponível/banido (acima).
- **Backend gerenciado (o app chama a IA):** ❌ quebra offline-first/BYOK, custo de
  servidor + privacidade; seria um pivô de produto com gate/ADR próprio.
- **Ollama-only:** registrado como opção futura (zero-key/offline; pesado em celular)
  — não bloqueia o BYOK-key de nuvem.

### Consequências / próximos passos
- **the-light muda (D1+D2) só via PR+ADR:** implementação em branch no repo `the-light`
  (autorizado), **push+merge pelo humano**, **re-pin** do rev — é um ponto de handoff
  (bloqueante) quando a tarefa da fronteira depender do core novo.
- **Re-escopo:** F2.3 = GeminiProvider no core (PR, D1) · F2.4 = chave nativa
  `expo-secure-store` (D3; app-side, não-bloqueante) · a fronteira ganha **streaming**
  (D4) · F2.7 = IA web via o core wasm-safe (D2) + `fetch`. Prova sempre por **MOCK**
  no CI; a IA real com a chave do usuário é F2.6 (bloqueante).
- **Anti-alucinação preservada em todas as opções:** texto do versículo sempre do
  store local; o LLM só interpreta; `cited_text` (store) separado de `interpretation`.
- **`loop/HALT` removido** (motivo do gate resolvido); loop retomado.

## ADR-0024 — D2 do ADR-0023 concretizada: feature `ai-pure` (partes puras do `ai` compiláveis em wasm) + fix `default_model` gemini (2.0-flash retirado → 2.5-flash)

- **Data:** 2026-07-01 · **Status:** aceito (PR sancionado ao the-light; branch `feat/ai-pure-wasm` `7486102`, mergeado por sign-off humano — ver re-pin abaixo) · **Tarefa:** F2.7 · **Depende:** ADR-0023 (D2 = IA no web via PR ao core) · ADR-0005 (precedente PR + matriz de features por alvo) · **Habilita:** F2.7b (UI web de IA)

### Contexto
A D2 do ADR-0023 pede a IA no web com **fonte única em Rust** (o anti-alucinação numa só
impl; só o transporte HTTP é `fetch`/TS). Mas o módulo `ai` do `the-light-core` era
inteiramente `#[cfg(feature="embedded")]` (puxa `reqwest`/`rusqlite`/`chrono`/`directories`/
`toml`) → não compilava em `wasm32`. Investigação na fonte (`133077a`) mostrou que as
funções da **Fase 2** (`ask`/`ask_context`/`numbered_passage`, `citation::rewrite_anchors`,
`default_model`/`estimate_cost_usd`, os `*_body`/`*_extract` de provider) são **PURAS**
(dependem só de `crate::model` + `serde_json`); o peso vem de `research`(reqwest+chrono),
`keys`(directories+toml), do **transporte** reqwest de `providers`, do rusqlite de `lexicon`
e do deep-study (Fase 3) de `study`.

### Decisão
Feature fina **`ai-pure`** (opt-in, **fora do `default`**), implementada no PR ao core:
- `Cargo.toml`: `ai-pure = ["dep:serde_json"]`; **`embedded` passa a incluir `ai-pure`** → sob
  o `default = ["embedded"]` **tudo** do `ai` segue compilando **byte-a-byte** (CLI/TUI/xtask
  inalterados).
- `lib.rs` (1 linha): `pub mod ai` sob `#[cfg(any(feature="embedded", feature="ai-pure"))]`.
- Dentro de `ai/`, gatear por `#[cfg(feature="embedded")]` só o pesado: módulos `research`/
  `keys` inteiros; transporte reqwest + `build_provider` em `providers`; queries rusqlite em
  `lexicon`; itens `WebSource`/deep-study em `study`/`citation`; `AiError::Toml`/`TomlSer`.
  Ficam em `ai-pure`: trait `LlmProvider`+`MockLlmProvider`, `ask`/`ask_context`/
  `numbered_passage`, `citation::rewrite_anchors`+`Citation`, `default_model`/
  `estimate_cost_usd`, os builders de prompt e `*_body`/`*_extract` puros.
- Um `#![cfg_attr(not(feature="embedded"), allow(dead_code))]` em `providers.rs`: as helpers
  puras (`*_body`/`*_extract`) ainda não têm chamador no caminho `ai-pure` (o transporte web
  via `fetch` é a **F2.7b**); sob `embedded` são exercitadas por impls+testes, então
  `-D warnings` segue plenamente válido no nativo.
- **Fix batendo junto:** `default_model` gemini `2.0-flash` → **`gemini-2.5-flash`**
  (`gemini-2.0-flash` foi **retirado em 3/mar/2026** → free-tier 0; achado da F2.6). Sem
  inventar preço p/ 2.5-flash em `estimate_cost_usd` (cai em `None`; arm histórico do
  2.0-flash mantido).

### Prova (portão D2)
`cargo build -p the-light-core --no-default-features --features ai-pure --target
wasm32-unknown-unknown` **compila**; `cargo tree` do grafo `ai-pure`/wasm **sem** `reqwest`/
`rusqlite`/`chrono`/`directories`/`toml` (só `regex`/`serde`/`serde_json`/`thiserror`).
Não-quebrante: `default` intacto; workspace do the-light **verde** (fmt 0, clippy `-D warnings`
0, `cargo test --workspace` 0 falhas; core 184); API pública nativa preservada. Escopo do PR
= só `ai/` + 1 linha `lib.rs` + `[features]`.

### Consequências
- **the-light re-pinado** de `133077a` → `<rev do merge de feat/ai-pure-wasm>` (ver JOURNAL).
- **F2.7b** (UI web de IA): a linha WEB de `core/Cargo.toml` passa a ligar `features =
  ["ai-pure"]` (sem `embedded`) → o wasm ganha prompt/RAG/citação puros em Rust; o glue web
  chama o provedor via `fetch` (a chave web = política registrada aqui/F2.7b) e monta a
  resposta com `cited_text` do store + interpretação do LLM. Anti-alucinação: mesma impl Rust
  (`rewrite_anchors`) no nativo e no web — **zero drift**.
- Anti-alucinação, offline-first (IA opt-in) e BYOK (chave nunca em git/log) preservados.

## ADR-0025 — Paridade web de IA (F2.7b): prompt/RAG/citação em Rust `ai-pure` (wasm, ZERO drift) + transporte por `fetch` no TS (body/extract espelham os `*_body`/`*_extract` PRIVADOS do core) + política de chave web **session-only / in-memory**

### Contexto
A F2.7 deixou `askAnchored`/`askAnchoredStream` no web como **stub** (`AI_WEB_UNAVAILABLE`)
e a chave web sem política (o `keystore.web` lançava em `setKey`, devolvia `null`/`[]`). A
ADR-0024 ligou a feature **`ai-pure`** na linha WEB de `core/Cargo.toml` (rev **c8ecb2f**),
trazendo as partes puras do `ai` ao wasm. Falta **destubar** o caminho web usando essas
partes (uma fonte da verdade em Rust) e **fixar a política de chave web** — sem tocar o
`the-light` (só via PR+ADR) nem `core/Cargo.toml` (re-pin já feito).

**ACHADO na fonte do core (c8ecb2f, só-leitura):** sob `ai-pure` são **`pub`** (chamáveis da
fronteira `the-light-app-core`): `numbered_verses`/`numbered_passage`/`ask_context`/`ask`/
`default_model`/`estimate_cost_usd`, `LlmProvider`+`MockLlmProvider`, `citation::rewrite_anchors`,
`prompts::ask_system_prompt` e `reference::*`. **MAS** os helpers de transporte
`gemini_body`/`gemini_extract` (e `anthropic_*`/`openai_*`/`ollama_*`) são **`fn` privados**
(não `pub`); `ask_user_prompt` (usado por `ask`) é **privado**; e `build_provider` é
`#[cfg(feature="embedded")]` → **ausente no wasm**. Logo o **corpo do request do provedor** e a
**extração da resposta crua** **não podem** ser feitos em Rust a partir da fronteira (seriam
outro PR ao core para tornar `*_body`/`*_extract` `pub`). Já os prompts exatos de `ask` **podem**
ser obtidos pela rota **pública** `ask` (dirigindo-a por um provedor de captura).

### Decisão
**Padrão prepare → fetch → finalize** (transporte = infra no TS, ADR-0023/D2; anti-alucinação =
Rust `ai-pure`, ZERO drift):
- **Fronteira web nova** em `core/src/lib.rs` (única mudança em `core/`; **cfg-free**, pois só
  toca `ai-pure` — nada de store/`rusqlite`/`reqwest`):
  - `ai_web_prepare(reference, question, provider_name, model, lang, verses: Vec<AiVerseInput>)
    -> AiWebRequest{reference, cited_text, system, user, provider, model}`: `cited_text =
    ai::numbered_verses(verses)` (verses **verbatim do store web**, F1.13 — a fronteira NÃO lê DB
    no wasm); `context = ask_context(format_reference(ref,lang), cited_text, &[])`; `model =
    model|default_model(provider)`; **system/user EXATOS** capturados por um `CaptureProvider`
    local (impl `LlmProvider`) **dirigido por `ai::ask`** (porque `ask_user_prompt` é privado).
  - `ai_web_finalize(reference, cited_text, provider, model, interpretation) -> AiAnswer`: aplica
    `citation::rewrite_anchors(interpretation, &HashSet::new())` (citação anti-alucinação em Rust,
    mesma impl do nativo) e monta o `AiAnswer` (cited_text do store **separado** da interpretation).
- **Transporte TS** (`app/web/ai-anchored.web.ts`, sem OPFS/asset — par de `sqlite-*.web.ts`):
  o corpo `generateContent` do Gemini e a extração `candidates[].content.parts[].text`
  **espelham** os `gemini_body`/`gemini_extract` **privados** do core; a chave vai só no header
  `x-goog-api-key` (NUNCA na URL/log); o modelo vai na URL. O `fetch` é **injetável** (a prova
  usa MOCK). `reading.web.ts` abre o store web (subset) e delega a `askAnchoredOnHandle`;
  `askAnchoredStream` web é **não-streaming** (emite a interpretação 1× via `onToken`;
  SSE/`ReadableStream` = follow-up). Provedores reais além de **Gemini** (MVP, F2.6) são follow-up.
- **Política de chave WEB = session-only / in-memory** (`app/lib/keystore.web.ts`): um `Map` de
  MÓDULO (vive só na aba/sessão; **perdido no reload** → re-inserir a cada visita). Interface
  `Keystore`/`createKeystore` **idêntica** ao nativo (mesma validação/`trim`/`listProviders`); só
  o backend muda (sessão vs. secure-store). **NUNCA** storage persistente do navegador/git/log.
  Justificativa (D3/ADR-0023): OAuth foi rejeitado e persistir segredo no navegador é inseguro →
  session-only é a opção web mais segura. `ReaderAskPanel` (compartilhado) ganha um input mínimo
  p/ colar a chave 1× por sessão (sem persistir).

### Prova (portões F2.7b)
`ai_web_prepare`/`ai_web_finalize` nos bindings web (`gen-bindings-web.sh` exit 0); grafo wasm
**puro** (`cargo tree` wasm sem `rusqlite`/`reqwest`); `cargo fmt`/`clippy -D warnings`/`test`
(41 + 2 host: `cited_text`/`system` idênticos ao `ask_anchored` nativo = **zero drift**;
`rewrite_anchors` remove âncora inválida). Prova **headless node** (`askAnchored.web.test.mjs`,
`fetch` **MOCK**, sem rede/chave real): `cited_text` = **João 3:16 KJV VERBATIM do store**
(numerado pelo ai-pure), `interpretation` = texto da resposta MOCK; chave dummy só no header;
paridade com o nativo. `tsc --noEmit` 0 + `expo export --platform web` 0.

### Consequências
- `the-light` **intacto** (`c8ecb2f`) e `core/Cargo.toml` **não** alterado — a fronteira web é a
  única mudança em `core/`. Se um dia o transporte multi-provedor precisar do body/extract **em
  Rust** (evitar drift de transporte), aí sim um PR ao core torna `*_body`/`*_extract` `pub`
  (fora do escopo desta task).
- Anti-alucinação **com ZERO drift**: prompt (`ask`) + citação (`rewrite_anchors`) do MESMO Rust
  `ai-pure` no web e no nativo; `cited_text` SEMPRE do store; o LLM só interpreta.
- Offline-first/BYOK: sem chave/sessão, o app segue 100% offline; a IA web é **opt-in** e a
  **única** rede em runtime é o `fetch` ao provedor, com a chave session-only (nunca em git/log).
- Depende de ADR-0024 (`ai-pure`), ADR-0023 (D2 transporte / D3 chave), ADR-0011 (infra TS no web).

## ADR-0026 — Dados de léxico (DADOS): `original_tokens`/`lexicon`/`scholarly_sources` populadas pelo `xtask import-scholarly` canônico (STEP Bible / STEPBible-Data, CC BY 4.0) + atribuição obrigatória + pipeline alinhado ao rev `c8ecb2f` + armazenamento gerar-ignorado

- **Data:** 2026-07-01 · **Status:** aceito · **Tarefa:** F3.1 · **Depende:** ADR-0002, ADR-0013, ADR-0016

### Contexto
A F3.1 abre a **Fase 3** (estudo profundo) populando as tabelas de **léxico** do
`assets/data/bible.sqlite` (gerado pela F1.1, ADR-0013; xrefs pela F1.7, ADR-0016):
**`original_tokens`** (tokens de língua original OT+NT + número de Strong por
palavra), **`lexicon`** (glosas breves TBESH/TBESG por Strong) e
**`scholarly_sources`** (atribuição das fontes). Como na F1.1/F1.7, a lógica de
download/parse/insert vive **só** no `the-light` (aqui **no core** `scholarly.rs`,
com um wrapper fino no member `xtask`): o subcomando **dedicado**
`import-scholarly`, confirmado na fonte do rev pinado `c8ecb2f`
(`xtask/src/main.rs`: `Some("import-scholarly") => scholarly_import::run(&args[1..])`;
lógica em `crates/the-light-core/src/scholarly.rs`). Por isso o plano manda **rodar
o importador canônico**, não reimplementá-lo (uma fonte da verdade;
anti-alucinação). Estas tabelas fazem parte do **schema v2** do core (criadas por
`Store::open`) e ficam **vazias** até esta importação — sem elas,
`ai::lexicon::verified_lexicon` devolve **vazio** e o estudo declara "sem base
léxica" (honesto, nunca inventa).

**Licenciamento (correção importante):** o dado do core é **STEP Bible /
STEPBible-Data — CC BY 4.0** (Tyndale House, Cambridge), **não** domínio público
puro. A **numeração de Strong** é PD, mas os **tokens e glosas amalgamados**
(TAHOT/TAGNT/TBESH/TBESG) são **CC-BY** → **atribuição obrigatória**. Só embarcamos
**dados livres** (PD/CC0/CC-BY); a **denylist do core** (`scholarly.rs`:
`sblgnt`/`morphgnt`/`louwnida`/`bdag`/`halot`) recusa fontes não-livres por código
(defesa em profundidade).

### Decisão

1. **Popular `original_tokens`/`lexicon`/`scholarly_sources` rodando `xtask
   import-scholarly` do rev pinado `c8ecb2f` — sem tocar o `the-light`.** O
   `scripts/gen-bible-db.sh` (molde da F1.1/F1.7) foi **estendido**: **após** o
   `import` (verses+FTS) e o `import-xref` (xrefs), roda o **`import-scholarly`** no
   **mesmo** `--db assets/data/bible.sqlite` e um `--seed-dir` **dedicado**
   (`.cache/seed/scholarly`), num **pipeline único** (evita o footgun de rodar
   `import-scholarly` num `--db` inexistente):
   - `CARGO_TARGET_DIR=.cache/xtask-target cargo run --quiet --locked
     --manifest-path <checkout c8ecb2f>/xtask/Cargo.toml -- import-scholarly
     --db assets/data/bible.sqlite --seed-dir .cache/seed/scholarly [$EXTRA]`.
   - Mesmo isolamento da ADR-0013/0016: o `xtask` roda do **checkout do cargo**
     (clone do GitHub gerenciado pelo cargo, independente do repo local protegido
     `/Users/butkeraites/Documents/the-light`), com **`CARGO_TARGET_DIR` fora** do
     checkout e **`--locked`** → **nenhum** artefato/lock escrito no source do
     `the-light`. **Verificado:** `the-light` em `c8ecb2f`, working tree **limpo**,
     **sem** `target/` no checkout, antes e depois.
   - **Flags reais confirmadas na fonte** (`scholarly_import.rs::run`, parser
     próprio): `--version <ids>` (lista por vírgula; **default = todos** os SPECS =
     `scholarly::default_datasets()` = `tahot,tagnt,tbesh,tbesg`), `--db <path>`,
     `--seed-dir <dir>`, `--force`, `--offline`. O script **não** passa `--version`
     (importa os **quatro** conjuntos) e repassa só `--offline`/`--force` (ambos
     válidos). Qualquer flag desconhecida → o xtask aborta.

2. **Decisão de rev: alinhar o `gen-bible-db.sh` a `c8ecb2f`** (rev pinado pelo
   app em `core/Cargo.toml`, ADR-0002). O script antes rodava o xtask do rev
   `8f66004`; agora roda os **três** importadores (`import`, `import-xref`,
   `import-scholarly`) do **mesmo** rev `c8ecb2f` → um pipeline **único** e coeso,
   sem descasamento `8f66004`↔`c8ecb2f`. Seguro porque `import.rs` e
   `xref_import.rs` são **byte-idênticos** entre `8f66004` e `c8ecb2f` (verificado
   por `diff`); `c8ecb2f` só **acrescenta** o `import-scholarly` (feature do PR de
   estudo/IA). `Store::open` aplica as migrações v2 idempotentemente, criando as
   tabelas de léxico se faltarem.

3. **Fonte (CC-BY) — URLs FIXADAS no core `scholarly.rs`, não parametrizáveis pelo
   app.** Base `STEP_RAW =
   https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master`; homepage
   `STEP_URL = https://github.com/STEPBible/STEPBible-Data`; `version =
   "STEPBible-Data master"`. Quatro conjuntos (todos CC-BY, um parser TSV STEP):
   **TAHOT** (Hebrew OT, 4 arquivos) e **TAGNT** (Greek NT) → `original_tokens`;
   **TBESH** (léxico breve hebraico) e **TBESG** (léxico breve grego) → `lexicon`.
   O core grava/lê os TSV no `<seed-dir>` e baixa por rede **só** se ausentes e
   **sem** `--offline`. **Volume grande** (dezenas de MB de TSV brutos).
   - **Anti-alucinação / licenciamento:** os tokens/glosas vêm **sempre** do
     importador canônico sobre essa fonte CC-BY; **nenhum** dado hardcoded/inventado
     no app; **nenhuma** fonte não-livre (a denylist do core recusa
     `sblgnt`/`morphgnt`/`louwnida`/`bdag`/`halot`).

4. **Atribuição CC-BY obrigatória (string verbatim, gravada no banco).** A licença
   CC-BY exige crédito. A **string canônica** (`scholarly::ATTRIBUTION`), gravada em
   `scholarly_sources.attribution` para **cada** conjunto e impressa ao final do
   `import-scholarly`, é **verbatim**:
   **`Credit it to 'STEP Bible' linked to www.STEPBible.org (data based on work at
   Tyndale House, Cambridge; CC BY 4.0)`**. A tabela `scholarly_sources` tem coluna
   `attribution` (diferente de `cross_references`, ADR-0016) → a atribuição fica
   **no próprio banco**; a **exibição visível na UI** (léxico inline + crédito) é
   responsabilidade da **F3.5**. License enforcement do core: só
   `public-domain`/`cc0`/`cc-by*` são aceitos (as quatro fontes gravam `license =
   cc-by`, `embeddable = 1`).

5. **Idempotência.** No core, `import` faz **DELETE+reinsert por conjunto**
   (`original_tokens`/`lexicon` por `source_id`) e **INSERT OR REPLACE** em
   `scholarly_sources` → reimportar **não duplica**. **Verificado** rodando o
   script **2×**: contagens **estáveis** — `original_tokens = 447673`, `lexicon =
   22717`, `scholarly_sources = 4`; verses (`62203`) e cross_references (`344799`)
   **intactos**.

6. **Armazenamento: continua gerar-ignorado (ADR-0013 mantém-se).** O léxico só
   **popula** tabelas que já existiam (vazias) no `bible.sqlite`. O banco cresceu de
   ~62 MB (verses+xref) para **126.451.712 bytes** (~121 MB) com ~447,7k tokens +
   ~22,7k entradas de léxico + índices. O `bible.sqlite` segue **artefato de build
   IGNORADO** e o `seed-dir` (incl. `.cache/seed/scholarly/` com os TSV STEP)
   **sempre ignorado** — `.gitignore` já cobre (`/assets/data/bible.sqlite*` +
   `/.cache/`): **nenhuma** mudança de `.gitignore` foi necessária (verificado via
   `git check-ignore`). **Não** se versiona o binário.

### Verificação (lendo do banco, não hardcode)
- **Guarda de drift no core:** `scholarly.rs` fixa pisos por conjunto (`tahot =>
  300_000`, `tagnt => 100_000`, `tbesh|tbesg => 5_000`) — importar abaixo **aborta**
  (`"apenas N … (piso F); fonte incompleta?"`). Tratados como **guardas** (≳ N).
- **Contagens observadas:** `original_tokens = 447673` (tahot 305577 + tagnt 142096,
  ≳ 400.000), `lexicon = 22717` (tbesh 11682 + tbesg 11035, ≳ 20.000),
  `scholarly_sources = 4` (tahot/tagnt/tbesh/tbesg, `license = cc-by`,
  `embeddable = 1`, com a `attribution` STEP verbatim).
- **Sanidade Gênesis 1:1:** `book_number=1 AND chapter=1 AND verse=1 AND strongs <>
  ''` → **7** tokens com Strong (ex.: `H7225G`, `H1254A`, `H0430G` = אֱלֹהִים).
- **Lookup de Strong conhecido (`lexicon`):** `H0430G` → lemma `אֱלֹהִים`, gloss
  `God` (`source_id = tbesh`); `G2316` → lemma `θεός`, gloss `God` (`source_id =
  tbesg`).

### Alternativas rejeitadas
- **Banco separado de léxico:** ❌ o léxico usa o **MESMO** `bible.sqlite`
  (`original_tokens`/`lexicon`/`scholarly_sources` são schema v2 do core, lidas por
  `ai::lexicon::verified_lexicon`); um DB à parte fragmentaria o corpus.
- **Manter o script no rev `8f66004` e chamar o `import-scholarly` de `c8ecb2f`
  separado:** ❌ dois revs no mesmo pipeline; alinhar tudo a `c8ecb2f` (rev do app)
  é mais coeso e seguro (import/xref idênticos entre os revs).
- **Reimplementar o parser TSV STEP no app:** ❌ viola "uma fonte da verdade"/
  anti-alucinação — o core é o único que conhece o formato STEP + a guarda de drift
  + a denylist de licença; mudar o core seria **PR + ADR** (ação humana).
- **Apontar para uma fonte não-livre (SBLGNT/BDAG/HALOT/…):** ❌ recusado por código
  (denylist do core) e por princípio (só dados livres PD/CC0/CC-BY).

### Consequências
- `./scripts/gen-bible-db.sh` (estendido) (re)gera o banco **completo** (verses +
  FTS + xrefs + **léxico**) de forma **reprodutível** e **idempotente**, rodando o
  `xtask import` + `import-xref` + `import-scholarly` do rev pinado `c8ecb2f`
  **sem tocar** o `the-light`.
- **Offline-first preservado:** a **única** rede é em **dev/build** (download dos
  TSV STEP ~dezenas de MB para o seed-dir, **só na 1ª vez**; offline OK a partir da
  2ª, com os TSV em cache). O app em **runtime não faz rede**. Nenhum segredo em
  git/log.
- **`the-light` intocado** (ADR-0002): rev `c8ecb2f`, working tree limpo; o `xtask`
  roda do checkout do cargo com target/lock fora do source.
- **Versionado nesta tarefa:** `scripts/gen-bible-db.sh` (rev `c8ecb2f` + passo
  `import-scholarly`), `DECISIONS.md` (este ADR). **Gerado/IGNORADO:**
  `assets/data/bible.sqlite` (agora com léxico), `.cache/seed/scholarly/*.txt`
  (TSV STEP). **`.gitignore` inalterado** (já cobre ambos).
- **Escopo:** F3.1 entrega **só os DADOS** (`original_tokens`/`lexicon`/
  `scholarly_sources` no `bible.sqlite`). A **fronteira** de léxico
  (`lexical_entries` → `ai::lexicon::verified_lexicon`) é **F3.2**; o **estudo
  profundo** (`deep_study`/`study`) é **F3.3**; a **UI** com léxico inline +
  **atribuição STEP CC-BY visível** + propagação ao subset `reading-sample.sqlite`
  (bundling) é **F3.5**. Não antecipados aqui.

## ADR-0027 — UI nativa de estudo profundo (F3.5): propagação do léxico STEP ao subset bundled + atribuição STEP CC-BY visível + anti-alucinação visível (`passage_text`×`interpretation`) + saneamento de JSDoc nos bindings gerados

- **Data:** 2026-07-01 · **Status:** aceito · **Tarefa:** F3.5 · **Depende:** ADR-0014 (subset), ADR-0016 (atribuição visível), ADR-0023/ADR-0025 (anti-alucinação visível), ADR-0026 (dados de léxico STEP CC-BY)

### Contexto
A F3.5 entrega a **UI nativa (iOS/Android) de estudo profundo** ancorada numa
passagem do Reader: seletores de **modo × lente × profundidade** que chamam
`deep_study` (F3.3) e exibem, com **anti-alucinação VISÍVEL**, a `passage_text`
(texto bíblico, verbatim do STORE) **separada** da `interpretation` (IA) +
`sections`/`citations`/`warnings`, mais o **léxico Strong inline**
(`lexical_entries`, F3.2) com a **atribuição STEP CC-BY VISÍVEL** (ADR-0026). A
fronteira Rust (`deep_study`/`lexical_entries`) **já existe** (F3.2/F3.3); F3.5 é
**só** app/UI/glue/self-test + o **gerador do subset** + os **bindings gerados**
(NÃO toca `the-light` nem `core/src/lib.rs`). Três subproblemas exigiram decisão.

### Decisão

1. **PROPAGAR o léxico STEP ao subset bundled `reading-sample.sqlite` (não só ao
   `bible.sqlite`).** O subset (ADR-0014) empacotado no app nativo propagava só
   `translations`/`books`/`verses`/`verses_fts`/`cross_references` — **não** o
   léxico. Como `lexical_entries`/`deep_study` leem de `original_tokens`+`lexicon`+
   `scholarly_sources` (schema v2, criado vazio por `Store::open`), no device o
   léxico viria **VAZIO** e a atribuição STEP **não apareceria**. Estendemos
   `core/examples/gen_reading_sample_db.rs` (via `scripts/gen-reading-sample-db.sh`)
   para copiar do `bible.sqlite`-fonte (ATTACH `src`, **mesmo molde do xref/FTS**):
   (a) **todas** as `scholarly_sources` (4 linhas — `tahot/tagnt/tbesh/tbesg`,
   atribuição STEP CC-BY verbatim — INSERIDAS ANTES, pois as FKs estão ligadas por
   `Store::open`); (b) `original_tokens` dos livros do subset `{Gn(1),Sl(19),Jo(43)}`;
   (c) as `lexicon` **referenciadas** pelos Strong desses tokens (não o léxico
   inteiro — enxuga o bundle). É **DADO/fixture** (verbatim do store, STEP Bible /
   TBESH–TBESG, CC BY 4.0): a query/JOIN/agregação de léxico continuam **no core**
   (`ai::lexicon::verified_lexicon`) — nada de léxico é reimplementado no gerador.
   - **Contagens (LIDAS do subset regenerado, não hardcode):** `scholarly_sources=4`,
     `original_tokens=56 268`, `lexicon=4 534` (vs. 22 717 inteiro),
     `joão_3_16_tokens_strong=26`, `step_sources=4`. **Tamanho do subset:
     ~4,4 MB → ~14,4 MB** (`14 409 728` bytes) — aceitável p/ asset bundled (o
     `bible.sqlite` completo é da ordem de ~130 MB). Sanidade no próprio gerador:
     João 3:16 tem ≥1 token com Strong + atribuição STEP presente.
   - **Armazenamento:** o subset segue **artefato de build IGNORADO** (ADR-0014):
     reprodutível por `scripts/gen-reading-sample-db.sh`; `.gitignore` inalterado.

2. **Atribuição STEP CC-BY VISÍVEL + anti-alucinação VISÍVEL na UI de estudo
   (obrigatórias).** `app/components/ReaderStudyPanel.tsx` (molde `ReaderAskPanel`
   F2.5 + atribuição do `ReaderXrefPanel` F1.9): renderiza `StudyResultOut.passage_text`
   num bloco **"Passagem (texto bíblico)"** (rótulo distinto, `testID=study-passage-text`)
   **separado** de **"Interpretação (IA) — confira nas Escrituras"** (`interpretation`,
   `testID=study-interpretation`) + `sections`/`citations`/`warnings`; o **léxico
   inline** (`lexicalEntries`) exibe `strongs`/`lemma`/`translit`/`gloss` do RETORNO
   real; e a **atribuição STEP CC-BY** (`VerifiedLexiconOut.sources`, verbatim do
   banco) aparece **sempre** que léxico/estudo é exibido (molde ADR-0016). O provedor
   é **`"mock"`** nesta entrega (offline, sem chave/rede; BYOK real = F3.10). Ação
   **"Estudo (IA)"** (`testID=verse-study`) no `ReaderVersePanel` + estado `studyVerse`
   + `<ReaderStudyPanel>` em `[book]/[chapter].tsx` (passagem **numérica**
   book/chapter/verse — não string canônica). Glue: `reading.ts` reexporta/embrulha
   `deepStudy`/`lexicalEntries` (ordem REAL: `lang` ANTES de `provider`; `lexical_entries`
   **sem** `translation`); `reading.web.ts` = **stub** (estudo web = F3.12). Prova
   headless no device: self-test `TLA_STUDY` (`provider="mock"`, `passage_prefix`
   = João 3:16 KJV verbatim, `lexicon>=1`, `attribution_ok=true`), sem regressão dos
   demais `TLA_*`.

3. **Saneamento de JSDoc nos bindings GERADOS (`**/` → `** /`).** Ao consumir os
   bindings gerados no app `tsc`/Metro, aflorou um defeito LATENTE: o `ubrn` copia os
   doc-comments Rust (`///`) VERBATIM para blocos JSDoc `/** … */`; doc-comments do
   core que contêm a sequência markdown `**puro**/` (negrito seguido de barra, ex.:
   "tipo **puro**/`ai-pure`", em `core/src/lib.rs` linhas 846–1457, dos tipos de léxico
   F3.2 / estudo F3.3 / conversa F3.4) embutem um `*/` que **fecha o bloco JSDoc
   PREMATURAMENTE** — o resto vira "código" e `tsc` acusa centenas de erros de sintaxe
   (TS1005/TS1109/…) nos dois bindings gerados (`app/web/{generated,native-generated}`).
   Como F3.5 **não** pode tocar `core/src/lib.rs` (correção de raiz = doc-comment no
   core, via PR + ADR — decisão humana) e os bindings são **artefatos GERADOS-IGNORADOS**,
   saneamos o **ARTEFATO** nos geradores (`scripts/gen-bindings-ios.sh` e
   `-web.sh`): um `perl -pe 's{\*\*/}{** /}g'` insere um espaço em `**/` (→ `** /`),
   quebrando o `*/` **sem** alterar tipo/assinatura/comportamento (é só comentário; o
   negrito markdown "puro" segue legível). É **seguro/global**: nenhuma linha usa `**/`
   como FECHAMENTO legítimo de comentário nesses arquivos (o fechamento é ` */`).
   **Follow-up recomendado (fora do escopo F3.5):** corrigir os doc-comments do core
   (`**puro** /` com espaço) via PR + ADR, tornando o saneamento redundante.

### Verificação (lendo do banco/retorno, não hardcode)
- **Subset regenerado:** contagens acima lidas de `reading-sample.sqlite`
  (`sqlite3`); João 3:16 com 21 Strong distintos (≥1 base agregado) + atribuição
  `tagnt` = `"Credit it to 'STEP Bible' … CC BY 4.0"`.
- **Prova no device (`run-ios-selftest.sh`):** `TLA_STUDY ref="John 3:16"
  provider="mock" passage_prefix="For God so loved…" lexicon=<n≥1> attribution_ok=true`,
  composto do RETORNO real de `deep_study`/`lexical_entries` (MOCK, sem chave/rede);
  **sem regressão** de `TLA_SELFTEST`/`TLA_READ`/`TLA_PARALLEL`/`TLA_SEARCH`/`TLA_XREF`/
  `TLA_NOTES`/`TLA_ASK`.
- **Qualidade:** `tsc --noEmit` limpo (0 erros após o saneamento); `expo export
  --platform web` sai 0 (estudo/léxico web = stub F3.12); `gen-bindings-ios.sh` exit 0
  com `deepStudy`/`lexicalEntries` presentes e 0 `**/` residual; UI separa
  `passage_text`/léxico da `interpretation` e exibe a string STEP CC-BY (grep).
- **`the-light`/core intactos:** `git -C ../the-light rev-parse HEAD` == `c8ecb2f`
  (working tree limpo); `core/src/lib.rs` + `core/Cargo.toml` **não** modificados.

### Alternativas rejeitadas
- **Aceitar léxico VAZIO no device (provar só no host `bible.sqlite`):** ❌ a UI de
  estudo mostraria léxico/atribuição vazios no aparelho — descaracteriza a entrega;
  a propagação é de baixo risco (já feita p/ xref/FTS).
- **Copiar o léxico INTEIRO (22 717 linhas):** ❌ infla o bundle sem ganho (só os
  Strong dos livros do subset são consultáveis); copiamos os **referenciados**.
- **Corrigir os doc-comments em `core/src/lib.rs` (`**puro**/` → `**puro** /`):** ❌
  fora do escopo F3.5 (só via PR + ADR) e a **verificação da própria tarefa FALHA** se
  `core/src/lib.rs` for tocado; saneamos o artefato gerado (equivalente, reversível).
- **Excluir os bindings gerados do `tsconfig`:** ❌ não resolve — os arquivos são
  **importados** por `reading.ts`/`reading.web.ts` e entram no programa `tsc` mesmo
  fora do `include`; e `@ts-nocheck` **não** suprime erros de SINTAXE.

### Consequências
- **Versionado nesta tarefa:** `app/components/ReaderStudyPanel.tsx` (novo),
  `app/components/ReaderVersePanel.tsx` (ação "Estudo (IA)"),
  `app/app/read/[book]/[chapter].tsx` (estado `studyVerse` + painel),
  `app/web/reading.ts`/`reading.web.ts` (glue `deepStudy`/`lexicalEntries` + stub),
  `app/web/study-selftest.ts`/`.web.ts` (novos) + `app/web/selftest.ts` (registro),
  `scripts/run-ios-selftest.sh` (asserções `TLA_STUDY`),
  `scripts/gen-bindings-ios.sh`/`gen-bindings-web.sh` (saneamento JSDoc),
  `core/examples/gen_reading_sample_db.rs` (propagação do léxico), `DECISIONS.md`
  (este ADR). **Gerado/IGNORADO:** `assets/data/reading-sample.sqlite` (~14,4 MB, agora
  com léxico), `app/web/{generated,native-generated}` (bindings saneados).
- **Offline-first / BYOK preservados:** a prova roda **offline** (provedor `"mock"`,
  sem chave, sem rede); nenhuma chave é logada/exibida. O texto bíblico e o léxico
  vêm SEMPRE do store local, verbatim; o LLM só interpreta.
- **Escopo:** estudo/léxico **web = F3.12** (`reading.web.ts` = stub); **BYOK real +
  rede + streaming de estudo = F3.10** (gate). Não antecipados aqui.

## ADR-0028 — Gate F3.9 / D1: pesquisa web assistida no estudo = **Wikipedia keyless, OPT-IN** (padrão desligado + aviso de privacidade); Tavily BYOK futuro

- **Data:** 2026-07-02 · **Status:** aceito (sign-off humano no gate F3.9) · **Tarefa:** F3.9 · **Depende:** ADR-0023 (BYOK/rede opt-in), ADR-0026 (fontes/atribuição) · **Habilita:** integração de `ai::research` no `deep_study` (nativo) + paridade web (F3.12)

### Decisão
O estudo profundo pode, **opcionalmente**, enriquecer a análise com **pesquisa web via
Wikipedia** (`ai::research::WikipediaProvider`, **KEYLESS** — API pública, sem chave). É
**opt-in, padrão DESLIGADO**, com **aviso de privacidade** obrigatório antes da 1ª busca
(rede opt-in). As fontes viram `WebSource` citadas `[W:n]`; o core **valida os índices**
(`cited_web_indices`) e monta as citações **das URLs** (nunca do modelo) — anti-alucinação
embutida. **Tavily (BYOK)** fica registrado como opção futura (melhor busca, exige chave).
`ai::research` é embedded-only (reqwest) → no nativo é direto; no **web** a busca Wikipedia
é `fetch` (TS), integrada na paridade web (F3.12), sem quebrar offline-first (opt-in).

### Consequências
Nova capacidade: `deep_study` ganha a opção de passar `web_sources` (hoje `vec![]`) obtidos
de `build_research_provider("wikipedia", None, lang)`. Prova por **MockResearchProvider**
(sem rede) no CI; rede real = opt-in do usuário (validação humana na F3.10). Offline-first,
anti-alucinação e atribuição preservados.

## ADR-0029 — Gate F3.9 / D2: paridade WEB do estudo profundo = **PR `ai-pure` COMPLETO agora** (study + léxico + conversa wasm-safe), fonte única / zero drift

- **Data:** 2026-07-02 · **Status:** aceito (sign-off humano no gate F3.9) · **Tarefa:** F3.9 · **Depende:** ADR-0024 (precedente feature `ai-pure`), ADR-0011/0025 (infra TS + prepare/fetch/finalize web) · **Habilita:** F3.11 (PR core) → F3.12 (paridade web)

### Decisão
Levar o **estudo profundo, o léxico e a conversa** ao web com **fonte única em Rust**
(zero drift do anti-alucinação), via um **PR ao `the-light-core`** que amplie a feature
`ai-pure` (ADR-0024) para cobrir as partes puras de `study`/`verified_lexicon` (montagem de
prompt/RAG/citação + a superfície de estudo), mantendo o transporte HTTP (LLM + Wikipedia)
em TS (`fetch`, molde F2.7b/ADR-0025). Hoje `study()`/`verified_lexicon`/`StudyResult` são
`embedded`-only e `user_prompt` é privado → **não há entrada pública pura**; por isso o PR
é necessário (molde exato F2.7/ADR-0024). A **conversa** (`ask_session`/`refine_scope`/
`parse_refinement`) JÁ é `ai-pure` (F3.4) → parte da paridade web sai sem depender do PR.
**NUNCA** espelhar o anti-alucinação do estudo em TS (drift proibido).

### Consequências / re-escopo
- **F3.11 = PR sancionado ao `the-light`** (branch + push/merge humano + re-pin, molde
  F2.7): expor as partes puras de estudo/léxico sob `ai-pure` (+ o que a pesquisa web pura
  exigir) — **handoff BLOQUEANTE**.
- **F3.10 = validação real** (D3) com a chave do usuário (estudo/conversa/comparação reais
  + pesquisa web se ligada), molde F2.6/`ask_real.rs` — **gate/bloqueante** (chave/segredo).
- **F3.12 = paridade web** (estudo/léxico/conversa/pesquisa) após o merge do F3.11 +
  re-pin (liga `ai-pure` estendido na linha web), molde F2.7b.
- **F3.13 = Marco 3.**
- Anti-alucinação, offline-first (opt-in), BYOK e `the-light`-só-via-PR+ADR preservados.

## ADR-0030 — F3.11: PR `ai-pure` do **estudo profundo** (wasm-safe) — widening de `#[cfg]` + 1 `pub` novo (`user_prompt`) + `chrono` clock-free no grafo puro

- **Data:** 2026-07-02 · **Status:** aceito (PR sancionado ao the-light; branch `feat/ai-pure-study`, **aguardando push/merge humano** + re-pin do Driver) · **Tarefa:** F3.11 · **Depende:** ADR-0029 (D2 autoriza), ADR-0024 (precedente da feature `ai-pure`), ADR-0025 (prepare→fetch→finalize web) · **Habilita:** F3.12 (paridade web do estudo)

### Contexto
A ADR-0029 (D2) mandou levar o **estudo profundo** ao web com **fonte única em Rust**
(zero drift do anti-alucinação). No core @ `c8ecb2f`, a superfície do deep-study era
`#[cfg(feature = "embedded")]`-only (`StudyRequest`/`StudyResult`/renders,
`WebSource`/`from_web_results`) e `user_prompt` era **`fn` privado** → **não havia
entrada pública pura** para o web montar `(system, user)` do estudo. `pub mod ai` já
estava sob `any(embedded, ai-pure)` desde a F2.7/ADR-0024, e `prompts::system_prompt_in`
(pura, `None` = prompt embutido) e os tipos de `lexicon`/`citation` já eram públicos.

### Decisão
Ampliar a feature **`ai-pure`** (ADR-0024) para cobrir as **partes puras do estudo**, via
**widening do gate** (`embedded` → `any(embedded, ai-pure)`) nos itens puros e **1 `pub`
novo**, sem mover código (aditivo, defaults byte-a-byte). Escopo cirúrgico: só
`crates/the-light-core/src/ai/{mod,study,research,citation}.rs` + `Cargo.toml [features]`
(**`lib.rs` NÃO mudou**).
- **Cargo:** `ai-pure = ["dep:serde_json", "dep:chrono"]` com **`chrono` clock-free**
  (`default-features = false, features = ["serde", "std"]`) — necessário porque
  `WebSource.fetched_at: DateTime<Utc>` e `from_web_results` entram no grafo puro; o
  caminho puro **nunca** chama `Utc::now()` (o timestamp vem do TS via `from_timestamp`),
  então sem `clock` o chrono **não** puxa `wasm-bindgen`/`js-sys`. `embedded` reativa o
  clock via **`chrono/clock`** (usado por `Utc::now()` nos providers de rede), mantendo o
  nativo **byte-a-byte**. `default = ["embedded"]` intacto; `ai-pure` fora do default.
- **`study.rs`:** widening p/ `ai-pure` de `StudyRequest`/`StudyResult`/`impl StudyResult`
  (`to_markdown`/`to_academic_markdown`)/`user_prompt`/`cited_web_indices`; `study()` e
  `CitationCollector` seguem `embedded` (provider real + `system_prompt` de disco +
  `lexicon::verify`). **`user_prompt` `fn`→`pub fn`** (a ÚNICA mudança de visibilidade;
  `cited_web_indices` também vira `pub`).
- **`research.rs`:** ficam puros (`ai-pure`) `WebSource`/`ResearchProvider`/
  `MockResearchProvider`/`RESEARCH_BACKENDS`; reqwest+clock (`WikipediaProvider`/
  `TavilyProvider`/`build_research_provider`/`blocking_client`/`urlencode`/`strip_html`)
  seguem `embedded`.
- **`citation.rs`:** `WebSource`/`from_web_results` passam a `any(embedded, ai-pure)`.

### Superfície pública nova (mínima)
**1 `pub` novo:** `ai::study::user_prompt`. Widening (aditivo) p/ `ai-pure` de itens já
públicos: `study::{StudyRequest, StudyResult}` + renders; `study::cited_web_indices`
(`pub`); `research::{WebSource, ResearchProvider, MockResearchProvider,
RESEARCH_BACKENDS}`; `citation::from_web_results`. API pública **nativa** inalterada.

### Prova (portão D2)
`cargo build -p the-light-core --no-default-features --features ai-pure --target
wasm32-unknown-unknown` **compila** com as peças do estudo. `cargo tree` do grafo
`ai-pure`/wasm **sem** `reqwest`/`rusqlite` (e **sem** `wasm-bindgen`/`js-sys` — a via
primária **chrono clock-free funcionou**; deps: chrono, regex, serde, serde_json,
thiserror). Não-quebrante: `default` intacto; workspace verde (fmt 0, clippy `-D warnings`
0, `cargo test --workspace` 0 falhas; **core lib 184**); chrono nativo mantém `clock`
(`iana-time-zone`). Escopo = só `ai/` + `[features]`.

### Consequências
- **the-light a re-pinar** de `c8ecb2f` → `<rev do merge de feat/ai-pure-study>` (handoff:
  push/merge humano; re-pin do Driver na linha WEB → `features = ["ai-pure"]`).
- **F3.12** consome a superfície nova (prepare = `system_prompt_in(...,None)` +
  `user_prompt`; finalize = `split_sections`/`verify`/`cited_web_indices`/
  `CitationCollector`/`to_academic_markdown` com `rewrite_anchors`) — MESMA impl Rust do
  nativo, **zero drift**. Transporte (LLM + Wikipedia) = `fetch`/TS (molde F2.7b).
- Anti-alucinação (texto do versículo do store; LLM só interpreta), offline-first (IA
  opt-in) e BYOK preservados; `the-light` alterado só via PR + ADR.

## ADR-0031 — F3.12a: paridade WEB do estudo profundo + léxico + export acadêmico (`ai-pure` prepare→fetch→finalize; zero drift) — fronteira web nova em `core/src/lib.rs` + recuperação de léxico TS (ADR-0011) + transporte `fetch` (ADR-0025)

- **Data:** 2026-07-02 · **Status:** aceito · **Tarefa:** F3.12a · **Depende:** ADR-0030 (superfície `ai-pure` do estudo, rev **04b9b24**), ADR-0025/ADR-0024 (F2.7b prepare/fetch/finalize + chave web session-only), ADR-0011 (infra TS de store no web), ADR-0027 (léxico STEP no subset), ADR-0029 (D2: zero drift)

### Contexto
A F3.11 (ADR-0030) mesclou no `the-light` (@ `04b9b24`, re-pin já feito na linha WEB com
`features = ["ai-pure"]`) a superfície **pura do estudo profundo**: `StudyRequest`/
`StudyResult`/`to_academic_markdown`, `study::user_prompt` (o 1 `pub` novo),
`split_sections`/`cited_web_indices`, e os tipos de `lexicon`/`citation`/`research` — todos
compiláveis no `wasm32` sob `ai-pure`. Faltava **destubar** o estudo web (`deepStudy`), o
léxico web (`lexicalEntries`) e o export acadêmico, **sem** espelhar em TS o anti-alucinação
do estudo (proibido, ADR-0029) e **sem** tocar o `the-light` nem `core/Cargo.toml` (re-pin
já feito).

### Decisão
**Padrão prepare → (fetch em TS) → finalize** (molde EXATO F2.7b/ADR-0025), com o
anti-alucinação **100% em Rust `ai-pure`** (zero drift nativo↔web):
- **Fronteira web nova** em `core/src/lib.rs` (única mudança em `core/`; **cfg-free**, só a
  superfície `pub` do `ai-pure` — nenhum store/`rusqlite`/`reqwest`, grafo wasm segue puro):
  - Records puros `StudyLexEntryInput`/`StudyWebSourceInput`/`StudyWebRequest`.
  - `study_web_prepare(book, chapter, verse, mode, lens, depth, lang, provider, model?, verses,
    lexicon_entries, lexicon_sources, web_sources) -> StudyWebRequest`: `passage_text =
    ai::numbered_verses(verses)` (VERBATIM do store); monta `Passage` + `VerifiedLexicon` (dos
    inputs recuperados do store) + `Vec<WebSource>` (**vazio na F3.12a**); `system =
    prompts::system_prompt_in(mode,lens,depth,lang,None)`; `user = study::user_prompt(&req,
    &passage_text)`. Referência **numérica** (`Reference::single`/`whole_chapter`, como
    `deep_study`) → paridade exata da referência (o store web é chaveado por número).
  - `study_web_finalize(..., passage_text, provider, model, raw_llm_response, lexicon_entries,
    lexicon_sources, web_sources) -> StudyResultOut`: espelha `ai::study::study` passo a
    passo — `split_sections` + `lexicon::verify().warnings` (se `wants_lexical`) +
    `cited_web_indices` fora do intervalo + `CitationCollector{from_verified_lexicon +
    from_web_results}.into_vec()` (se `emits_apparatus`) + `StudyResult` →
    `to_academic_markdown(lang)` (F3.8). O `impl From<StudyResult> for StudyResultOut` deixou
    de ser `#[cfg(not(wasm32))]` (agora `StudyResult`/`to_academic_markdown` são `ai-pure`) →
    serve nativo E web com a MESMA serialização SBL.
  - `web_sources` **vazio nesta fatia** (Wikipedia web = **F3.12b**, app-side apenas: o app
    passa `web_sources` populado via `fetch`, sem re-tocar o Rust). O `fetched_at` do
    `WebSource` usa `Default::default()` (época) porque `chrono` é dep **transitiva** do core
    (não nomeável desta crate sem tocar `Cargo.toml`) — inerte com a lista vazia; a data de
    acesso das citações web é refinamento da F3.12b.
- **Recuperação de léxico no web = infra TS** (`app/web/sqlite-lexicon.web.ts`, precedente
  ADR-0011 do passage/xref/search web): SELECT `original_tokens` + LEFT JOIN `lexicon`
  (COALESCE da glosa) por book/chapter[/verse], agregado por **Strong base** ("H7225G"→
  "H7225"), ordenado por ocorrência desc (desempate por Strong), truncado ao `limit`, +
  atribuições (`scholarly_sources.attribution`, ordem por `source_id`) — **espelhando o shape**
  de `ai::lexicon::verified_lexicon` (que é `embedded`-only/rusqlite, ausente no wasm). É
  SELECT + shaping (infra sancionada); **o que NÃO vira TS** é prompt/verify/citação/aparato.
  As glosas/lemas/Strong/atribuição são **VERBATIM do store** (STEP Bible / TBESH–TBESG,
  CC-BY, do subset F3.5/ADR-0027).
- **Glue web** (`app/web/study.web.ts`, par de `ai-anchored.web.ts`): `deepStudyOnHandle` =
  léxico do store → `studyWebPrepare` (wasm) → **`fetch`** ao LLM (transporte REUSADO de
  `webLlmTransport`, MVP Gemini; a chave **session-only** vai SÓ no header, nunca na URL/log)
  → `studyWebFinalize` (wasm) → `StudyResultOut`. `reading.web.ts` **destuba** `deepStudy`/
  `lexicalEntries` (abre o store OPFS + delega); `researchBackend` aceito mas **ignorado**
  (F3.12b). Export web sai de graça: `buildStudyExport` (F3.8) já reusa `academicMarkdown`.

### Prova (portões F3.12a)
`study_web_prepare`/`study_web_finalize` nos bindings web (`gen-bindings-web.sh` exit 0);
grafo wasm **puro** (`cargo tree` wasm sem `rusqlite`/`reqwest`/`wasm-bindgen`/`js-sys`);
`cargo fmt`/`clippy -D warnings`/`test` (**65** = 63 + 2 host: **paridade** `study()` nativo
== prepare+finalize web em passage_text/user/system/sections/warnings/citations/
academic_markdown → zero drift; Devotional sem aparato). Provas **headless node** (fetch
MOCK, sem rede/chave real): `deepStudy` web ponta a ponta (passage_text = João 3:16 KJV
VERBATIM do store ≠ interpretation do mock; ≥1 citação `Source` do léxico STEP CC-BY;
`academicMarkdown` > 0 com a passagem + atribuição STEP); `lexicalEntries` web (21 entradas
Strong de João 3:16 + STEP CC-BY; sem cobertura → vazio; `limit`); export web
(`buildStudyExport` sobre o retorno REAL). `tsc --noEmit` 0 + `expo export --platform web` 0;
sem regressão web (reading/search/xref/notes/ask/keystore) nem nativa (`deep_study` + host).

### Consequências
- `the-light` **intacto** (`04b9b24`, working tree limpo) e `core/Cargo.toml`/`Cargo.lock`
  **não** alterados — a fronteira web (`core/src/lib.rs`) é a única mudança em `core/`.
- Anti-alucinação **com ZERO DRIFT**: prompt (`system_prompt_in`+`user_prompt`), verify,
  citações e `to_academic_markdown` do MESMO Rust `ai-pure` no web e no nativo; `passage_text`
  e léxico SEMPRE do store; o LLM só interpreta.
- Offline-first/BYOK: sem chave/sessão, o app segue 100% offline; a IA web é **opt-in** e a
  **única** rede em runtime é o `fetch` ao provedor (chave session-only, nunca em git/log). A
  pesquisa web Wikipedia (rede opt-in) e a conversa ancorada web ficam para a **F3.12b**.
- **Versionado nesta tarefa:** `core/src/lib.rs` (fronteira web + Records + 2 testes de
  paridade), `app/web/{study,sqlite-lexicon}.web.ts` (novos), `app/web/reading.web.ts`
  (destub), `app/web/ai-anchored.web.ts` (`webLlmTransport` reusável),
  `app/web/{study,export}-selftest.web.ts` (destub), `app/web/__tests__/{deepStudy-headless-entry.ts,
  deepStudy.web.test.mjs,lexicalEntries.web.test.mjs,export.web.test.mjs}` (novos),
  `app/package.json` (scripts), `DECISIONS.md` (este ADR). **Gerado/IGNORADO:**
  `app/web/generated/*` (bindings web).

## ADR-0032 — F3.12b: paridade WEB da **conversa ancorada** + **pesquisa Wikipedia** (opt-in, keyless) + **comparação multi-IA** — 1 fronteira web nova (`session_web_prepare` via `CaptureProvider`, zero drift) + `fetch` Wikipedia em TS (ADR-0028) + reuso de `askAnchored`

- **Data:** 2026-07-02 · **Status:** aceito · **Tarefa:** F3.12b · **Depende:** ADR-0031 (F3.12a: fronteira web do estudo `study_web_*`, que **já aceita** `web_sources`), ADR-0025/ADR-0024 (F2.7b prepare/fetch/finalize + chave web session-only), ADR-0028 (pesquisa web Wikipedia keyless opt-in), ADR-0011 (infra TS de store no web), ADR-0029 (D2: zero drift)

### Contexto
A F3.12a entregou a fronteira web do estudo (`study_web_prepare`/`study_web_finalize`, que
**já aceita** `web_sources: Vec<StudyWebSourceInput>`, vazio na F3.12a). Faltava fechar a
paridade web do estudo profundo em 3 frentes, **sem** espelhar em TS o anti-alucinação
(prompt/citação/`[W:n]`/verify/aparato — proibido, ADR-0029) e **sem** tocar o `the-light`
(@ `04b9b24`) nem `core/Cargo.toml`: (1) **conversa ancorada web** (`askSessionAnchored`,
stub desde F3.6), (2) **pesquisa web Wikipedia** (rede opt-in, ADR-0028), (3) **comparação
multi-IA web** (`askAnchored` já web-ok desde F2.7b; só faltava un-SKIP do self-test).

### Decisão
**Fonte única em Rust `ai-pure` / ZERO DRIFT** — só a recuperação de store (SELECT léxico,
ADR-0011) e o transporte (`fetch` ao LLM/Wikipedia, ADR-0025/ADR-0028) são infra TS:

1. **Conversa web = 1 fronteira web nova** em `core/src/lib.rs` (única mudança em `core/`;
   **cfg-free**, só a superfície `pub` do `ai-pure` — nenhum store/`rusqlite`/`reqwest`, grafo
   wasm segue puro): `session_web_prepare(book, chapter, verse, lang, turns, study_mode?,
   study_lens?, provider, model?, verses, related) -> AiWebRequest`. **NÃO** reusa
   `ai_web_prepare` (aquele usa `ai::ask` → `ask_system_prompt` + `user` de 1 turno; a conversa
   usa `ai::ask_session` → `study_followup`/`ask_system` + o `context` do 1º turno + o
   **transcript dobrado**). A menor via zero-drift: dirigir `ai::ask_session(&cap, lang,
   &context, &messages, study)` por um **`CaptureProvider`** (reuso da F2.7b, sobrescreve **só**
   `complete`) — o `chat` **default** dobra o transcript e chama `complete(system, user)`,
   capturando o par EXATO que o nativo (`ask_session_anchored`) enviaria. `cited_text =
   ai::numbered_verses(verses)` (VERBATIM do store web); `context = ai::ask_context(label,
   cited_text, related)`. Devolve o **mesmo `AiWebRequest`** do `ask`. O **finalize é REUSO PURO
   de `ai_web_finalize`** (F2.7b — `rewrite_anchors` com válidas vazio → limpa âncoras espúrias;
   idêntico ao `ask` sem citações léxicas): **nenhum finalize novo**.
   - **Glue** `app/web/session.web.ts` (par de `ai-anchored.web.ts`): `askSessionAnchoredOnHandle`
     = `hasTranslation` → `queryChapter` + recorte → `verses`; `session_web_prepare` (wasm,
     `related = []` no MVP — ver abaixo) → `webLlmTransport` (`fetch`, chave só no header) →
     `aiWebFinalize` (wasm) → `AiAnswer`. `reading.web.ts` **destuba** `askSessionAnchored`. O
     `ReaderChatPanel` (F3.6) passa a funcionar no web só por este glue.
   - **Decisão MVP `related = []`:** o `related` (RAG leve = rótulos de xref do store web) fica
     **vazio** no web nesta fatia. Não é drift do anti-alucinação (o prompt/contexto é do MESMO
     Rust `ai::ask_context`; `related` é **recuperação** de store — infra TS, ADR-0011). Popular
     `related` via `crossRefsOnHandle` é follow-up (exige formatar rótulos, hoje só em Rust).
2. **Pesquisa Wikipedia web = `fetch` TS keyless (opt-in), SEM Rust** (ADR-0028): novo
   `app/web/research.web.ts::wikipediaSearch(fetchImpl, query, lang, limit) ->
   StudyWebSourceInput[]` — `fetch` à API pública (`/w/api.php?action=query&list=search&
   format=json&origin=*&srsearch=…`, **keyless**), mapeia `search[]` → `{title, url (artigo),
   snippet (sem HTML), site, fetchedAt}`. `study.web.ts::deepStudyOnHandle` passa a resolver
   `web_sources` quando `researchBackend === 'wikipedia'` (query = rótulo da passagem, como o
   nativo `deep_study`) e os repassa a `study_web_prepare`/`study_web_finalize` (que **já
   aceitam**). O bloco `[W:n]` no prompt, as citações `kind="Web"` (das URLs, `from_web_results`)
   e o `verify`/aparato vêm do **MESMO Rust `ai-pure`** — **nunca** do modelo. Sem backend (ou
   `undefined`) → `[]` (offline por padrão, comportamento F3.12a); backend desconhecido → erro
   explícito (espelha `build_research_provider`). **UI:** `ReaderStudyPanel` ganha um **toggle
   opt-in DESLIGADO por padrão** + **aviso de privacidade** (a rede Wikipedia só ocorre quando o
   usuário liga; keyless, sem segredo).
3. **Comparação web = reuso puro de `askAnchored`** (já destubada, F2.7b): **nenhum** glue/
   fronteira nova; só **un-SKIP** de `compare-selftest.web.ts` (2× `askAnchored` `"mock"`, mesma
   âncora → `cited_match`) e `chat-selftest.web.ts` (conversa de 2 turnos), agora provas reais
   pela fronteira web.

### Prova (portões F3.12b)
`session_web_prepare` nos bindings web (`gen-bindings-web.sh` exit 0, `sessionWebPrepare`
presente); grafo wasm **puro** (`cargo tree` wasm sem `rusqlite`/`reqwest`/`wasm-bindgen`/
`js-sys`); `cargo fmt`/`clippy -D warnings`/`test` (**68** = 65 + 3 host: **paridade** conversa
nativo↔web — `(system,user)` capturado idêntico ao `ask_session` nativo → zero drift; system
de follow-up de estudo ≠ `ask` simples; `related` entra no contexto). Provas **headless node**
(fetch MOCK, sem rede/chave real): `askSession.web` ponta a ponta (citedText = João 3:16 KJV
VERBATIM do store ≠ interpretation do mock; multi-turno sem panic; user ancora no citedText 1×
+ transcript; provider gemini, chave só no header, 1 fetch; "mock" = 0 fetch); `research.web`
(estudo Acadêmico com `researchBackend="wikipedia"` + fetch MOCK Wikipedia+LLM → ≥1 citação
`kind="Web"` com URL wikipedia + `academicMarkdown` cita `[W`; SEM `researchBackend` → 0 citação
Web; Wikipedia keyless, chave do LLM só no header); `compare.web` (2× `askAnchored` mock, mesma
âncora, `cited_match=true`, 0 fetch). `tsc --noEmit` 0 + `expo export --platform web` 0 (`.wasm`
empacotado); sem regressão web (reading/search/xref/notes/ask/study/léxico/export) nem nativa.

### Consequências
- `the-light` **intacto** (`04b9b24`; consumido como dependência git pinada) e
  `core/Cargo.toml`/`Cargo.lock` **não** alterados — a fronteira web da conversa
  (`session_web_prepare` em `core/src/lib.rs`) é a única mudança em `core/`.
- Anti-alucinação **com ZERO DRIFT**: conversa (`ask_session`+`ask_context`+transcript dobrado),
  `[W:n]`/citações web (`from_web_results`) e verify/aparato do MESMO Rust `ai-pure` no web e no
  nativo; `citedText`/glosas SEMPRE do store; `interpretation` só do LLM.
- Offline-first/BYOK: sem chave/sessão, o app segue 100% offline; a IA web (conversa/estudo) é
  **opt-in** e a chave é session-only (só no header, nunca em git/log). A **pesquisa Wikipedia**
  é a única rede além do LLM, **KEYLESS** e **opt-in** (padrão OFF + aviso de privacidade).
- **Versionado nesta tarefa:** `core/src/lib.rs` (fronteira `session_web_prepare` + 3 testes de
  paridade/host), `app/web/{session,research}.web.ts` (novos), `app/web/{study,reading}.web.ts`
  (wire Wikipedia + destub conversa), `app/web/{chat,compare}-selftest.web.ts` (un-SKIP),
  `app/components/ReaderStudyPanel.tsx` (toggle opt-in + aviso de privacidade),
  `app/web/__tests__/{askSession-headless-entry.ts,askSession.web.test.mjs,research.web.test.mjs,
  compare.web.test.mjs}` (novos), `app/package.json` (scripts), `DECISIONS.md` (este ADR).
  **Gerado/IGNORADO:** `app/web/generated/*` (bindings web).

## ADR-0033 — F4.1: streaming WEB real da IA (token-a-token) = **só o transporte TS streama** via `fetch` + `ReadableStream` (Gemini `:streamGenerateContent?alt=sse`); `ai_web_prepare`/`ai_web_finalize` (Rust `ai-pure`) INALTERADOS

- **Data:** 2026-07-02 · **Status:** aceito · **Tarefa:** F4.1 · **Depende:** ADR-0025 (F2.7b: prepare/fetch/finalize web + chave session-only; adiou o streaming web como follow-up EXPLÍCITO), ADR-0024 (feature `ai-pure`), ADR-0029 (D2: zero drift). **NÃO** toca o `the-light` (@ `04b9b24`) nem `core/**`.

### Contexto
A F2.7b (ADR-0025) entregou a paridade web de IA com o transporte `fetch` **não-streaming** e
adiou EXPLICITAMENTE o streaming web: *"`askAnchoredStream` web é não-streaming (emite a
interpretação 1× via `onToken`; SSE/`ReadableStream` = follow-up)"*. Enquanto o nativo já
streama token-a-token (`AiTokenCallback` do binding gerado), o web (`reading.web.ts::
askAnchoredStream`) obtinha a resposta COMPLETA por `askAnchored` e emitia a `interpretation`
inteira **1×**. Esta tarefa realiza o follow-up: streaming web **real**, sem tocar a fronteira
Rust nem o core.

### Decisão
**O streaming muda SÓ o transporte TS.** A fronteira Rust `ai-pure`
(`ai_web_prepare`/`ai_web_finalize`) é suficiente e permanece **inalterada** — `cited_text`
(numerado, VERBATIM do store) sai do `prepare` e a `interpretation` COMPLETA (concatenação dos
deltas) passa pela MESMA `ai_web_finalize` (`rewrite_anchors`, Rust). **App-side apenas:**

1. **`app/web/ai-anchored.web.ts` (transporte, versionado):**
   - `geminiPartText(raw)`: extrator LENIENTE do delta de UM `GenerateContentResponse` parcial
     (mesmo shape `candidates[0].content.parts[*].text`; `''` quando o evento não tem texto) —
     fatorado de `geminiExtract` (estrito, não-streaming, que o REUSA na agregação).
   - `geminiCompleteStream(fetchImpl, key, request, onToken)`: `POST` ao endpoint
     `:streamGenerateContent?alt=sse` (MESMO corpo `geminiBody`), lê `res.body.getReader()` +
     `TextDecoder`, quebra por linha, parseia cada evento SSE `data: {…}`, extrai o delta,
     `onToken(delta)` por evento e ACUMULA. Tolera `data: [DONE]`/linhas parciais/quebra de
     evento através de fronteiras de byte (buffer de linha). Devolve o texto completo (idêntico
     ao `:generateContent`) → segue para `finalize`.
   - `webLlmTransport(fetchImpl, provider, key, parts, onToken?)`: parâmetro OPCIONAL final. Com
     `onToken`: `"gemini"` → `geminiCompleteStream`; `"mock"` → `emitMockStream` (fatia o
     `MOCK_INTERPRETATION` por palavra, OFFLINE, ≥1 incrementos). Sem `onToken`: caminho
     não-streaming INALTERADO (`:generateContent`/`res.json()` — sem regressão; estudo/conversa
     seguem chamando com 4 args).
   - `askAnchoredOnHandle(..., onToken?)`: repassa `onToken` ao transporte; a `interpretation`
     que vai à `aiWebFinalize` é o texto ACUMULADO (idêntico ao não-streaming).
2. **`app/web/reading.web.ts::askAnchoredStream`** DESTUBADO: abre o store web
   (`openReadingDbWeb`) e delega a `askAnchoredOnHandle(..., onToken)` com o `onToken` REAL.
   Assinatura pública e `AiAnswer` final **inalterados** (o `ReaderAskPanel` já consome
   `onToken`; agora recebe N incrementos reais em vez de 1). Chave só no header, session-only.

### Prova (portões F4.1)
Prova **headless node** determinística (fetch MOCK, `ReadableStream` SSE, SEM rede/chave real)
`askAnchoredStream.web` em 3 cenários: **(A limpo)** N=6 deltas → `onToken` 6× na ORDEM, e a
concatenação dos tokens **== `AiAnswer.interpretation`**; 1 `fetch` ao `:streamGenerateContent?
alt=sse` (POST, chave só no header `x-goog-api-key`, NUNCA na URL); `cited_text` = João 3:16 KJV
VERBATIM do store (via `ai_web_prepare`, inalterado), separado da interpretação; **(B âncora)**
o stream emite a âncora Strong ESPÚRIA `[V:G9999]` (bytes fatiados em 7B → eventos SSE quebrados
através de chunks) → `ai_web_finalize` (Rust `rewrite_anchors`) a REMOVE (`interpretation` ==
concatenação com só a âncora espúria removida pelo Rust); **(C mock)** `"mock"` + `onToken` emite
≥1 incremento OFFLINE, **0 fetch**, concatenação == interpretation. `tsc --noEmit` 0 + `expo
export --platform web` 0; grafo wasm segue PURO (streaming é só transporte TS; nada novo no
Rust); SEM regressão dos testes web (reading/search/xref/notes/ask/study/session/research/
compare/lexicon/export) nem do caminho não-streaming (`test:web:ai`).

### Consequências
- `the-light` **intacto** (`04b9b24`) e `core/src/lib.rs`/`core/Cargo.toml`/`Cargo.lock` **NÃO**
  alterados — a mudança é 100% app-side (transporte TS). A fronteira `ai-pure` (prepare/finalize)
  é suficiente para o streaming.
- Anti-alucinação **ZERO-DRIFT**: o streaming só fatia a INTERPRETAÇÃO do modelo em incrementos;
  nenhum texto bíblico é streamado nem reconstruído em TS; o `cited_text` viaja SEPARADO (store,
  via `prepare`) e a interpretação completa passa pela MESMA `ai_web_finalize` (remove âncoras
  Strong/`[W:n]` inválidas). Os deltas são SÓ texto do modelo.
- Offline-first/BYOK: sem chave/sessão, o app segue offline; a IA web é opt-in; a chave
  session-only vai SÓ no header (nunca em git/log/URL). O `"mock"` streama sem rede.
- **Versionado nesta tarefa:** `app/web/ai-anchored.web.ts` (streaming no transporte),
  `app/web/reading.web.ts` (destub `askAnchoredStream`), `app/package.json` (script
  `test:web:ai-stream`), `app/web/__tests__/{askAnchoredStream-headless-entry.ts,
  askAnchoredStream.web.test.mjs}` (novos), `DECISIONS.md` (este ADR).
  **Gerado/IGNORADO:** `app/web/generated/*` (bindings web, inalterados — nenhum símbolo novo de
  fronteira).

## ADR-0034 — F4.2: transporte web MULTI-PROVEDOR (anthropic/openai/ollama) = **só o transporte TS** despacha por provedor (endpoint/headers/body/extract + streaming SSE/NDJSON); `ai_web_prepare`/`ai_web_finalize` (Rust `ai-pure`) INALTERADOS

- **Data:** 2026-07-02 · **Status:** aceito · **Tarefa:** F4.2 · **Depende:** ADR-0033 (F4.1: streaming web = só transporte TS via `ReadableStream`), ADR-0025 (F2.7b: prepare/fetch/finalize web + `*_body`/`*_extract` espelham os PRIVADOS do core; chave session-only; MVP Gemini com os demais provedores adiados como follow-up), ADR-0029 (D2: zero drift). **NÃO** toca o `the-light` (@ `04b9b24`) nem `core/**`.

### Contexto
A F2.7b (ADR-0025) entregou a paridade web de IA com o transporte `fetch` só para `gemini`+`mock`
(MVP) e deixou os demais provedores — `anthropic`/`openai`/`ollama`, que **já existem no core**
(`ai::PROVIDERS`, nativo já funciona) — a lançar *"ainda não tem transporte web"*. A F4.1
(ADR-0033) adicionou o streaming token-a-token (SSE) para o Gemini. Esta tarefa completa a
matriz de provedores web, mantendo tudo app-side (transporte TS), sem tocar a fronteira Rust nem
o core (o `LlmRequestParts` do `ai_web_prepare` — `system`/`user`/`model` resolvido por provedor
— é suficiente).

### Decisão
**O multi-provedor muda SÓ o transporte TS.** A fronteira Rust `ai-pure`
(`ai_web_prepare`/`ai_web_finalize`) permanece **inalterada** — `cited_text` (numerado, VERBATIM
do store) sai do `prepare` (SEPARADO) e a `interpretation` COMPLETA (não-streaming: `*_extract`;
streaming: concatenação dos deltas) passa pela MESMA `ai_web_finalize` (`rewrite_anchors`, Rust).
Em `app/web/ai-anchored.web.ts` (transporte, versionado), para CADA provedor, ESPELHANDO os
`*_body`/`*_extract` PRIVADOS do core (`providers.rs`) — transporte = infra, ADR-0023/0025:

1. **Helpers compartilhados:** `postJson` (`POST` genérico: monta headers/body, erra citando o
   provedor + status HTTP — nunca a chave); `readLineStream` (esqueleto de leitura de
   `ReadableStream` LINHA a LINHA — `getReader()`+`TextDecoder`+buffer, reconstrói linhas
   quebradas através de fronteiras de byte — reusado por TODOS os streamings); `parseSseData`
   (parser de linha SSE `data: {…}` genérico, tolera `[DONE]`/`event:`/parcial). O
   `geminiComplete`/`geminiCompleteStream` foram REFATORADOS para reusá-los (comportamento
   idêntico; sem regressão do `test:web:ai`/`test:web:ai-stream`).
2. **Anthropic** (`x-api-key`+`anthropic-version`; `POST https://api.anthropic.com/v1/messages`):
   body `{model, max_tokens:8192, system, thinking:{type:"adaptive"}, messages:[{role:"user",
   content:user}]}` (+`stream:true` no streaming); extract não-stream = concat dos blocos
   `content[type=="text"].text` (`stop_reason=="refusal"` → erro); DELTA streaming (SSE) =
   eventos `content_block_delta` com `delta.type=="text_delta"` → `delta.text`.
3. **OpenAI** (`authorization: Bearer <key>`; `POST https://api.openai.com/v1/chat/completions`):
   body `{model, max_tokens:8192, messages:[{role:"system"},{role:"user"}]}` (+`stream:true`);
   extract não-stream = `choices[0].message.content`; DELTA streaming (SSE) =
   `choices[0].delta.content` (+`data: [DONE]`).
4. **Ollama** (LOCAL, **SEM chave** — header só `content-type`; `POST http://localhost:11434/api/
   chat`): body `{model, stream:<bool>, messages:[{role:"system"},{role:"user"}]}`; extract
   não-stream = `message.content`; DELTA streaming = **NDJSON** (JSON por linha, sem prefixo
   `data:`) `{"message":{"content":...},"done":...}` → `message.content` por linha.
5. **`webLlmTransport`:** novos `case` `anthropic`/`openai`/`ollama` — exige chave (SÓ
   anthropic/openai; ollama **não**) e despacha `*CompleteStream` (com `onToken`) ou `*Complete`
   (sem). Chave ausente/vazia p/ anthropic/openai → erro que cita **só o provedor** (nunca o
   valor). `askAnchoredOnHandle` inalterado (o despacho é interno).

### Prova (portões F4.2)
Prova **headless node** determinística (`multiProvider.web.test.mjs`, fetch MOCK SSE/NDJSON, SEM
rede/chave real) para CADA provedor (anthropic/openai/ollama), em 3 cenários: **(1 streaming
limpo)** N=5 deltas → `onToken` 5× na ORDEM, concatenação == `AiAnswer.interpretation`; request
CAPTURADO asserta endpoint + método POST + header da chave CORRETO por provedor (ollama SEM chave)
+ body espelhando o `*_body` do core + a chave DUMMY NUNCA na URL; **(2 não-streaming)**
`interpretation` == `*_extract` do shape do provedor; **(3 âncora espúria + bytes fatiados 5B)** o
stream emite `[V:G9999]` → `ai_web_finalize` (Rust) a REMOVE. Em TODOS: `cited_text` = João 3:16
KJV VERBATIM do store (via `ai_web_prepare`, inalterado), separado; `provider`/`model` (default
resolvido pelo `ai_web_prepare`) conferem. + Chave ausente (anthropic/openai) → erro cita só o
provedor, 0 fetch. `tsc --noEmit` 0 + `expo export --platform web` 0; grafo wasm PURO (sem
`rusqlite`/`reqwest`); SEM regressão dos testes web (ask/ask-stream gemini-mock/study/session/
compare/…).

### Consequências
- `the-light` **intacto** (`04b9b24`) e `core/src/lib.rs`/`core/Cargo.toml`/`Cargo.lock` **NÃO**
  alterados — a mudança é 100% app-side (transporte TS). Nenhum binding novo de fronteira. Os
  provedores JÁ existem no core (nativo já funciona); um provedor **novo, inexistente no core**
  exigiria `impl LlmProvider` no core → PR futuro (`gate:true`, fora de escopo).
- Anti-alucinação **ZERO-DRIFT**: o transporte só monta o request (com `system`/`user`/`model` do
  Rust `ai-pure`) e extrai a INTERPRETAÇÃO do modelo; nenhum prompt/RAG/citação/aparato é
  reimplementado em TS; o `cited_text` viaja SEPARADO (store, via `prepare`) e a interpretação
  completa passa pela MESMA `ai_web_finalize`. Os `*_body`/`*_extract` espelham os PRIVADOS do
  core.
- BYOK — **chave por provedor, session-only, só no header:** anthropic `x-api-key`
  (+`anthropic-version`), openai `Authorization: Bearer`, gemini `x-goog-api-key`, **ollama sem
  chave** (localhost). NUNCA na URL/log. `fetch` INJETÁVEL; a prova usa MOCK (nenhuma rede/chave
  real).
- Offline-first: a IA web é opt-in; sem chave/rede o app segue offline; o `"mock"` roda sem rede.
- **Versionado nesta tarefa:** `app/web/ai-anchored.web.ts` (multi-provedor no transporte +
  helpers compartilhados + refactor do Gemini), `app/package.json` (script
  `test:web:ai-multiprovider`), `app/web/__tests__/{multiProvider-headless-entry.ts,
  multiProvider.web.test.mjs}` (novos), `DECISIONS.md` (este ADR).
  **Gerado/IGNORADO:** `app/web/generated/*` (bindings web, inalterados — nenhum símbolo novo de
  fronteira).

## ADR-0035 — F4.6: streaming NATIVO real por provedor (SSE/NDJSON) = **PR ao `the-light-core`** sobrescrevendo `LlmProvider::complete_stream` nos 4 provedores (embedded-only, não-quebrante, zero-drift); assinatura/fronteira/bindings INALTERADOS

- **Data:** 2026-07-02 · **Status:** **aceito e MERGEADO** (the-light PR [#2](https://github.com/butkeraites/the-light/pull/2), squash/ff na `main` → rev **`2fc2dabbe1e8ea14d9aab07ba774221595b65b7d`**; `core/Cargo.toml` re-pinado 2 linhas) · **Tarefa:** F4.6 (**gate:true** — toca o `the-light` via PR + ADR) · **Depende:** ADR-0023 (D4: streaming na fronteira), ADR-0024/F2.7 (precedente PR `ai-pure` ao core + re-pin), ADR-0005 (precedente PR de feature-gating + molde de handoff), ADR-0033/ADR-0034 (streaming/multi-provedor **web** = só transporte TS). · **Handoff:** push/merge autorizado pelo humano e executado pelo Driver (merge local via git após o classificador gatear o `gh pr merge`) → o Driver **re-pinou** `core/Cargo.toml` (2 linhas) no novo rev.

- **Atualização (merge, 2026-07-02):** a revisão adversarial (workflow 5 lentes) do diff aplicado aprovou zero-drift / não-quebrante / BYOK / wire-format e encontrou **1 achado real** — frames de **erro in-band** (após o 200: `overloaded_error`/rate-limit/`error`) eram silenciosamente engolidos pelo catch-all dos parsers, truncando a resposta como `Ok(parcial)`. **Corrigido no mesmo PR:** cada `*_stream_delta` agora devolve `AiError::Http` (via `api_error_msg`) num frame de erro, espelhando a política dos `*_extract` não-streaming (+4 testes). Gates no the-light verdes (fmt/clippy `-D warnings`/`test --workspace` 196 no core, wasm `ai-pure` puro). Re-pin revalidado: fronteira 69 testes, `tsc`/`expo export web`/15 self-tests web verdes, grafo wasm puro no novo rev. Streaming nativo com chave real = etapa humana (base F4.5 aceita).

### Contexto
Este é o **último caminho de IA ainda não-streaming**. No core pinado (`04b9b24`), **nenhum**
provedor sobrescreve `LlmProvider::complete_stream`: todos caem no **default não-quebrante**
(`ai/mod.rs:378-387`), que chama `self.complete()` e emite a **String inteira 1×** por `on_token`.
Logo o nativo "streama" em **um único incremento**. O web já streama token-a-token via transporte
**TS** (F4.1/F4.2, ADR-0033/ADR-0034); a fronteira (`ask_anchored_stream` → `AiTokenCallback`
UniFFI) já sabe repassar N tokens — só o **transporte nativo** ainda emite 1×. A **D4** do ADR-0023
(streaming) previu justamente o override SSE real de `complete_stream` mantendo a assinatura, sem
mudar os chamadores. Fatos confirmados byte-a-byte na fonte (checkout só-leitura do cargo,
`04b9b24`): trait `complete_stream` é **puro** (`ai-pure`, o default compila em wasm); os 4
providers são `#[cfg(feature="embedded")]`; `AiError::Http`/`BadResponse` (puros) bastam;
`reqwest::blocking::Response: std::io::Read` → `BufReader::lines()` cobre SSE **e** NDJSON (sem a
feature async `stream`).

### Decisão
**PR sancionado ao `the-light`** (branch `feat/native-sse-streaming` sobre `04b9b24`; escopo SÓ
`crates/the-light-core/src/ai/{mod.rs,providers.rs}` + testes) que **sobrescreve
`complete_stream`** nos 4 provedores reais, abrindo a conexão de **streaming do provedor** com
`reqwest::blocking`, emitindo **cada delta** por `on_token` e devolvendo a **resposta completa**
(concatenação) — **idêntica** à de `complete`. Design em duas camadas (espelha `send_json`
embedded ↔ `parse_api_response` puro), detalhado em
`loop/proposals/the-light-PR-native-sse-streaming.md`:

1. **Parsers de delta PUROS, un-gated** (só `serde_json`, já em `ai-pure`; cobertos pelo
   `allow(dead_code)` de topo de `providers.rs`): `sse_data` (payload de linha SSE `data:`),
   `anthropic_stream_delta`/`openai_stream_delta`/`gemini_stream_delta`/`ollama_stream_delta`
   (cada um espelha o `*_extract` correspondente) e `with_stream` (liga `"stream": true` reusando
   o `*_body`).
2. **Leitor `stream_reader` PURO** (`std::io::BufRead`, testável com `Cursor` de fixture) +
   **`stream_response` `#[cfg(embedded)]`** (checa status HTTP → `AiError::Http`, delega ao leitor)
   + os **overrides** de `complete_stream` e métodos `post_stream` por provedor (`embedded`).
3. **Transporte por provedor:** SSE (`text/event-stream`) p/ anthropic (`content_block_delta` →
   `delta.text` do `text_delta`; ignora `thinking_delta`; `refusal` → erro), openai
   (`choices[0].delta.content`; `[DONE]` ignorado), gemini (endpoint
   `:streamGenerateContent?alt=sse`, corpo idêntico; `candidates[0].content.parts[].text`;
   `blockReason` → erro); **NDJSON** p/ ollama (1 JSON por linha, `message.content`,
   `with_stream` troca o `"stream": false` do `ollama_body` p/ `true`).
- **Ollama = INCLUIR o override** (decisão explícita, não deixar no default): NDJSON é mais simples
  que SSE, o web já streama ollama (ADR-0034), e deixar 1 dos 4 no default manteria o "último
  caminho não-streaming" aberto. Reversível (remover o override → volta ao default).

### Garantias
- **Não-quebrante:** só se **acrescenta** o override de um método de trait que já tem **default**.
  `MockLlmProvider` (e qualquer provedor futuro sem override) continua no default (1×);
  `complete`/`chat`/`*_body`/`*_extract` intactos; **nenhuma** mudança em `Cargo.toml`/`lib.rs`/
  `[features]`; `default = ["embedded"]` **byte-a-byte**; nenhuma variante de `AiError` nova.
- **Zero-drift (anti-alucinação):** a **concatenação dos deltas == a resposta de `complete`** (cada
  parser espelha seu `*_extract`); o streaming muda **só o TRANSPORTE nativo**; a interpretação
  final é a MESMA e o `cited_text`/citações continuam do store/`ai-pure` na fronteira. Os deltas são
  **só** texto do modelo — **nunca** texto bíblico.
- **Embedded-only / wasm PURO:** tudo que usa `reqwest` fica sob `#[cfg(feature="embedded")]`; os
  parsers puros usam só `serde_json` (já em `ai-pure`). **Nada novo** no grafo `ai-pure`/wasm; o
  `complete_stream` **default** segue puro; o **web permanece** com o transporte TS (F4.1/F4.2 —
  ADR-0033/0034).
- **Assinatura INALTERADA:** `complete_stream(&self, &str, &str, &mut dyn FnMut(&str)) ->
  Result<String>`. Logo `ask_anchored_stream` (`core/src/lib.rs`) + `AiTokenCallback` (UniFFI/JSI) e
  os bindings **não** mudam — só passam a receber **N tokens reais** em vez de 1. **Sem** regeneração
  de bindings.
- **BYOK:** chave **só no header** (anthropic `x-api-key`; openai `authorization: Bearer`; gemini
  `x-goog-api-key`; ollama **sem chave**), **nunca** na URL/log/git. Prova **determinística por
  parser puro sobre fixture** (sem rede/chave no CI).
- **Offline-first:** streaming é opt-in e só melhora o transporte de uma chamada de IA que já é
  opt-in; nenhuma capacidade essencial passa a exigir rede.

### Prova (no `the-light`, branch) e testes propostos
Sob `cargo test` (default = `embedded`): (a) parser SSE/NDJSON **por provedor** sobre um corpo de
**fixture** (via `Cursor`) → N deltas na ordem, concat == full (com `thinking_delta`/`event:`/
vazias/`[DONE]` corretamente ignorados; `refusal`/`blockReason` → erro); (b) `complete_stream`
concat == `complete` para o `MockLlmProvider` (prova o **default preservado** = 1 delta e o
zero-drift do retorno). Portões: `cargo fmt --all --check`, `cargo clippy --workspace -- -D
warnings`, `cargo test --workspace` verdes; `cargo build -p the-light-core` (default/embedded)
byte-a-byte; `cargo build -p the-light-core --no-default-features --features ai-pure --target
wasm32-unknown-unknown` verde (grafo puro intacto). Validação com **chave real** de streaming
nativo (SSE/NDJSON em rede) = **etapa humana** (fora do loop; base de conteúdo real aceita na F4.5).

### Consequências / handoff
- **Bloqueante (gate:true):** o executor preparou a proposta
  (`loop/proposals/the-light-PR-native-sse-streaming.md`) + este ADR; o Driver **HALTA** para o
  humano revisar/mergear o PR no `the-light` e fornecer o **novo rev**.
- **Pós-merge (Driver):** re-pina `core/Cargo.toml` (2 linhas: web `ai-pure` l.37 + nativa
  `embedded` l.44 → novo rev) + `core/Cargo.lock`; revalida a fronteira (`cargo test -p
  the-light-app-core`, `ask_anchored_stream` funcional), o grafo wasm PURO (`ai-pure` sem
  `reqwest`/`rusqlite`) e o web (`tsc --noEmit` + `expo export --platform web`).
- **Risco registrado (para o humano):** o zero-drift *de fixture* prova que o **parser** não diverge;
  a igualdade *em rede real* (stream vs não-stream) depende do provedor (ordenação de partes/
  whitespace) → validação humana. Se, ao compilar no branch, ficar comprovado que a assinatura de
  `complete_stream` PRECISA mudar (novo tipo de erro/sink que force a fronteira/bindings) → é
  **decisão para o humano**: parar e registrar, **não** improvisar.
- **Versionado nesta tarefa (app repo apenas):** `loop/proposals/the-light-PR-native-sse-streaming.md`
  (proposta do PR), `DECISIONS.md` (este ADR), `loop/queue/F4.6-pr-streaming-nativo-sse.task.md`
  (task `in_progress`). **NENHUM** arquivo do `the-light`/`core/**`/`core/Cargo.toml` tocado; pin
  `04b9b24` intacto.

## ADR-0038 — F5.2: camada de i18n de CROMO de UI (PT/EN) dependency-free + KV de preferências OFFLINE + detecção de idioma do device (sem rede/dep nova); tela HOME migrada ponta a ponta

> Numeração: ADR-0036 está reservado ao gate de sync (F5.22) e ADR-0037 à PR `ai-pure`
> de planos (F5.10). O próximo ADR REALMENTE livre para o workstream de i18n/a11y/temas
> é este, **ADR-0038** (confirmado contra `DECISIONS.md` + backlog/loop).

### Contexto
O app tinha 100% da UI em português hardcoded e nenhuma camada de internacionalização.
O `theme.ts` (F1.4/ADR-0015) já estabeleceu o molde de uma camada de UI dependency-free
(`.ts` puro com `createElement`, `Provider`/hook, tokens centralizados) — mas o modo de tema
NÃO persiste entre reinícios (só na sessão), porque não havia um KV de preferências offline.
O `keystore.ts` (F2.4/ADR-0023) estabeleceu o molde de serviço com **backend injetável**
(`SecureBackend`) para teste headless. Faltava (a) um catálogo de strings PT/EN, (b) um KV
de preferências OFFLINE reutilizável e (c) provar a fatia vertical fim-a-fim numa tela.

### Decisão
1. **i18n dependency-free (`app/lib/i18n.ts`):** `Locale = 'pt' | 'en'`; catálogos `pt`/`en`
   tipados como `Record<MessageKey, string>` — o TypeScript **força a paridade** (toda chave
   existe nos dois idiomas em tempo de compilação). `translate(locale, key, params?)` PURA
   (interpola `{param}` por `split/join`, sem depender de ES2021). `I18nProvider`/`useI18n()`
   expõem `{ locale, t, setLocale, isSystem }` (molde `theme.ts`, só `react` — **sem
   `react-native`**, o que mantém o módulo bundlável headless). **NÃO** se introduziu
   `i18next`/`expo-localization`/`AsyncStorage` (regra da task).
2. **Detecção OFFLINE do idioma do device:** `detectDeviceLocale()` usa `navigator.language`
   (web) e cai em `Intl.DateTimeFormat().resolvedOptions().locale` (nativo/Hermes com Intl),
   `pt` como fallback. `normalizeLocale` faz `pt-*`→`pt`, `en-*`→`en`, desconhecido→`pt`
   (preserva o PT-default atual). Zero rede.
3. **KV de preferências OFFLINE (`app/lib/prefs.ts` + `prefs.web.ts`):** `createPrefs(backend?)`
   com `PrefsBackend` INJETÁVEL (molde do keystore). Nativo = arquivo `prefs.json` sob o
   `documentDirectory` (`expo-file-system/legacy`, import LAZY — molde `userdata.ts`); web =
   `localStorage`. API `getPref`/`setPref`/`removePref` (`string→string`), namespaceada por
   `tla.pref.<key>`, **nunca logada**. É DISTINTO do keystore: prefs guardam dado NÃO-secreto
   (idioma), por isso `localStorage` no web é adequado (o OPOSTO da política session-only de
   CHAVES BYOK, ADR-0025). Este KV é o **alicerce reutilizável** do workstream (theme-persist
   futuro reusa-o, fechando a lacuna do ADR-0015).
4. **Persistência do idioma:** no boot, o `I18nProvider` re-hidrata o override salvo (prefs);
   `setLocale` persiste; `isSystem=true` enquanto não há override salvo. Falha de storage é
   tolerada (offline-first não quebra a UI).
5. **Seletor (`app/components/LanguageToggleButton.tsx`):** alterna PT⇄EN, `testID='language-toggle'`,
   `accessibilityRole='switch'`, label via `t()`, cor por token de tema. Inserido no header ao
   lado do `ThemeToggleButton` (`_layout.tsx` agora envolve a stack em `I18nProvider` e mostra
   ambos os toggles em TODAS as telas — inclusive a home).
6. **Home migrada ponta a ponta (`app/app/index.tsx`):** 100% das strings via `t()`; elementos
   interativos com `accessibilityRole`/`Label` + testIDs; **ZERO hex** (todas as cores de
   `useTheme()`) — a home passa a ser temática e acessível. O resultado é guardado como DADO
   estruturado (`Outcome`) e formatado no RENDER, de modo que trocar o idioma re-renderiza o
   CROMO na hora.

### Garantias (não-negociáveis)
- **Anti-alucinação (LEI):** `t()` traduz APENAS cromo de UI. O TEXTO do versículo (`v.text`)
  vem VERBATIM do store (Rust) e nunca passa por `t()`; os rótulos de referência (`livro`/`cap.`/
  `v.`) são cromo, mas os NÚMEROS são dados. A prova headless verifica, estruturalmente, que
  TODA `MessageKey` está num namespace de cromo (`home`/`ref`/`a11y`/`language`) — nenhuma chave
  de conteúdo bíblico. Atribuições CC-BY não são tocadas.
- **Conceitos distintos:** `locale`/`language` (idioma da INTERFACE) ≠ `translation` (VERSÃO
  bíblica). O módulo NÃO usa o nome `translation` (só o menciona em comentário para documentar
  a distinção).
- **Offline-first:** detecção e persistência 100% locais (sem rede/conta). Idioma default =
  device (fallback PT). A escolha sobrevive a reinícios.
- **the-light:** `core/src/lib.rs` e `core/Cargo.toml` INALTERADOS; pin `2fc2dab` intacto —
  tarefa 100% app-side.

### Prova (headless, determinística) e gates
- `app/web/__tests__/i18n.test.mjs` (script `test:i18n`; esbuild, sem wasm/rede): paridade de
  catálogo pt↔en (sem chave órfã dos dois lados); `translate()` PT/EN corretos + uma chave que
  DIVERGE (troca observável) + interpolação; round-trip de persistência sobre backend em memória
  que SOBREVIVE a uma nova instância de `Prefs` (reabrir o app) + re-hidratação; fallback de
  detecção (`pt-BR`→pt, `en-US`→en, desconhecido→pt); higiene (sem `console.*`).
- Gates verdes: `tsc --noEmit` (0), `expo export --platform web` (exit 0, 7 rotas), sem
  regressão dos `test:web:*`/`test:keystore` existentes. `grep` de hex na home = vazio.
- **eslint:** o repo NÃO tem config de eslint (nenhum `.eslintrc`/`eslint.config.*`;
  `eslint --print-config` confirma "not configured"). Seguindo a regra "não inventar eslint",
  o gate de eslint do bloco de verificação da task é **N/A** neste repo (os demais gates cobrem).

### Consequências
- **Fundação do workstream:** o KV de prefs e o catálogo tipado são a base de F5.5/8/11/…
  (migração das demais telas, que ainda têm strings PT hardcoded — os títulos de navegação em
  `_layout.tsx` seguem PT nesta fatia, por design de tracer). `theme-persist` reusa `prefs`.
- **Nenhuma dependência nova** foi adicionada (regra da task cumprida).

## ADR-0039 — F5.7: UI NATIVA de planos de leitura (rota expo-router lista→iniciar→dia de hoje→marcar) orquestrando as fronteiras F5.1 (geração) + F5.4 (progresso); native-first + self-test on-device TLA_PLANS

### Contexto
F5.1 (geração: `list_reading_plans`/`reading_plan_day`/`reading_plan_day_index`) e F5.4
(progresso: `reading_plan_progress`/`start_reading_plan`/`set_reading_plan_completed`/
`clear_reading_plan`) já expuseram a superfície de planos pela fronteira NATIVA (glue em
`app/web/reading.ts`), provadas por host tests Rust — mas SEM UI e sem prova on-device. O
módulo `the_light_core::userdata::plans` é `#[cfg(feature="embedded")]` (**nativo-only**);
no web os bindings são STUBS (lista vazia / lançam). Faltava a tela que orquestra essas fns
e a prova de que o vertical roda no device.

### Decisão
1. **Rota NATIVA `app/app/plans/index.tsx`** (registrada em `_layout.tsx` como
   `plans/index`, com o `screenChrome` temático; link `open-plans` na home, gateado p/
   nativo como os de leitura/busca). Duas telas de estado: (a) SEM plano ativo → lista
   `listReadingPlans()` (nome PT verbatim do CATALOG + nº de dias) com "Começar" →
   `startReadingPlan(dir, id, hojeISO)`; (b) plano ATIVO → cabeçalho (nome + barra
   `completed/len` + sequência), `FlatList` de dias com HOJE destacado (índice de
   `readingPlanDayIndex(startDate, hojeISO, len)`), tocar um dia abre o Reader existente
   em `/read/${ref.book}/${ref.chapter}` (1º capítulo inteiro do dia), "Marcar dia como
   lido" → `setReadingPlanCompleted(dir, completed+1)`, "Trocar/encerrar" → `clearReadingPlan`.
   A UI **só orquestra** as fns da fronteira — ZERO geração/progresso reimplementado em TS.
2. **Anti-alucinação:** nomes de plano vêm do CATALOG (core), rótulos/refs de dia de
   `reading_plan_day` (core), e o texto do versículo é lido pelo Reader (verbatim do store).
   A UI NUNCA sintetiza texto/refs. As strings de CROMO (títulos/botões/contadores/estados)
   são i18n (`plans.*`/`nav.plans`/`home.readingPlans`/`a11y.*`, PT+EN, paridade em
   compile-time); o namespace `plans` entrou no guarda anti-alucinação do `i18n.test.mjs`.
3. **Native-first / web:** a rota degrada no web com um aviso (`plans.webUnavailable`) SEM
   tocar a fronteira (evita os stubs que lançam), mantendo o build web verde (`expo export`
   inclui `/plans` como 8ª rota). Paridade web REAL (OPFS) = F5.10 (gate ADR-0037).
4. **Sequência (streak):** definida de forma determinística como `completed` (dias
   concluídos consecutivos a partir do dia 1 — o `completed` avança sequencialmente); sem
   estado extra. `dataDir` resolvido por `ensureUserDataDir()` (mesmo root das notas/F1.11).
5. **Self-test on-device (`app/web/plans-selftest.ts`, molde F1.11):** num dir ISOLADO,
   roda lista→dia0→iniciar→índice de hoje→marcar→**releitura independente** e emite
   `TLA_PLANS plan_id="gospels" days=30 today_index=<n> completed=<m> persisted=<bool>`
   COMPOSTO do retorno real (sem hardcode). Par `.web.ts` = SKIP; registrado em
   `selftest.ts`; `run-ios-selftest.sh` assere `plan_id="gospels"` + `days=30` + `persisted=true`.

### Prova (on-device, iOS simulador) e gates
- `run-ios-selftest.sh` verde no iPhone 17 (iOS 26): `TLA_PLANS plan_id="gospels" days=30
  today_index=0 completed=1 persisted=true` (composto do retorno real), SEM regressão dos
  demais marcadores (TLA_SELFTEST/READ/PARALLEL/SEARCH/XREF/NOTES/ASK/STUDY/CHAT/COMPARE/EXPORT).
- **Regeneração do módulo nativo:** o `.a`/xcframework iOS estava DEFASADO (Jun 30, anterior a
  F5.1/F5.4 → sem os checksums UniFFI das fns de plano; o app quebraria em `initialize()`).
  `scripts/gen-bindings-ios.sh` regerou o módulo (build incremental do alvo `aarch64-apple-ios-sim`,
  cache quente) → 7 símbolos de checksum de plano presentes; só então o self-test roda no device.
- `tsc --noEmit` (0) com os bindings regenerados; `expo export --platform web` (exit 0, 8 rotas);
  `test:i18n` (44 chaves, paridade PT↔EN, guarda anti-alucinação com `plans`) + `test:web:*`/
  `test:keystore` sem regressão. `eslint` = N/A neste repo (sem config — ADR-0038).
- the-light `2fc2dab` **intacto** (nenhuma mudança em `core/src/lib.rs`; a tarefa é 100%
  app-side: UI + self-test + glue de i18n; os host tests de plano de F5.1/F5.4 só foram RODADOS,
  não alterados).

### Consequências
- Reading-plans nativo agora tem o vertical completo (geração F5.1 + progresso F5.4 + UI F5.7).
  Desbloqueia F5.10 (paridade web — exige a PR `ai-pure` de planos ao core, gate ADR-0037) e
  F5.13 (lembretes locais do plano ativo, reusando o KV de prefs).
- **Nenhuma dependência nova**; o Reader existente é reusado p/ a leitura do dia (sem nova UI
  de leitura). O `web-bundle-baseline.json` (F5.3) fica com um leve drift esperado (+1 rota
  eager); o orçamento é travado como guarda em F5.19 (fora do escopo desta tarefa).

---

## ADR-0040 — F5.9: CODE-SPLIT web dos transportes pesados (factory wa-sqlite + IA/estudo/léxico/busca/xref/userdata) via `import()` no glue `reading.web.ts` + re-centragem da baseline perf (dívida F5.7/F5.8)

- **Data:** 2026-07-02 · **Status:** aceito · **Tarefa:** F5.9 (`gate: false`) · **Depende:** ADR-0019 (F1.13: store web OPFS + factory wa-sqlite), ADR-0025/ADR-0031/ADR-0032 (transportes web de IA/estudo/conversa), ADR-0020/ADR-0021 (busca/xref web), ADR-0022 (userdata web), **F5.3** (métrica `measure-web-bundle.sh` + `web-bundle-baseline.json`). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side (imports/metro/build).

### Contexto
O bundle web do Expo/Metro emitia UM ÚNICO chunk EAGER de entry (~1,45 MB). O glue
web-only PESADO era importado ESTÁTICO por `app/web/reading.web.ts` (o glue que as telas
`app/app/read/**`, `search`, `plans` e os painéis importam), logo entrava no entry mesmo
p/ quem só abre a home: a **factory do wa-sqlite** (`vendor/wa-sqlite-fts5/wa-sqlite.mjs`
~41,5 KB + `MemoryVFS` + a API `wa-sqlite`) via `sqlite-reading-opfs.web`, a IA
`ai-anchored.web` (~32 KB), o estudo/léxico `study.web` (+`sqlite-lexicon.web`+`research.web`),
a conversa `session.web`, a busca `sqlite-search.web`, a xref `sqlite-xref.web`, os SELECTs
`sqlite-reading.web` e o userdata (`userdata-fs.web`/`userdata-opfs.web`). Nada disso é
1º-paint: o 1º paint só precisa de `listBooks()` (síncrono, wasm da fronteira). Em paralelo,
a métrica `scripts/measure-web-bundle.sh` estava **RED** — a dívida acumulada desde a baseline
F5.6: F5.7 (`/plans`) + F5.8/F5.5 (i18n) subiram o `moduleCount` p/ **856** (travado em 854) e
estouraram a banda de bytes do entry.

### Decisão
1. **Code-split no LIMITE DE CHAMADA (só `reading.web.ts`).** Cada função assíncrona do glue
   troca os `import` estáticos pesados por `await import()` (via `Promise.all`) DENTRO do corpo:
   `getChapter`/`listTranslations`/`chapterCount`/`search`/`crossRefs`/`putNote`/… e as fns de
   IA/estudo/conversa carregam a factory wa-sqlite + o `*OnHandle` sob demanda (ao abrir
   capítulo/busca/notas/IA/estudo — "quando o DB é preciso"). `AiFetch` vira `import type`
   (apagado). O Metro/Expo (`expo export --platform web`, `web.output: static`) emite então
   **CHUNKS ASYNC** separados: de 1 → **10 bundles web** (`sqlite-reading-opfs` 42 KB [factory],
   `study` 6,2 KB, `userdata-fs` 2,6 KB, `sqlite-search` 2 KB, `sqlite-xref` 1,7 KB,
   `userdata-opfs` 1,4 KB, `session` 806 B, e `ai-anchored`+`sqlite-reading` no `__common` 9,3 KB
   compartilhado). São assets LOCAIS (offline-first: nenhuma rede; carregam da própria origem).
2. **Zero-drift (muda SÓ QUANDO carrega, nunca o comportamento).** As assinaturas públicas e as
   saídas são IDÊNTICAS — só o TIMING do import muda. Os 15 self-tests `test:web:*` importam as
   fns `*OnHandle` DIRETAMENTE dos sub-módulos (não via `reading.web.ts`), então ficam intactos e
   verdes (prova de zero-drift). Os PAINÉIS (`ReaderAskPanel`/`StudyPanel`/`ChatPanel`/`ComparePanel`)
   **não** foram convertidos a `React.lazy`: são montados sempre com `visible` (Modal + estado
   interno); torná-los condicionais mudaria o ciclo de vida (reset de estado) — BEHAVIOR change SEM
   cobertura de teste → violaria o zero-drift. Eles já não puxam código pesado (o glue o difere).
3. **Re-centragem da baseline (REQUERIDO).** `measure-web-bundle.sh` (budget) + `web-bundle-baseline.json`
   atualizados p/ o estado pós-split: `moduleCount` **856 → 844** (−12; os pesados saíram do entry),
   `eagerBytes` **1.448.032 → 1.381.059** (−66.973 B, −4,6%), `eagerGzip` **372.625 → 352.644**
   (−19.981 B, −5,4%). Tolerâncias (1024 raw / 2048 gzip) intactas p/ o flutter não-determinístico do
   Metro. `moduleCount` (nº de `__d(`) é a grandeza EXATA que pega o split.

### Prova e gates
- **10 bundles web** no `expo export` (era 1); `entry-*.js` = 844 módulos / 1.381.059 B (3 exports
  byte-idênticos). `measure-web-bundle.sh` → **BUDGET OK** (exit 0) com os novos números.
- `tsc --noEmit` (0). Os 15 `test:web:*` (reading/search/xref/notes/ai/ai-stream/ai-multiprovider/
  study/lexicon/export/session/research/research-tavily/compare/firstpaint) + `test:keystore` + `test:i18n`
  **verdes, saídas idênticas** (zero-drift). Grafo wasm da fronteira intacto (frontierWasm byte-igual).
- the-light `2fc2dab` **intacto** (0 mudanças em `core/**`).

### Consequências
- O 1º paint (home/lista de livros) não arrasta mais a factory wa-sqlite (via `reading.web.ts`) nem
  os transportes de IA/estudo/léxico — carregam sob demanda como chunks LOCAIS.
- A baseline volta a VERDE e reflete o split + a dívida F5.7/F5.8. O split do DADO ~9 MB do léxico
  (on-demand DB) é F5.15 e a pré-compressão é F5.17 — fora do escopo desta tarefa.

> **Correção (F5.12 / ADR-0041, 2026-07-03).** A narrativa acima estava IMPRECISA em dois pontos e é
> corrigida aqui: **(1)** `reading.web.ts` NÃO era a única porta ESTÁTICA para o subgrafo pesado — a
> home (`app/app/index.tsx`) puxava, EAGER, uma **2ª factory wa-sqlite** (o build ASYNC do npm) pelo
> caminho F0.10 `app/web/passage.web` → `app/web/sqlite-opfs.web` (`getPassage`, usado só no submit,
> nunca no mount). **(2)** Logo, o "~66 KB / restante IRREDUTÍVEL" NÃO era irredutível: essa 2ª factory
> (~40 KB de glue no entry) + seus assets (npm `wa-sqlite.wasm` 558 KB + `sample.sqlite` 131 KB) eram
> DUPLICADO MORTO e também MOVÍVEL/REMOVÍVEL. A F5.12 (ADR-0041) apontou a home ao MESMO store de
> leitura (build vendorado FTS5 + subset, já lazy) via `import()`, retirando `passage.web` do entry
> (moduleCount 844 → 834; eagerBytes −74,7 KB) e removendo ~689 KB de assets do bundle. A meta de −20%
> do entry segue não-atingível sem quebrar o 1º paint (o restante é RN Web + React + expo-router +
> glue wasm-bindgen + i18n/tema), mas ela é MAIOR que os ~66 KB antes alegados.

## ADR-0041 — F5.12: remover o DUPLICADO MORTO do caminho F0.10 (npm `wa-sqlite` async + `sample.sqlite`) do bundle web, re-apontando a home ao store de leitura + split de `passage.web` (follow-ups da F5.9) + re-centragem da baseline

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.12 (`gate: false`) · **Depende:** ADR-0011/ADR-0012 (F0.10: store web `getPassage`), ADR-0019/ADR-0020 (F1.13/F1.14: store de leitura web + build vendorado wa-sqlite COM FTS5), **ADR-0040** (F5.9: code-split web + baseline), **F5.3** (métrica `measure-web-bundle.sh`). Herda os 2 follow-ups da review da F5.9. **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side.

### Contexto
O export web embarcava DOIS builds do wa-sqlite: o VENDORADO COM FTS5 (`vendor/wa-sqlite-fts5/wa-sqlite.wasm`, 666 KB — usado por leitura/busca desde a F1.14) E o build ASYNC do npm (`node_modules/wa-sqlite/dist/wa-sqlite.wasm`, 558.343 B), MAIS o `sample.sqlite` (131.072 B) da F0.10. Um grep provou que o npm async + o `sample.sqlite` só eram alcançáveis pelo caminho LEGADO F0.10 do `getPassage` da home (`app/app/index.tsx` → `app/web/passage.web` → `app/web/sqlite-opfs.web`), a ÚNICA porta de produção que os importava. O `sample.sqlite` é um TOY de 1 versículo (só `kjv`, livro 43, João 3:16); o subset de leitura `reading-sample.sqlite` (KJV+Almeida de Gn/Sl/Jo) contém João 3:16 KJV **BYTE-IDÊNTICO** e o build FTS5 é SUPERSET do npm (roda o mesmo `SELECT verse,text … WHERE … verse=?`). Logo os 2 assets eram DUPLICADO MORTO. Esse caminho também seguia EAGER (2ª factory wa-sqlite no chunk de entry) — o follow-up (A) da F5.9.

### Decisão
1. **Re-apontar a home ao MESMO store de leitura (F1.13).** `passage.web.ts` deixa de abrir o F0.10 (`sqlite-opfs.web` + npm factory + `sample.sqlite`) e passa a `await import('./sqlite-reading-opfs.web')` (`openReadingDbWeb`, build vendorado FTS5 + subset) + `await import('./sqlite.web')` (a MESMA `readPassage`). `ReadingDb = PassageDb`, então o handle é compatível — a query `Single` e a `Passage` de saída ficam IDÊNTICAS (João 3:16 KJV verbatim). **ZERO-DRIFT** no caso testado; a única mudança de comportamento é que agora referências de Gn/Sl/Jo (que o subset tem) resolvem em vez de "não encontrado" — melhoria, não regressão, e não coberta por nenhum self-test.
2. **Split de `passage.web` (follow-up F5.9-A).** `app/app/index.tsx` passa a `import type` o `Passage` + `await import('../web/passage')` no submit handler (`getPassage` NUNCA roda no mount). `passage.web` sai do chunk EAGER p/ um chunk ASYNC (`passage-*.js`); a factory wa-sqlite carrega SOB DEMANDA, COMPARTILHANDO o chunk `sqlite-reading-opfs` da leitura (nenhuma 2ª factory no entry).
3. **Remover o código/assets mortos.** `app/web/sqlite-opfs.web.ts` (único importador de produção do npm factory + `sample.sqlite`) DELETADO; a declaração de tipo do npm `wa-sqlite/dist/wa-sqlite.wasm` sai de `assets.d.ts`. O `sample.sqlite` (repo/symlink) e o pacote npm `wa-sqlite` PERMANECEM (o pacote fornece a API JS `wa-sqlite`/`MemoryVFS` a TODOS os stores + self-tests; o `sample.sqlite` é só do repo p/ histórico) — mas NENHUM dos dois é mais EMITIDO no `dist`. O self-test `getPassage.web.test.mjs` foi RE-TARGETADO ao build FTS5 + subset (espelha a produção; João 3:16 KJV idêntico).
4. **Correção da ADR-0040 (follow-up F5.9-B)** + **re-centragem da baseline** (`measure-web-bundle.sh` + `web-bundle-baseline.json`): `waSqliteNpm`/`sampleDb` saem de `stable` p/ `removed` (o budget FALHA se reaparecerem); `moduleCount` 844 → 834; `eagerBytes` 1.381.059 → 1.306.320; `eagerGzip` 352.644 → 331.038 (nominais no centro do flutter; tolerâncias 1024/2048 intactas).

### Prova e gates
- `expo export --platform web` (0): `dist` NÃO contém mais `node_modules/wa-sqlite/dist/wa-sqlite.*.wasm` nem `_assets/data/sample.*.sqlite` (−689.415 B); os únicos `.wasm`/`.sqlite` restantes são `frontierWasm`, `readingDb`, `waSqliteFts5`. `passage-*.js` é um chunk ASYNC novo (glue off-eager); a factory FTS5 vive em `sqlite-reading-opfs-*.js` (compartilhado com a leitura).
- `tsc --noEmit` (0). Os 15 `test:web:*` + `getPassage` + `test:keystore` + `test:i18n` **verdes, saídas idênticas** (zero-drift). `measure-web-bundle.sh` → **BUDGET OK** (exit 0) com os novos números; grafo wasm da fronteira intacto (frontierWasm byte-igual).
- the-light `2fc2dab` **intacto** (0 mudanças em `core/**`).

### Consequências
- O bundle web perde ~689 KB (o 2º build wa-sqlite + o toy DB) e o entry perde `passage.web` (10 módulos); a home usa UM ÚNICO engine wa-sqlite (o FTS5 vendorado), servindo leitura, busca E a resolução de passagem da home. Offline-first preservado (assets locais; nada de rede). Anti-alucinação preservada (texto verbatim do store).
- Nota de runtime: a 1ª resolução de passagem na home agora hidrata o subset de 14 MB em OPFS (antes, o toy de 131 KB) — mas é o MESMO subset que a leitura já usa (cacheado após o 1º uso), e é sobre BUNDLE, não runtime, que a tarefa mede. O split do DADO ~9 MB do léxico (F5.15) e a pré-compressão (F5.17) seguem fora do escopo.

## ADR-0042 — F5.13: lembretes LOCAIS opt-in do plano de leitura ativo (`expo-notifications` local, pref app-side na F5.2, web degrada) — offline-first, sem servidor/conta/push token

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.13 (`gate: false`) · **Depende:** **F5.7** (UI de planos), **F5.2/ADR-0038** (KV de prefs offline + i18n de cromo). Adiciona a dep de runtime `expo-notifications` (~56.0.19, app-side — NÃO toca `the-light` @ `2fc2dab` nem `core/**`).

### Contexto
A UI de planos (F5.7) já mostra o plano ativo + progresso, mas não tinha como LEMBRAR o usuário de ler. O requisito é um lembrete DIÁRIO — porém a lei offline-first/BYOK do app proíbe servidor, conta e push token remoto. `expo-notifications` faz agendamento LOCAL no device (iOS/Android) 100% offline (`scheduleNotificationAsync` com trigger DIÁRIO de calendário), sem tocar a rede nem exigir push token. No web, `expo-notifications` é NATIVO e um export web estático não agenda notificação diária confiável (exigiria service worker + background).

### Decisão
1. **Serviço em 3 arquivos (molde `keystore`/`prefs`).** `app/lib/planReminders.shared.ts` tem a LÓGICA PURA (types + `parseHHMM`/`formatHHMM` + `createPlanReminders(notifications, prefs)`) sobre um `NotificationsBackend` INJETÁVEL — SEM `expo-notifications`/`react-native`, testável headless. `planReminders.ts` (NATIVO) define o `defaultNotificationsBackend` que faz import LAZY de `expo-notifications` (agenda/cancela/permissão LOCAL). `planReminders.web.ts` (Metro escolhe no web) é um backend NO-OP documentado (best-effort, nunca lança/toca rede) — mantém `expo-notifications` FORA do bundle web.
2. **Opt-in, OFF por padrão.** A permissão de notificação LOCAL é pedida SÓ dentro de `enableReminder` (nunca no boot). `enableReminder(time, title, body, channelName)`: valida o horário, CANCELA um agendamento anterior (evita duplicar ao trocar horário), pede permissão (se ainda não concedida), agenda UMA notificação diária e persiste a pref. `disableReminder()` cancela e remove a pref. Sem permissão → não agenda e fica OFF.
3. **Pref app-side na F5.2 (SEPARADA do core).** A preferência `{ enabled, time: "HH:MM", id }` é JSON no KV OFFLINE da F5.2 sob `tla.pref.plans.reminder` — a forma de `PlanProgress` do core (`active.json`) fica INTACTA. `id` = identificador da notificação LOCAL agendada, só p/ cancelar. Nada sai do device.
4. **UI (F5.7).** `ReminderControls` (só no ramo nativo de `plans/index.tsx`, sob o plano ativo): `Switch` opt-in + chips de horário-preset (06/07/08/12/18/21h — sem date-picker nativo, evita dep nova). `clearReadingPlan` (trocar/encerrar plano) também CANCELA o lembrete. Corpo/título da notificação = CROMO i18n (`t('plans.reminderTitle'/'reminderBody')`) + NOME do plano VERBATIM do CATALOG do core (`{plan}`), nunca texto bíblico inventado (anti-alucinação). Chaves i18n novas em `plans.*`/`a11y.*` (PT/EN, paridade forçada pelo tipo).
5. **Web degrada.** A tela de planos já mostra `PlansWebNotice` no web (F5.10) e NUNCA renderiza o toggle; o `planReminders.web` no-op existe só p/ paridade de tipos. Planos ficam 100% utilizáveis sem lembretes.

### Prova e gates
- `tsc --noEmit` (0). Self-test headless novo `web/__tests__/planReminders.web.test.mjs` (`npm run test:web:reminders`, esbuild + `expo-notifications`/`expo-file-system` EXTERNAL, backend fake + KV em memória, NENHUMA notificação real): opt-in OFF por padrão; ligar agenda EXATAMENTE 1 diária no horário escolhido + pref sob a chave namespaceada; trocar horário cancela o anterior e agenda 1 novo; desligar cancela e remove a pref; permissão negada não agenda e fica OFF; já-concedida não re-pergunta; pref sobrevive a reabrir; grep estrutural garante ZERO `getExpoPushTokenAsync`/`getDevicePushTokenAsync`/`fetch`/URL/`console.*` nos 3 fontes (estritamente LOCAL, sem servidor/conta/rede/log).
- `expo export --platform web` (0): `dist` com **0** arquivos referenciando `expo-notifications`/push token (grep) — o `.web.ts` no-op mantém o módulo nativo fora do web; os planos e o resto do app degradam sem quebrar. `test:i18n` verde (138 chaves, paridade pt↔en) + os 15 `test:web:*` + `test:keystore` verdes (zero regressão).
- `expo-notifications` adicionado ao `package.json`/`package-lock.json` (~56.0.19, compatível com SDK 56 via `bundledNativeModules`) e ao `plugins` do `app.json` (config plugin p/ o build nativo).

### Consequências
- O plano ativo ganha lembrete diário LOCAL opt-in; leitura/planos seguem 100% funcionais sem nunca habilitá-lo. Nova dep de runtime `expo-notifications` (app-side). Sem servidor/conta/push token/rede — offline-first e BYOK/privacidade preservados (nada logado, nada sai do device). Histórico/soneca de lembrete ficam fora do escopo.

## ADR-0043 — F5.14: persistir o MODO DE TEMA (claro/escuro) entre reinícios no KV de prefs OFFLINE da F5.2 (`tla.pref.theme.mode`) — fecha a lacuna do ADR-0015, sem dependência nova

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.14 (`gate: false`) · **Depende:** **F5.2/ADR-0038** (KV de prefs OFFLINE) e **F1.4/ADR-0015** (sistema de tema). É um **amendment** ao ADR-0015 (persistência agora entregue). NÃO toca `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side, sem dep nova.

### Contexto
O `ThemeProvider` da F1.4 (ADR-0015) mantinha o override de tema (claro/escuro) só em **estado de sessão** (memória): reabrir o app perdia a escolha e voltava a seguir o `useColorScheme()` do sistema. O ADR-0015 registrou isso como "melhoria futura" e a nota da F5.2/ADR-0038 já previa que o KV de prefs OFFLINE serviria, no futuro, para persistir o tema. Esta tarefa entrega exatamente isso REUSANDO a infra — sem criar um 2º mecanismo de persistência e sem dep nova.

### Decisão
1. **Lógica PURA em `themePrefs.ts` (molde `planReminders.shared.ts`).** Um módulo novo, dependency-free e SEM `react-native` (não importa `useColorScheme`), define `ThemeMode` (`'light'|'dark'`), `THEME_MODES`, `THEME_PREF_KEY = 'theme.mode'` e o guard `isThemeMode(value)`. Manter isto SEPARADO de `theme.ts` (que puxa `react-native`) é o que torna a prova headless bundlável em node. `theme.ts` re-exporta `ThemeMode` (compat: consumidores importam de `../lib/theme` como antes).
2. **`ThemeProvider` hidrata no boot e persiste on-change (molde `I18nProvider`).** A base segue sendo `useColorScheme()`; no boot, um `useEffect` lê `getPref('theme.mode')` e, se `isThemeMode(saved)`, aplica o override. `toggle`/`setMode` gravam via `setPref` (ou `removePref` quando `null`, voltando a seguir o sistema) — fire-and-forget, falha tolerada (offline-first, nunca quebra a UI). Só `'light'|'dark'|ausente` são estados válidos; um valor desconhecido/corrompido no storage é IGNORADO pelo guard (segue o sistema). A pref NUNCA é logada.
3. **Reuso do KV da F5.2 (SEM 2º mecanismo).** Grava sob a chave NAMESPACEADA `tla.pref.theme.mode` (via `prefIdFor`), ao lado de `tla.pref.ui.locale` (F5.2) e `tla.pref.plans.reminder` (F5.13): mesmo arquivo JSON nativo / `localStorage` web, mesma superfície `Prefs`. Nada de `AsyncStorage`/`expo-secure-store` (tema NÃO é segredo — o keystore continua exclusivo de chaves BYOK).
4. **Boot-flash aceitável (ADR-0015).** A hidratação é ASSÍNCRONA (o KV nativo/web tem API async): se o modo salvo DIVERGE do esquema do sistema, o 1º paint segue o sistema por um instante até a leitura resolver — comportamento idêntico ao `I18nProvider` da F5.2 e explicitamente aceito pela tarefa/ADR-0015. Não se adicionou leitura síncrona (acoplaria `theme.ts` ao `localStorage` e quebraria a paridade nativa).

### Prova e gates
- `tsc --noEmit` (0). Self-test headless novo `web/__tests__/theme.test.mjs` (`npm run test:web:theme`, esbuild + `expo-file-system` EXTERNAL, `PrefsBackend` FAKE em memória, molde `i18n.test.mjs`): guard `isThemeMode` (só light/dark; `system`/`''`/null/undefined/case-diferente → inválido); ROUND-TRIP `setPref('theme.mode','dark')` → SOBREVIVE a uma NOVA instância de `Prefs` sobre o MESMO storage (reabrir o app) e re-hidrata; grava sob a chave namespaceada `tla.pref.theme.mode` (nunca a crua); `removePref` volta a seguir o sistema; toggle simétrico light/dark; valor desconhecido ignorado; higiene (`themePrefs.ts`/`theme.ts` sem `console.*`).
- `test:i18n` verde (138 chaves, paridade pt↔en) + os 16 `test:web:*` + `test:keystore` sem regressão. `expo export --platform web` (0). `eslint` = N/A neste repo (sem config — ADR-0038).

### Consequências
- A escolha de tema SOBREVIVE a reinícios (fecha a lacuna do ADR-0015) reusando o KV OFFLINE da F5.2 — offline-first e BYOK preservados (nada sai do device, nada logado). Sem dep nova; `core/**`/`the-light` intactos. Um breve flash default→hidrata pode ocorrer no boot quando o modo salvo diverge do sistema (aceitável, molde i18n). Um seletor tri-estado (claro/escuro/sistema) na UI e a auditoria WCAG ficam FORA do escopo (F5.18).

## ADR-0044 — F5.15: separar o DADO do léxico (~9 MB) do caminho de LEITURA web — subset `reading-lite` (leitura, SEM léxico) + `lexicon-sample` (léxico STEP CC-BY carregado ON-DEMAND) + UX de carregamento + re-centragem da baseline

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.15 (`gate: false`) · **Depende:** **F5.3** (métrica `measure-web-bundle.sh` + baseline), **ADR-0040** (F5.9: code-split web dos stores OPFS via `import()`), **ADR-0041** (F5.12: dead-asset removal + home no store de leitura), ADR-0018/0019/0020 (F1.13/F1.14: store de leitura web + build vendorado wa-sqlite COM FTS5), ADR-0027/ADR-0031 (F3.5/F3.12a: léxico STEP CC-BY propagado + pipeline de estudo/léxico web). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side (asset/loading/bundle). **WEB-scoped**: o nativo segue no combinado.

### Contexto
O `reading-sample.sqlite` (subset de leitura, ADR-0014) tem **14.409.728 B**, dos quais **~9,4 MB** são LÉXICO — `original_tokens` (56.268 linhas), `lexicon` (4.534), `scholarly_sources` (4) e `morph_legend` (0) — usados SÓ pelo estudo/léxico (opt-in, IA). No web, TODO o caminho de LEITURA (`getChapter`/`search`/`crossRefs`/`listTranslations`/`chapterCount`) abre esse mesmo arquivo via `openReadingDbWeb`, e o léxico (`sqlite-lexicon.web`) REUSAVA o handle de leitura. Logo um LEITOR PURO — que nunca toca IA — baixava os ~9 MB de léxico junto. A F5.9 já havia feito code-split do GLUE/JS do léxico; faltava separar o **DADO**.

### Decisão
1. **Split app-side, determinístico, do combinado (sem tocar o core).** `scripts/gen-reading-sample-db.sh` (após gerar o `reading-sample.sqlite` combinado, que segue sendo o asset NATIVO + a fonte da verdade) deriva, via `sqlite3` CLI, DOIS subsets WEB: `reading-lite.sqlite` (`DROP` das 4 tabelas de léxico + `VACUUM` → **4.530.176 B**, translations/books/verses/cross_references/verses_fts/versification_map, SEM léxico) e `lexicon-sample.sqlite` (`DROP` das tabelas de leitura + `VACUUM` → **9.502.720 B**, só léxico STEP CC-BY). NENHUM schema é escrito à mão — só REMOVEMOS tabelas de um DB cujo schema veio das migrações do core (uma fonte da verdade preservada) e compactamos. `VACUUM` torna os tamanhos REPRODUTÍVEIS byte-a-byte. Ambos são artefatos de BUILD ignorados no git (como o combinado); symlinks versionados em `app/assets/data/` deixam o Metro empacotá-los como assets locais.
2. **Store de leitura → `reading-lite`.** `sqlite-reading-opfs.web.ts` importa `reading-lite.sqlite` (era `reading-sample.sqlite`); OPFS file `reading-lite.sqlite`. A leitura funciona 100% offline SEM léxico. As tabelas de léxico estão AUSENTES do arquivo (não vazias) — uma consulta de léxico neste handle FALHA por design (nunca vazio silencioso).
3. **Store de léxico ON-DEMAND (novo).** `sqlite-lexicon-opfs.web.ts` (par de `sqlite-reading-opfs.web.ts`) abre `lexicon-sample.sqlite` do OPFS, semeado do asset SÓ na 1ª vez que estudo/léxico roda. É `import()`-ado dinamicamente por `reading.web.ts` (`deepStudy`/`lexicalEntries`) → o Metro coloca o asset num CHUNK ASYNC (`sqlite-lexicon-opfs-*.js`), FORA do 1º paint/leitura.
4. **Pipeline com DOIS handles (explícito, zero-drift).** `deepStudyOnHandle(handle, lexHandle, …)` ganha um 2º handle: o TEXTO do versículo vem do `handle` de leitura (`reading-lite`) e o léxico do `lexHandle` (`lexicon-sample`). `lexicalEntriesOnHandle(lexHandle, …)` roda só sobre o léxico. O SELECT/agregação de léxico são IDÊNTICOS — só muda o ARQUIVO de onde as MESMAS linhas STEP CC-BY vêm (preferido ATTACH por explicitude/robustez: nada depende de resolução de nome por ausência de tabela).
5. **UX de carregamento (honesta).** O `ReaderStudyPanel` mostra, enquanto `busy`, um indicador `study-loading-lexicon` (spinner + `t('study.loadingLexicon')`, PT/EN) — tornando a "descida" deferida do léxico visível na 1ª abertura (nas próximas já está em OPFS, local/instantâneo). Assets LOCAIS: nenhuma rede externa.
6. **Re-centragem da baseline.** `measure-web-bundle.sh`/`web-bundle-baseline.json`: `readingDb` (14.409.728) sai de `stable`; entram `readingLiteDb` (4.530.176) e `lexiconDb` (9.502.720); o `reading-sample.sqlite` combinado entra em `removed` (o budget FALHA se reaparecer no dist web). `moduleCount` 834 → **837** (+3 módulos LEVES: a glue do store on-demand + o wiring do `import()`; a factory pesada do wa-sqlite segue em chunk async — verificado: `MemoryVFS`/`SQLiteESMFactory`/`vfs_register` AUSENTES do entry). `eagerBytes` 1.306.320 → ~1.312.001; `eagerGzip` 331.038 → ~332.520 (nominais no centro do flutter; tolerâncias 1024/2048 intactas).

### Prova e gates
- **ZERO-DRIFT (dado):** as 4 tabelas de léxico em `lexicon-sample.sqlite` e as tabelas de leitura em `reading-lite.sqlite` têm conteúdo `SHA-256` IDÊNTICO ao do combinado (verificado linha-a-linha) — separar o DADO NÃO mudou o conteúdo. Os `test:web:lexicon`/`test:web:study`/`test:web:export`/`test:web:research`/`test:web:research-tavily` verdes com SAÍDAS idênticas (João 3:16 → mesmas 21 entradas Strong; atribuição STEP CC-BY verbatim).
- **Léxico FORA do caminho de leitura:** `expo export --platform web` (0) → `dist` tem `reading-lite.*.sqlite` (4.530.176) + `lexicon-sample.*.sqlite` (9.502.720) e **NÃO** tem mais `reading-sample.*.sqlite`. O `entry-*.js` EAGER não referencia NENHUM dos dois assets; `lexicon-sample` só aparece no chunk async `sqlite-lexicon-opfs-*.js` (estudo/léxico). Um leitor puro baixa **4,53 MB** (era 14,41 MB) — **−9,88 MB** no 1º open de leitura.
- **Schema:** o `test:web:reading` asserta que `reading-lite` NÃO contém `original_tokens`/`lexicon`/`scholarly_sources`/`morph_legend` e MANTÉM `verses`/`verses_fts`.
- `tsc --noEmit` (0). Os 17 `test:web:*` + `getPassage` + `test:keystore` + `test:i18n` verdes (zero regressão). `measure-web-bundle.sh` → **BUDGET OK** (exit 0). the-light `2fc2dab` intacto (0 mudanças em `core/**`; o `core/examples/*` NÃO foi tocado — o split é 100% via `sqlite3` CLI no script app-side).

### Consequências
- Leitores puros deixam de baixar ~9 MB de léxico no caminho de leitura; o dado do léxico "desce" SÓ ao abrir estudo/léxico (opt-in, IA), com UX de carregamento honesta. Offline-first preservado (assets LOCAIS, sem rede). Anti-alucinação/zero-drift preservados (texto do store de leitura verbatim; glosas/Strong/atribuição do store de léxico, idênticos). O NATIVO segue no combinado `reading-sample.sqlite` (adotar o split no nativo é follow-up). O entry EAGER cresce ~5,7 KB (glue leve do on-demand). A pré-compressão dos assets (F5.17) segue fora do escopo.

## ADR-0045 — F5.17: pré-comprimir os assets grandes (`.gz` gzip-9 + `.br` brotli-11) + estratégia de cache/serving + medir o TAMANHO DE TRANSFER (over-the-wire) na baseline — build/serving/métrica, honesto sobre o que exige camada de serving

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.17 (`gate: false`) · **Depende:** **F5.6** (wasm RELEASE+wasm-opt — o número comprimido reflete o wasm otimizado), **F5.3** (métrica `measure-web-bundle.sh` + baseline; já gravava raw+gzip), **ADR-0044** (F5.15: split `reading-lite`/`lexicon-sample`). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side (build/serving/medição). **WEB-scoped.**

### Contexto
A baseline da F5.3 media bytes-EM-DISCO (raw) + gzip como referência, mas o que o usuário realmente baixa é o TAMANHO DE TRANSFER (over-the-wire), que depende de `Content-Encoding`. Faltava (a) EMITIR as variantes pré-comprimidas como artefato de build, (b) MEDIR/RASTREAR o transfer (gzip **e** brotli) na métrica, e (c) DOCUMENTAR a estratégia de cache/serving. **Realidade honesta:** um `expo export --platform web` (output `static`) produz um `dist` de ARQUIVOS — SEM servidor; ele NÃO seta `Content-Encoding` sozinho. A redução real over-the-wire só se realiza atrás de um host que sirva a variante pré-comprimida (nginx `gzip_static`/`brotli_static`, Netlify, Cloudflare Pages, Vercel…). Não afirmamos um ganho em runtime que o export estático não entrega por si.

### Decisão
1. **Pré-compressão como passo de build (`scripts/compress-web-assets.sh`).** Após o export, emite `<asset>.gz` (gzip-9) + `<asset>.br` (brotli-11) AO LADO de cada asset compressível em `dist` (`.wasm`/`.sqlite` sempre; texto js/css/html/json/svg/map/txt ≥ 1 KB). brotli vem do **`zlib` built-in do Node** — SEM dependência do CLI externo `brotli` (portátil, offline, determinístico); gzip-9 do Node grava mtime=0 → bytes byte-estáveis. Fonte única dos parâmetros: `scripts/lib/web-compress.cjs` (usada também pela medição, garantindo que o número gravado é o do arquivo emitido).
2. **ZERO-DRIFT provado (lossless).** `emitVariantsVerified` DESCOMPRIME cada variante (`gunzipSync`/`brotliDecompressSync`) e exige igualdade byte-a-byte com a origem ANTES de aceitá-la — joga se divergir. Verificado também pelos CLIs do sistema (`gunzip -c … | cmp`, `brotli -dc … | cmp` → sem diferença): o `.wasm`/`.sqlite` que o app carrega permanece byte-idêntico (self-tests inalterados).
3. **Métrica estendida p/ TRANSFER (`measure-web-bundle.sh` → `web-bundle-baseline.json`).** Cada asset byte-estável ganha `brotliBytes` ao lado de `gzipBytes` (ambos EXATOS — content-addressed). Novos campos top-level: `frontierWasmBytesGzip`/`frontierWasmBytesBrotli`, `firstPaintTransferBytes` (headline de 1º paint = entry-JS eager **gzip**, piso universal) + `firstPaintTransferBytesBrotli` (brotli, default moderno), e `totals.stableAssetsBrotliBytes`/`nominalTotalBrotliBytes`. O entry (não byte-determinístico) ganha `eagerBrotliBytes` NOMINAL±TOLERÂNCIA, re-verificado a cada run. Re-centragem dos nominais raw/gzip do entry ao centro do flutter DESTE ambiente (moduleCount 837 EXATO estável; o app NÃO mudou — o nominal antigo ficara ~2,3 KB baixo por drift de versão do Metro).
4. **Estratégia de cache/serving documentada (`loop/perf/SERVING.md` + campo `serving` na baseline).** Assets content-hashed (`name.<hash>.ext`) ⇒ imutáveis ⇒ `Cache-Control: public, max-age=31536000, immutable` seguro; HTML/entry com cache curto. `Content-Encoding` servido pelo host quando a variante existe. Config copy-paste p/ nginx e Netlify/CF Pages. Offline-first intacto: assets LOCAIS same-origin; o browser descomprime transparente e o `fetch()` do app devolve os bytes ORIGINAIS — sem CDN/servidor externo.

### Prova e gates
- **Transfer medido (byte-exato, assets estáveis):** frontier wasm 1.198.888 → gzip 430.849 / **brotli 311.729** (−74,0 %); wa-sqlite FTS5 666.267 → gzip 327.579 / br 282.578 (−57,6 %); `reading-lite.sqlite` 4.530.176 → gzip 1.728.435 / br 1.089.464 (−76,0 %); `lexicon-sample.sqlite` (on-demand) 9.502.720 → gzip 2.957.473 / br 1.841.054 (−80,6 %). **1º paint** (entry-JS eager): ~1.314.270 → **gzip ~332.884 / brotli ~262.639** (−80 %). Totais estáveis: 15,16 MB raw → 5,19 MB gzip → **3,36 MB brotli** (−77,8 %).
- **Zero-drift:** `gunzip -c foo.wasm.gz | cmp - foo.wasm` e `brotli -dc foo.wasm.br | cmp - foo.wasm` → BYTE-IDÊNTICO (wasm + sqlite). Self-tests `test:web:*` verdes (o app carrega os mesmos bytes).
- `tsc --noEmit` (0). `expo export --platform web` (0) → `dist` com `*.wasm.gz`/`*.wasm.br` + `*.sqlite.gz`/`.br` ao lado dos originais. Os `test:web:*` + `test:keystore` + `test:i18n` verdes (zero regressão). `measure-web-bundle.sh` → **BUDGET OK** (exit 0), JSON reprodutível byte-a-byte (só constantes/valores byte-exatos gravados). the-light `2fc2dab` intacto (0 mudanças em `core/**`).

### Consequências
- A baseline passa a rastrear o TAMANHO DE TRANSFER (gzip+brotli), não só bytes-em-disco — o ganho da pré-compressão fica quantificado e monitorado (regressão detectável). As variantes `.gz`/`.br` são emitidas + lossless-verificadas a cada build. **O ganho over-the-wire só se REALIZA atrás de um host com `Content-Encoding`** (documentado, não afirmado como runtime-wired no export estático cru). Offline-first/BYOK/anti-alucinação/zero-drift preservados. FORA de escopo: travar o orçamento de performance (F5.19); adotar o split/pré-compressão no NATIVO; instrumentar um servidor de produção real. Nova dep = nenhuma (brotli built-in do Node).

## ADR-0046 — F5.18: auditoria de contraste WCAG AA das paletas de tema (claro/escuro) como GUARDA headless + ajuste MÍNIMO dos 3 tokens LIGHT que reprovavam (muted/accent/chipLang), preservando a identidade visual

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.18 (`gate: false`) · **Depende:** **F1.4/ADR-0015** (sistema de tema + paletas), **F5.14/ADR-0043** (persistência do modo). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side (tokens de cor + prova). Sem dep nova (matemática WCAG própria, `esbuild` já dev-dep).

### Contexto
As paletas de leitura (`theme.ts`, F1.4/ADR-0015) nunca tiveram uma auditoria de CONTRASTE: nada garantia que o texto/UI atingisse o mínimo legível (WCAG 2.1 AA — 4.5:1 texto normal, 3:1 texto grande + componentes de UI). Computados os pares texto/fundo SIGNIFICATIVOS, **3 tokens do modo CLARO reprovavam** sobre o fundo branco: `muted` #888888 (3.54:1), `accent` #b08400 (3.42:1) e `chipLang` #999999 (2.85:1). O modo ESCURO já passava em todos os pares significativos. Faltava (a) a auditoria determinística, (b) o ajuste dos tokens reprovados e (c) uma GUARDA anti-regressão (como a guarda de cobertura da F5.16).

### Decisão
1. **Tokens de cor extraídos p/ módulo PURO (`app/lib/themePalettes.ts`).** `ThemeColors`/`LIGHT`/`DARK`/`PALETTES` saem de `theme.ts` (que puxa `react-native` via `useColorScheme`) para um módulo SEM `react-native` — exatamente como `themePrefs.ts` isolou a persistência — de modo que a prova de contraste bundle HEADLESS. `theme.ts` RE-EXPORTA `ThemeColors`/`LIGHT`/`DARK`/`PALETTES`: os 24 componentes que importam `ThemeColors` de `lib/theme` seguem inalterados.
2. **Matemática WCAG 2.x própria e determinística (`app/lib/contrast.ts`).** `relativeLuminance` (linearização sRGB por canal) + `contrastRatio` (`(L1+0.05)/(L2+0.05)`), nenhuma lib externa. Mais a ESPECIFICAÇÃO dos pares: `AUDITED_PAIRS` (bloqueantes — texto/UI significativo) e `DECORATIVE_PAIRS` (reportados). `auditPalettes()` roda a spec sobre ambos os modos. A comparação usa a razão ARREDONDADA a 2 casas (paridade com o número reportado; sem falso-negativo de ponto flutuante).
3. **Ajuste MÍNIMO só dos tokens reprovados (identidade preservada).** SÓ os 3 tokens LIGHT mudaram, mantendo o MATIZ: `muted` #888888→**#6b6b6b** (5.33:1, cinza neutro escurecido); `accent` #b08400→**#916c00** (4.83:1, MESMO ouro no mesmo hue, só mais escuro); `chipLang` #999999→**#737373** (4.74:1, cinza neutro — segue mais claro que `muted`, preservando a ordenação original). Nenhum token DARK mudou. `text`/`verseText`/`error`/`chipText`/`chipActiveText` já passavam — intactos.
4. **GUARDA headless (`web/__tests__/contrast.test.mjs`, script `test:web:contrast`).** Assevera que os 9 pares significativos × 2 modos (18) atingem AA; FALHA se algum reprovar. Prova que NÃO é vacuosa: injeta um token reprovado numa CÓPIA da paleta e exige `pass:false` (a paleta real segue verde). Valida a matemática contra âncoras (preto↔branco=21:1; #767676/#fff≈4.54, o cinza AA-mínimo canônico).
5. **Política decorativo (WCAG 1.4.11).** `faint` (chevron redundante — a linha inteira é clicável/rotulada), `divider` (hairline) e `border` (borda cosmética de chip) são "puramente decorativos" → REPORTADOS (contra 3:1) mas FORA da guarda bloqueante. Transparência sem esconder os números.

### Prova e gates
- **Razões antes→depois (sobre `background`, salvo indicado):** LIGHT `muted` 3.54→**5.33**, `accent` 3.42→**4.83**, `chipLang` 2.85→**4.74** (os 3 reprovados agora passam com margem); demais LIGHT já ≥4.5 (`text` 18.88, `verseText` 17.40, `error` 7.33, `chipText` 12.63, `chipActiveText/chipActiveBg` 18.88, `text/headerBackground` 18.88). DARK já 100% verde (`muted` 6.75, `accent` 10.08, `chipLang` 5.51, …), inalterado.
- **Guarda pega regressão real:** revertido `muted`→#888888 na FONTE, `test:web:contrast` FALHA (`FAIL 3.54:1 (≥4.5) [light] muted/background`, exit 1); restaurado → exit 0.
- `tsc --noEmit` (0). `test:web:contrast` (0) + `test:web:theme` (persistência do tema, sem regressão da extração) + os demais `test:web:*` + `test:keystore` + `test:i18n`/`test:i18n-coverage` verdes. `expo export --platform web` (0). `eslint` = N/A neste repo (sem config — ADR-0038). the-light `2fc2dab` intacto (0 mudanças em `core/**`).

### Consequências
- Ambas as paletas atingem WCAG AA nos pares texto/UI significativos, com uma GUARDA que detecta qualquer regressão futura de token. A identidade visual é preservada (só 3 tokens LIGHT escurecidos minimamente no mesmo matiz; DARK intacto). Anti-alucinação preservada: é CROMO de cor de token — o versículo é renderizado com `verseText`, cujo contraste é o que auditamos, nunca o conteúdo (que vem do store). Offline-first/BYOK preservados (matemática local, nada de rede/lib). FORA de escopo: a varredura interativa de a11y (rótulos/foco/toque — F5.20) e o dynamic-type (F5.21); decorativos (faint/divider/border) seguem abaixo de 3:1 por design (isenção 1.4.11). Nova dep = nenhuma.

## ADR-0047 — F5.19: TRAVAR o orçamento de performance web como GUARDA de regressão wired (`test:web:perf-budget`) — contrato congelado (`web-bundle-budget.json`) + cross-check (`check-web-bundle-budget.sh`) + re-baseline `moduleCount` 837→838 (drift da F5.18 pega pela própria guarda)

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.19 (`gate: false`, SAÍDA do workstream perf) · **Depende:** **F5.3** (métrica `measure-web-bundle.sh` + baseline), **F5.6** (wasm release), **F5.9** (code-split), **F5.12** (dead-assets), **F5.15** (léxico on-demand), **F5.17/ADR-0045** (precompress + transfer). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side/tooling (script + doc + wiring). Sem dep nova.

### Contexto
O `measure-web-bundle.sh` (F5.3, evoluído por F5.6/9/12/15/17) já EXPORTA o bundle web, pré-comprime (.gz/.br zero-drift) e FALHA (exit ≠ 0) em breach de budget. Faltava (a) TRAVAR os limites finais como CONTRATO durável, (b) WIRE a guarda num script nomeado que rode junto da suíte web, (c) PROVAR que ela falha se o bundle regredir, e (d) DOCUMENTAR o orçamento + a política de re-baseline. Sem isso, "performance verde" não era objetivo/durável — e, de fato, uma drift ESTRUTURAL da F5.18 passara sem ser vista.

### Decisão
1. **Contrato CONGELADO (`loop/perf/web-bundle-budget.json`).** Espelho legível por máquina dos limites FINAIS: bytes crus + transfer (gzip/br) EXATOS dos assets content-addressed (frontier wasm, `reading-lite`, `lexicon-sample` on-demand, wa-sqlite FTS5); `moduleCount` eager EXATO; entry-JS `nominal±tolerância` (raw/gzip/br); headline de 1º paint (transfer); lista de assets REMOVIDOS que não podem voltar. Inclui a `reBaselinePolicy` explícita.
2. **Guarda wired (`scripts/check-web-bundle-budget.sh`, `app/package.json` → `test:web:perf-budget`).** DUAS camadas: **[1] enforcer** — roda `measure-web-bundle.sh` (propaga exit ≠ 0 em breach); **[2] lock cross-check** — compara a `web-bundle-baseline.json` produzida contra o contrato congelado, detectando drift entre o enforcer (const `BUDGET` embutida) e o lock (ex.: re-baseline não documentado). Modo `--check-only` reusa a baseline (rápido, p/ CI/re-checagem sem re-export). Offline: nenhuma rede.
3. **Re-baseline DELIBERADO `moduleCount` 837 → 838 (drift da F5.18).** Ao travar, a guarda pegou que a **F5.18** (ADR-0046) extraíra os tokens de cor p/ o módulo PURO novo `app/lib/themePalettes.ts` (importado por `theme.ts`, eager no 1º paint) → +1 módulo eager (837→838, git-provável, determinístico em 2+ exports). A F5.18 só rodou `expo export` (exit 0), NÃO a métrica → a drift não foi vista. Re-baseline justificado: os bytes NÃO mudaram de forma relevante (wrapper extra ~600 B raw absorvido pela banda ±1024; centros gzip/brotli inalterados). Os demais limites (F5.17) ficam intactos. É EXATAMENTE a classe de regressão que a guarda passa a travar.

### Prova e gates
- **Guarda VERDE na árvore atual:** `test:web:perf-budget` → enforcer `BUDGET OK` (moduleCount 838, entry-JS na banda, assets byte-estáveis batem, .gz/.br zero-drift) + `PERF BUDGET LOCKED OK` (baseline == contrato). `expo export --platform web` roda dentro (exit 0).
- **Guarda FALHA em regressão (provado, 2 formas, revertido byte-idêntico):** (A) lock cross-check — `web-bundle-budget.json` com `frontierWasmBytes` −1 → `--check-only` exit **1** (`exact.frontierWasmBytes: baseline 1198888 != travado 1198887 (delta 1)`); (B) enforcer — `BUDGET.moduleCount` 838→837 → `check-web-bundle-budget.sh` exit **1** (`entryJs.moduleCount 838 != esperado 837`). Ambos os arquivos restaurados (SHA idêntico). Real-world: a métrica estava VERMELHA (838≠837) na árvore pré-lock — a própria drift da F5.18 foi o 1º caso capturado.
- `tsc --noEmit` (0). Self-tests `test:web:*` + `test:web:firstpaint` verdes (sem regressão — só script/doc/wiring mudou). `eslint` = N/A (sem config, ADR-0038). the-light `2fc2dab` intacto (0 mudanças em `core/**`).

### Consequências
- "Performance web" vira objetivo e durável: um orçamento travado + guarda wired que roda junto da suíte. Re-baselinear exige tocar DOIS arquivos + ADR (speed-bump proposital, documentado em `loop/perf/BUDGET.md` + `web-bundle-budget.json`). Anti-alucinação/offline-first/BYOK preservados (métrica local, só assets, sem rede/conta). Zero-drift do app: nenhuma fonte do app mudou — só o `moduleCount` do budget acompanhou a realidade já commitada da F5.18. FORA de escopo: adotar o split no nativo; otimização adicional (o workstream perf fecha aqui). Nova dep = nenhuma.

## ADR-0048 — F5.20: varredura de a11y dos elementos INTERATIVOS (role + label + alvo de toque ≥44) como GUARDA headless (`test:a11y-scan`) + follow-up da F5.18 (o "—" de versículo ausente promovido de `faint` p/ `muted`)

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.20 (`gate: false`) · **Depende:** **F5.16/ADR (i18n-coverage)** (molde da guarda lint-like + rótulos via `t()`), **F5.18/ADR-0046** (contraste + política decorativo/`faint`), **F5.5/F5.8/F5.11** (role+label já adicionados na maioria das telas/painéis). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side (a11y de cromo + prova). Sem dep nova (Node puro, sem `esbuild`).

### Contexto
A F5.18 auditou COR (contraste); faltava a varredura de a11y dos elementos INTERATIVOS: garantir que TODO touchable/campo/switch/link tenha `accessibilityRole`, um RÓTULO e um ALVO DE TOQUE adequado (≥44×44 pt iOS / 48 Android), e uma GUARDA anti-regressão (molde F5.16/F5.18). A maior parte já estava conforme (F5.5/F5.8/F5.11 puseram role+label nos versículos, busca, nav e painéis IA). Restava (a) fechar as poucas lacunas reais, (b) a guarda, e (c) o **follow-up da F5.18**: o token `faint` (claro #cccccc = 1.61:1) colorindo o "—" de "versículo ausente" na visão paralela.

### Decisão
1. **Follow-up F5.18 — o "—" de versículo ausente é NÃO-decorativo → promovido de `faint` p/ `muted`.** Na `ReaderParallelView`, o `—` sinaliza que a passagem NÃO EXISTE naquela tradução — CONVEY informação, logo NÃO se enquadra na isenção decorativa (WCAG 1.4.11). A cor do estilo `missing` passou de `faint` (1.61:1 ✗) para `muted`, que já atinge AA (claro #6b6b6b 5.33:1 / escuro #9a9a9a 6.75:1). Nenhum TOKEN mudou de valor (a guarda de contraste segue verde). Com isso, `faint` fica usado SÓ no chevron redundante da `ReaderBookList` (a linha inteira é `Pressable` rotulada) — uma afordância PURAMENTE decorativa → a exclusão 1.4.11 do ADR-0046 agora é 100% precisa.
2. **GUARDA headless determinística (`web/__tests__/a11y-scan.test.mjs`, script `test:a11y-scan`).** Lint-like sobre o FONTE de `components/*.tsx` + `app/**/*.tsx` (Node puro, sem device/rede/chave; lexer que remove comentários ciente de strings/templates, igual à i18n-coverage). Para CADA interativo (`Pressable`/`Touchable*`, `Switch`, `TextInput`, `Link`) checa 3 coisas, com política POR TAG:
   - **(role)** só o TOUCHABLE GENÉRICO (`Pressable`/`Touchable*`) — View sem papel implícito — exige `accessibilityRole`. `TextInput` (textbox), `Switch` (switch) e `Link` (link) têm papel IMPLÍCITO do nativo → isentos (forçar role neles pode quebrar a semântica).
   - **(label)** todo interativo precisa de FONTE de rótulo: `accessibilityLabel` OU `placeholder` (TextInput) OU TEXTO-FILHO (`t()`, `<Text>` ou palavra). ANTI-ALUCINAÇÃO: o rótulo PODE ser dado do store (ref "John 3:16", abbrev/idioma da tradução) — não traduzido; a guarda checa PRESENÇA, não idioma (isso é a i18n-coverage).
   - **(alvo ≥44)** touchable genérico + `Link` (wrapper sem tamanho intrínseco): FALHA se não há NENHUMA pista (`hitSlop`/`flex`-fill/tamanho/`padding`) OU se há `height`/`minHeight`/`width`/`minWidth` FIXO numérico < 44 SEM `hitSlop` (ex.: swatch 34×34). `TextInput`/`Switch` são controles NATIVOS de tamanho intrínseco → isentos do check de tamanho. Resolve os `styles.NAME` referenciados contra os blocos `StyleSheet.create({…})` do arquivo + estilos inline.
   A guarda tem um SELF-TEST embutido (fontes sintéticas) provando que REPROVA sem-role / sem-label / fixo<44 / sem-tamanho e NÃO gera falso-positivo (touchable completo / backdrop-flex / swatch+hitSlop / TextInput-Switch nativos / Link / texto-filho).
3. **Correções MÍNIMAS (não-visuais) das poucas lacunas reais.** (a) 6 BACKDROPS de modal (`ask/chat/compare/study/verse/xref-*-backdrop`) — `<Pressable>` de dispensar sem role/label → ganharam `accessibilityRole="button"` + `accessibilityLabel={t(close)}` (o `{flex:1}` já é alvo enorme). (b) 6 botões CLOSE de header (texto "Fechar" sem padding próprio) → `hitSlop={12}`. (c) SWATCH de marcação 34×34 → `hitSlop` (chega a ~44). (d) CHIPS de menor padding (provedor Ask/Compare, modo/lente/profundidade/web do Estudo, seletor de versão, preset de horário do plano, toggle paralelo) → `hitSlop` vertical. (e) `ReaderVersionPicker` — faltava `accessibilityRole="button"`+`accessibilityState`+label (abbrev/idioma do store). (f) `readLink` da home — `paddingVertical:10`. (g) atribuição CC-BY do xref — `hitSlop` + `accessibilityLabel` (string verbatim). NENHUM redesenho: `hitSlop` não muda o visual; onde há dimensão fixa pequena, expandimos o alvo, não a caixa.

### Prova e gates
- **Guarda VERDE na árvore atual:** `test:a11y-scan` varre **61 interativos** em 22 arquivos (Pressable×49, TextInput×8, Switch×1, Link×3) — todos com role/label/alvo — exit 0; self-test embutido verde.
- **Guarda pega regressão real (provado, revertido):** removido `accessibilityRole="button"` do `ReaderSearchResultItem` → `test:a11y-scan` FALHA (`components/ReaderSearchResultItem.tsx:54 <Pressable> [role] sem accessibilityRole`, exit 1); restaurado → exit 0.
- `tsc --noEmit` (0). `test:web:contrast` (0 — `faint` inalterado; `muted` já auditado) + `test:i18n-coverage` (0 — adições via `t()`/store, sem cromo hardcoded) + demais `test:web:*` verdes. `expo export --platform web` (0). `eslint` = N/A (sem config, ADR-0038). the-light `2fc2dab` intacto.

### Consequências
- Todo elemento interativo tem role + rótulo + alvo de toque adequado, com uma GUARDA determinística que trava a regressão (sem device/rede — igual às guardas F5.16/F5.18/F5.19). Anti-alucinação preservada: a11y de CROMO — nenhum texto bíblico tocado; rótulos de conteúdo do store entram como dado (`{param}`/campo), não `t()`. O `faint` fica corretamente restrito ao decorativo (chevron), fechando o débito do ADR-0046. LIMITAÇÃO HONESTA da guarda: o alvo ≥44 é provado por AFORDÂNCIA EXPLÍCITA (hitSlop/flex/dimensão), não por cálculo de px em runtime (impossível estático sem métricas de fonte) — `padding` conta como pista de tamanho e dims fixas <44 sem hitSlop reprovam; onde o alvo real era pequeno, adicionamos `hitSlop` de fato. FORA de escopo (F5.21): dynamic-type/escala de fonte e ordem de foco. Nova dep = nenhuma.

## ADR-0049 — F5.21: dynamic type + semântica de modal + ordem de foco dos painéis de leitura — hook `useReaderModalA11y` (`accessibilityViewIsModal` + foco inicial no cabeçalho) + GUARDA headless (`test:a11y-modals`) emitindo `TLA_A11Y`

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.21 (`gate: false`, ÚLTIMA não-gate da Fase 5) · **Depende:** **F5.20/ADR-0048** (a11y de interativos + molde da guarda lint-like; a F5.20 declarou dynamic-type/ordem-de-foco FORA de escopo → é exatamente esta), **F5.11/F5.16** (os 6 painéis já como `<Modal>` com header/título via `t()`). **NÃO** toca o `the-light` (@ `2fc2dab`) nem `core/**` — 100% app-side. Sem dep nova (só RN `AccessibilityInfo`/`findNodeHandle`; guarda em Node puro).

### Contexto
Restavam os eixos de a11y que são de RUNTIME/estrutura da UI: (1) **dynamic type** — a UI de leitura deve RESPEITAR a escala de fonte do sistema (não travar `allowFontScaling`); (2) **semântica de modal** — os 6 painéis de leitura (`ReaderVersePanel` + IA: Ask/Study/Compare/Chat/Xref) são RN `<Modal transparent>` SOBRE o conteúdo de leitura, mas NÃO declaravam `accessibilityViewIsModal` → o leitor de tela podia "vazar" para o conteúdo atrás; (3) **ordem de foco** — ao abrir, o foco não pousava no cabeçalho. Realidade auditada: NENHUM `allowFontScaling={false}` existe no app (dynamic type já respeitado por padrão — RN escala o texto); a lacuna real era a semântica de modal + foco. Diferente dos marcadores `TLA_*` (fronteira/core no device), a11y é PROP ESTÁTICA de RN → a prova reproduzível é HEADLESS.

### Decisão
1. **Hook compartilhado `app/lib/useReaderModalA11y.ts`.** Ao abrir (`visible` false→true), move o foco de acessibilidade para o `<Text>` de TÍTULO do painel (`AccessibilityInfo.setAccessibilityFocus(findNodeHandle(ref))`, com atraso curto p/ o Modal montar; 350 ms Android / 150 ms iOS). Isso dá, de uma vez, **ordem de foco lógica** (cabeçalho→conteúdo→ações) e **anúncio de abertura** (o leitor LÊ o título — o sinal idiomático de novo contexto). NÃO usamos `announceForAccessibility` separado (causaria fala DUPLA). O **fechamento** é anunciado pelo `<Modal>` nativo, que devolve o foco ao gatilho. Offline; sem I/O; sem rede.
2. **`accessibilityViewIsModal` na View-folha (`sheet`) dos 6 painéis** + `accessibilityRole="header"` + `ref` no `<Text>` de título. `accessibilityViewIsModal` prende o foco ao painel (o leitor IGNORA o conteúdo atrás — o correto p/ `Modal transparent` sobreposto). NENHUMA mudança visual; o texto do versículo/atribuição continua VERBATIM do store (anti-alucinação).
3. **GUARDA headless determinística (`web/__tests__/reader-modal-a11y.test.mjs`, script `test:a11y-modals`).** Lint-like sobre o FONTE (Node puro, sem device/rede/chave; mesmo lexer de comentários da F5.16/F5.20). Para cada `Reader*Panel.tsx` que renderiza `<Modal>` assevera: `accessibilityViewIsModal` [modal=true], `useReaderModalA11y(...)` + `accessibilityRole="header"` [focus=ok], `<Text>` de título como âncora de nome da dialog [labels=ok]. Além disso varre `components/*.tsx`+`app/**/*.tsx` e FALHA em qualquer `allowFontScaling={false}`/`: false` que trave a escala — a menos que a linha traga o marker de política `a11y-allow-fontscale-lock` (escape DOCUMENTADO) [scale=ok]. Emite o marcador grep-ável `TLA_A11Y modal=true labels=ok scale=ok focus=ok panels=6 locks=0` (molde dos `TLA_*`), com SELF-TEST embutido (reprova sem-viewIsModal/sem-hook/sem-header/lock-sem-marker; não gera falso-positivo em painel completo/lock-com-marker).
4. **`scripts/run-ios-selftest.sh` assevera `TLA_A11Y` (passo [0/5], HEADLESS).** Como a11y de modal/dynamic-type é PROP ESTÁTICA (não chamada de fronteira do core), o script roda a guarda ANTES do fluxo de device e re-emite `TLA_A11Y` — COMPLEMENTAR (sem regressão) aos `TLA_*` de fronteira provados no simulador logo abaixo. Assim `run-ios-selftest.sh | grep TLA_A11Y` passa de forma reproduzível, com ou sem simulador.

### Prova e gates
- **DECLARAÇÃO HONESTA device-vs-headless:** `TLA_A11Y` é prova HEADLESS/ESTÁTICA (props JSX de RN não são runtime de core) — `test:a11y-modals` exit 0 emitindo `TLA_A11Y modal=true labels=ok scale=ok focus=ok panels=6 locks=0`, e `run-ios-selftest.sh` a re-emite no passo [0/5]. Os demais `TLA_*` (parse/read/search/xref/notes/ask/study/chat/compare/export/plans) seguem sendo prova de FRONTEIRA no device, INALTERADOS. A verificação `run-ios-selftest.sh | grep -q TLA_A11Y` retorna 0 rapidamente (o marcador sai no [0/5], antes do boot). Checagem manual VoiceOver/TalkBack + fonte grande: ver resultado da tarefa.
- **Guarda VERDE:** `test:a11y-modals` — 6 painéis com `accessibilityViewIsModal`+hook+header; 22 arquivos sem `allowFontScaling={false}`; self-test verde.
- `tsc --noEmit` (0). `test:a11y-scan`/`test:web:contrast`/`test:i18n-coverage`/demais `test:web:*` verdes (sem regressão). `expo export --platform web` (0). `eslint` = N/A (sem config, ADR-0038). the-light `2fc2dab` intacto; 0 arquivos `core/`.

### Consequências
- Os painéis de leitura têm semântica de modal correta (`accessibilityViewIsModal`), foco inicial no cabeçalho (ordem lógica + anúncio idiomático) e retorno de foco ao fechar (Modal nativo); a UI respeita o dynamic type do sistema, com uma GUARDA que trava regressão de ambos (modal + escala de fonte). Anti-alucinação preservada: a11y de CROMO — nenhum texto bíblico tocado. LIMITAÇÃO HONESTA: (a) `TLA_A11Y` é estático (props), não runtime de core — a verificação REAL de VoiceOver "não vaza p/ o fundo" e "não corta em fonte grande" é a checagem MANUAL documentada (o `accessibilityViewIsModal`/dynamic-type default são o contrato que o SO honra); (b) o retorno de foco ao fechar delega ao `<Modal>` nativo (não gerenciamos o elemento anterior manualmente). Fecha a largura de a11y da Fase 5. Nova dep = nenhuma.


## ADR-0037 — F5.10 (gate): PARIDADE WEB dos planos de leitura = **PR `ai-pure` ao `the-light`** expondo a geração PURA de planos (wasm-safe); `PlanStore`/fs seguem embedded

- **Data:** 2026-07-03 · **Status:** **aceito e MERGEADO** (the-light PR #3, ff na `main` → rev **`225b8c929cf388e29dc148fec3975bf05a884b07`**; `core/Cargo.toml` re-pinado 2 linhas) · **Tarefa:** F5.10 (**gate estratégico** — toca o `the-light` via PR + ADR) · **Sancionado por:** o humano (escolha "opção A" para a F5.10) · **Precedente:** ADR-0024/F2.7, ADR-0030/F3.11, ADR-0035/F4.6 (mesmo molde de PR `ai-pure` + re-pin). · **Número:** 0037 foi RESERVADO a este PR (por isso fora de sequência vs. 0038–0049).

### Contexto
Os planos de leitura são NATIVOS (F5.1/4/7/13) porque `pub mod userdata` era `#[cfg(feature="embedded")]` no core → a GERAÇÃO de planos não compilava em wasm (a F5.1 foi re-escopada p/ native-first exatamente por isso). Mas a geração é PURA: `available_plans`/`plan_by_id`/`Plan`/`PlanProgress`/`day_index_for`/`chunk` dependem só de `model::Reference`, `reference::chapters_in_book`, `chrono` clock-free e `serde_json` — todos já sob `ai-pure`. Só a PERSISTÊNCIA (`PlanStore`, `data_dir`, path helpers) usa fs/`directories`. A paridade web precisa da geração pura no navegador (zero-drift vs. nativo) → expor essa superfície sob `ai-pure` = mudança no core = PR + ADR.

### Decisão
PR mínimo e não-quebrante ao `the-light` (branch `feat/ai-pure-plans`, `+36/-3` em 3 arquivos):
- `lib.rs`: `pub mod userdata` de `#[cfg(embedded)]` -> `#[cfg(any(embedded, ai-pure))]`.
- `userdata/mod.rs`: `#[cfg(embedded)]` em `data_dir` + 7 path helpers + submódulos `notes`/`highlights`/`sessions` (+ re-exports) + `PlanStore`. Mantém PURO: `pub mod plans`, `UserDataError`, `pub use plans::{Plan, PlanProgress}`.
- `userdata/plans.rs`: `#[cfg(embedded)]` em `PlanStore` (+ `use PathBuf`/`super::Result`) e no teste `progress_roundtrip` (fs).

### Garantias (verificadas + revisão independente)
- **Não-quebrante:** `default = ["embedded"]` byte-a-byte (`Cargo.toml` intacto); `embedded` inclui `ai-pure` → nativo com `userdata` COMPLETO (CLI/TUI/xtask + 196 testes do core verdes, clippy `-D warnings`). Nenhuma API removida/renomeada.
- **wasm PURO:** build `--features ai-pure --target wasm32` compila; `cargo tree` sem `reqwest`/`rusqlite`/`directories`/`tempfile`. Revisor construiu um consumidor `ai-pure` fora do repo → `available_plans()` = 3 planos/365 dias (REACH_OK); `PlanStore` sob `ai-pure` → `E0433` (gate real).
- **Zero-drift:** só atributos `#[cfg]` mudaram; lógica de geração byte-idêntica → nativo e web geram planos idênticos.

### Consequências / follow-up (app-side = F5.10 propriamente dita)
Após o re-pin (`225b8c9`; frontier 80 testes verdes): (1) as fns de geração de planos na fronteira (F5.1: `listReadingPlans`/`readingPlanDay`/`readingPlanDayIndex`) podem virar **cfg-free** (largam o stub web → chamam `userdata::plans` real no wasm); (2) o **progresso** web (que a F5.4 stuba pois `PlanStore` é embedded) passa a persistir em **OPFS** app-side (espelho de `active.json`, molde do VFS de userdata F1.16); (3) a rota `/plans` (F5.7) deixa de mostrar o aviso "native-only" e funciona no web. Prova: headless web (geração via wasm + progresso OPFS). Próximo ADR livre = **ADR-0050** (0036 reservado ao sync F5.22).

## ADR-0050 — F5.10 (app-side): realizar a PARIDADE WEB dos planos (geração cfg-free/wasm + progresso OPFS + rota `/plans`) e RE-BASELINE deliberado do orçamento perf web para o crescimento LEGÍTIMO da wasm

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.10 (`gate: false`, app-side; o gate estratégico foi o ADR-0037/PR `ai-pure`, já mergeado em `225b8c9`) · **Depende:** **ADR-0037** (geração pura de planos sob `ai-pure`/wasm), **F5.7** (UI de planos), **F1.16/ADR-0022** (VFS OPFS de userdata — molde do progresso), **F5.19/ADR-0047** (guarda de orçamento perf + `reBaselinePolicy`). **NÃO** toca o `the-light` (@ `225b8c9`) nem `core/Cargo.toml`. App-side + a fronteira `core/src/lib.rs` (só `#[cfg]`, sem mudar assinatura).

### Contexto
Com `225b8c9` (ADR-0037), a geração PURA de planos compila em wasm sob `ai-pure`. Faltava a F5.10 propriamente dita (app-side): (1) largar o split nativo+stub das 3 fns de GERAÇÃO da fronteira; (2) persistir o PROGRESSO no web (o `PlanStore` fs segue embedded → não entra no wasm); (3) ligar a rota `/plans` no web. Efeito colateral esperado: a geração entrando na wasm da fronteira faz o asset `index_bg.wasm` crescer — o que a guarda `test:web:perf-budget` (ADR-0047) trava por design, exigindo re-baseline deliberado.

### Decisão
1. **Geração cfg-free.** `list_reading_plans`/`reading_plan_day`/`reading_plan_day_index` na fronteira (`core/src/lib.rs`) largam o `#[cfg(not(wasm32))]` nativo + stub web e viram impl ÚNICA delegando a `the_light_core::userdata::plans` (agora `ai-pure`). Assinaturas INALTERADAS → bindings idempotentes; o web ganha a impl REAL (zero-drift vs. nativo). Persistência (`PlanStore` fs) segue nativa + stub web.
2. **Progresso web em OPFS (app-side).** Novo `app/web/plans-fs.web.ts` (VFS-agnóstico, molde das notas F1.16) ESPELHA o formato do core `reading-plans/active.json` = `{plan_id, start_date, completed}` (snake_case, pretty 2-espaços), reusando o backend OPFS de userdata (`openUserDataWeb`). Valida o `plan_id` contra o CATALOG do core (`listReadingPlans`, wasm) e a `start_date` ISO delegando ao core (`readingPlanDayIndex` parseia `NaiveDate`) — ZERO parsing/chunking/índice reimplementado em TS.
3. **Rota `/plans` no web.** `PlansWebNotice` removido (+ chave i18n morta `plans.webUnavailable`); `PlansContent` renderiza nas duas plataformas via `WasmGate`. O `ReminderControls` (F5.13, `expo-notifications` nativo) fica gateado por `REMINDERS_SUPPORTED` (false no web) — sem tocar o workstream de lembretes.
4. **RE-BASELINE DELIBERADO do orçamento perf (ADR-0047/`reBaselinePolicy`), autorizado pelo Driver.** `frontierWasm` 1.198.888 → **1.223.324 B** (+24.436, +2,0%; gzip 430.849→**440.559**, br 311.729→**319.679**) — a geração PURA + parse `chrono` entrando na wasm; determinístico em 3 exports. `moduleCount` eager 838 → **839** (+1: a tela `/plans` monta a UI real em vez de degradar; o progresso `plans-fs.web` é chunk ASYNC, não eager). Nominais do entry re-centrados no centro do flutter do Metro medido em 3 exports (raw 1.324.748–1.324.870→**1.324.809**; gzip 334.428–336.118→**335.273**; br 264.620–264.644→**264.632**); tolerâncias inalteradas. Atualizados AMBOS: a const `BUDGET` em `scripts/measure-web-bundle.sh` E `loop/perf/web-bundle-budget.json` (+ nota em `loop/perf/BUDGET.md`).

### Prova e gates
- **Core:** `cargo test -p the-light-app-core` 80 verdes; `clippy -D warnings` limpo; `gen-bindings-web.sh` OK (a geração cfg-free compila p/ wasm32 — grafo wasm PURO: um símbolo embedded/`PlanStore`/`rusqlite` vazado falharia o build). 
- **App:** `tsc --noEmit` 0; `expo export --platform web` 0 (rota `/plans` presente; `plans-fs` = chunk async). Novo `test:web:plans` (headless, sem rede): 3 planos com nomes/dias do core, Mateus 1 (capítulo inteiro), round-trip OPFS iniciar→marcar→reabrir persiste, `plan_id`/data inválidos rejeitados sem I/O. `test:web:notes`/`reading`/`i18n`/`i18n-coverage`/`firstpaint` sem regressão.
- **Perf:** `test:web:perf-budget` VERDE (enforcer `BUDGET OK` + `PERF BUDGET LOCKED OK`); baseline byte-estável em 3 runs.

### Consequências
Planos de leitura com PARIDADE WEB completa (geração idêntica ao nativo; progresso OPFS local; offline-first/anti-alucinação preservados — refs/nomes do core, texto lido do store pelo Reader). O orçamento perf acompanha a realidade da feature (crescimento legítimo, git-provável), mantendo a guarda como trava anti-regressão. Fronteira de progresso do core (F5.4) segue nativa + stub web (PlanStore é fs). FORA de escopo: lembrete diário no web (nativo-only por design); link de `/plans` na home web (gateado como `/read`/`/search`, concern de nav-web à parte; a rota é acessível por URL direta).


## ADR-0036 — F5.22 (gate): SYNC OPCIONAL de dados do usuário = **export/import manual (todos os alvos)** + **integração Google Drive no WEB** (opt-in, OAuth/PKCE client-side, pasta app-private do Drive); offline-first permanece a base

- **Data:** 2026-07-03 · **Status:** **aceito (decisão do gate)** — decidido pelo humano; F5.22 é o BRIEF DE DECISÃO (sem código de produto). A implementação vem em F5.23–F5.27. · **Tarefa:** F5.22 (gate) · **Decidido por:** o humano ("manual export/import; no web, integração Google Drive linkando a conta").

### Contexto
Sincronizar dados do usuário (notas, marcações, progresso de plano) entre dispositivos SEM quebrar o offline-first (não-negociável: o app é 100% funcional com ZERO conta/rede). O `notesExport::buildNotesExport` (F1.11) já monta um export a partir dos Records (`list_notes`/`list_highlights`) — mas em Markdown legível (p/ Share), não round-trippável. A persistência é fs no nativo e OPFS no web (F1.16).

### Decisão
Duas camadas, ambas **opt-in** e **aditivas** (o app segue offline-first sem nenhuma delas):
1. **Export/import manual (TODOS os alvos)** — um SNAPSHOT JSON máquina-legível dos dados do usuário (notas + marcações + progresso de plano), montado dos Records (NÃO reimplementa o formato do store), round-trippável: exportar (Share/salvar) e importar (merge de volta). Zero servidor, zero conta, zero rede. É o piso.
2. **Google Drive no WEB (opt-in)** — o usuário LINKA a própria conta Google via **OAuth 2.0 PKCE client-side** (SEM servidor do app; client-id público + PKCE, sem segredo) e o snapshot é gravado na **pasta app-data do Drive** (`drive.appdata` — oculta, app-private, na conta DO USUÁRIO); push/pull automáticos. Token em session/secure storage, nunca em git/log. Funciona 100% offline sem linkar.

### Escopo dos dados
Sincroniza: **notas, marcações, progresso de plano** (dados do próprio usuário). **NÃO** sincroniza: histórico de conversas de IA (`sessions` — privacidade), o banco bíblico (domínio público, bundled), chaves BYOK. Nenhum texto bíblico, nenhum segredo.

### Conflito / merge
Snapshot = ESTADO completo → merge no import/pull: notas/marcações fazem UNIÃO por referência (colisão → last-modified vence); progresso de plano = LWW (ou `max(completed)`). Determinístico, testável por MOCK (sem rede). CRDT é overkill p/ este dado.

### Criptografia / privacidade
Transporte = HTTPS (Google Drive). A pasta app-private + a conta DO USUÁRIO = o dado fica no Drive do próprio usuário, escopo do app. **E2e com passphrase = futuro opcional** (o dado já está na nuvem privada do usuário; não é requisito da v1). **Opt-in, OFF por padrão; SEM telemetria; token nunca em git/log; nenhum servidor/conta do app.**

### Reconciliação com ADR-0023 ("OAuth banido")
O ADR-0023 baniu OAuth para as **chaves BYOK de IA** (preferindo chave direta — credencial paga do usuário melhor tratada como BYOK direto). O OAuth do Google Drive é um caso DISTINTO: acessar o **armazenamento do próprio usuário** (não uma chave de LLM), onde o Google EXIGE OAuth e o PKCE client-side (client-id público, sem segredo) é o padrão seguro. A distinção fica registrada; não há conflito.

### Decomposição (F5.23–F5.27, re-escopada por esta decisão)
- **F5.23** — Export/import JSON (todos os alvos): snapshot round-trippável (notas+marcações+progresso) + import-com-merge; prova headless. Fundação p/ o Drive. Baixo esforço, valor imediato. **(A SEMEAR primeiro.)**
- **F5.24** — Link Google Drive no web: OAuth 2.0 PKCE, escopo `drive.appdata`, token session/secure, hook link/unlink. Prova por MOCK (sem conta real).
- **F5.25** — Push/pull no Drive (web): upload/download do snapshot na pasta app-data + merge no pull (reusa F5.23). Prova por MOCK.
- **F5.26** — UI opt-in de sync: toggle OFF por padrão, aviso de privacidade, "funciona offline sem isto", link/unlink.
- **F5.27** — ⛔ **Validação real** (gate): conta/Drive Google reais; o loop NUNCA roda sozinho; conta/token nunca transitam pelo loop (humano valida e reporta sucesso).

Próximo ADR livre = **ADR-0051** (números 0038–0050 já usados; 0037 foi o PR de planos).

## ADR-0051 — F5.23: SNAPSHOT JSON round-trippável dos dados do usuário (notas + marcações + progresso de plano) = motor PURO (build/serialize/parse/merge + import-com-merge) + prova headless; fundação do sync (ADR-0036)

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.23 (`gate: false`, 1ª da decomposição do sync ADR-0036) · **Depende:** **F5.22/ADR-0036** (a decisão de sync = export/import manual + Drive no web), **F1.11** (`notesExport` = molde de função pura sobre os Records), **F1.16/ADR-0022** (userdata web `*Fs` + `formatReferenceEn`), **F5.10/ADR-0050** (progresso de plano web `plans-fs`). **NÃO** toca o `the-light` (@ `225b8c9`) nem `core/**` — 100% app-side. Sem dep nova (Node/esbuild na prova; wasm já presente).

### Contexto
O ADR-0036 decidiu o sync como export/import MANUAL (todos os alvos) + Drive no web, e apontou a F5.23 como a FUNDAÇÃO: um SNAPSHOT máquina-legível, round-trippável, que o transporte (Share/file-picker na F5.26; Drive na F5.24–25) vai mover. O `notesExport` (F1.11) já monta um export dos Records, mas em Markdown LEGÍVEL (p/ Share), não round-trippável. Faltava o formato JSON + o merge determinístico de volta.

### Decisão
Um motor PURO `app/lib/userdataSnapshot.ts` (molde `notesExport`: função pura sobre os Records + resolvers INJETADOS, cross-target, sem I/O/rede/wasm direto):
1. **Formato** (versionado): `{ app: "the-light-app", version: 1, exportedAt?, notes: {reference,body}[], highlights: {reference,color,tag?}[], planProgress: {planId,startDate,completed}|null }`. A `reference` é a STRING CANÔNICA do core (via `formatReference` injetado; no web = `formatReferenceEn`), consistente com o `ref` do `highlights.json` em disco. Ordenado por referência (determinístico → `serialize` byte-estável).
2. **Export:** monta o snapshot dos Records (`list_notes`/`list_highlights`/`reading_plan_progress`) — NÃO reimplementa o store. A UI (F5.26) fará o Share/save do `serializeSnapshot(...)`.
3. **Import + merge determinístico:** `parseSnapshot` valida (app/versão/tipos) e LANÇA antes de tocar o store; `assertValidReference` (core) rejeita referência irreal antes de qualquer escrita; `mergeSnapshots` faz UNIÃO por referência; APLICA só o DIFF via as fns de ESCRITA do core (`put_note`/`add_highlight`/`start_reading_plan`+`set_reading_plan_completed`), nunca reescrevendo o store.

### Regras de merge (documentadas)
- **Notas/marcações = união por `reference`.** Colisão → o snapshot IMPORTADO vence. **Motivo:** os Records `Note`/`Highlight` NÃO carregam timestamp (`Note = {reference, body}`; `Highlight = {reference, color, tag?}`), então "last-modified vence" (redação do ADR-0036) é IMPOSSÍVEL sem campo de tempo. Escolha determinística e documentada: o import é a autoridade (o usuário está trazendo o snapshot do outro dispositivo). `exportedAt` é INFORMATIVO e NÃO desempata.
- **Progresso de plano = LWW / `max(completed)`.** Import vazio não apaga plano local; mesmo plano (`planId`+`startDate`) → `max(completed)` (progresso NUNCA regride); plano diferente → o importado vence (LWW).
- **IDEMPOTENTE:** `merge(s, s) == s`; reimportar o mesmo snapshot = diff vazio (0/0/false), estado idêntico. Merge NÃO é simétrico (import = aplicar sobre o local, por design).

### Escopo / anti-alucinação / privacidade
Snapshot = SÓ notas + marcações + progresso de plano. **NÃO** sessões de IA (privacidade), **NÃO** banco bíblico, **NÃO** chave/token. NENHUM texto bíblico (só a referência canônica do core). Nada logado. Offline-first: puro/local, sem rede (o Drive é F5.24–25).

### Prova
Headless (node, sem browser/rede/chave) `test:web:snapshot` — exercita o motor de produção sobre um `SnapshotStore` ligado às MESMAS fns web (`*Fs`/`*PlanFs`) num `UserDataDir` em memória (mock OPFS) + wasm p/ `parseReference`/`listBooks`: (A) export dos Records; (B) round-trip (export → limpar → import → estado idêntico); (C) merge determinístico (colisão → importado vence; `max(completed)`/LWW); (D) import inválido/corrompido/irreal rejeitado sem corromper; (E) re-import idempotente. Marcador `WEB_SNAPSHOT`.

### Escopo NÃO coberto (próximas tarefas)
A UI de Share/file-picker/toggle é a **F5.26**; o OAuth/PKCE do Drive é a **F5.24**; push/pull no Drive é a **F5.25**. O motor é cross-target: o web já o liga fim-a-fim na prova; o **nativo** o ligará na F5.26 com um `SnapshotStore` sobre o frontier (`format_reference`/`parse_reference` — `parseReference`/`formatReferenceEn` já têm precedente em TS via `listBooks`, sem exigir mudança no core).

Próximo ADR livre = **ADR-0052** (0036–0051 usados; 0037 foi o PR de planos).

## ADR-0052 — F5.24: LINK do Google Drive no WEB = motor PURO de autorização OAuth 2.0 **PKCE client-side** (client-id público, SEM client-secret), escopo mínimo `drive.appdata`, token só no `TokenStore` injetado; 2ª etapa do sync (ADR-0036), reconcilia ADR-0023

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.24 (`gate: false`, 2ª da decomposição do sync ADR-0036) · **Depende:** **F5.22/ADR-0036** (a decisão de sync = export/import manual + Drive no web, opt-in), **F5.23/ADR-0051** (o SNAPSHOT round-trippável que a F5.25 vai mover ao Drive), **F2.4/ADR-0023 D3** (molde `keystore.ts` de serviço injetável + invariante de não-vazamento de segredo). **NÃO** toca o `the-light` (@ `225b8c9`) nem `core/**` — 100% app-side (web-only). Sem dep nova (Web Crypto/`fetch` injetados; Node/esbuild só na prova).

### Contexto
O ADR-0036 decidiu, como 2ª camada do sync (a 1ª, F5.23, é o snapshot local round-trippável), a **integração Google Drive no WEB**: o usuário LINKA a própria conta e o snapshot vai/vem da pasta **app-private** do Drive DELE. O Google EXIGE OAuth para isso e não há servidor do app para guardar um client-secret. Esta tarefa entrega **apenas o fluxo de autorização** (link/unlink + gestão de token); push/pull do snapshot é a F5.25, a UI opt-in é a F5.26, a validação com conta REAL é a F5.27 (gate humano).

### Decisão
Um motor **PURO / de injeção de dependências** `app/lib/driveAuth.ts` (molde `userdataSnapshot.ts`/`keystore.ts`: sem rede/crypto/relógio embutidos — recebe `fetch`, `crypto` (Web Crypto), `redirectUri`, `clientId`, um `TokenStore` (get/set/clear) e `now` opcional):
1. **OAuth 2.0 com PKCE (S256), cliente PÚBLICO, SEM client-secret.** `generatePkce(crypto)` → `code_verifier` = BASE64URL de 32 bytes aleatórios (43 chars, faixa 43–128 da RFC 7636) + `code_challenge` = BASE64URL(SHA-256(verifier)). `buildAuthUrl(...)` monta `accounts.google.com/o/oauth2/v2/auth` com `response_type=code`, `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, `scope`, `state` e `redirect_uri` (só campos PÚBLICOS — challenge, nunca o verifier). `exchangeCode(...)` faz POST a `oauth2.googleapis.com/token` com `grant_type=authorization_code`+`code_verifier`+`client_id`+`redirect_uri` — **sem `client_secret`** — e devolve `{accessToken, expiresAt, refreshToken?}`.
2. **Escopo MÍNIMO `https://www.googleapis.com/auth/drive.appdata`** — só a pasta oculta app-private do Drive (não lê o Drive do usuário, não toca outros arquivos dele).
3. **Estado/token:** `createDriveAuth(deps)` expõe `beginLink(state)` (PKCE+URL), `completeLink`/`link`/`unlink`, `isLinked`, `currentToken` (com checagem de expiração via `now`), `getLinkState` (`linked{email?,expiresAt} | unlinked`). O token vive SÓ no `TokenStore` injetado (a F5.26 liga a memória de sessão no web; secure storage no nativo) — **nunca em git/log**.

### Não-vazamento de segredo (LEI, molde ADR-0023 D3)
Client-id é PÚBLICO (pode ficar em config); **NUNCA** há client-secret (cliente público + PKCE). Access token / refresh token / `code_verifier` / `code_challenge` são SENSÍVEIS: `driveAuth.ts` **não faz NENHUMA chamada de log** (a prova faz grep do fonte por `console.*` e por `client_secret`, exigindo AUSÊNCIA), e a prova espiona `console.*` durante toda a execução exigindo que nenhum token/verifier apareça no output (`notoken=ok`).

### Reconciliação com ADR-0023 ("OAuth banido")
O ADR-0023 baniu OAuth para as **chaves BYOK de IA** (login-de-conta arriscava banir a conta do usuário e violava ToS dos provedores de LLM — ver pesquisa lá). O OAuth do Google Drive é caso DISTINTO e complementar: acessar o **armazenamento do PRÓPRIO usuário** (não uma credencial de LLM de terceiro), na conta DELE, onde o Google EXIGE OAuth e o **PKCE client-side (client-id público, sem segredo)** é o padrão seguro p/ clientes públicos. Sem infra/servidor/segredo do app. Não há conflito; a distinção fica registrada (já antecipada no ADR-0036).

### Offline-first / privacidade / anti-alucinação
Estritamente **OPT-IN e ADITIVO**: o app é 100% funcional com ZERO conta/rede; nada essencial passa a exigir Google. Esta camada NÃO toca dados do usuário nem o snapshot (só autorização) — nenhum texto bíblico, nenhuma sessão de IA, nenhuma chave BYOK. O módulo é puro/injetável, portanto FORA do entry graph eager do web (perf-budget `moduleCount` inalterado — 839; sem re-baseline).

### Prova
Headless (node, sem browser/rede/CONTA/chave) `test:web:driveauth` — exercita o MESMO código de produção com `fetch`/`crypto` MOCKADOS: (1) `generatePkce` DETERMINÍSTICO contra o vetor OFICIAL RFC 7636 Apêndice B (verifier + challenge = SHA-256 real); (2) `buildAuthUrl` com scope `drive.appdata`, `response_type=code`, S256, `access_type=offline`/`prompt=consent`, state+redirect, e SEM vazar o verifier; (3) `exchangeCode` POST ao token endpoint (`grant_type=authorization_code`+`code_verifier`, sem `client_secret`) → `link()` grava no TokenStore → `isLinked()`/`currentToken()` (com expiração) → `unlink()` limpa; (4) invariante de não-vazamento (`notoken=ok`). Marcador `DRIVE_AUTH pkce=ok url=ok exchange=ok link=ok unlink=ok notoken=ok`.

### Escopo NÃO coberto (próximas tarefas)
**MOCK apenas** — NENHUMA chamada real ao Google nesta tarefa. Push/pull do snapshot na pasta app-data + merge no pull → **F5.25**. UI opt-in (toggle OFF por padrão, aviso de privacidade, "funciona offline sem isto", link/unlink) + wiring nativo do motor de snapshot → **F5.26**. Validação com conta/Drive Google REAIS → **F5.27 (⛔ gate humano; conta/token NUNCA transitam pelo loop)**.

Próximo ADR livre = **ADR-0053** (0036–0052 usados; 0037 foi o PR de planos).

## ADR-0053 — F5.25: PUSH/PULL do snapshot na pasta app-private do Google Drive (arquivo canônico único) + MERGE no pull = motor PURO sobre F5.23/F5.24 + prova headless MOCK; 3ª etapa do sync (ADR-0036)

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.25 (`gate: false`, 3ª da decomposição do sync ADR-0036) · **Depende:** **F5.24/ADR-0052** (o fluxo OAuth/PKCE que provê o access token via `currentToken`), **F5.23/ADR-0051** (o SNAPSHOT round-trippável + merge determinístico que esta tarefa MOVE), **F5.22/ADR-0036** (a decisão de sync = export/import manual + Drive no web, opt-in). **NÃO** toca o `the-light` (@ `225b8c9`) nem `core/**` — 100% app-side (web-only TS). Sem dep nova (`fetch` injetado; Node/esbuild só na prova; wasm já presente).

### Contexto
O ADR-0036 decidiu, como 3ª camada do sync (a 1ª, F5.23, é o snapshot local round-trippável; a 2ª, F5.24, é o OAuth/link do Drive), o **transporte do snapshot** para/da pasta **app-private** (`appDataFolder`) do Drive do PRÓPRIO usuário: com o token linkado na F5.24, empurrar (push) e puxar (pull) o snapshot da F5.23, e no pull MESCLAR com o estado local. Com isto os dados do usuário transitam entre dispositivos via o Drive DELE, **sem servidor do app**. Esta tarefa entrega SÓ o motor de transporte+merge (MOCK); a UI opt-in + wiring nativo é a F5.26; a validação com conta/Drive REAIS é a F5.27 (gate humano).

### Decisão
Um motor **PURO / de injeção de dependências** `app/lib/driveSync.ts` (molde `driveAuth.ts`/`userdataSnapshot.ts`: sem rede/store/token embutidos — recebe `fetch`, `getToken()` (F5.24) e um `SnapshotStore` (F5.23)). `createDriveSync(deps)` expõe:
1. **`pushSnapshot()`** — `exportSnapshot(store)` (F5.23) → `serializeSnapshot` → **upload/replace** do ARQUIVO CANÔNICO ÚNICO `the-light-app.snapshot.json` na pasta app-private: cria via `POST /upload/drive/v3/files?uploadType=multipart` com `parents:["appDataFolder"]`; se já existe, substitui por id via `PATCH /upload/.../files/{id}?uploadType=media` (**id ESTÁVEL**). Retorna `{fileId, bytes}`.
2. **`pullSnapshot()`** — `findSnapshotFile()` (`GET /drive/v3/files?spaces=appDataFolder&q=name='...'`), baixa (`alt=media`) e delega 100% à F5.23 `importSnapshotIntoStore` (parse + valida app/versão/tipos + `assertValidReference` REAL via core ANTES de tocar o store + `mergeSnapshots` união + aplica SÓ o diff). App-data vazio = **no-op** (store intacto). Retorna `{applied, merged}`.
3. **`syncNow()`** — **pull-then-push** (convergência): puxa+mescla e então empurra o merge. **Idempotente**: na 2ª rodada seguida o remoto já == local → pull aplica 0/0/false e o push reescreve os mesmos bytes.

**Arquivo canônico único** (não histórico/multi-arquivo): o snapshot já É o estado completo do usuário (a F5.23 é round-trippável) e o merge é determinístico, então um arquivo substituível basta; simplicidade e sem duplicação. Bytes determinísticos (`exportSnapshot` ordenado, sem `exportedAt`) → id estável no replace e idempotência do sync.

### Reuso (não reimplementa)
Snapshot/merge = 100% F5.23 (`exportSnapshot`/`serializeSnapshot`/`importSnapshotIntoStore` → `parseSnapshot`/`mergeSnapshots`). OAuth/token = 100% F5.24 (chega pronto via `getToken`; expirado/ausente → `null` → o motor LANÇA sem tocar a rede). O motor NOVO é só o transporte Drive (list/download/create/update).

### Anti-alucinação / privacidade / merge não-destrutivo
O que SOBE é EXATAMENTE o snapshot da F5.23 — notas + marcações + progresso de plano, com referências CANÔNICAS do core e MAIS NADA: **NENHUM** texto bíblico (só a referência), **NENHUMA** sessão de IA, **NENHUM** banco, **NENHUMA** chave/token. O que BAIXA é validado (estrutura + referência real via core) ANTES de qualquer escrita. O **merge NUNCA apaga dado local** (união por referência; progresso `max(completed)` — F5.23/ADR-0051): provado que um pull de um remoto MENOR preserva a nota só-local.

### Não-vazamento de segredo (LEI, molde ADR-0052/ADR-0023 D3)
O access token chega SÓ do `getToken` injetado, vai SÓ no header `Authorization: Bearer` (o mock exige em TODA request) e NUNCA é logado (`driveSync.ts` não faz NENHUMA chamada de log; a prova faz grep do fonte por `console.*`, exigindo ausência, e espiona `console.*` durante toda a execução exigindo que o token nunca apareça — `notoken=ok`). As mensagens de erro citam só o status HTTP.

### Offline-first / perf
Estritamente **OPT-IN e ADITIVO**: o app é 100% funcional com ZERO conta/rede; nada essencial passa a exigir Google. O módulo é puro/injetável → FORA do entry graph eager do web (perf-budget `moduleCount` inalterado — 839; sem re-baseline).

### Prova
Headless (node, sem browser/rede/CONTA) `test:web:drivesync` — exercita o MESMO código de produção com um `fetch` MOCK + uma "nuvem" EM MEMÓRIA (dict que emula a app-data) + `SnapshotStore` ligado às fns web (`*Fs`/`*PlanFs`) + wasm p/ referência REAL: (1) push cria 1 arquivo canônico (list acha 1) e 2º push = replace (id estável); (2) só notas+marcações+progresso sobem (sem texto bíblico/sessão/chave; campos do snapshot); (3) pull vazio = no-op; (4) 2 dispositivos (2 stores + 1 nuvem) convergem p/ a UNIÃO após `syncNow` A→B→A, progresso = max(completed); (5) idempotência (0/0/false na 2ª); (6) merge nunca apaga (pull de remoto menor preserva local); (7) não-vazamento (`notoken=ok`). Marcador `DRIVE_SYNC push=ok pull=ok converge=ok idempotent=ok notoken=ok`.

### Escopo NÃO coberto (próximas tarefas)
**MOCK apenas** — NENHUMA chamada real ao Google nesta tarefa. UI opt-in (link/unlink, aviso de privacidade, botão "Sincronizar agora", "funciona offline sem isto") + wiring do motor de snapshot ao store NATIVO real → **F5.26**. Validação com conta/Drive Google REAIS → **F5.27 (⛔ gate humano; conta/token NUNCA transitam pelo loop)**.

Próximo ADR livre = **ADR-0054** (0036–0053 usados; 0037 foi o PR de planos).

## ADR-0054 — F5.26: UI de SINCRONIZAÇÃO **opt-in (OFF por padrão)** + backup manual + wiring do `SnapshotStore`→store REAL; 4ª e última etapa CONSTRUÍVEL do sync (ADR-0036) antes do gate humano F5.27

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.26 (`gate: false`, 4ª/última da decomposição do sync ADR-0036) · **Depende:** **F5.23/ADR-0051** (o motor do SNAPSHOT + `SnapshotStore` injetável que aqui é ligado ao store real), **F5.24/ADR-0052** (`createDriveAuth`/link/unlink/`currentToken`), **F5.25/ADR-0053** (`createDriveSync`/`syncNow`), **F5.2/ADR-0038** (KV `prefs` p/ persistir o opt-in; camada i18n). **NÃO** toca o `the-light` (@ `225b8c9`) nem `core/**` — 100% app-side. Sem dep nova (Share/file-picker/Blob do runtime; wasm já presente).

### Decisão
Entregar a **seção de sync opt-in + backup** que costura a trilha, com **offline-first EXPLÍCITO na UI**:

1. **Opt-in OFF por padrão** — `lib/syncPrefs.ts` (`createSyncPrefs` puro sobre o KV da F5.2): KV vazio / valor ≠ `'true'` lê `false`; desligar REMOVE a chave (volta ao default OFF). **Opt-in OFF ⇒ ZERO rede** (o Google Drive só aparece com o opt-in ON).
2. **Adaptador `SnapshotStore`→store REAL** — `lib/snapshotStore.shared.ts` (`createSnapshotStore` puro + `formatReferenceEnPure`, espelho SEM drift de `format_reference(_,En)` do core) + wiring por-alvo `snapshotStore.ts` (**nativo**, JSI/fs — alvo GARANTIDO) e `snapshotStore.web.ts` (**web**, OPFS). Liga o motor da F5.23/F5.25 às fns de fronteira reais (`listNotes`/`putNote`/`addHighlight`/`readingPlanProgress`/`startReadingPlan`/`setReadingPlanCompleted`) casadas ao `dataDir`; a referência canônica vem do core (`listBooks().nameEn`) e TODA referência importada é validada como REAL (`parse_reference` SÍNCRONO) ANTES de escrever (anti-alucinação).
3. **UI** (`components/SyncSettings.tsx`) — aviso "**funciona 100% offline sem isto**" em destaque; **aviso de PRIVACIDADE** (o que sincroniza = notas + marcações + progresso de plano; o que **NUNCA** sai do aparelho = sessões de IA, banco bíblico, chaves/segredos, texto de versículo além da referência) + "sem telemetria"; **backup manual** em TODOS os alvos (exportar: web = download de arquivo, nativo = Share sheet; importar: colar JSON em todos + file-picker no web) → `importSnapshotIntoStore` (merge determinístico da F5.23); **Google Drive** só web + só com opt-in ON (link/unlink + "Sincronizar agora" ligados à F5.24/F5.25). i18n (PT/EN, namespace `sync` — guardas i18n atualizadas), a11y (role+label), contraste (tokens de tema, zero hex).

### Sem chamada real ao Google (F5.27)
NADA de rede real ao Google nesta tarefa. O motor da F5.25 está LIGADO, mas sua rede real só é exercida com uma conta **linkada de verdade** + um **client-id configurado** (`EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID`, ausente por padrão — offline-first, **NENHUM segredo no repo**). Sem client-id, "Conectar" fica **gated** com aviso de que conectar conta real é a **F5.27 (gate humano)**; `isLinked`/`unlink` só leem/limpam o TokenStore de **sessão** (memória, sem rede); "Sincronizar agora" só habilita com conta linkada (nunca nesta versão). **Token/segredo NUNCA em git/log**: a UI não loga token nem conteúdo do snapshot; as mensagens de erro citam só o status HTTP.

### Perf (moduleCount INALTERADO; re-baseline SÓ de bytes) — nota sobre `loop/perf`
Para não regredir o entry eager do 1º paint (perf-budget travado — F5.19/ADR-0047), a seção de sync é **carregada SOB DEMANDA** (`import()` do painel `SyncSettings` a partir da Home) e seus **motores pesados** (snapshotStore/driveAuth/driveSync/userdataSnapshot + Share/file-picker) são `import()` no limite de chamada → **chunks ASYNC**, FORA do entry. Resultado: **`moduleCount` = 839 EXATO, inalterado** (sem regressão estrutural — verificado em 3 exports). O único crescimento foi de **TEXTO localizado** no catálogo i18n EAGER (aviso de privacidade/offline + rótulos, ~40 chaves PT+EN): eagerBytes 1.324.809→1.330.402 (+~5,6 KB raw), eagerBrotli 264.632→266.106 (+~1,5 KB), eagerGzip re-centrado dentro da banda antiga. Feito **re-baseline SÓ dos nominais de bytes** (tolerâncias inalteradas), centrado no flutter medido em 3 exports, em `scripts/measure-web-bundle.sh` **e** `loop/perf/web-bundle-budget.json` (nota `noteBytesF526`) — o único toque em `loop/`, autorizado pela instrução de perf da tarefa ("re-baseline com justificativa"); nenhum arquivo de ESTADO do loop (queue/done/STATUS/JOURNAL/HALT) foi tocado.

### Limitações registradas (candidatas a follow-up)
- **Importar por ARQUIVO no NATIVO:** não há `expo-document-picker`/`expo-sharing` no projeto (evitar dep nova + rebuild nativo fora de escopo). O nativo tem **importar por COLAGEM** (universal, offline) + exportar via **Share sheet**; o file-picker é web-only. Follow-up: adicionar picker nativo se/quando uma dep for aprovada.
- **Google Drive real:** gated (client-id ausente) → **F5.27** valida com conta/Drive reais (BYOK, gate humano; conta/token nunca transitam pelo loop).

### Prova
Headless (node, sem browser/rede/device/chave) `test:web:syncui` — exercita o MESMO código de produção que a tela costura: (A) o adaptador `createSnapshotStore` ligado a um store REAL em memória (`*Fs`/`*PlanFs` da F5.23 + wasm) → export→import **ROUND-TRIP** + idempotente; (B) `formatReferenceEnPure` == `formatReferenceEn` (sem drift; referência canônica do core); (C) opt-in **DEFAULT OFF** (KV vazio → `false`) + persiste (ligar grava/relê, desligar volta a OFF, valor-lixo lê OFF). Marcador `SYNC_UI store=ok optin_default_off=ok optin_persist=ok`. A UI React não roda 100% headless → o transporte manual (download/Share/file-picker) e os controles do Drive são provados por INSPEÇÃO + os guards de i18n/contraste/a11y sobre `SyncSettings.tsx`.

Próximo ADR livre = **ADR-0055** (0036–0054 usados; 0037 foi o PR de planos).

## ADR-0055 — F5.35: tela **Sobre / Créditos / Licenças** consolidada (KJV/Almeida domínio público · OpenBible CC-BY · STEP/Tyndale CC BY 4.0) + princípios (offline-first/BYOK/anti-alucinação) + atalho de backup; última da varredura de refinamento

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.35 (`gate: false`, ÚLTIMA da varredura F5.28+) · **Depende:** **F5.26/ADR-0054** (o painel `SyncSettings` que o atalho de backup REUSA), **F5.2/ADR-0038** (camada i18n PT/EN), **F1.4/ADR-0015** (tokens de tema), **ADR-0016** (atribuição OpenBible CC-BY) e **ADR-0026** (atribuição STEP CC BY 4.0). **NÃO** toca o `the-light` (@ `225b8c9`) nem `core/**` — 100% app-side, sem dep nova.

### Problema
Não havia tela central de "Sobre" (grep por about/onboarding/welcome/credits vazio). As atribuições apareciam SÓ contextualmente (OpenBible no painel de xref; STEP no painel de estudo) e os textos bíblicos embarcados (KJV, Almeida 1911) não tinham atribuição exibida em lugar nenhum.

### Decisão
Nova ROTA `app/app/about.tsx` (registrada na Stack do `_layout.tsx`; alcançável por um `<Link href="/about">` na Home), 100% CROMO, que consolida:

1. **4 fontes de dados embarcadas + licença** — texto bíblico KJV e Almeida 1911 = **domínio público**; **referências cruzadas OpenBible.info = CC-BY** (`about.xrefAttribution`); **léxico STEP Bible / Tyndale House = CC BY 4.0** (`about.stepAttribution`).
2. **Princípios inegociáveis** — offline-first (tudo essencial funciona sem rede/conta; dados locais), BYOK (chaves no cofre do aparelho / só-sessão no web; nunca logadas nem enviadas a ninguém além do provedor escolhido) e anti-alucinação (versículo sempre do acervo local verbatim; a IA só interpreta).
3. **Provedores de IA (BYOK, opcional)** — Claude (Anthropic), GPT (OpenAI), Gemini (Google) e **Ollama (modelos locais, sem chave)** — o conjunto REAL de `SUPPORTED_PROVIDERS` (`['anthropic','openai','gemini','ollama']`).
4. **Explicador de 1º uso** (`about.intro`) + **atalho de backup/export** que REUSA `SyncSettings` (F5.26), carregado SOB DEMANDA (`import()`, chunk async) — não construímos outra superfície de backup.

### Atribuições CC-BY = FONTE-DA-VERDADE (verbatim, sem drift)
As duas strings CC-BY são expostas via `t()` como valores FIXOS **idênticos em pt/en** (identificadores de licença, não texto traduzível) e são **cópias byte-a-byte** das constantes `XREF_ATTRIBUTION` (`ReaderXrefPanel.tsx`) e `STEP_ATTRIBUTION` (`ReaderStudyPanel.tsx`). Um novo guard `test:about-attr` (`about-attributions.test.mjs`, headless/text-extract, sem bundlar os painéis pesados) TRAVA a igualdade catálogo⇔constante e pt⇔en — se qualquer lado editar e divergir, FALHA (preserva o requisito de licença ADR-0016/0026). O allowlist do guard i18n-coverage (marcadores OpenBible/STEP Bible/CC-BY/CC BY/Tyndale) já isenta essas linhas; `about` foi adicionado ao conjunto de namespaces de CROMO em `i18n.test.mjs` e `i18n-coverage.test.mjs`.

### Perf (re-baseline DELIBERADO +1 rota eager; nota sobre `loop/perf`)
Com `web.output: static` e sem `asyncRoutes`, TODA rota do expo-router é eager no entry do 1º paint → a nova rota `about` é **+1 módulo eager EXATO** (moduleCount **839 → 840**, determinístico em 3 exports IDÊNTICOS), como a `/plans` foi na F5.10. O painel `SyncSettings` reusado segue `import()` sob demanda (chunk ASYNC, não pesa o entry). Bytes: a rota + ~18 chaves de CROMO (PT+EN) somam ~10,4 KB raw / ~1,7 KB brotli (eagerBytes 1.330.402→1.340.803; gzip 336.848→338.708; brotli 266.106→267.845). Feito **re-baseline** dos nominais (tolerâncias inalteradas) em `scripts/measure-web-bundle.sh` **e** `loop/perf/web-bundle-budget.json` (nota `noteF535`) — seguindo a `reBaselinePolicy` e o precedente F5.10/F5.19/F5.26, autorizado pela instrução de perf da tarefa ("re-baseline com justificativa"); é o ÚNICO toque em `loop/`, nenhum arquivo de ESTADO do loop (queue/done/STATUS/JOURNAL/HALT) foi tocado. Após o re-baseline, `test:web:perf-budget` volta a **LOCKED OK**.

### Prova
`npx tsc --noEmit` (0) · `test:about-attr` (atribuições byte-a-byte) · `test:i18n` + `test:i18n-coverage` (paridade pt/en 225 chaves, todas em namespace de CROMO, sem hardcoded PT/hex) · `test:a11y-scan` (73 interativos com role/label/alvo ≥44) · `test:web:contrast` (WCAG AA, tokens de tema) · `npx expo export --platform web` (sucesso) · `test:web:perf-budget` (LOCKED OK pós re-baseline). Offline: nenhuma rede, nenhum segredo; texto/atribuições são CROMO/dado exibido, não saída de modelo.

Próximo ADR livre = **ADR-0056** (0036–0055 usados; 0037 foi o PR de planos).

---

## ADR-0056 — F5.36: Bíblia de LEITURA **completa** (66 livros × KJV+Almeida) em NATIVO e WEB — corrige o bug "Mateus 1 indisponível"; léxico segue **amostrado** on-demand

- **Data:** 2026-07-03 · **Status:** aceito · **Tarefa:** F5.36 (`gate: false`; correção de bug reportado pelo humano) · **Depende:** **F1.3/ADR-0014** (gerador do subset de leitura), **F1.14/ADR-0020** (busca FTS5 web), **F1.15/ADR-0021** (xref web), **F5.15/ADR-0044** (split reading-lite/lexicon-sample), **F5.3** (fetch→OPFS on-demand), **F5.19/ADR-0047** (lock do orçamento perf). **NÃO** toca o `the-light` (@ `225b8c9`): o gerador é app-side (`core/examples/`), não o core externo.

### Problema (bug reportado)
Abrir **Mateus 1** (ou qualquer livro fora de Gênesis/Salmos/João) mostrava "Nenhum capítulo disponível nesta versão do banco de leitura", e a busca só achava hits nesses 3 livros. **Causa raiz:** o app embarcava um SAMPLE de dev de **3 livros** — o gerador `core/examples/gen_reading_sample_db.rs` fixava `BOOKS = [1, 19, 43]` (Gênesis/Salmos/João) e copiava só esses do `bible.sqlite` (que tem TODOS os 66 livros, KJV + Almeida 1911). Leitura/busca/xref são 100% offline — era DADO faltando, **não** gating de IA.

### Decisão
As tabelas de **LEITURA** (`books`, `verses`, `cross_references`, `verses_fts`) passam a copiar a **Bíblia COMPLETA** — 66 livros × 2 traduções — do `bible.sqlite` (SEM filtro de livro; xref sem o filtro "ambos os lados no subset"). O **léxico** (`original_tokens`/`lexicon`) segue **AMOSTRADO** em `LEXICON_BOOKS = [1,19,43]` (o léxico STEP completo é ~90 MB e o estudo profundo é on-demand + AI-gated + secundário — completo = follow-up **F5.38**). `scholarly_sources` segue copiado inteiro (poucas linhas: FK + atribuição STEP). Regenerado via `./scripts/gen-reading-sample-db.sh` → `reading-sample.sqlite` (asset NATIVO) + split F5.15 → `reading-lite.sqlite` (web, leitura/busca/xref, agora completo) + `lexicon-sample.sqlite` (léxico on-demand, **inalterado**).

### Anti-alucinação (preservado)
O texto dos versículos e o léxico são copiados **verbatim do `bible.sqlite`** via `INSERT ... SELECT FROM src` — nada fabricado/hardcodado. O schema continua vindo das migrações do `the-light-core` (`Store::open`). As asserções de sanidade do gerador foram mantidas (João 21 cap., João 3:16 KJV verbatim, FTS 1:1, xref/léxico de João 3:16) e AMPLIADAS: `count(DISTINCT number)==66` por tradução e Mateus (livro 40) com ≥1 capítulo em KJV e Almeida — o bug não pode voltar sem falhar a geração.

### Tamanho / Perf (re-baseline DELIBERADO do asset ON-DEMAND; nota sobre `loop/perf`)
`reading-lite.sqlite` cresce **4.530.176 → 40.308.736 B** (+35,78 MB; ~14,7 MB gzip / ~10,4 MB brotli over-the-wire). **NÃO é regressão de 1º paint:** este DB é carregado **ON-DEMAND** (fetch→OPFS, F5.3), NUNCA no entry EAGER — `moduleCount` fica **840 EXATO** (verificado no export) e `eagerBytes/gzip/brotli` do entry NÃO mudam (`transferHeadline` inalterado). Re-baseline SÓ do `readingLiteDbBytes` em `scripts/measure-web-bundle.sh` **e** `loop/perf/web-bundle-budget.json` (nota `noteF536`), seguindo a `reBaselinePolicy` e o precedente F5.15/F5.17 — é o ÚNICO toque em `loop/`, nenhum arquivo de ESTADO do loop foi tocado. Após o re-baseline, `test:web:perf-budget` volta a **LOCKED OK**.

### Offline-first (preservado)
A Bíblia de leitura é asset LOCAL: bundled no NATIVO (asset expo) e baixado **uma vez** (fetch→cache em OPFS) no WEB — nenhuma dependência de rede/conta em runtime para ler/buscar/navegar xref. O crescimento é custo de **transferência única cacheada**, não de cada boot. Se o download completo no web incomodar depois, "download opcional" é decisão humana futura (por ora, completo em todos os alvos — pedido explícito: "faz parte da Bíblia").

### Prova
Regeneração OK (versículos=62203, verses_fts=62203, cross_references=344799, léxico amostrado 56268 tokens). `sqlite3 reading-lite.sqlite "SELECT COUNT(*) FROM books"` = 132 (66×2); Matthew/Mateus presentes. Novo guard `test:web:coverage` (66 livros × 2 traduções, Mateus/Marcos/Lucas/Romanos presentes, ≥1 hit de busca em Romanos — FALHA se o banco regredir a um sample). `npx tsc --noEmit` (0) · `test:web:reading`/`search`/`xref`/`notes`/`plans` (verdes; search e xref tiveram seus valores DERIVADOS-DO-DADO atualizados p/ a Bíblia completa — "God"/kjv 646→3892; 1º xref de João 3:16 João 3:15/439 → Romanos 5:8/871; texto verbatim de João 3:16 preservado) · `npx expo export --platform web` (0) · `compress-web-assets.sh` (zero-drift OK) · `test:web:perf-budget` (LOCKED OK; moduleCount 840 inalterado). Offline: nenhuma rede/segredo.

Próximo ADR livre = **ADR-0057** (0036–0056 usados; 0037 foi o PR de planos). Follow-up: **F5.38** (léxico completo on-demand, opcional/nativo).
