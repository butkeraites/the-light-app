# The Light App — Visão & Arquitetura

> Plataforma de **estudo bíblico profundo orientado a IA**, multiplataforma
> (Web · iOS · Android), construída sobre o motor Rust do
> [`the-light`](https://github.com/butkeraites/the-light).
>
> Versão do documento: 0.1 · Data: 2026-06-29 · Autor: Renan

---

## 1. A ideia em uma frase

Pegar o motor de estudo bíblico do The Light — dados abertos, ~344.000
referências cruzadas, grego/hebraico verificado, lentes denominacionais e uma
camada de IA **ancorada e citada** (não alucinada) — e levá-lo do terminal para
um app moderno acessível no navegador e nos celulares, com Claude, ChatGPT e
Gemini como motores de IA intercambiáveis, mantendo os princípios de
*offline-first* e *bring-your-own-key* (BYOK).

O posicionamento herdado do The Light continua sendo o diferencial:

> *"Um leitor/estudo bíblico hackeável, com camada de IA opcional e lente
> teológica configurável, que respeita licenças e roda com as chaves do próprio
> usuário."*

A diferença agora é **alcance**: deixa de ser uma ferramenta de terminal para
nicho técnico e passa a ser um produto que qualquer pessoa pode usar no
celular ou no navegador — sem perder a alma (dados do usuário no dispositivo,
texto bíblico sempre *verbatim* da fonte, IA que distingue citação de
interpretação).

---

## 2. O gap de mercado que ocupamos

O mercado de apps bíblicos hoje se divide em mundos que não conversam:

| Categoria | Exemplos | Limitação |
|---|---|---|
| Apps de leitura/devocional | YouVersion, Bíblia JFA, Olive Tree | Leitura e planos, mas estudo raso; IA inexistente ou superficial; dados na nuvem deles. |
| Apps de IA bíblica | Spirit Speak AI, Aura, Biblical-AI | IA que **alucina** citações, sem perspectiva denominacional explícita, fechados, sem dados locais. |
| Software de estudo sério | Logos, Accordance | Profundos, porém caros, pesados, desktop-first e sem IA generativa moderna integrada de forma honesta. |

**Nenhum combina as três coisas:** estudo exegético sério + IA generativa
*ancorada e citada* com lente denominacional explícita + dados abertos e
privacidade por padrão, num app multiplataforma leve. É exatamente esse
cruzamento que o The Light App ocupa.

### O que nos torna "diferente de tudo"

1. **IA que não inventa versículo.** O texto bíblico vem sempre *verbatim* do
   acervo local; o modelo só produz interpretação; citações fabricadas são
   removidas automaticamente (herança do ADR-0008 do The Light).
2. **Lente teológica explícita.** O usuário escolhe a perspectiva (Batista,
   Presbiteriana, Luterana, Pentecostal, Católica, Ortodoxa) e a profundidade do
   estudo — e o app é transparente sobre isso.
3. **Multi-IA real.** Claude, ChatGPT e Gemini lado a lado, com BYOK: o usuário
   compara respostas e paga só o próprio uso.
4. **Privacidade por padrão.** Notas, marcações e chaves vivem no dispositivo.
   Sem conta obrigatória, sem telemetria.
5. **Erudição embarcada.** Grego/hebraico com Strong's, ~344k referências
   cruzadas votadas, exportação acadêmica (notas SBL).

---

## 3. Princípios de design (herdados e adaptados)

1. **Offline-first.** Leitura, busca, notas, marcações, planos e referências
   cruzadas funcionam 100% sem internet e sem IA.
2. **Bring-your-own-key (BYOK).** A IA é opcional; o usuário fornece a própria
   chave (Claude/GPT/Gemini) e paga o próprio uso. As chaves ficam no
   armazenamento seguro do dispositivo.
3. **Os dados do usuário são do usuário.** Notas e marcações em formato aberto e
   exportável; sync na nuvem é opcional e futuro, nunca pré-requisito.
4. **Licença em primeiro lugar.** Só embarcamos versões de domínio público;
   versões protegidas (NVI/ARA/ESV...) só via conector opt-in com credenciais do
   próprio usuário.
5. **Texto vs. interpretação sempre distinguíveis.** A saída de IA cita
   versículos e marca claramente o que é leitura interpretativa.
6. **Uma fonte da verdade.** A lógica de domínio vive no core Rust e é
   compartilhada por web, iOS e Android — não reimplementada três vezes.

---

## 4. Decisão arquitetural central: reaproveitar o core Rust

A escolha definida é **reaproveitar `the-light-core`** como um motor portável,
compilado para os três alvos a partir de uma única base de código, em vez de
reescrever a lógica em TypeScript ou escondê-la atrás de um servidor.

### Por quê

- O valor do produto **está no core**: o parsing de referência PT/EN, a montagem
  do contexto RAG estritamente local, o stripping anti-alucinação, as lentes
  denominacionais e os dados de erudição. Reescrever isso em TS significaria
  duplicar o moat e arriscar divergência de comportamento.
- O core já é desenhado com fronteiras limpas (crate `the-light-core` separado da
  CLI/TUI) e com a IA atrás de um *trait* (`LlmProvider`), o que facilita expor
  uma API estável.
- Mantém *offline-first* e *BYOK* honestos: a inteligência roda no dispositivo,
  não num servidor nosso.

### Como: UniFFI → Web (WASM) + iOS/Android (Turbo Modules)

O ecossistema amadureceu exatamente para este caso. O
[`uniffi-bindgen-react-native`](https://jhugman.github.io/uniffi-bindgen-react-native/)
(Mozilla/Filament) gera, a partir de uma interface Rust anotada com UniFFI,
*bindings* TypeScript que funcionam tanto como **Turbo Modules nativos** (Swift no
iOS, Kotlin no Android) quanto como **WASM** para a web (`wasm32-unknown-unknown`).
Ou seja: escrevemos a fronteira uma vez em Rust e consumimos de TypeScript nos
três alvos. O projeto está em release inicial mas ativo (em transição de nome
para `uniffi-bindgen-javascript`), e há receitas prontas de integração com Expo.

```
                 ┌───────────────────────────────────────────┐
                 │            the-light-core (Rust)            │
                 │  reference · store · search · xref ·        │
                 │  scholarly · ai (RAG local, citation,       │
                 │  prompts, LlmProvider trait)                │
                 └───────────────────────────────────────────┘
                                    │  interface UniFFI (.udl / proc-macros)
                                    ▼
                 ┌───────────────────────────────────────────┐
                 │        uniffi-bindgen-react-native          │
                 └───────────────────────────────────────────┘
                    │                  │                  │
          wasm32-unknown-unknown   iOS (Swift)      Android (Kotlin)
                    │                  │                  │
                    ▼                  ▼                  ▼
        ┌───────────────────────────────────────────────────────┐
        │             App Expo (React Native + TS)                │
        │   UI · navegação · estado · telas de leitura/estudo     │
        │   Expo Web  ·  Expo iOS  ·  Expo Android                 │
        └───────────────────────────────────────────────────────┘
```

### As duas fricções honestas desta abordagem

Vale registrar onde mora a dificuldade, para não haver surpresa:

1. **SQLite no alvo web (WASM).** No nativo, o `rusqlite` (SQLite embarcado,
   bundled) compila e roda bem dentro do módulo nativo. No WASM puro
   (`wasm32-unknown-unknown`), o SQLite em C não compila trivialmente. Opções a
   decidir na fase de arquitetura técnica:
   - Compilar SQLite para WASM no lado JS (`wa-sqlite`/`sql.js` com OPFS para
     persistência) e o Rust acessar dados via uma camada de store injetada; **ou**
   - Adotar um store alternativo no alvo web; **ou**
   - Tratar o web como "leitura + IA" servindo os dados como assets pré-indexados
     e reservar o store completo para o nativo.
   Recomendação inicial: `wa-sqlite` + OPFS no web, mantendo `rusqlite` no nativo,
   com a interface de store abstraída para esconder a diferença do resto do core.

2. **Transporte HTTP da IA.** O core hoje chama os provedores via `reqwest`
   (rustls). No nativo isso funciona. No WASM/web, chamadas diretas esbarram em
   CORS/TLS do browser. Como o `LlmProvider` já é um *trait*, a saída limpa é:
   manter em Rust **toda a inteligência** (montagem do contexto RAG, construção do
   prompt por modo/lente/profundidade, e o stripping de citações) e tornar o
   *transporte* plugável — no nativo, `reqwest`; no web, um provider que delega o
   `fetch` para o JS. A ancoragem anti-alucinação continua 100% no Rust, em todos
   os alvos.

---

## 5. Camada de IA: Claude, ChatGPT e Gemini

O core já implementa provedores para **Anthropic (Claude)** e **OpenAI (GPT)**,
além de **Ollama** (local), todos atrás do trait `LlmProvider`. O fluxo de
ancoragem (`ai::study::ask_context`, prompts por modo/lente, `ai::citation`) é
agnóstico de provedor.

O que muda para o app:

- **Adicionar o provedor Gemini** (Google) — é uma nova implementação do
  `LlmProvider` (endpoint `generativelanguage.googleapis.com`), análoga às que já
  existem. Esforço pequeno e isolado.
- **Seletor de modelo na UI** com BYOK por provedor, reaproveitando o conceito do
  `secrets.toml`/keystore — no app, as chaves vão para o armazenamento seguro
  (Keychain no iOS, Keystore no Android, e um cofre apropriado no web).
- **Modo comparação** (diferencial de produto): a mesma pergunta ancorada enviada
  a Claude, GPT e Gemini lado a lado, já que o contexto RAG é idêntico e montado
  localmente.

As capacidades de estudo já existentes a expor na UI: **4 modos** (Acadêmico,
Devocional, Introdutório, Sermão) × **6 lentes denominacionais** × **3
profundidades**, mais o `ask` ancorado a uma passagem e o `ask_session`
(conversa com follow-up).

---

## 6. Modelo de dados e conteúdo

- **Texto bíblico:** versões de domínio público embarcadas (KJV, Almeida 1911...),
  geradas pelo importador `xtask` para SQLite (`translations/books/verses/
  verses_fts`). Bilíngue PT/EN desde o início.
- **Referências cruzadas:** ~344k da OpenBible.info (Treasury of Scripture
  Knowledge), votadas — exigem atribuição CC-BY visível na UI.
- **Erudição:** tokens de grego/hebraico (STEPBible) com Strong's e léxico breve,
  unidos por versículo.
- **Dados do usuário:** notas, marcações, planos de leitura e sessões — hoje em
  arquivos; no app, persistidos no dispositivo com formato exportável.
- **Versões protegidas:** nunca embarcadas; somente via conectores opt-in com
  credenciais do próprio usuário (modelo já definido no The Light).

---

## 7. Estrutura proposta do repositório `the-light-app`

```
the-light-app/
├─ core/                      # crate Rust: fronteira UniFFI sobre the-light-core
│  ├─ src/lib.rs              # API exposta (parse, passage, search, study, ask…)
│  └─ the_light.udl           # ou proc-macros UniFFI
├─ bindings/                  # bindings TS gerados (web/wasm + nativo)
├─ app/                       # projeto Expo (React Native + TS)
│  ├─ app/                    # rotas (expo-router): leitura, estudo, busca…
│  ├─ components/             # UI de leitura, painel de estudo, seletor de IA
│  ├─ modules/                # Expo modules que ligam aos bindings nativos
│  └─ web/                    # glue do alvo web (wa-sqlite, fetch provider)
├─ assets/data/              # banco SQLite gerado / assets pré-indexados
└─ VISION_AND_ARCHITECTURE.md
```

O `the-light-core` pode ser consumido como dependência (git/submódulo) sem ser
modificado, mantendo o projeto original intacto e evoluindo a fronteira no novo
repo.

---

## 8. Roadmap em fases

**Fase 0 — Prova de conceito da ponte (1 vertical slice).**
Expor uma única função do core (ex.: `parse_reference` + buscar uma passagem) via
UniFFI e chamá-la dos três alvos (Expo web, iOS, Android). Objetivo: validar a
toolchain ponta a ponta antes de investir em UI. Resolver aqui a questão do
SQLite no WASM.

**Fase 1 — Leitura offline multiplataforma.**
Navegação por livro/capítulo, múltiplas versões PT/EN, busca FTS5, referências
cruzadas, notas e marcações no dispositivo. Zero IA, zero rede. É o produto
mínimo já útil e fiel ao "offline-first".

**Fase 2 — Camada de IA BYOK.**
Tela de chaves (Keychain/Keystore), seletor de provedor/modelo, `ask` ancorado a
uma passagem com Claude e GPT. Adicionar o provedor **Gemini**. Garantir que o
contexto RAG e o stripping de citação rodam idênticos em todos os alvos.

**Fase 3 — Estudo profundo.**
Modos × lentes × profundidades na UI, `ask_session` (conversa), e o **modo
comparação** entre Claude/GPT/Gemini. Exportação acadêmica (SBL → Markdown/PDF).

**Fase 4 — Refinamento e abertura.**
Planos de leitura com lembretes, temas, acessibilidade, e — se desejado no futuro
— sync opcional por conta (sem quebrar o offline-first como base).

---

## 9. Riscos e questões em aberto

- **Maturidade do `uniffi-bindgen-react-native`** (release inicial): mitigar com
  a Fase 0 antes de qualquer compromisso de UI.
- **SQLite no WASM:** decisão técnica da Fase 0 (recomendação: `wa-sqlite`+OPFS no
  web, `rusqlite` no nativo, store abstraído).
- **Tamanho do bundle:** banco bíblico + WASM + assets; avaliar carregamento
  sob demanda no web.
- **Custos de IA do usuário:** manter o estimador de custo (`estimate_cost_usd`)
  visível na UI para transparência.
- **Licenciamento de conteúdo:** manter a disciplina do The Light — só domínio
  público embarcado; atribuições (OpenBible CC-BY, STEPBible) visíveis.

---

## 10. Próximos passos sugeridos

1. Aprovar esta visão/arquitetura (ou ajustar pontos do roadmap).
2. Iniciar a **Fase 0**: scaffold do repo `the-light-app` com Expo + a primeira
   função do core via UniFFI rodando nos três alvos.
3. Em paralelo, adicionar o provedor **Gemini** ao `the-light-core` (mudança
   pequena e independente).
