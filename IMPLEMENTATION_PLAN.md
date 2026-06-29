# The Light App — Plano de Implementação (para execução pelo Claude Code)

> **Como usar este documento:** este é um plano executável. O agente deve ler
> primeiro o `VISION_AND_ARCHITECTURE.md` (visão e arquitetura — fonte de verdade
> do "porquê" e do "o quê") e depois executar as tarefas abaixo **em ordem**,
> fase a fase. Cada tarefa tem: objetivo, arquivos, notas de implementação,
> critério de aceite e comando de verificação. Não pule a verificação. Faça
> commit ao final de cada tarefa concluída e verde.
>
> **Papel:** este plano foi escrito por um agente planejador. O Claude Code
> executa. Em qualquer divergência entre este plano e a realidade do ecossistema
> no momento da execução (versões de ferramentas, APIs), **pare, registre um ADR
> em `DECISIONS.md` e ajuste** — não force soluções desatualizadas.

Stack: **Rust** (core) + **Expo / React Native + TypeScript** (app).
Alvos: **Web · iOS · Android**. Conteúdo inicial: **bilíngue PT + EN**.
Documento v0.1 · 2026-06-29

---

## 0. Regras de trabalho para o agente

1. **Leia `VISION_AND_ARCHITECTURE.md` antes de começar.** Ele é a fonte de
   verdade de design; este arquivo é o "como".
2. **Trabalhe fase a fase, tarefa a tarefa.** Não comece uma fase sem a anterior
   verde. Não comece UI antes da Fase 0 (a ponte) estar provada.
3. **Não modifique o `the-light` original.** Consuma `the-light-core` como
   dependência (git ou submódulo, pinada por commit). Toda a fronteira nova vive
   em `the-light-app`. Se for **estritamente necessário** mudar o core (ex.: novo
   provedor Gemini, abstração de store/transport), faça via PR no repo `the-light`
   e registre em `DECISIONS.md` — nunca um fork divergente silencioso.
4. **Padrão de qualidade por tarefa:**
   - Rust: `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test` verdes.
   - TS/Expo: `tsc --noEmit`, `eslint`, e o app sobe nos alvos relevantes.
5. **Commits pequenos e descritivos** (Conventional Commits, prefixados com o ID
   da tarefa, ex.: `feat(F0.2): bridge parse_reference via UniFFI`).
6. **Offline-first e BYOK são regras rígidas.** Nada essencial pode exigir rede
   ou conta. Chaves de IA **nunca** no git nem em logs — usar armazenamento seguro
   do dispositivo (Keychain/Keystore; cofre apropriado no web).
7. **Licenciamento é regra rígida.** Só embarcar versões de domínio público.
   Versões protegidas só via conector opt-in com credencial do usuário.
   Atribuições (OpenBible CC-BY, STEPBible) visíveis na UI.
8. **Documente decisões** em `DECISIONS.md` (ADR curto) a cada escolha relevante
   (store no WASM, transporte da IA no web, lib de navegação, etc.).
9. **Atualize `PROGRESS.md`** ao concluir cada tarefa: ID, data, resumo, commit.
10. **Anti-alucinação é inegociável.** O texto de versículo sempre vem do store
    local (Rust); o LLM só produz interpretação; o stripping de citações
    (`ai::citation`) roda em todos os alvos. Qualquer atalho que envie "o modelo
    inventa o versículo" é um bug, não uma feature.

---

## 1. Estrutura-alvo do repositório `the-light-app`

```
the-light-app/
├── VISION_AND_ARCHITECTURE.md      # já existe — fonte de verdade de design
├── IMPLEMENTATION_PLAN.md          # este arquivo
├── DECISIONS.md                    # ADRs curtos (criar na F0.1)
├── PROGRESS.md                     # log de execução (criar na F0.1)
├── core/                           # crate Rust: fronteira UniFFI sobre the-light-core
│   ├── Cargo.toml
│   ├── src/lib.rs                  # API exposta + tipos UniFFI
│   ├── src/store_bridge.rs         # abstração de store (rusqlite nativo / wa-sqlite web)
│   └── src/transport.rs            # LlmProvider plugável (reqwest nativo / fetch web)
├── bindings/                       # bindings TS gerados (não editar à mão)
├── app/                            # projeto Expo (React Native + TS)
│   ├── app/                        # rotas (expo-router)
│   ├── components/
│   ├── modules/the-light-core/     # Expo module ligando aos bindings nativos
│   ├── lib/                        # wrappers TS sobre a API do core
│   └── web/                        # glue do alvo web (wa-sqlite/OPFS, fetch provider)
├── assets/data/                    # banco SQLite gerado / assets pré-indexados
└── scripts/                        # geração de bindings, build do core, import de dados
```

---

## 2. Pré-requisitos a confirmar no início (F0.0)

Antes de codar, confirmar e registrar versões em `DECISIONS.md`:

- Toolchain Rust com targets: `wasm32-unknown-unknown`, `aarch64-apple-ios`,
  `aarch64-linux-android` (e os demais via `cargo-ndk`).
- Node LTS + `pnpm`/`npm`; Expo SDK atual; `expo-router`.
- `uniffi-bindgen-react-native` (verificar release atual / possível rename para
  `uniffi-bindgen-javascript`) e seu fluxo de build (ex.: ferramenta `ubrn`).
- Xcode (iOS) e Android SDK/NDK.
- Decisão de store no web: recomendação inicial **`wa-sqlite` + OPFS** no web e
  **`rusqlite` (bundled)** no nativo — confirmar e registrar.

---

## FASE 0 — Prova da ponte Rust → Expo (vertical slice)

> Objetivo da fase: provar a toolchain ponta a ponta com **uma** função do core
> rodando em **Web + iOS + Android**, antes de qualquer investimento em UI.
> Esta fase decide a viabilidade de todo o projeto.

### F0.1 — Bootstrap do repositório e documentos de processo
- **Objetivo:** estrutura base + docs de processo.
- **Arquivos:** árvore da seção 1 (vazia), `DECISIONS.md`, `PROGRESS.md`,
  `.gitignore` (ignorar `bindings/` gerado, `node_modules/`, artefatos de build,
  segredos).
- **Aceite:** repo organizado; docs criados; `the-light` referenciado como
  dependência pinada por commit.
- **Verificação:** `git status` limpo após commit inicial; `the-light-core`
  resolve em `cargo metadata`.

### F0.2 — Crate `core/` com fronteira UniFFI mínima
- **Objetivo:** expor `parse_reference(input) -> Reference` (e um tipo de retorno
  serializável) via UniFFI, delegando para `the-light-core::reference`.
- **Arquivos:** `core/Cargo.toml`, `core/src/lib.rs` (+ `.udl` ou proc-macros).
- **Notas:** começar pela função **mais pura** (parsing, sem I/O nem rede) para
  isolar a complexidade da ponte. Definir o padrão de erro UniFFI aqui.
- **Aceite:** `cargo build` do crate `core` ok; interface UniFFI válida.
- **Verificação:** `cargo test -p the-light-app-core` (testes da fronteira).

### F0.3 — Geração de bindings e app Expo mínimo
- **Objetivo:** gerar bindings TS e chamar `parse_reference` de um app Expo que
  renderize o resultado numa tela.
- **Arquivos:** `scripts/gen-bindings.*`, `app/` (Expo + expo-router),
  `app/modules/the-light-core/`, `app/lib/core.ts`.
- **Aceite:** digitar "Jo 3.16" na UI retorna a referência resolvida pelo Rust.
- **Verificação:** rodar nos **três** alvos:
  - `npx expo start --web` → funciona no navegador (WASM).
  - `npx expo run:ios` → funciona no simulador iOS.
  - `npx expo run:android` → funciona no emulador Android.
- **Gate:** se algum alvo não passar, **parar** e registrar a barreira em
  `DECISIONS.md` antes de seguir.

### F0.4 — Decisão e prova do store (SQLite) nos três alvos
- **Objetivo:** ler **uma passagem** de um banco SQLite pequeno (subset KJV) em
  todos os alvos, validando a estratégia de store.
- **Arquivos:** `core/src/store_bridge.rs`, `app/web/sqlite.ts` (wa-sqlite/OPFS),
  `assets/data/sample.sqlite`.
- **Notas:** nativo via `rusqlite` (bundled); web via `wa-sqlite`+OPFS com store
  injetado no core. Manter a interface de store idêntica para o resto do core.
- **Aceite:** `getPassage("John 3:16")` devolve o texto correto nos três alvos.
- **Verificação:** teste manual por alvo + um teste automatizado da camada store.

> **Marco 0:** ponte e store provados em Web/iOS/Android. Só então seguir.

---

## FASE 1 — Leitura offline multiplataforma (sem IA, sem rede)

> Produto mínimo já útil e fiel ao offline-first.

### F1.1 — Pipeline de dados e banco embarcado
- **Objetivo:** gerar o banco completo (KJV + Almeida 1911, PT/EN) e empacotá-lo
  como asset, reaproveitando o importador `xtask` do `the-light`.
- **Aceite:** contagem de versículos validada (KJV 31.102; Almeida 1911 31.101).
- **Verificação:** script de import idempotente; checagem de contagem.

### F1.2 — Expor leitura no core (livros, capítulos, passagens, versões)
- **Objetivo:** funções UniFFI para listar livros, abrir capítulo, trocar versão,
  obter passagem numerada por versículo.
- **Aceite:** navegação programática completa pela API do core.
- **Verificação:** `cargo test` da fronteira.

### F1.3 — UI de leitura
- **Objetivo:** telas de navegação (livro → capítulo → texto), seletor de versão,
  múltiplas versões lado a lado, tema claro/escuro.
- **Arquivos:** `app/app/(read)/...`, `app/components/Reader*`.
- **Aceite:** ler qualquer capítulo nos três alvos, trocar versão, alternar tema.
- **Verificação:** teste manual por alvo + checks de tipos/lint.

### F1.4 — Busca FTS5
- **Objetivo:** expor `search` (FTS5, acento-insensível) e UI de resultados.
- **Aceite:** buscar termo PT/EN retorna acertos com referência clicável.
- **Verificação:** `cargo test` (search) + teste manual da UI.

### F1.5 — Referências cruzadas
- **Objetivo:** integrar as ~344k xrefs (OpenBible/TSK), com atribuição CC-BY
  visível, e UI de "referências relacionadas" por passagem.
- **Aceite:** abrir xrefs de uma passagem; atribuição exibida.
- **Verificação:** `cargo test` (xref) + teste manual.

### F1.6 — Notas e marcações no dispositivo
- **Objetivo:** criar/editar/remover notas e highlights, persistidos localmente em
  formato exportável; reaproveitar `userdata` do core.
- **Aceite:** dados sobrevivem a reinício do app; export funciona.
- **Verificação:** teste de persistência por alvo.

> **Marco 1:** app de leitura offline completo, multiplataforma. Zero rede.

---

## FASE 2 — Camada de IA BYOK (Claude · GPT · Gemini)

### F2.1 — Provedor Gemini no core (via PR no `the-light`)
- **Objetivo:** implementar `GeminiProvider` no trait `LlmProvider` do
  `the-light-core` (endpoint `generativelanguage.googleapis.com`), análogo a
  Anthropic/OpenAI; incluir `default_model` e `estimate_cost_usd`.
- **Aceite:** paridade com os provedores existentes; testes com mock.
- **Verificação:** `cargo test` no `the-light` (suíte de providers).

### F2.2 — Transporte de IA plugável (nativo vs web)
- **Objetivo:** abstrair o transporte HTTP do `LlmProvider` — `reqwest` no
  nativo; provider que delega `fetch` ao JS no web (evita CORS/TLS do browser).
  **Toda a inteligência** (contexto RAG, prompt, stripping de citação) permanece
  no Rust.
- **Arquivos:** `core/src/transport.rs`, `app/web/llm-fetch.ts`.
- **Aceite:** mesma chamada ancorada funciona em nativo e web.
- **Verificação:** teste de integração por alvo com chave de teste.

### F2.3 — Gestão segura de chaves (BYOK)
- **Objetivo:** tela de configuração de chaves por provedor, persistidas em
  Keychain (iOS) / Keystore (Android) / cofre adequado (web). Nunca logar.
- **Aceite:** chave sobrevive a reinício; nunca aparece em logs/telemetria (não há
  telemetria).
- **Verificação:** auditoria manual de logs + teste de persistência.

### F2.4 — Pergunta ancorada (`ask`) na UI
- **Objetivo:** UI para perguntar sobre uma passagem com IA; resposta separa
  **texto citado** (do store) de **interpretação** (do modelo); seletor de
  provedor/modelo; estimativa de custo visível.
- **Aceite:** resposta ancorada e citada nos três alvos, com Claude, GPT e Gemini.
- **Verificação:** teste manual cobrindo os três provedores e os três alvos.

> **Marco 2:** IA BYOK ancorada funcionando com Claude/GPT/Gemini.

---

## FASE 3 — Estudo profundo

### F3.1 — Modos × lentes × profundidades na UI
- **Objetivo:** expor os 4 modos (Acadêmico/Devocional/Introdutório/Sermão), 6
  lentes denominacionais e 3 profundidades; integrar grego/hebraico (Strong's).
- **Aceite:** estudo de uma passagem variando modo/lente/profundidade.
- **Verificação:** teste manual + checagem de que os prompts corretos são usados.

### F3.2 — Conversa com follow-up (`ask_session`)
- **Objetivo:** UI de conversa mantendo o contexto ancorado da passagem.
- **Aceite:** follow-ups coerentes sem perder a âncora local.
- **Verificação:** teste manual de sessão.

### F3.3 — Modo comparação multi-IA (diferencial de produto)
- **Objetivo:** enviar a mesma pergunta ancorada a Claude/GPT/Gemini e exibir as
  respostas lado a lado (contexto RAG idêntico, montado localmente).
- **Aceite:** três respostas comparáveis para a mesma âncora.
- **Verificação:** teste manual com as três chaves configuradas.

### F3.4 — Exportação acadêmica
- **Objetivo:** exportar estudo com notas SBL → Markdown (e PDF/DOCX via pipeline
  apropriado), reaproveitando `export` do core.
- **Aceite:** arquivo exportado com citações corretas e sidecar de citações.
- **Verificação:** conferência do arquivo gerado.

> **Marco 3:** plataforma de estudo profundo completa.

---

## FASE 4 — Refinamento e abertura

- **F4.1** Planos de leitura (anual/NT/evangelhos) com progresso e lembretes.
- **F4.2** Acessibilidade, i18n da UI (PT/EN), temas.
- **F4.3** Performance: carregamento sob demanda do banco/WASM no web; tamanho do
  bundle.
- **F4.4** (Opcional, futuro) Sync por conta — **sem** quebrar o offline-first
  como base. Registrar ADR antes de iniciar.

> **Marco 4:** refino e lançamento.

---

## Apêndice A — Gates de decisão críticos (parar e registrar ADR)

1. **F0.3/F0.4:** se a ponte UniFFI ou o store não rodarem em algum dos três
   alvos, reavaliar a estratégia (ex.: web tratado como "leitura + IA" com dados
   pré-indexados) antes de prosseguir.
2. **F2.2:** confirmar a abordagem de transporte no web (fetch via JS) com um
   provedor real antes de construir a UI de IA por cima.
3. Qualquer necessidade de alterar o `the-light-core` deve virar PR + ADR, nunca
   um fork divergente.

## Apêndice B — Mapa de reaproveitamento do `the-light-core`

| Capacidade | Módulo no core | Fase |
|---|---|---|
| Parsing de referência PT/EN | `reference` | F0.2 |
| Store SQLite / passagens | `store`, `model` | F0.4, F1.2 |
| Busca FTS5 | `search` | F1.4 |
| Referências cruzadas | `xref` | F1.5 |
| Notas/marcações/planos | `userdata` | F1.6, F4.1 |
| Contexto RAG local + prompts | `ai::study`, `ai::prompts` | F2.4, F3.1 |
| Provedores LLM (trait) | `ai::providers` (+ Gemini novo) | F2.1, F2.2 |
| Anti-alucinação (stripping) | `ai::citation` | F2.4 |
| Grego/hebraico, léxico | `ai::lexicon`, `scholarly` | F3.1 |
| Exportação acadêmica | `export` | F3.4 |
