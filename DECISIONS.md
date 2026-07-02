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

- **Data:** 2026-07-02 · **Status:** **aceito (PR proposto; pendente merge humano)** · **Tarefa:** F4.6 (**gate:true** — toca o `the-light` via PR + ADR) · **Depende:** ADR-0023 (D4: streaming na fronteira), ADR-0024/F2.7 (precedente PR `ai-pure` ao core + re-pin), ADR-0005 (precedente PR de feature-gating + molde de handoff), ADR-0033/ADR-0034 (streaming/multi-provedor **web** = só transporte TS). · **Handoff:** push/merge é ação humana → o Driver **re-pina** `core/Cargo.toml` (2 linhas) no novo rev.

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
