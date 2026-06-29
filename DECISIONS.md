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
| Gerador de bindings UniFFI              | `uniffi-bindgen-react-native` (CLI `ubrn`), em transição p/ `uniffi-bindgen-javascript` | NÃO INSTALADO (instalar na fronteira, ~F0.2/F0.4) |
| `uniffi-bindgen`                        | ausente do PATH                     | PENDÊNCIA     |
| `cargo-ndk`                             | ausente                             | PENDÊNCIA (build Android) |
| Xcode completo (`xcodebuild`)           | ausente (só Command Line Tools em `/Library/Developer/CommandLineTools`) | BLOQUEIO futuro (build iOS, ~F0.7) |
| Android SDK/NDK (`ANDROID_HOME`, `adb`) | não configurados                    | BLOQUEIO futuro (build Android, ~F0.8) |

Pendências leves (`rustup target add ...`, instalar `ubrn`/`cargo-ndk`) são
resolvíveis por script na tarefa que precisar de cada alvo. Os dois BLOQUEIOS
reais (Xcode completo e Android SDK/NDK) exigem setup humano de máquina e
deverão disparar HALT nas tarefas F0.7/F0.8 se ainda não resolvidos.

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
