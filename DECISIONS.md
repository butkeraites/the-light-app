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
