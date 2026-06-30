# Backlog — Fase 1 (Leitura offline multiplataforma — zero IA, zero rede)

> Rascunhos de tarefa redigidos pelo Planner. Cada bloco vira um arquivo
> `queue/<ID>.task.md` quando elegível (deps aceitas). **Uma de cada vez**
> (ver `PROTOCOL.md`). A Fase 1 entrega o **produto mínimo já útil**: ler a
> Bíblia offline (KJV + Almeida 1911, PT/EN), buscar (FTS5), ver referências
> cruzadas (OpenBible CC-BY) e tomar notas/marcações no dispositivo — nos **três
> alvos** provados na Fase 0 (web/wasm, iOS, Android).

## O que a Fase 0 já entregou (reaproveitar — NÃO refazer)

- **Ponte UniFFI provada nos 3 alvos** (ADR-0007/0008/0009): web/wasm via `ubrn
  build web` + glue `app/web/*.web.ts`; iOS/Android via **Turbo Module nativo**
  compartilhado (`ubrn build ios|android`, autolink `app/react-native.config.js`,
  glue `app/web/reference.ts`). Metro escolhe por extensão (`.web.ts` web / `.ts`
  nativo).
- **Matriz de features por alvo** (ADR-0005): núcleo `the-light-core` consumido
  como **git dep pinada** (`rev 8f66004`), feature única `embedded` (default-on).
  **Nativo:** `embedded` on → `store`/`search`/`xref`/`userdata` (rusqlite).
  **Web/wasm:** `embedded` off → só `model`/`reference` (puros). `get_passage` é
  exportado em todos os alvos; **só o corpo** que toca `store` é
  `#[cfg(not(target_arch = "wasm32"))]` (no wasm é stub) — ADR-0010.
- **Store nativo** (ADR-0010): `get_passage` lê do SQLite via `Store::open` +
  `EmbeddedSource::passage`. `sample.sqlite` (subset KJV) versionado, regerável
  por `scripts/gen-sample-db.sh`.
- **Store web** (ADR-0011/0012): `wa-sqlite@1.0.0` (build sync, sem COOP/COEP) +
  OPFS; o web **espelha o SELECT** de passagem em TS (`app/web/sqlite.web.ts`),
  a referência continua vindo do **Rust (wasm)**. Decisão de direção: **Opção A**
  (espelho de query em TS), com nota explícita: "quando o web precisar de
  **search/xref**, reavaliar a Opção B (store abstraído no core via PR)".

## Decomposição (F1.1 → F1.6 + paridade web + Marco 1)

Padrão Fase 1: cada capacidade nasce no **núcleo (fronteira nativa)** primeiro
(delegando ao `the-light-core`, com **teste Rust de host** determinístico), depois
a **UI nativa** (iOS/Android), e a **paridade web** vem **depois** do gate
estratégico (F1.12) que decide como o web atende busca/xref sobre o banco
completo. Anti-alucinação: **todo** texto de versículo vem do store local.

---

## F1.1 — Pipeline de dados e banco embarcado completo
**Objetivo:** gerar o banco SQLite completo (**KJV** + **Almeida 1911**, PT/EN)
**reaproveitando o importador `xtask` do `the-light`** (rev pinado `8f66004`), de
fontes de **domínio público**, e empacotá-lo como asset; processo reprodutível e
idempotente; decidir/registrar (ADR) a estratégia de armazenamento do asset.
**Aceite:** `assets/data/bible.sqlite` gerado pelo xtask pinado (sem
modificar/forkar `the-light`); contagens validadas (`kjv` **31.102**, `alm1911`
**31.101**); import **idempotente**; ADR registra origem/licença/tamanho e a
decisão **versionar vs gerar-por-script vs Git LFS**; só domínio público.
**Verificação:** `scripts/gen-bible-db.sh` produz o banco; checagem de contagem
por SQL (não hardcode); reexecução estável.
**Depende:** — (primeira da Fase 1).
**Risco / blocked legítimo:** os datasets (KJV ~8,4 MB scrollmapper, ALM1911
~4 MB damarals) **não estão em cache** (`data/seed/` vazio no core) → o xtask
**baixa por rede em build**. Se o ambiente do loop estiver **offline** e não houver
seed local → `blocked` (decisão: origem/seed dos dados, ou re-escopo a um subset
maior verificável). **Já semeada** em `queue/F1.1-pipeline-banco-embarcado.task.md`.

## F1.2 — Expor leitura no core (fronteira UniFFI — nativo)
**Objetivo:** funções UniFFI de leitura **delegando ao `the-light-core`**:
`list_translations()` (→ `BibleSource::translations`), `list_books(translation)`
(tabela `books` / `reference::BOOKS`), `chapter_count(book, translation)`
(`EmbeddedSource::chapter_count`), `get_chapter(book, chapter, translation)`
(passagem do capítulo inteiro via `Reference::whole_chapter` →
`BibleSource::passage`) e a passagem numerada (`get_passage`, já existe — F0.9,
estender para Range/WholeChapter). Records UniFFI espelhando `model`.
**Aceite:** navegação programática completa pela API do core (listar versões,
listar livros, abrir capítulo, passagem numerada) — **sem** reimplementar SQL.
**Verificação:** `cargo test -p the-light-app-core` (host, `embedded` on) sobre o
banco completo (ou um banco de teste com ≥1 capítulo real), conferindo livros,
capítulos e texto verbatim. Build web segue puro (`cargo tree --target wasm32…`
sem `rusqlite`; corpo nativo sob `cfg(not(wasm32))`, surface uniforme).
**Depende:** F1.1.

## F1.3 — UI de leitura nativa: navegação + seletor de versão
**Objetivo:** telas `app/app/(read)/...` + `app/components/Reader*` ligadas à
fronteira **nativa**: navegar **livro → capítulo → texto** e **trocar versão**
(KJV ⇄ Almeida 1911), lendo do store local via Turbo Module.
**Aceite:** ler qualquer capítulo (texto verbatim do store) no **iOS e Android**;
trocar versão recarrega o mesmo capítulo na outra tradução.
**Verificação:** self-test headless por alvo (molde F0.7/F0.8: marcadores em
`adb logcat`/`simctl log` provando texto lido do store) + `tsc --noEmit`/eslint.
**Depende:** F1.2.

## F1.4 — UI de leitura nativa: múltiplas versões lado a lado + tema
**Objetivo:** exibir **duas versões lado a lado** (PT|EN) do mesmo capítulo e
alternar **tema claro/escuro**.
**Aceite:** capítulo em duas colunas alinhadas por versículo; toggle de tema
persiste na sessão; sem regressão da F1.3.
**Verificação:** teste de UI/headless por alvo + `tsc`/eslint.
**Depende:** F1.3.

## F1.5 — Busca FTS5 na fronteira (core — nativo)
**Objetivo:** expor `search(query, translation, book?, limit?) -> Vec<SearchHit>`
delegando a `the_light_core::search::search` (FTS5 BM25, **acento-insensível** via
`verses_fts`). Record `SearchHit` (referência, texto, trecho destacado, score).
**Aceite:** buscar termo PT (ex.: "céus"/"ceus") e EN retorna acertos corretos com
referência; consulta vazia → lista vazia (sem injeção FTS).
**Verificação:** `cargo test -p the-light-app-core` (host) sobre o banco com FTS5.
**Depende:** F1.2.

## F1.6 — UI de busca nativa
**Objetivo:** tela de busca + lista de resultados com **referência clicável** que
abre o capítulo no Reader.
**Aceite:** buscar termo PT/EN retorna acertos clicáveis que navegam à passagem
nos **3 alvos nativos**.
**Verificação:** teste de UI/headless por alvo + `tsc`/eslint.
**Depende:** F1.5, F1.3.

## F1.7 — Referências cruzadas: dados (import-xref)
**Objetivo:** importar as **~344.799** referências cruzadas (OpenBible.info / TSK)
via `xtask import-xref` (CC-BY) para a tabela `cross_references` do
`bible.sqlite`; idempotente.
**Aceite:** `SELECT count(*) FROM cross_references` ≈ 344.799 (guarda de drift);
import re-executável sem duplicar; **string de atribuição CC-BY** registrada para
exibição (`Cross references courtesy of OpenBible.info (CC-BY)`).
**Verificação:** `scripts/gen-bible-db.sh` (ou passo dedicado) popula
`cross_references`; checagem de contagem por SQL.
**Depende:** F1.1. **Risco:** rede em build (mesma natureza da F1.1) → `blocked`
se offline sem cache (decisão: seed dos dados).

## F1.8 — Referências cruzadas na fronteira (core — nativo)
**Objetivo:** expor `cross_refs(book, chapter, verse, min_votes?, limit?) ->
Vec<CrossRef>` (→ `the_light_core::xref::for_verse`) e, opcionalmente,
`passage_labels` para um capítulo.
**Aceite:** xrefs de João 3:16 retornadas, ordenadas por votos; filtro `min_votes`
respeitado.
**Verificação:** `cargo test -p the-light-app-core` (host) sobre `cross_references`.
**Depende:** F1.7, F1.2.

## F1.9 — UI de referências cruzadas nativa + atribuição CC-BY
**Objetivo:** painel "referências relacionadas" por passagem, abrindo cada xref no
Reader; **atribuição CC-BY da OpenBible.info visível** na UI.
**Aceite:** abrir xrefs de uma passagem nos 3 alvos nativos; atribuição exibida
(linkada) onde as xrefs aparecem.
**Verificação:** teste de UI/headless por alvo + `tsc`/eslint.
**Depende:** F1.8, F1.3.

## F1.10 — Notas e marcações na fronteira (core — userdata)
**Objetivo:** expor CRUD de **notas** (`userdata::notes::NoteStore`) e
**marcações/highlights** (`userdata::highlights::HighlightStore`) por referência,
persistidos em **formato exportável**. **Atenção:** o `userdata` do core é
**baseado em arquivos JSON** num diretório de dados (XDG/`directories`), **não no
SQLite** — a fronteira recebe um **diretório de dados** do app (caminho gravável
do dispositivo) em vez de assumir o default XDG.
**Aceite:** criar/editar/remover nota e highlight de uma referência; listar;
recarregar do disco devolve os mesmos dados.
**Verificação:** `cargo test -p the-light-app-core` (host) usando um diretório
temporário; round-trip de persistência.
**Depende:** F1.2. **Nota:** decidir o **caminho de dados** por alvo (iOS/Android
sandbox de documentos; web = sem filesystem → tratado na paridade web F1.16).

## F1.11 — UI de notas/marcações nativa + export
**Objetivo:** UI para criar/editar/remover notas e highlights numa passagem;
**export** dos dados do usuário (arquivo exportável).
**Aceite:** dados **sobrevivem a reinício** do app (iOS/Android); export gera um
arquivo legível/reimportável; highlights aparecem no Reader.
**Verificação:** teste de persistência por alvo (relançar o app mantém os dados) +
`tsc`/eslint.
**Depende:** F1.10, F1.3.

## F1.12 — ⛔ GATE estratégico: paridade WEB da Fase 1 (store web do corpus completo)
**Objetivo (decisão humana/arquitetural):** definir como o **web** atende a Fase 1
sobre o **banco completo** (não mais o `sample.sqlite` de 1 versículo):
leitura/navegação, **busca FTS5**, **xref** e **notas/highlights**. ADR-0011 adiou
exatamente isto ("quando o web precisar de search/xref, reavaliar a Opção B").
**Pontos a decidir (com evidência):**
1. **FTS5 no `wa-sqlite`:** o build empacotado do `wa-sqlite@1.0.0` **inclui
   FTS5**? Se não, qual build/flag (sem exigir COOP/COEP) — ou a busca web usa
   outra estratégia?
2. **Carga do banco completo em OPFS:** `bible.sqlite` completo (texto + FTS5 +
   ~344k xrefs) é **multi-MB** (provável dezenas de MB). Estratégia de
   empacotamento/carga **sob demanda** no web (offline-first, sem rede em runtime)?
3. **Direção:** estender a **Opção A** (espelhar em TS os SELECTs de capítulo /
   `search` / `for_verse` sobre `wa-sqlite`) **vs** adotar a **Opção B** (abstrair
   o store no `the-light-core` via **PR + ADR** — store injetável que rode em
   wasm), para evitar duplicar lógica de busca/xref em TS.
4. **Notas/highlights no web:** sem filesystem → OPFS/IndexedDB; manter o
   **formato exportável** compatível com o nativo.
**Aceite:** ADR novo (ex.: **ADR-0014**) registrando 1–4 com evidência; se a Opção
B for escolhida, abrir spec de PR ao `the-light` (`loop/proposals/`) — **núcleo só
via PR humano**.
**Verificação:** auditoria humana do ADR; gate de sign-off.
**Depende:** F1.2, F1.5, F1.8, F1.10.
**gate: true** — o loop **PARA** aqui (decisão estratégica) antes de construir a
paridade web. Não bloqueia a UI nativa (F1.3–F1.11, IDs menores, completam antes).

## F1.13 — Paridade web: leitura (navegação + versões)
**Objetivo:** navegação livro→capítulo→texto + troca de versão + lado a lado no
**web**, conforme a decisão da F1.12 (Opção A: espelhar SELECTs sobre o banco
completo em `wa-sqlite`/OPFS; ou Opção B: store do core no wasm).
**Aceite:** ler/navegar capítulos e trocar versão no **browser**, texto do store
local; `expo export --platform web` sai 0 com o banco empacotado/carregado.
**Verificação:** prova headless node (molde F0.10) + export web.
**Depende:** F1.12, F1.4.

## F1.14 — Paridade web: busca FTS5
**Objetivo:** busca no web conforme F1.12 (FTS5 no `wa-sqlite` ou Opção B).
**Aceite:** buscar PT/EN no browser retorna acertos com referência clicável.
**Verificação:** prova headless node + export web.
**Depende:** F1.12, F1.6.

## F1.15 — Paridade web: referências cruzadas + atribuição
**Objetivo:** xrefs no web + atribuição CC-BY visível.
**Aceite:** abrir xrefs de uma passagem no browser; atribuição exibida.
**Verificação:** prova headless node + export web.
**Depende:** F1.12, F1.9.

## F1.16 — Paridade web: notas/marcações + export
**Objetivo:** notas/highlights no web (OPFS/IndexedDB), **formato exportável**
compatível com o nativo (F1.10/F1.11).
**Aceite:** dados sobrevivem a reload no browser; export idêntico ao nativo.
**Verificação:** prova headless/manual web documentada + export web.
**Depende:** F1.12, F1.11.

## F1.17 — ⛔ Marco 1: leitura offline completa, multiplataforma
**Objetivo:** confirmar o **app de leitura offline completo** nos 3 alvos
(navegação + versões PT/EN + tema + busca FTS5 + xref CC-BY + notas/marcações),
**zero rede em runtime**; atualizar `PROGRESS.md`; consolidar ADRs.
**Aceite:** checklist do Marco 1 verde nos 3 alvos; nenhuma chamada de rede no
runtime; atribuições (OpenBible CC-BY) visíveis; `the-light` intacto (consumo
pinado / PRs registrados).
**Verificação:** revisão do Guia; `PROGRESS.md` atualizado.
**Depende:** F1.4, F1.6, F1.9, F1.11, F1.13, F1.14, F1.15, F1.16.
**gate: true** — marco; HALT para sign-off humano/auditoria.

---

> **Regras rígidas da Fase 1 (do `IMPLEMENTATION_PLAN.md` §0):** offline-first
> (zero rede em runtime; rede só em dev/build); só **domínio público** embarcado
> (KJV/Almeida 1911); **anti-alucinação** (texto sempre do store local);
> atribuições (OpenBible **CC-BY** visível; STEPBible quando aplicável); **não
> modificar/forkar `the-light`** (consumo pinado; mudança só via **PR + ADR**).
> Diante de conflito com qualquer regra: **HALT**, não improviso.
