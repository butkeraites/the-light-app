//! `the-light-app-core` — fronteira UniFFI do app.
//!
//! Esta crate é a **ponte** entre as UIs (Expo/nativo) e o núcleo canônico
//! `the-light-core`, consumido como **git dep pinada por commit** (ADR-0002). A
//! regra "uma fonte da verdade" vale: nenhuma lógica de domínio (parsing,
//! cânon, etc.) é reimplementada aqui — a fronteira apenas **adapta tipos e
//! erros** do core para tipos serializáveis via UniFFI.
//!
//! Caminho UniFFI: modo *library* (proc-macros + [`uniffi::setup_scaffolding`]),
//! sem UDL e sem `build.rs` (ver ADR-0003 em `DECISIONS.md`).
//!
//! F0.3 expõe [`parse_reference`], que **delega** a
//! `the_light_core::reference::parse_reference` e mapeia o erro do core para
//! [`CoreError`].
//!
//! F0.9 expõe [`get_passage`], que **lê** uma passagem do store SQLite local
//! **delegando** ao `the_light_core::store::Store` + `source::EmbeddedSource::passage`
//! (anti-alucinação: o texto vem **sempre do store**; a fronteira só adapta os
//! tipos/erros do core para Records UniFFI). A função é exportada em **todos** os
//! alvos (a forma da fronteira é uniforme), mas só o **corpo que toca
//! store/`rusqlite`** é `cfg(not(target_arch = "wasm32"))`: no web ela retorna um
//! stub de erro (store web = `wa-sqlite`+OPFS é F0.10), mantendo `rusqlite` fora
//! do grafo wasm (matriz de features, ADR-0005; gating de corpo, ADR-0010).
//!
//! F1.2 expõe a **leitura/navegação**: [`list_translations`], [`list_books`],
//! [`get_chapter`] e [`chapter_count`], que **delegam** ao `the-light-core`
//! (`BibleSource::translations`, `reference::BOOKS`/`chapters_in_book`,
//! `BibleSource::passage` via `Reference::whole_chapter`,
//! `EmbeddedSource::chapter_count`) e adaptam os tipos do core para os Records
//! [`Translation`], [`Book`], [`Passage`] e o Enum [`Testament`]. Mesmo gating de
//! corpo da F0.9 para as três funções DB-backed; [`list_books`] é **puro** (só a
//! tabela canônica `reference::BOOKS`, disponível em todos os alvos, inclusive
//! wasm).
//!
//! F1.5 expõe a **busca full-text (FTS5)**: [`search`], que **delega** a
//! `the_light_core::source::BibleSource::search` (via `EmbeddedSource`, montando
//! `the_light_core::search::SearchOptions` a partir de `translation`/`book`/`limit`)
//! e adapta cada `model::SearchHit` para o Record [`SearchHit`]. Nenhum SQL/FTS é
//! reimplementado aqui (sem `verses_fts MATCH`/`bm25`/`highlight`): a busca, o
//! índice acento-insensível (`remove_diacritics 2`) e o ranking BM25 vivem no core.
//! Mesmo gating de corpo da F0.9/F1.2 (corpo DB `cfg(not(wasm32))` + stub web), e
//! anti-alucinação: todo texto de hit vem **do store local**.
//!
//! F1.8 expõe as **referências cruzadas (xref)**: [`cross_refs`], que **delega** à
//! função livre `the_light_core::xref::for_verse(store.conn(), …)` (via
//! `Store::open`) e adapta cada `xref::CrossRef` para o Record [`CrossRef`]. Nenhum
//! SQL/ranking de xref é reimplementado aqui (sem `SELECT … FROM cross_references`,
//! sem `ORDER BY votes`): a query, a ordenação por votos (DESC) e o filtro
//! `votes >= min_votes` vivem no core (`xref.rs`). **Divergência de gating vs. F1.5:**
//! o tipo-fonte `xref::CrossRef` está no módulo `xref`, que é `embedded`-only — logo o
//! `From<xref::CrossRef>` é gated `cfg(not(wasm32))` (o Record em si só referencia
//! tipos puros, `Reference`/`i64`, e existe em todos os alvos). Mesmo gating de corpo
//! da F0.9/F1.2/F1.5 (corpo DB `cfg(not(wasm32))` + stub web). A xref é só
//! **referência** (sem texto bíblico); os dados são **CC-BY** (OpenBible.info,
//! ADR-0016) e a **string de atribuição visível** é responsabilidade da UI da F1.9 —
//! a fronteira apenas **entrega os dados**.
//!
//! F1.10 expõe o **CRUD de notas e marcações por referência** (dados do usuário,
//! file-based): [`put_note`]/[`get_note`]/[`delete_note`]/[`list_notes`] e
//! [`add_highlight`]/[`remove_highlight`]/[`list_highlights`], que **delegam** à
//! camada `the_light_core::userdata` (`notes::NoteStore` + `highlights::HighlightStore`)
//! — **nenhum** I/O de arquivo, slug de referência, ordenação ou serialização JSON é
//! reimplementado aqui (vive no core). As funções recebem um **`data_dir` gravável do
//! app** (quem o fornece é a F1.11) e derivam os subcaminhos do **MESMO layout default
//! do core** (`notes/` + `highlights.json`), para o formato em disco ser **idêntico**
//! ao de `open_default`/`load_default` (essencial p/ o EXPORT da F1.11 e a paridade web
//! F1.16). A fronteira **nunca** chama `data_dir()`/`open_default`/`load_default`
//! (dependentes de XDG/`directories`) → o erro `UserDataError::NoDataDir` **não ocorre**.
//! A referência chega como `String` e é **canonicalizada pelo core**
//! (`reference::parse_reference`, como [`get_passage`]) → PT e EN caem na MESMA
//! nota/arquivo, evitando um `From<Reference>` reverso. **Separação de dados:** estas
//! funções **não recebem `db_path`** e **nunca** tocam o `bible.sqlite` (conteúdo
//! público só-leitura) — gravam apenas em `data_dir`. **Anti-alucinação não se aplica
//! ao corpo da nota/highlight** (dado do usuário), só à referência (canônica).
//! **Gating (como o `xref::CrossRef` da F1.8):** os tipos-fonte
//! `userdata::notes::Note`/`userdata::highlights::Highlight` vivem em módulo
//! `embedded`-only → os Records [`Note`]/[`Highlight`] são puros (todos os alvos), mas
//! os `From` e o corpo das funções são `cfg(not(wasm32))` + stub web (paridade web =
//! F1.16). A **UI/persistência no device/export é a F1.11** (fora de escopo aqui).
//!
//! F2.1 abre a **Fase 2 (IA BYOK)** expondo a **pergunta ancorada**:
//! [`ask_anchored`], que **delega** à camada de IA do core
//! (`the_light_core::ai::{build_provider, numbered_passage, ask_context, ask}`) e
//! prova a espinha ponta a ponta com o **provedor MOCK** do core (via
//! `build_provider("mock", None, None)`) — **sem chave** (`key = None`) e **sem
//! rede** (o `MockLlmProvider` devolve uma resposta fixa). O texto do versículo é
//! lido do **store local** pela **mesma** rota da F1.2 (`EmbeddedSource::passage`),
//! numerado por `ai::numbered_passage` — a fronteira **nunca** deixa o LLM
//! gerar/editar texto bíblico. O Record de retorno [`AiAnswer`] **separa** o
//! `cited_text` (verbatim do store) da `interpretation` (do modelo) — a
//! anti-alucinação materializada no contrato (SPEC §6.2). **Gating (como
//! [`get_passage`]):** a função é exportada em **todos** os alvos, mas o corpo que
//! toca `ai`/store é `cfg(not(target_arch = "wasm32"))` + **stub web** — o módulo
//! `ai` do core é `#[cfg(feature = "embedded")]` (só nativo, ADR-0005), então o
//! grafo wasm permanece **puro** (sem `reqwest`/`rusqlite`; paridade web de IA =
//! F2.7). O Record [`AiAnswer`] só referencia tipos **puros** ([`Reference`]/
//! `String`) e é montado **na mão** (não há um único tipo-fonte do core a
//! converter — `ai::ask` devolve só a `String` da interpretação), logo **não** há
//! `From<ai::…>` a gatear. A chave real (BYOK), o armazenamento seguro e a UI vêm
//! depois (F2.3–F2.6), após o **gate estratégico F2.2**.
//!
//! F2.7b expõe a **fronteira web de IA** (paridade web do `ask` ancorado, ADR-0025):
//! [`ai_web_prepare`] e [`ai_web_finalize`] (+ os Records [`AiVerseInput`]/
//! [`AiWebRequest`]). Diferente de [`ask_anchored`] (corpo nativo `cfg`-gated), estas
//! funções usam **só a superfície `pub` do `ai` sob `ai-pure`** (`numbered_verses`/
//! `ask_context`/`ask`/`default_model`/`citation::rewrite_anchors`) → **corpo
//! `cfg`-free** (compila igual no wasm e no nativo), pois **não** tocam
//! store/`rusqlite`/`reqwest` (o grafo wasm segue **puro**). `ai_web_prepare` recebe os
//! versículos **verbatim do store web** (o texto vem do subset F1.13; a fronteira não
//! lê DB no wasm), numera o `cited_text` e **captura o `system`/`user` EXATOS** que o
//! nativo enviaria (via um `CaptureProvider` local dirigido por `ai::ask`, porque
//! `ask_user_prompt` é privado no core) — **zero drift** de prompt/citação nativo↔web.
//! O **transporte** (`fetch` ao provedor + montagem/parse do corpo) fica no TS/browser
//! (os `*_body`/`*_extract` do core são privados; ver ADR-0025), com a chave. A
//! `interpretation` volta de `ai_web_finalize` **após** `rewrite_anchors`
//! (anti-alucinação em Rust), separada do `cited_text` do store. `ask_anchored[_stream]`
//! **nativos intactos** (sem regressão).
//!
//! F3.3 expõe o **estudo profundo** (modo × lente × profundidade): [`deep_study`],
//! que **delega** a `the_light_core::ai::study::study(&provider, &StudyRequest)` (rev
//! pinado `c8ecb2f`). A fronteira **monta** o `StudyRequest` com **fatos do store
//! local** — a [`Passage`] verbatim (mesma rota da F1.2, `EmbeddedSource::passage`), o
//! **léxico verificado** (rota da F3.2, `ai::lexicon::verified_lexicon`) e os **rótulos
//! de xref** (`xref::passage_labels`) — e o `study` do core separa o `passage_text`
//! (numerado, do **banco**, verbatim) da `interpretation` (do **modelo**). Prova
//! determinística por **MOCK** (`build_provider("mock", None, None)`) — **sem chave** e
//! **sem rede** (o `MockLlmProvider` devolve resposta fixa). **Nenhum** prompt/RAG/SQL/
//! aparato de citação é reimplementado aqui — tudo vive no `ai::study` do core (regra
//! "uma fonte da verdade"). O Record [`StudyResultOut`] **separa** `passage_text` de
//! `interpretation` (anti-alucinação materializada no contrato, SPEC §6.2); `citations`
//! e léxico vêm de **fontes locais verificadas** (nunca do modelo) e os `warnings`
//! sinalizam Strong/`[W:n]` inventados. **Gating (como [`ask_anchored`]):** exportada em
//! **todos** os alvos, mas o corpo que toca `ai::study`/store é
//! `cfg(not(target_arch = "wasm32"))` + **stub web** — os tipos-fonte `StudyRequest`/
//! `StudyResult`/`study` são `embedded`-only, então o `From<StudyResult>` é gateado (como
//! `From<xref::CrossRef>`), enquanto os enums ([`StudyMode`]/[`StudyLens`]/[`StudyDepth`])
//! e os Records puros ([`StudySection`]/[`StudyCitation`]) são `ai-pure` → `From` cfg-free
//! (como [`LexEntry`] da F3.2); o grafo wasm segue **puro** (sem `reqwest`/`rusqlite`). A
//! chave real/rede é a F2.10/F3.10, a pesquisa web é a F3.9 (→ `web_sources: vec![]`), a
//! UI é a F3.5 e a paridade web é a F3.12.

uniffi::setup_scaffolding!();

/// Erro padrão da fronteira UniFFI.
///
/// Não carrega lógica de produto: existe apenas para **fixar o formato** de erro
/// (`Result<_, CoreError>`) que as funções da F0.3+ reutilizarão. Deriva
/// `thiserror::Error` (para `Display`/`std::error::Error`) e `uniffi::Error`
/// (para atravessar a fronteira).
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    /// Erro genérico da fronteira. Placeholder até a F0.3 introduzir lógica real.
    #[error("core error: {message}")]
    Generic {
        /// Mensagem legível propagada através da fronteira UniFFI.
        message: String,
    },
}

/// Função trivial exportada via UniFFI.
///
/// Retorna um valor **constante** — sem I/O, sem rede, sem lógica.
#[uniffi::export]
pub fn ping() -> String {
    "pong".to_string()
}

/// Variante checada que exercita o padrão de erro [`CoreError`].
///
/// Sem lógica de produto: apenas ecoa o sinalizador `ok`. Serve para que a
/// variante de erro seja de fato **construída** (evita `dead_code` sob
/// `clippy -- -D warnings`) e para fixar o contrato `Result<_, CoreError>` que
/// as funções seguintes vão reutilizar.
#[uniffi::export]
pub fn ping_checked(ok: bool) -> Result<String, CoreError> {
    if ok {
        Ok(ping())
    } else {
        Err(CoreError::Generic {
            message: "ping not ok".to_string(),
        })
    }
}

/// Intervalo de versículos de uma referência, na fronteira UniFFI.
///
/// Espelha fielmente `the_light_core::model::VerseRange` (a única fonte da
/// verdade). É um tipo **desacoplado** do core para manter a API da fronteira
/// estável mesmo que o core evolua; a conversão vive em [`From`] abaixo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum VerseRange {
    /// Um único versículo (ex.: `João 3.16`).
    Single {
        /// Número do versículo.
        verse: u16,
    },
    /// Intervalo inclusivo (ex.: `Gênesis 1.1-3`); invariante `start <= end`.
    Range {
        /// Primeiro versículo (inclusive).
        start: u16,
        /// Último versículo (inclusive).
        end: u16,
    },
    /// O capítulo inteiro (ex.: `Salmos 23`).
    WholeChapter,
}

impl From<the_light_core::model::VerseRange> for VerseRange {
    fn from(v: the_light_core::model::VerseRange) -> Self {
        use the_light_core::model::VerseRange as Core;
        match v {
            Core::Single(verse) => VerseRange::Single { verse },
            Core::Range { start, end } => VerseRange::Range { start, end },
            Core::WholeChapter => VerseRange::WholeChapter,
        }
    }
}

/// Referência bíblica resolvida, serializável via UniFFI.
///
/// Espelha `the_light_core::model::Reference`: número canônico do livro
/// (`1..=66`), capítulo e o intervalo de versículos. Construída **somente** a
/// partir do core via [`From`] — a fronteira nunca produz referências por
/// lógica própria.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct Reference {
    /// Número canônico do livro, `1..=66` (cânon protestante de 66 livros).
    pub book: u8,
    /// Capítulo, `>= 1`.
    pub chapter: u16,
    /// Versículos abrangidos pela referência.
    pub verses: VerseRange,
}

impl From<the_light_core::model::Reference> for Reference {
    fn from(r: the_light_core::model::Reference) -> Self {
        Reference {
            book: r.book,
            chapter: r.chapter,
            verses: r.verses.into(),
        }
    }
}

/// Analisa uma referência bíblica (PT ou EN) **delegando** ao `the-light-core`.
///
/// O parsing, a tabela canônica e a resolução de ambiguidades vivem no core
/// (`the_light_core::reference::parse_reference`) — esta função apenas adapta o
/// tipo de retorno para o [`Reference`] da fronteira e mapeia o erro do core
/// (`ReferenceError`) para [`CoreError`]. Nenhuma lógica de parsing é
/// reimplementada aqui (regra "uma fonte da verdade").
///
/// Sem rede e sem I/O: a operação é pura sobre a `String` de entrada.
#[uniffi::export]
pub fn parse_reference(input: String) -> Result<Reference, CoreError> {
    the_light_core::reference::parse_reference(&input)
        .map(Reference::from)
        .map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })
}

/// Um versículo resolvido com seu texto, na fronteira UniFFI.
///
/// Espelha `the_light_core::model::Verse` (tipo **puro** do core, disponível em
/// todos os alvos). O `text` vem **verbatim do store local** — a fronteira nunca
/// gera texto bíblico (anti-alucinação). O Record é definido em **todos** os
/// alvos para manter a forma da fronteira UniFFI idêntica entre nativo e web (a
/// extração de metadata do `ubrn` ocorre no host; ver nota em [`get_passage`]).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Verse {
    /// Livro/capítulo/versículo deste texto (`verses` é sempre `Single`).
    pub reference: Reference,
    /// Texto do versículo, **verbatim** da tradução no store local.
    pub text: String,
    /// Slug da tradução de origem (ex.: `"kjv"`).
    pub translation: String,
}

impl From<the_light_core::model::Verse> for Verse {
    fn from(v: the_light_core::model::Verse) -> Self {
        Verse {
            reference: v.reference.into(),
            text: v.text,
            translation: v.translation.to_string(),
        }
    }
}

/// Uma passagem resolvida (a referência pedida + os versículos), na fronteira
/// UniFFI.
///
/// Espelha `the_light_core::model::Passage`. Pode vir **vazia** (`verses` sem
/// itens) se a referência for válida mas não houver texto no store (ex.: capítulo
/// fora do alcance do livro) — comportamento herdado do core, não um erro.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Passage {
    /// Referência originalmente solicitada.
    pub reference: Reference,
    /// Versículos resolvidos, em ordem canônica.
    pub verses: Vec<Verse>,
}

impl From<the_light_core::model::Passage> for Passage {
    fn from(p: the_light_core::model::Passage) -> Self {
        Passage {
            reference: p.reference.into(),
            verses: p.verses.into_iter().map(Verse::from).collect(),
        }
    }
}

/// Um resultado de busca full-text (FTS5), na fronteira UniFFI.
///
/// Espelha `the_light_core::model::SearchHit` (tipo **puro** do core, presente em
/// todos os alvos). O `text` vem **verbatim do store local** — a fronteira nunca
/// gera texto bíblico (anti-alucinação): a busca apenas **localiza** ocorrências no
/// índice FTS5 do core. O Record é definido em **todos** os alvos para manter a
/// forma da fronteira UniFFI idêntica entre nativo e web (a extração de metadata do
/// `ubrn` ocorre no host; ver nota em [`get_passage`]). Construído **somente** via
/// [`From`]. Não deriva `Eq`/`Copy`: carrega o `score: f64` (BM25) do core.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SearchHit {
    /// Versículo onde o termo foi encontrado (`verses` é sempre `Single`).
    pub reference: Reference,
    /// Slug da tradução de origem (ex.: `"kjv"`).
    pub translation: String,
    /// Texto do versículo, **verbatim** da tradução no store local (sem marcação).
    pub text: String,
    /// Texto com os termos casados envolvidos pelos marcadores do core
    /// (`the_light_core::search::HL_START`/`HL_END`); a UI da F1.6 decide a
    /// renderização (fora de escopo aqui).
    pub highlighted: String,
    /// Pontuação BM25 do core (menor = correspondência mais relevante).
    pub score: f64,
}

impl From<the_light_core::model::SearchHit> for SearchHit {
    fn from(h: the_light_core::model::SearchHit) -> Self {
        SearchHit {
            reference: h.reference.into(),
            translation: h.translation.to_string(),
            text: h.text,
            highlighted: h.highlighted,
            score: h.score,
        }
    }
}

/// Uma **referência cruzada** (xref) de destino, na fronteira UniFFI.
///
/// Espelha `the_light_core::xref::CrossRef`: a [`reference`](Self::reference) de
/// destino (book/chapter/verse, podendo ser um intervalo via [`VerseRange::Range`])
/// e o número de [`votes`](Self::votes) da comunidade. A xref é só **referência** —
/// **nenhum texto bíblico** é gerado nem necessário aqui (anti-alucinação); os dados
/// vêm do store local (importador canônico, F1.7).
///
/// **Gating (divergência vs. `SearchHit`/`Verse`):** o tipo-fonte
/// `the_light_core::xref::CrossRef` vive no módulo `xref`, que é
/// `#[cfg(feature = "embedded")]` (**só no nativo**). Por isso o Record é definido em
/// **todos** os alvos (só referencia tipos **puros**, [`Reference`]/`i64`), mas o
/// [`From`] a partir do tipo-fonte do core é `#[cfg(not(target_arch = "wasm32"))]`
/// (senão o build web quebra — o tipo-fonte não existe no wasm) e o módulo `xref`
/// **não** entra no grafo wasm.
///
/// **`votes`:** votos da comunidade OpenBible.info (maior = mais relevante);
/// **negativos = referências disputadas**, ocultas por padrão (ver
/// [`cross_refs`] e `DEFAULT_MIN_VOTES = 1`).
///
/// **Licenciamento (ADR-0016):** os dados de xref são **CC-BY** (OpenBible.info). A
/// fronteira apenas **entrega os dados** (referência + votos) — a tabela
/// `cross_references` não tem coluna de licença/atribuição. A **string de atribuição**
/// `Cross references courtesy of OpenBible.info (CC-BY)` é exibida pela **UI da
/// F1.9**; a obrigação CC-BY do produto **não** desaparece, só muda de camada.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct CrossRef {
    /// Versículo (ou intervalo) de destino relacionado.
    pub reference: Reference,
    /// Votos da comunidade OpenBible (maior = mais relevante; negativos = disputados).
    pub votes: i64,
}

// O tipo-fonte `xref::CrossRef` é `embedded`-only (módulo `xref` do core); este
// `From` precisa ficar fora do grafo wasm. O Record acima é puro e vale p/ todos os
// alvos; aqui mapeamos só no nativo (`reference` via o `From` de `model::Reference`).
#[cfg(not(target_arch = "wasm32"))]
impl From<the_light_core::xref::CrossRef> for CrossRef {
    fn from(c: the_light_core::xref::CrossRef) -> Self {
        CrossRef {
            reference: c.reference.into(),
            votes: c.votes,
        }
    }
}

/// Lê uma passagem do **store SQLite local**, delegando ao `the-light-core`.
///
/// Pipeline no **nativo** (tudo no core — uma fonte da verdade):
/// `parse_reference(&reference)` → `Store::open(db_path)` (abre/migra o schema
/// via migrações do core) → `EmbeddedSource::new(&store).passage(&ref,
/// &TranslationId)` → adapta a `Passage` do core para o Record [`Passage`] e
/// mapeia os erros para [`CoreError`]. **Nenhum** SQL ou parsing é reimplementado
/// aqui.
///
/// Anti-alucinação: o `text` de cada versículo vem **sempre do store** (texto
/// verbatim da tradução). Offline-first: nenhuma rede — apenas I/O local no
/// arquivo `db_path`.
///
/// **Gating por alvo (crítico, ver ADR-0010):** a função é exportada via UniFFI
/// em **todos** os alvos para manter a forma da fronteira consistente — o `ubrn`
/// extrai a metadata UniFFI no **host** (onde a função existe) e gera o wrapper
/// wasm referenciando o símbolo; gatear a *exportação* inteira por
/// `cfg(not(wasm32))` quebraria o link do build web (símbolo ausente). Por isso
/// apenas o **corpo que toca store/rusqlite** é `cfg(not(target_arch = "wasm32"))`:
/// no nativo, implementação real; no **web**, um stub que retorna [`CoreError`]
/// (store web = `wa-sqlite`+OPFS é F0.10), sem arrastar `rusqlite` para o grafo
/// wasm.
#[uniffi::export]
pub fn get_passage(
    db_path: String,
    reference: String,
    translation: String,
) -> Result<Passage, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para poder chamar `.passage(...)` em `EmbeddedSource`.
        use the_light_core::source::BibleSource;

        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation = the_light_core::model::TranslationId::new(translation);
        let passage = source
            .passage(&reference, &translation)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        Ok(Passage::from(passage))
    }
    #[cfg(target_arch = "wasm32")]
    {
        // Stub web: o store local (`rusqlite`) é nativo-only (ADR-0005). O store
        // web (`wa-sqlite`+OPFS) chega na F0.10; até lá, falha explícita — sem
        // tocar `store`/`source`/`rusqlite` (mantém o grafo wasm puro).
        let _ = (db_path, reference, translation);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Testamento a que um livro pertence, na fronteira UniFFI.
///
/// Espelha `the_light_core::model::Testament` (tipo **puro**, presente em todos
/// os alvos). Construído **somente** via [`From`] a partir do core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Testament {
    /// Antigo Testamento.
    Old,
    /// Novo Testamento.
    New,
}

impl From<the_light_core::model::Testament> for Testament {
    fn from(t: the_light_core::model::Testament) -> Self {
        use the_light_core::model::Testament as Core;
        match t {
            Core::Old => Testament::Old,
            Core::New => Testament::New,
        }
    }
}

/// Metadados de uma tradução disponível no store, na fronteira UniFFI.
///
/// Espelha `the_light_core::model::Translation`. Os campos `language`/`license`
/// (enums do core) são serializados para `String` pela própria representação
/// canônica do core (`Lang::code()` → `"pt"`/`"en"`; `License::as_str()` →
/// ex.: `"public-domain"`), nunca por lógica nova da fronteira. Construído
/// **somente** via [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Translation {
    /// Slug estável da tradução (ex.: `"kjv"`).
    pub id: String,
    /// Abreviação de exibição (ex.: `"KJV"`).
    pub abbrev: String,
    /// Nome completo (ex.: `"King James Version"`).
    pub name: String,
    /// Código ISO 639-1 do idioma (`"pt"`/`"en"`), via `Lang::code()`.
    pub language: String,
    /// Licença canônica (ex.: `"public-domain"`), via `License::as_str()`.
    pub license: String,
    /// `true` se o texto está embarcado e pode ser redistribuído.
    pub embeddable: bool,
}

impl From<the_light_core::model::Translation> for Translation {
    fn from(t: the_light_core::model::Translation) -> Self {
        Translation {
            id: t.id.to_string(),
            abbrev: t.abbrev,
            name: t.name,
            language: t.language.code().to_string(),
            license: t.license.as_str().to_string(),
            embeddable: t.embeddable,
        }
    }
}

/// Um livro do cânon (66 livros), na fronteira UniFFI.
///
/// Espelha `the_light_core::reference::BookInfo` (tabela canônica **pura**
/// `reference::BOOKS`, presente em todos os alvos). `chapter_count` é o número
/// **canônico** de capítulos do livro (`reference::chapters_in_book`,
/// independente de versão; João = 21), não o que existe num banco específico —
/// para isso há [`chapter_count`] (DB-backed). Construído **somente** via
/// [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Book {
    /// Número canônico do livro, `1..=66`.
    pub number: u8,
    /// Nome em inglês (ex.: `"John"`).
    pub name_en: String,
    /// Nome em português (ex.: `"João"`).
    pub name_pt: String,
    /// Abreviação canônica em inglês (ex.: `"John"`).
    pub abbrev_en: String,
    /// Abreviação canônica em português (padrão Almeida, ex.: `"Jo"`).
    pub abbrev_pt: String,
    /// Testamento do livro.
    pub testament: Testament,
    /// Número **canônico** de capítulos (independente da versão).
    pub chapter_count: u16,
}

impl From<&the_light_core::reference::BookInfo> for Book {
    fn from(info: &the_light_core::reference::BookInfo) -> Self {
        Book {
            number: info.number,
            name_en: info.name_en.to_string(),
            name_pt: info.name_pt.to_string(),
            abbrev_en: info.abbrev_en.to_string(),
            abbrev_pt: info.abbrev_pt.to_string(),
            testament: info.testament.into(),
            chapter_count: the_light_core::reference::chapters_in_book(info.number),
        }
    }
}

/// Lista as traduções presentes no **store SQLite local**, delegando ao core.
///
/// Pipeline no **nativo**: `Store::open(db_path)` → `EmbeddedSource::new(&store)`
/// → `BibleSource::translations()` (lê a tabela `translations`) → adapta cada
/// `model::Translation` para o Record [`Translation`]. **Nenhum** SQL é
/// reimplementado aqui. Offline-first: apenas I/O local em `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** exportada em todos os alvos, mas o corpo
/// que toca store/`rusqlite` é `cfg(not(target_arch = "wasm32"))`; no **web**,
/// stub que retorna [`CoreError`] (store web = F0.10), sem arrastar `rusqlite`
/// para o grafo wasm.
#[uniffi::export]
pub fn list_translations(db_path: String) -> Result<Vec<Translation>, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para chamar `.translations()` em `EmbeddedSource`.
        use the_light_core::source::BibleSource;

        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translations = source.translations().map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })?;
        Ok(translations.into_iter().map(Translation::from).collect())
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = db_path;
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Lista os **66 livros canônicos** (cânon protestante), delegando à tabela
/// **pura** `the_light_core::reference::BOOKS` (+ `chapters_in_book`).
///
/// **Função pura, sem `db_path`/`translation` e sem gating:** não toca o
/// store/`rusqlite`, então roda igual no nativo e no **web** (a tabela canônica
/// é `cfg`-livre no core).
///
/// **Divergência registrada (vs. `list_books(translation)`):** o core **não**
/// expõe método para listar a tabela `books` por tradução **sem reimplementar
/// SQL** (`EmbeddedSource`/`BibleSource` não têm `books()`). O cânon de 66 é
/// version-independent (igual p/ KJV e Almeida); só o **nome de exibição** muda
/// por idioma, já disponível via `name_en`/`name_pt` + a `language` da
/// [`Translation`]. Filtrar por tradução exigiria reimplementar SQL (proibido)
/// ou mudar o core (PR+ADR, fora de escopo) → mantém-se a lista canônica.
#[uniffi::export]
pub fn list_books() -> Vec<Book> {
    the_light_core::reference::BOOKS
        .iter()
        .map(Book::from)
        .collect()
}

/// Lê um **capítulo inteiro** numerado por versículo do store local, delegando
/// ao core.
///
/// Pipeline no **nativo**: `Reference::whole_chapter(book, chapter)` →
/// `Store::open(db_path)` → `EmbeddedSource::new(&store).passage(&ref, &id)` →
/// adapta para o Record [`Passage`] (versículos em ordem canônica). **Nenhum**
/// SQL/parsing é reimplementado. Anti-alucinação: o `text` vem **sempre do
/// store** (verbatim). Pode retornar `Passage` **vazia** (capítulo ausente),
/// herdado do core — não é erro.
///
/// **Gating por alvo (ver ADR-0010):** mesmo molde de [`get_passage`] — corpo DB
/// `cfg(not(target_arch = "wasm32"))`; stub web retornando [`CoreError`].
#[uniffi::export]
pub fn get_chapter(
    db_path: String,
    translation: String,
    book: u8,
    chapter: u16,
) -> Result<Passage, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para chamar `.passage(...)` em `EmbeddedSource`.
        use the_light_core::source::BibleSource;

        let reference = the_light_core::model::Reference::whole_chapter(book, chapter);
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation = the_light_core::model::TranslationId::new(translation);
        let passage = source
            .passage(&reference, &translation)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        Ok(Passage::from(passage))
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (db_path, translation, book, chapter);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Conta os capítulos de um livro **presentes no store** (DB-backed), delegando
/// ao core.
///
/// Pipeline no **nativo**: `Store::open(db_path)` →
/// `EmbeddedSource::chapter_count(book, &id)` (`SELECT max(chapter) …`; `0` se o
/// livro/tradução não tiver versículos no banco). **Nenhum** SQL é reimplementado
/// aqui. Difere de [`Book::chapter_count`], que é o total **canônico**: este
/// reflete o conteúdo **real** do `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo DB `cfg(not(target_arch = "wasm32"))`;
/// stub web retornando [`CoreError`].
#[uniffi::export]
pub fn chapter_count(db_path: String, translation: String, book: u8) -> Result<u16, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation = the_light_core::model::TranslationId::new(translation);
        source
            .chapter_count(book, &translation)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (db_path, translation, book);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Busca full-text (FTS5) no **store SQLite local**, delegando ao `the-light-core`.
///
/// Pipeline no **nativo** (tudo no core — uma fonte da verdade):
/// `Store::open(db_path)` → `EmbeddedSource::new(&store)` → monta
/// `search::SearchOptions::new(TranslationId)` aplicando `book`/`limit` quando
/// informados → `BibleSource::search(&query, &opts)` → adapta cada
/// `model::SearchHit` para o Record [`SearchHit`] e mapeia o erro para
/// [`CoreError`]. **Nenhum** SQL/FTS é reimplementado aqui (sem `verses_fts MATCH`,
/// `bm25(...)` nem `highlight(...)`): o índice, o ranking BM25 e o destaque vivem
/// no core.
///
/// A busca é **acento-insensível em PT** (índice do core com `remove_diacritics 2`:
/// `ceus` casa `céus`) e combina múltiplas palavras com AND — comportamento
/// herdado do core. Uma `query` sem termo utilizável (vazia/só espaços) retorna
/// `Vec` **vazio** (não é erro, não panica). `limit` `None` usa o padrão do core
/// (`DEFAULT_LIMIT` = 20); `book` `None` não filtra por livro. Tradução inexistente
/// no store → [`CoreError`] (via `SourceError::UnknownTranslation` do core).
///
/// Anti-alucinação: o `text` de cada hit vem **sempre do store** (verbatim).
/// Offline-first: nenhuma rede — apenas I/O local no `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** mesmo molde de [`get_passage`] — corpo DB
/// `cfg(not(target_arch = "wasm32"))`; stub web retornando [`CoreError`] (store web
/// = F0.10), sem arrastar `search`/`source`/`store`/`rusqlite` para o grafo wasm.
#[uniffi::export]
pub fn search(
    db_path: String,
    query: String,
    translation: String,
    book: Option<u8>,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para chamar `.search(...)` em `EmbeddedSource`.
        use the_light_core::source::BibleSource;

        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation = the_light_core::model::TranslationId::new(translation);
        let mut opts = the_light_core::search::SearchOptions::new(translation);
        opts.book = book;
        if let Some(limit) = limit {
            opts.limit = limit as usize;
        }
        let hits = source
            .search(&query, &opts)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        Ok(hits.into_iter().map(SearchHit::from).collect())
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (db_path, query, translation, book, limit);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Lista as **referências cruzadas** (xref) de um versículo do **store SQLite
/// local**, delegando ao `the-light-core`.
///
/// Pipeline no **nativo** (tudo no core — uma fonte da verdade):
/// `Store::open(db_path)` → `the_light_core::xref::for_verse(store.conn(), book,
/// chapter, verse, min_votes, limit)` → adapta cada `xref::CrossRef` para o Record
/// [`CrossRef`] e mapeia o erro para [`CoreError`]. **Nenhum** SQL/ranking de xref é
/// reimplementado aqui (sem `SELECT … FROM cross_references`, sem `ORDER BY votes`,
/// sem o filtro `votes >= min_votes` à mão): a query, a ordenação por votos (DESC) e o
/// filtro vivem no core (`xref.rs`). A delegação usa a **função livre**
/// `xref::for_verse` recebendo a `&Connection` de `Store::conn()` (o
/// `EmbeddedSource`/`BibleSource` **não** têm método de xref) — ainda é delegação ao
/// core; a fronteira não escreve SQL.
///
/// **Sem parâmetro `translation`:** a xref é **independente de tradução** (chaveada
/// por book/chapter/verse). Um versículo sem referências cruzadas → `Vec` **vazio**
/// (não é erro, não panica); erros só de I/O (`Store::open` com path inválido) ou
/// `rusqlite`.
///
/// **Defaults (herdados do core):** `min_votes = None` usa
/// `xref::DEFAULT_MIN_VOTES` (= **1** → **oculta** referências disputadas/negativas);
/// `limit = None` usa `xref::DEFAULT_LIMIT` (= **20**). A UI/F1.9 pode pedir um
/// `min_votes` menor (ex.: negativo) para **ver** as disputadas.
///
/// **Licenciamento (ADR-0016):** os dados de xref são **CC-BY** (OpenBible.info). A
/// fronteira apenas **entrega os dados** (referência + votos); a **string de
/// atribuição** `Cross references courtesy of OpenBible.info (CC-BY)` é exibida pela
/// **UI da F1.9** — a obrigação CC-BY do produto **não** desaparece, só muda de
/// camada. Anti-alucinação: xref é só **referência**, nenhum texto bíblico aqui.
///
/// Offline-first: nenhuma rede — apenas I/O local no `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** mesmo molde de [`get_passage`]/[`search`] —
/// corpo DB `cfg(not(target_arch = "wasm32"))`; stub web retornando [`CoreError`]
/// (store web = F0.10), sem arrastar `xref`/`store`/`rusqlite` para o grafo wasm.
#[uniffi::export]
pub fn cross_refs(
    db_path: String,
    book: u8,
    chapter: u16,
    verse: u16,
    min_votes: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<CrossRef>, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let min_votes = min_votes.unwrap_or(the_light_core::xref::DEFAULT_MIN_VOTES);
        let limit = limit
            .map(|l| l as usize)
            .unwrap_or(the_light_core::xref::DEFAULT_LIMIT);
        let hits =
            the_light_core::xref::for_verse(store.conn(), book, chapter, verse, min_votes, limit)
                .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        Ok(hits.into_iter().map(CrossRef::from).collect())
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (db_path, book, chapter, verse, min_votes, limit);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Número máximo de entradas léxicas devolvidas quando `limit` é `None`.
///
/// Padrão **local** da fronteira (não há constante equivalente pública no core para
/// esta função): 32 é folga confortável para um versículo/capítulo curto sem inflar a
/// UI de léxico (F3.5). A UI/estudo pode pedir um `limit` explícito. Só entra no
/// caminho nativo (o corpo que abre o store é `cfg(not(wasm32))`); gateado para não
/// disparar `dead_code` no build web.
#[cfg(not(target_arch = "wasm32"))]
const DEFAULT_LEXICON_LIMIT: usize = 32;

/// Uma **entrada léxica verificada** (número de Strong + lema/transliteração/glosa),
/// na fronteira UniFFI.
///
/// Espelha `the_light_core::ai::LexicalEntry` (tipo **puro** /`ai-pure` do core, presente
/// em **todos** os alvos, ADR-0024). Os campos vêm **verbatim do léxico local
/// verificado** (STEP Bible / TBESH–TBESG, CC-BY, populado na F3.1) — a fronteira nunca
/// gera nem infere dado léxico (anti-alucinação): apenas **entrega** o que o acervo
/// contém. O Record é definido em **todos** os alvos para manter a forma da fronteira
/// UniFFI idêntica entre nativo e web (a extração de metadata do `ubrn` ocorre no host).
/// Construído **somente** via [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct LexEntry {
    /// Número de Strong **base** (ex.: `"H7225"`; o core já removeu o sufixo de
    /// desambiguação `"H7225G"`→`"H7225"`). É a chave de citação `[V:...]`.
    pub strongs: String,
    /// Lema na língua original (ex.: `אֱלֹהִים`).
    pub lemma: Option<String>,
    /// Transliteração.
    pub translit: Option<String>,
    /// Glosa breve (do léxico: COALESCE `lexicon.gloss_pt` → `lexicon.gloss` →
    /// `original_tokens.gloss`).
    pub gloss: Option<String>,
    /// Ocorrências do termo na passagem.
    pub occurrences: u32,
    /// Testamento (`"OT"` hebraico | `"NT"` grego).
    pub testament: String,
}

/// Dados léxicos verificados de uma passagem + fontes (atribuição obrigatória CC-BY),
/// na fronteira UniFFI.
///
/// Espelha `the_light_core::ai::VerifiedLexicon` (tipo **puro** /`ai-pure`). As
/// [`sources`](Self::sources) são as **atribuições verbatim** das fontes usadas (lidas
/// de `scholarly_sources.attribution`), que a **UI da F3.5 exibe obrigatoriamente**
/// (CC-BY). Construído **somente** via [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct VerifiedLexiconOut {
    /// Entradas por Strong base, das mais frequentes para as menos (desempate estável
    /// pelo Strong asc); truncadas em `limit`.
    pub entries: Vec<LexEntry>,
    /// Atribuições das fontes usadas (STEP Bible CC-BY) — a UI da F3.5 exibe.
    pub sources: Vec<String>,
}

// **Gating (DIVERGÊNCIA vs. `CrossRef`/`Note`):** os tipos-fonte
// `ai::LexicalEntry`/`ai::VerifiedLexicon` são **PUROS** (`ai-pure`, presentes também no
// wasm — o app compila o core com `ai-pure` na linha web, ADR-0024), ao contrário de
// `xref::CrossRef`/`userdata::*` (embedded-only). Por isso estes dois `From` **NÃO**
// levam `#[cfg(not(target_arch = "wasm32"))]` (são como `From<model::SearchHit>`); só o
// **corpo** de [`lexical_entries`] que abre o store SQLite é gateado.
impl From<the_light_core::ai::LexicalEntry> for LexEntry {
    fn from(e: the_light_core::ai::LexicalEntry) -> Self {
        LexEntry {
            strongs: e.strongs,
            lemma: e.lemma,
            translit: e.translit,
            gloss: e.gloss,
            occurrences: e.occurrences,
            testament: e.testament,
        }
    }
}

impl From<the_light_core::ai::VerifiedLexicon> for VerifiedLexiconOut {
    fn from(vl: the_light_core::ai::VerifiedLexicon) -> Self {
        VerifiedLexiconOut {
            entries: vl.entries.into_iter().map(LexEntry::from).collect(),
            sources: vl.sources,
        }
    }
}

/// Recupera os **dados léxicos Strong verificados** de uma passagem do **store SQLite
/// local**, delegando ao `the-light-core`.
///
/// Pipeline no **nativo** (tudo no core — uma fonte da verdade):
/// `Store::open(db_path)` → `the_light_core::ai::lexicon::verified_lexicon(store.conn(),
/// &Reference, &[], lang, limit)` → adapta a `VerifiedLexicon` do core para o Record
/// [`VerifiedLexiconOut`]. **Nenhum** SQL/JOIN/agregação de léxico é reimplementado aqui
/// (sem `SELECT … FROM original_tokens`, sem `LEFT JOIN lexicon`, sem agregação por
/// Strong base): a query, o `COALESCE` da glosa, a agregação e a ordenação por
/// frequência vivem no core (`ai/lexicon.rs`).
///
/// **`verified_lexicon` é INFALÍVEL** (não devolve `Result`): engole erros de SQLite
/// internamente e devolve vazio. Logo o **único** ponto de erro da fronteira é
/// `Store::open(&db_path)` (I/O local). Passa-se `verse_numbers = &[]`, deixando o core
/// derivar os versículos do `reference` (`Single`→`[v]`; `WholeChapter`→capítulo todo).
///
/// **Sem parâmetro `translation`:** o léxico é **independente de tradução** (chaveado por
/// `book_number/chapter[/verse]` em `original_tokens`), como a xref da F1.8 — recebe
/// `book/chapter/verse` **numéricos**. O `lang` (`"pt"`/`"en"` + sinônimos, default `Pt`)
/// é aceito pela assinatura real do core, mas **atualmente ignorado** por
/// `verified_lexicon`; é passado por fidelidade à assinatura (zero drift futuro).
///
/// **Anti-alucinação:** glosas/lemas/Strong vêm **só** do léxico local verificado (STEP
/// Bible / TBESH–TBESG, CC-BY, F3.1) — nenhum LLM envolvido nesta função (é lookup puro
/// de banco). As [`sources`](VerifiedLexiconOut::sources) preservam a **atribuição CC-BY**
/// para a exibição obrigatória da F3.5. Offline-first: nenhuma rede — só I/O local.
///
/// **Gating por alvo (ver ADR-0010):** mesmo molde de [`get_passage`]/[`search`]/
/// [`cross_refs`] — a função é exportada em **todos** os alvos (forma da fronteira
/// consistente; `ubrn` extrai a metadata no host), mas apenas o **corpo que toca
/// store/rusqlite** é `cfg(not(target_arch = "wasm32"))`. No **web** um stub retorna
/// [`CoreError`] (léxico web = F3.12), sem arrastar `rusqlite`/`store` para o grafo wasm.
#[uniffi::export]
pub fn lexical_entries(
    db_path: String,
    book: u8,
    chapter: u16,
    verse: Option<u16>,
    lang: String,
    limit: Option<u32>,
) -> Result<VerifiedLexiconOut, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        // Léxico independente de tradução: Reference por book/chapter[/verse].
        let reference = match verse {
            Some(v) => the_light_core::model::Reference::single(book, chapter, v),
            None => the_light_core::model::Reference::whole_chapter(book, chapter),
        };
        // lang aceito pela assinatura real, mas ignorado por verified_lexicon; default Pt.
        let lang = lang
            .parse::<the_light_core::model::Lang>()
            .unwrap_or(the_light_core::model::Lang::Pt);
        let limit = limit.map(|l| l as usize).unwrap_or(DEFAULT_LEXICON_LIMIT);
        // Infalível (não Result): verse_numbers = &[] → o core deriva do reference.
        let vl = the_light_core::ai::lexicon::verified_lexicon(
            store.conn(),
            &reference,
            &[],
            lang,
            limit,
        );
        Ok(VerifiedLexiconOut::from(vl))
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (db_path, book, chapter, verse, lang, limit);
        Err(CoreError::Generic {
            message: "léxico indisponível no alvo web (F3.12)".to_string(),
        })
    }
}

/// **Modo** de estudo (molda estrutura/tom da saída), na fronteira UniFFI.
///
/// Espelha `the_light_core::ai::StudyMode` (enum **puro** /`ai-pure`, presente em todos
/// os alvos, ADR-0024). Enum **sem dados** (como [`Testament`]); os [`From`] em ambos os
/// sentidos são **cfg-free** (o tipo-fonte existe também no wasm). Usado para **montar**
/// o `StudyRequest` (fronteira → core) e para **espelhar** o `StudyResult` (core →
/// fronteira). A semântica (`wants_lexical`/`emits_apparatus`/prompt) vive no core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum StudyMode {
    /// Acadêmico/exegético: rigoroso, com aparato (notas + bibliografia).
    Academic,
    /// Devocional: reflexão e aplicação pessoal.
    Devotional,
    /// Introdutório: primeiro contato, linguagem acessível.
    Introductory,
    /// Pregação/ensino: esboço homilético.
    Sermon,
}

impl From<StudyMode> for the_light_core::ai::StudyMode {
    fn from(m: StudyMode) -> Self {
        use the_light_core::ai::StudyMode as Core;
        match m {
            StudyMode::Academic => Core::Academic,
            StudyMode::Devotional => Core::Devotional,
            StudyMode::Introductory => Core::Introductory,
            StudyMode::Sermon => Core::Sermon,
        }
    }
}

impl From<the_light_core::ai::StudyMode> for StudyMode {
    fn from(m: the_light_core::ai::StudyMode) -> Self {
        use the_light_core::ai::StudyMode as Core;
        match m {
            Core::Academic => StudyMode::Academic,
            Core::Devotional => StudyMode::Devotional,
            Core::Introductory => StudyMode::Introductory,
            Core::Sermon => StudyMode::Sermon,
        }
    }
}

/// **Lente** denominacional (voz hermenêutica) do estudo, na fronteira UniFFI.
///
/// Espelha `the_light_core::ai::Denomination` (enum **puro** /`ai-pure`). Nome distinto
/// (`StudyLens`) para deixar o papel explícito na API da fronteira; os [`From`] mapeiam
/// 1:1 para/de `Denomination` (cfg-free). A voz teológica de cada lente vive no core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum StudyLens {
    /// Batista.
    Baptist,
    /// Presbiteriana / Reformada.
    Presbyterian,
    /// Luterana.
    Lutheran,
    /// Pentecostal.
    Pentecostal,
    /// Católica Romana.
    Catholic,
    /// Ortodoxa.
    Orthodox,
}

impl From<StudyLens> for the_light_core::ai::Denomination {
    fn from(l: StudyLens) -> Self {
        use the_light_core::ai::Denomination as Core;
        match l {
            StudyLens::Baptist => Core::Baptist,
            StudyLens::Presbyterian => Core::Presbyterian,
            StudyLens::Lutheran => Core::Lutheran,
            StudyLens::Pentecostal => Core::Pentecostal,
            StudyLens::Catholic => Core::Catholic,
            StudyLens::Orthodox => Core::Orthodox,
        }
    }
}

impl From<the_light_core::ai::Denomination> for StudyLens {
    fn from(d: the_light_core::ai::Denomination) -> Self {
        use the_light_core::ai::Denomination as Core;
        match d {
            Core::Baptist => StudyLens::Baptist,
            Core::Presbyterian => StudyLens::Presbyterian,
            Core::Lutheran => StudyLens::Lutheran,
            Core::Pentecostal => StudyLens::Pentecostal,
            Core::Catholic => StudyLens::Catholic,
            Core::Orthodox => StudyLens::Orthodox,
        }
    }
}

/// **Profundidade** do estudo, na fronteira UniFFI.
///
/// Espelha `the_light_core::ai::StudyDepth` (enum **puro** /`ai-pure`). [`From`] cfg-free
/// em ambos os sentidos.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum StudyDepth {
    /// Visão geral.
    Overview,
    /// Exegético (contexto histórico-literário, estrutura).
    Exegetical,
    /// Estudo de palavras (grego/hebraico).
    WordStudy,
}

impl From<StudyDepth> for the_light_core::ai::StudyDepth {
    fn from(d: StudyDepth) -> Self {
        use the_light_core::ai::StudyDepth as Core;
        match d {
            StudyDepth::Overview => Core::Overview,
            StudyDepth::Exegetical => Core::Exegetical,
            StudyDepth::WordStudy => Core::WordStudy,
        }
    }
}

impl From<the_light_core::ai::StudyDepth> for StudyDepth {
    fn from(d: the_light_core::ai::StudyDepth) -> Self {
        use the_light_core::ai::StudyDepth as Core;
        match d {
            Core::Overview => StudyDepth::Overview,
            Core::Exegetical => StudyDepth::Exegetical,
            Core::WordStudy => StudyDepth::WordStudy,
        }
    }
}

/// Uma **seção** estruturada da interpretação (cabeçalho `## ` + corpo), na fronteira
/// UniFFI.
///
/// Espelha `the_light_core::ai::StudySection` (tipo **puro** /`ai-pure`, presente em todos
/// os alvos). O fatiamento por `## ` é feito **pelo core** (`split_sections`) — a
/// fronteira só **adapta** o tipo. Vazio quando o modelo não usou cabeçalhos.
/// [`From`] **cfg-free** (como [`LexEntry`]).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StudySection {
    /// Cabeçalho da seção (sem o `## `).
    pub heading: String,
    /// Corpo da seção (texto entre este cabeçalho e o próximo).
    pub body: String,
}

impl From<the_light_core::ai::StudySection> for StudySection {
    fn from(s: the_light_core::ai::StudySection) -> Self {
        StudySection {
            heading: s.heading,
            body: s.body,
        }
    }
}

/// Uma **citação** verificável do aparato acadêmico (léxico/fonte/web), na fronteira
/// UniFFI.
///
/// Espelha `the_light_core::ai::Citation` (tipo **puro** /`ai-pure`). Invariante
/// anti-alucinação do core: **o LLM nunca produz uma `Citation`** — elas são construídas
/// **do banco** (léxico verificado) ou de URLs realmente buscadas. O [`kind`](Self::kind)
/// é a **representação canônica** do `CitationKind` do core (via `Debug` do enum: o
/// identificador da variante, ex.: `"Lexicon"`) — não um rótulo inventado pela fronteira.
/// [`From`] **cfg-free** (como [`LexEntry`]).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StudyCitation {
    /// Tipo da citação (variante canônica do core: `Scripture`/`Lexicon`/`Source`/`Web`).
    pub kind: String,
    /// Chave estável, **idêntica à âncora** que o modelo cita (ex.: `"H7225"`, `"W:1"`).
    pub key: String,
    /// Autor (quando aplicável).
    pub author: Option<String>,
    /// Título da obra.
    pub title: Option<String>,
    /// Locus (ex.: verbete/página).
    pub locus: Option<String>,
    /// Editora.
    pub publisher: Option<String>,
    /// Ano.
    pub year: Option<String>,
    /// URL da fonte (fontes web).
    pub url: Option<String>,
    /// Rótulo de licença para exibição (ex.: `"CC BY 4.0"`).
    pub license: Option<String>,
    /// Atribuição verbatim exigida pela fonte (CC-BY).
    pub attribution: Option<String>,
    /// Data de acesso (fontes web).
    pub accessed: Option<String>,
    /// Trecho verbatim citado (fontes web).
    pub quote: Option<String>,
}

impl From<the_light_core::ai::Citation> for StudyCitation {
    fn from(c: the_light_core::ai::Citation) -> Self {
        StudyCitation {
            // Representação canônica do core (`CitationKind`): o identificador da
            // variante via `Debug`; a fronteira não inventa rótulo (anti-alucinação).
            kind: format!("{:?}", c.kind),
            key: c.key,
            author: c.author,
            title: c.title,
            locus: c.locus,
            publisher: c.publisher,
            year: c.year,
            url: c.url,
            license: c.license,
            attribution: c.attribution,
            accessed: c.accessed,
            quote: c.quote,
        }
    }
}

/// O resultado de um **estudo profundo** (`study`), na fronteira UniFFI.
///
/// **Separa explicitamente** o que vem do **banco local** do que vem do **modelo** — a
/// anti-alucinação materializada no contrato (SPEC §6.2):
/// - [`passage_text`](Self::passage_text): a passagem **numerada, verbatim do store
///   local**, **nunca** produzida/editada pelo LLM;
/// - [`interpretation`](Self::interpretation): a saída do **modelo** (aqui o
///   `MockLlmProvider`), que apenas **interpreta** o texto citado;
/// - [`citations`](Self::citations): construídas **do banco/URLs** (nunca pelo modelo);
/// - [`warnings`](Self::warnings): avisos de verificação do core (Strong/`[W:n]` citados
///   fora do acervo).
///
/// Espelha `the_light_core::ai::study::StudyResult`. **Gating (como [`CrossRef`]):** o
/// tipo-fonte `StudyResult` é `embedded`-only → o [`From`] a partir dele é
/// `#[cfg(not(target_arch = "wasm32"))]`; o Record em si só referencia tipos **puros**
/// ([`Reference`]/`String`/[`StudyMode`]/[`StudyLens`]/[`StudyDepth`]/[`StudySection`]/
/// [`StudyCitation`]) e existe em **todos** os alvos. Construído **somente** via [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct StudyResultOut {
    /// Referência canônica estudada (book/chapter/verses).
    pub reference: Reference,
    /// Referência formatada (ex.: `"John 3.16"`), via `reference::format_reference`.
    pub reference_label: String,
    /// Modo usado (ecoa a entrada).
    pub mode: StudyMode,
    /// Lente usada (ecoa a entrada).
    pub lens: StudyLens,
    /// Profundidade usada (ecoa a entrada).
    pub depth: StudyDepth,
    /// Idioma da resposta (`"pt"`/`"en"`), via `Lang::code()`.
    pub language: String,
    /// Passagem **numerada, verbatim do store local**. Anti-alucinação: **nunca** do LLM.
    pub passage_text: String,
    /// Interpretação produzida pelo **modelo** (texto do LLM, não bíblico). Separada do
    /// [`passage_text`](Self::passage_text).
    pub interpretation: String,
    /// Interpretação fatiada por seção (`## `). Vazio quando o modelo não usou cabeçalhos.
    pub sections: Vec<StudySection>,
    /// Avisos de verificação (ex.: Strong citado fora do acervo). Vazio quando nada foi
    /// sinalizado.
    pub warnings: Vec<String>,
    /// Citações verificáveis (léxico + fontes), construídas **do banco** — nunca pelo
    /// modelo. Vazio fora do modo acadêmico / sem léxico/web semeados.
    pub citations: Vec<StudyCitation>,
    /// Nome do provedor usado (ex.: `"mock"`), via `LlmProvider::name()`.
    pub provider: String,
    /// Modelo usado (ex.: `"mock-1"`), via `LlmProvider::model()`.
    pub model: String,
    /// **Markdown acadêmico (SBL)** do estudo, produzido pela **mesma impl do core**
    /// (`StudyResult::to_academic_markdown`, `pub` porém `embedded`-only → callável na
    /// fronteira **nativa**). Fonte única / **zero drift**: a fronteira **não**
    /// reimplementa a serialização SBL/proveniência (F3.8). Inclui bloco YAML
    /// (`title`/`author`/`lang`), `## Texto (acervo local)` (= [`passage_text`](Self::passage_text)
    /// verbatim do store), `## Análise` (âncoras `[V:Strong]`/`[W:n]` **validadas e
    /// reescritas** deterministicamente pelo core), `## Notas`/`## Bibliografia` (SBL) e o
    /// **rodapé de procedência** que separa o **verificável** (acervo local + atribuição
    /// **STEP CC-BY** das citações `Source`) do **gerado por IA** ("…podem conter erros —
    /// confira sempre as fontes primárias"). No **web** o Record nunca é construído (o
    /// stub de `deep_study` retorna [`CoreError`]); o `From` que popula este campo é
    /// `#[cfg(not(target_arch = "wasm32"))]` (grafo wasm puro).
    pub academic_markdown: String,
}

// O tipo-fonte `study::StudyResult` é `embedded`-only (superfície pesada do `ai`); este
// `From` fica fora do grafo wasm (como `From<xref::CrossRef>`). O Record acima é puro e
// vale p/ todos os alvos; aqui mapeamos só no nativo (enums/seções/citações via os `From`
// puros; `reference` via o `From` de `model::Reference`; `language` via `Lang::code()`).
#[cfg(not(target_arch = "wasm32"))]
impl From<the_light_core::ai::study::StudyResult> for StudyResultOut {
    fn from(r: the_light_core::ai::study::StudyResult) -> Self {
        // Markdown acadêmico (SBL) produzido pela MESMA impl do core (fonte única, zero
        // drift): `StudyResult::to_academic_markdown` é `pub` (só `embedded`-gated, OK na
        // fronteira nativa). Computado ANTES de mover os campos de `r` (`&self`; `language`
        // é `Copy`). A fronteira NÃO reimplementa SBL/proveniência (F3.8).
        let academic_markdown = r.to_academic_markdown(r.language);
        StudyResultOut {
            reference: r.reference.into(),
            reference_label: r.reference_label,
            mode: r.mode.into(),
            lens: r.lens.into(),
            depth: r.depth.into(),
            language: r.language.code().to_string(),
            passage_text: r.passage_text,
            interpretation: r.interpretation,
            sections: r.sections.into_iter().map(StudySection::from).collect(),
            warnings: r.warnings,
            citations: r.citations.into_iter().map(StudyCitation::from).collect(),
            provider: r.provider,
            model: r.model,
            academic_markdown,
        }
    }
}

/// Produz um **estudo profundo** de uma passagem (modo × lente × profundidade),
/// delegando à camada de IA do `the-light-core` (RAG leve com fatos do store; BYOK).
///
/// Pipeline no **nativo** (tudo no core — uma fonte da verdade): a fronteira **monta** o
/// `StudyRequest` a partir dos **fatos do store local** e delega a
/// `ai::study::study(&provider, &req)`, que separa `passage_text` (banco) de
/// `interpretation` (modelo):
/// 1. `lang` → `Lang` (default `Pt`, sem panicar); `reference` = `Reference::single`
///    (quando há `verse`) ou `Reference::whole_chapter`; `reference_label` via
///    `reference::format_reference`;
/// 2. `Store::open(db_path)` → a [`Passage`] **verbatim do store** pela **mesma** rota da
///    F1.2 (`EmbeddedSource::passage`, anti-alucinação);
/// 3. léxico verificado via `ai::lexicon::verified_lexicon` (rota da F3.2, **infalível**)
///    e rótulos de xref via `xref::passage_labels` (RAG leve, melhor esforço);
/// 4. `ai::build_provider(&provider_name, key, model)` — a **chave é argumento** (BYOK);
///    `"mock"` **não** faz rede nem exige chave;
/// 5. `ai::study::study(provider, &req)` → o `StudyResult` (o **modelo** só interpreta:
///    `provider.complete(system, user)`), adaptado para [`StudyResultOut`].
///
/// **Nenhum** prompt/RAG/SQL/aparato de citação é reimplementado aqui — tudo vive em
/// `ai::study`/`ai::lexicon`/`xref`/store. Anti-alucinação: o `passage_text` e as
/// `citations`/léxico vêm **sempre do banco local verificado** (verbatim); o LLM/mock só
/// **interpreta**. `web_sources` fica **vazio** (offline; a pesquisa web é a F3.9);
/// `brief` é `None` (foco temático é fora de escopo aqui — sempre uma passagem concreta).
///
/// **BYOK / offline-first:** com `provider_name = "mock"` e `key = None` (esta tarefa)
/// não há rede nem chave; nenhuma chave é logada. A chave real do usuário e a rede opt-in
/// vêm depois (F2.10/F3.10); a UI é a F3.5.
///
/// **Gating por alvo (ver ADR-0010):** exportada em todos os alvos, mas o corpo que toca
/// `ai::study`/store é `cfg(not(target_arch = "wasm32"))`; no **web**, stub que retorna
/// [`CoreError`] (estudo web = F3.12), sem arrastar `ai::study`/`reqwest`/`rusqlite` para
/// o grafo wasm.
#[uniffi::export]
#[allow(clippy::too_many_arguments)]
pub fn deep_study(
    db_path: String,
    translation: String,
    book: u8,
    chapter: u16,
    verse: Option<u16>,
    mode: StudyMode,
    lens: StudyLens,
    depth: StudyDepth,
    lang: String,
    provider_name: String,
    key: Option<String>,
    model: Option<String>,
) -> Result<StudyResultOut, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para chamar `.passage(...)` em `EmbeddedSource` (como em
        // `ask_anchored`). `name()/model()` do `dyn LlmProvider` dispensam import.
        use the_light_core::source::BibleSource;

        // 1) Idioma de exibição/resposta (`"pt"|"en"` + sinônimos); default Pt.
        let lang = lang
            .parse::<the_light_core::model::Lang>()
            .unwrap_or(the_light_core::model::Lang::Pt);

        // 2) Referência (single ou capítulo inteiro) + rótulo formatado (core).
        let reference = match verse {
            Some(v) => the_light_core::model::Reference::single(book, chapter, v),
            None => the_light_core::model::Reference::whole_chapter(book, chapter),
        };
        let reference_label = the_light_core::reference::format_reference(&reference, lang);

        // 3) Passagem VERBATIM do store, pela MESMA rota da F1.2 (anti-alucinação).
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation_id = the_light_core::model::TranslationId::new(translation);
        let passage =
            source
                .passage(&reference, &translation_id)
                .map_err(|e| CoreError::Generic {
                    message: e.to_string(),
                })?;

        // 4) Fatos locais para o RAG: léxico verificado (infalível, rota F3.2) + rótulos
        //    de xref (melhor esforço). Nenhum SQL/agregação é reimplementado aqui.
        let verified_lexicon = the_light_core::ai::lexicon::verified_lexicon(
            store.conn(),
            &reference,
            &[],
            lang,
            DEFAULT_LEXICON_LIMIT,
        );
        let cross_references = the_light_core::xref::passage_labels(
            store.conn(),
            &reference,
            &[],
            lang,
            the_light_core::xref::DEFAULT_LIMIT,
        );

        // 5) Provedor (BYOK: a chave é argumento; "mock" = sem rede/chave).
        let provider =
            the_light_core::ai::build_provider(&provider_name, key, model).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;

        // 6) Monta o StudyRequest (fatos do store) e DELEGA ao core — o `study` separa
        //    o `passage_text` (banco) da `interpretation` (modelo). Offline: sem web.
        let request = the_light_core::ai::study::StudyRequest {
            reference,
            reference_label,
            mode: mode.into(),
            lens: lens.into(),
            depth: depth.into(),
            language: lang,
            passage: Some(&passage),
            cross_references,
            verified_lexicon,
            web_sources: Vec::new(),
            brief: None,
        };
        let result =
            the_light_core::ai::study::study(provider.as_ref(), &request).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;

        Ok(StudyResultOut::from(result))
    }
    #[cfg(target_arch = "wasm32")]
    {
        // Stub web: a superfície pesada do `ai` (`study`/`StudyRequest`/`StudyResult`) e o
        // store são `embedded`-only (nativo). O estudo web é a F3.12; até lá, falha
        // explícita — sem tocar `ai::study`/store/`rusqlite`/`reqwest` (grafo wasm puro).
        let _ = (
            db_path,
            translation,
            book,
            chapter,
            verse,
            mode,
            lens,
            depth,
            lang,
            provider_name,
            key,
            model,
        );
        Err(CoreError::Generic {
            message: "estudo profundo indisponível no alvo web (F3.12)".to_string(),
        })
    }
}

/// Papel de um turno de conversa (`user`/`assistant`), na fronteira UniFFI.
///
/// Espelha `the_light_core::ai::ChatRole` (enum **puro** /`ai-pure`, presente em **todos**
/// os alvos, sem `cfg`). Enum sem dados (como [`StudyMode`]); o [`From`] para o tipo-fonte
/// é **cfg-free** (o alvo existe também no wasm). Usado só como **entrada** (o histórico da
/// conversa), via [`ChatTurn`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ChatRole {
    /// Turno do usuário (pergunta/follow-up).
    User,
    /// Turno do assistente (resposta anterior do modelo).
    Assistant,
}

impl From<ChatRole> for the_light_core::ai::ChatRole {
    fn from(r: ChatRole) -> Self {
        use the_light_core::ai::ChatRole as Core;
        match r {
            ChatRole::User => Core::User,
            ChatRole::Assistant => Core::Assistant,
        }
    }
}

/// Um **turno** do histórico de conversa (papel + conteúdo), na fronteira UniFFI.
///
/// Record de **entrada** que espelha `the_light_core::ai::ChatMessage` (tipo **puro** /
/// `ai-pure`). O [`From`] para `ChatMessage` é **cfg-free**. O [`content`](Self::content)
/// é **texto do usuário/modelo** (não bíblico) — a âncora com o texto do versículo é
/// montada **pela fronteira, do store**, e injetada como `context` pelo core (invariante:
/// o `context` entra só no 1º turno de usuário).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ChatTurn {
    /// Papel do turno (`User`/`Assistant`).
    pub role: ChatRole,
    /// Conteúdo textual do turno (pergunta/follow-up ou resposta anterior).
    pub content: String,
}

impl From<ChatTurn> for the_light_core::ai::ChatMessage {
    fn from(t: ChatTurn) -> Self {
        the_light_core::ai::ChatMessage {
            role: t.role.into(),
            content: t.content,
        }
    }
}

/// Uma **rodada de refinamento** já respondida (pergunta + resposta), na fronteira UniFFI.
///
/// Record de **entrada** para o `prior` de [`refine_scope`]: cada par vira `(pergunta,
/// resposta)` no vetor que o core usa como histórico. Puro (só `String`) → **cfg-free**.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RefinementRound {
    /// A pergunta feita pelo modelo naquela rodada.
    pub question: String,
    /// A resposta escolhida/dada pelo usuário.
    pub answer: String,
}

/// Uma **rodada de refinamento** produzida pelo modelo (pergunta + opções), na fronteira
/// UniFFI.
///
/// Espelha `the_light_core::ai::Refinement` (struct **pura**/`ai-pure`, sem `cfg`): uma
/// [`question`](Self::question) e as [`options`](Self::options) (deduplicadas, sem vazias
/// — o parsing/dedup vive no core). O [`From`] a partir de `Refinement` é **cfg-free**.
/// **Não há texto bíblico aqui** (é escopo/pergunta), mas segue a lei anti-alucinação: a
/// fronteira nada fabrica — só adapta o que o core devolve.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct RefinementOut {
    /// A pergunta de refinamento (pode ser vazia quando a rodada não trouxe pergunta).
    pub question: String,
    /// As opções sugeridas (deduplicadas, sem vazias), na ordem do core.
    pub options: Vec<String>,
}

impl From<the_light_core::ai::Refinement> for RefinementOut {
    fn from(r: the_light_core::ai::Refinement) -> Self {
        RefinementOut {
            question: r.question,
            options: r.options,
        }
    }
}

/// Resolve o **provedor** de IA (BYOK) para os fluxos de conversa/refinamento, com o
/// **caminho mock cfg-free**.
///
/// - `provider_name == "mock"`: instancia `MockLlmProvider::default()` **direto** (é
///   `ai-pure`, sem `cfg`) — **NÃO** via `build_provider` (que é `embedded`-only). Assim o
///   caminho MOCK **compila e roda no wasm**, antecipando a paridade web do refinamento.
/// - qualquer outro nome: no **nativo** (`cfg(not(wasm32))`) delega a `ai::build_provider`
///   (providers reais via `reqwest`, BYOK); no **web** (`cfg(wasm32)`) retorna
///   [`CoreError`] (transporte web = F3.12), sem arrastar `reqwest` para o grafo wasm.
///
/// Devolve um `Box<dyn LlmProvider>` (mesma forma que `build_provider`), pronto para as
/// funções **puras** `ai::ask_session`/`ai::refine_scope`.
fn resolve_provider(
    provider_name: &str,
    key: Option<String>,
    model: Option<String>,
) -> Result<Box<dyn the_light_core::ai::LlmProvider>, CoreError> {
    if provider_name == "mock" {
        // ai-pure → instanciado DIRETO (sem `build_provider`, que é embedded-only) → o
        // caminho MOCK é cfg-free e roda no wasm. `key`/`model` não se aplicam ao mock.
        return Ok(Box::new(the_light_core::ai::MockLlmProvider::default()));
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        the_light_core::ai::build_provider(provider_name, key, model).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (key, model);
        Err(CoreError::Generic {
            message: format!("provedor '{provider_name}' indisponível no alvo web (F3.12)"),
        })
    }
}

/// **Refinamento de escopo** (`refine_scope`) — pede ao provedor UMA rodada de
/// refinamento (pergunta + opções) a partir de um assunto (`brief`) e do histórico de
/// respostas, delegando a `the_light_core::ai::refine_scope`.
///
/// Pipeline (o core faz o trabalho — a fronteira só **adapta** tipos/erros e resolve o
/// provedor):
/// 1. `lang` → `Lang` (default `Pt`, sem panicar); `prior` (`Vec<RefinementRound>`) →
///    `Vec<(String, String)>` (pares pergunta/resposta);
/// 2. `resolve_provider(provider_name, key, model)` — **mock cfg-free** (roda no wasm) ou
///    provedor real gated (F3.12 no web);
/// 3. `ai::refine_scope(provider, mode, lang, brief, prior, round)` → `Refinement`,
///    adaptado para [`RefinementOut`]. Com o **mock**, o `refine_system_prompt` contém
///    `"PERGUNTA:"` → o mock devolve a **rodada canônica** (determinística, sem rede).
///
/// **Sem `lens`:** `refine_scope` do core recebe só `mode` (não uma denominação) — a
/// fronteira **não** inventa um parâmetro de lente. Não há texto bíblico (é escopo:
/// pergunta + opções); ainda assim nada é fabricado — tudo vem do core.
///
/// **Gating:** **cfg-free** para o caminho `"mock"` (compila e roda no wasm, pois
/// `ai::refine_scope` e `MockLlmProvider` são `ai-pure` e **não tocam o store**); o
/// provedor real fica sob `cfg(not(wasm32))` dentro de [`resolve_provider`].
#[uniffi::export]
#[allow(clippy::too_many_arguments)]
pub fn refine_scope(
    mode: StudyMode,
    lang: String,
    brief: String,
    prior: Vec<RefinementRound>,
    round: u8,
    provider_name: String,
    key: Option<String>,
    model: Option<String>,
) -> Result<RefinementOut, CoreError> {
    // 1) Idioma (default Pt) + histórico de rodadas como pares (pergunta, resposta).
    let lang = lang
        .parse::<the_light_core::model::Lang>()
        .unwrap_or(the_light_core::model::Lang::Pt);
    let prior_pairs: Vec<(String, String)> =
        prior.into_iter().map(|r| (r.question, r.answer)).collect();

    // 2) Provedor (mock cfg-free / real gated). BYOK: a chave é argumento; mock = sem rede.
    let provider = resolve_provider(&provider_name, key, model)?;

    // 3) DELEGA ao core: a rodada (pergunta + opções) é do modelo — nada reimplementado.
    let refinement = the_light_core::ai::refine_scope(
        provider.as_ref(),
        mode.into(),
        lang,
        &brief,
        &prior_pairs,
        round,
    )
    .map_err(|e| CoreError::Generic {
        message: e.to_string(),
    })?;

    Ok(RefinementOut::from(refinement))
}

/// **Parser puro** de uma rodada de refinamento (`parse_refinement`) — string
/// (`PERGUNTA:` + `- opção`) → [`RefinementOut`], delegando a
/// `the_light_core::ai::parse_refinement`.
///
/// **Determinístico, SEM provedor, SEM store** → **cfg-free** (compila **e roda** no wasm
/// E no nativo, antecipando a paridade web do parser). O parsing tolerante (linha
/// `PERGUNTA:`/`Pergunta:` ou 1ª linha não-opção vira a pergunta; linhas `- …`/`* …` viram
/// opções deduplicadas, sem vazias) vive **no core** — a fronteira só **adapta** o tipo.
/// Entrada vazia/inválida → `question` vazia e `options` vazio (**sem panic**).
#[uniffi::export]
pub fn parse_refinement(raw: String) -> RefinementOut {
    RefinementOut::from(the_light_core::ai::parse_refinement(&raw))
}

/// **Conversa ancorada com follow-up** (`ask_session`) sobre uma passagem/estudo,
/// delegando a `the_light_core::ai::ask_session` e mantendo a **âncora** (texto do
/// versículo) **do store local**, separada da **interpretação** (modelo).
///
/// Pipeline no **nativo** (a âncora vem do store — anti-alucinação):
/// 1. `lang` → `Lang` (default `Pt`); `reference` = `Reference::single` (com `verse`) ou
///    `Reference::whole_chapter`;
/// 2. `Store::open(db_path)` → `Passage` **verbatim do store** (`EmbeddedSource::passage`,
///    mesma rota da F1.2) → `ai::numbered_passage` (o `cited_text`, numerado);
/// 3. `label` via `reference::format_reference` + rótulos de xref via `xref::passage_labels`
///    (RAG leve) → `context` via `ai::ask_context` (o **contexto ancorado**);
/// 4. `study_mode.zip(study_lens)` → `Option<(StudyMode, Denomination)>` (modo + lente do
///    estudo, quando ambos presentes → prompt de follow-up de estudo);
/// 5. `resolve_provider` (mock/real, BYOK); `turns` (`Vec<ChatTurn>`) → `Vec<ChatMessage>`;
/// 6. `ai::ask_session(provider, lang, context, messages, study)` → **só a interpretação**
///    (o modelo nunca gera texto bíblico; o core embute o `context` só no 1º turno de
///    usuário), composta em [`AiAnswer`] separando `cited_text` (store) de `interpretation`.
///
/// **Nenhuma** lógica de conversa (transcript/prompt/parsing) é reimplementada — tudo em
/// `ai::ask_session`/`ai::ask_context`/`ai::numbered_passage`/store. Anti-alucinação: o
/// `cited_text` (âncora) é **sempre** do store verbatim; o LLM só conversa/interpreta.
///
/// **Gating por alvo (molde F3.3):** corpo `cfg(not(wasm32))` (a âncora é montada do store
/// nativo, `rusqlite`/`embedded`); no **web**, stub que retorna [`CoreError`] (a paridade
/// web — montar o `context` do store web e chamar a `ask_session` **pura** — é a F3.12),
/// sem arrastar store/`rusqlite`/`reqwest` para o grafo wasm.
#[uniffi::export]
#[allow(clippy::too_many_arguments)]
pub fn ask_session_anchored(
    db_path: String,
    translation: String,
    book: u8,
    chapter: u16,
    verse: Option<u16>,
    lang: String,
    turns: Vec<ChatTurn>,
    study_mode: Option<StudyMode>,
    study_lens: Option<StudyLens>,
    provider_name: String,
    key: Option<String>,
    model: Option<String>,
) -> Result<AiAnswer, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para chamar `.passage(...)` em `EmbeddedSource` (como em
        // `deep_study`). `name()/model()` do `dyn LlmProvider` dispensam import.
        use the_light_core::source::BibleSource;

        // 1) Idioma (default Pt) + referência (single ou capítulo inteiro).
        let lang = lang
            .parse::<the_light_core::model::Lang>()
            .unwrap_or(the_light_core::model::Lang::Pt);
        let reference = match verse {
            Some(v) => the_light_core::model::Reference::single(book, chapter, v),
            None => the_light_core::model::Reference::whole_chapter(book, chapter),
        };

        // 2) Passagem VERBATIM do store, pela MESMA rota da F1.2 (anti-alucinação) →
        //    texto numerado (o `cited_text`, a âncora da conversa).
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation_id = the_light_core::model::TranslationId::new(translation);
        let passage =
            source
                .passage(&reference, &translation_id)
                .map_err(|e| CoreError::Generic {
                    message: e.to_string(),
                })?;
        let cited_text = the_light_core::ai::numbered_passage(&passage);

        // 3) Contexto ancorado: rótulo + texto numerado + rótulos de xref (RAG leve).
        let label = the_light_core::reference::format_reference(&reference, lang);
        let related = the_light_core::xref::passage_labels(
            store.conn(),
            &reference,
            &[],
            lang,
            the_light_core::xref::DEFAULT_LIMIT,
        );
        let context = the_light_core::ai::ask_context(&label, &cited_text, &related);

        // 4) Estudo (modo + lente) só quando ambos presentes → prompt de follow-up.
        let study = study_mode
            .zip(study_lens)
            .map(|(m, l)| (m.into(), l.into()));

        // 5) Provedor (mock/real, BYOK) + histórico de turnos → mensagens do core.
        let provider = resolve_provider(&provider_name, key, model)?;
        let messages: Vec<the_light_core::ai::ChatMessage> =
            turns.into_iter().map(Into::into).collect();

        // 6) DELEGA ao core: a interpretação é SÓ a saída do modelo (o core embute o
        //    `context` no 1º turno de usuário). Nada de conversa é reimplementado aqui.
        let interpretation =
            the_light_core::ai::ask_session(provider.as_ref(), lang, &context, &messages, study)
                .map_err(|e| CoreError::Generic {
                    message: e.to_string(),
                })?;

        // Contrato anti-alucinação: cited_text (store) separado da interpretation (modelo).
        Ok(AiAnswer {
            reference: reference.into(),
            cited_text,
            interpretation,
            provider: provider.name().to_string(),
            model: provider.model().to_string(),
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        // Stub web: a âncora é montada do store nativo (`embedded`); a paridade web
        // (montar `context` do store web + `ask_session` pura) é a F3.12. Falha explícita
        // sem tocar store/`rusqlite`/`build_provider`/`reqwest` (grafo wasm puro).
        let _ = (
            db_path,
            translation,
            book,
            chapter,
            verse,
            lang,
            turns,
            study_mode,
            study_lens,
            provider_name,
            key,
            model,
        );
        Err(CoreError::Generic {
            message: "conversa ancorada indisponível no alvo web (F3.12)".to_string(),
        })
    }
}

/// Uma **nota** do usuário associada a uma referência, na fronteira UniFFI.
///
/// Espelha `the_light_core::userdata::notes::Note`: a [`reference`](Self::reference)
/// canônica e o [`body`](Self::body) em Markdown. O `body` é **dado do usuário** —
/// **anti-alucinação não se aplica a ele** (texto livre, não bíblico); aplica-se à
/// `reference`, que é o [`Reference`] **canônico** parseado pelo core (PT e EN caem na
/// MESMA nota). Persistida como **um arquivo `.md` por referência** em `notes/` (nome
/// canônico EN, ex.: `John_3.16.md`) — formato aberto e exportável (a serialização vive
/// no core; a fronteira não escreve `.md` à mão).
///
/// **Gating (como [`CrossRef`]):** o tipo-fonte `userdata::notes::Note` vive no módulo
/// `userdata`, que é `#[cfg(feature = "embedded")]` (**só no nativo**). Por isso o
/// Record é definido em **todos** os alvos (só referencia tipos **puros**,
/// [`Reference`]/`String`), mas o [`From`] a partir do tipo-fonte do core é
/// `#[cfg(not(target_arch = "wasm32"))]` (o módulo `userdata` **não** entra no grafo
/// wasm). Construída **somente** via [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Note {
    /// Referência canônica da nota (book/chapter/verses).
    pub reference: Reference,
    /// Corpo da nota em Markdown — **texto livre do usuário** (anti-alucinação não se
    /// aplica ao corpo; aplica-se à `reference`).
    pub body: String,
}

// O tipo-fonte `userdata::notes::Note` é `embedded`-only (módulo `userdata`); este
// `From` fica fora do grafo wasm. O Record acima é puro e vale p/ todos os alvos; aqui
// mapeamos só no nativo (`reference` via o `From` de `model::Reference`).
#[cfg(not(target_arch = "wasm32"))]
impl From<the_light_core::userdata::notes::Note> for Note {
    fn from(n: the_light_core::userdata::notes::Note) -> Self {
        Note {
            reference: n.reference.into(),
            body: n.body,
        }
    }
}

/// Uma **marcação** (highlight) do usuário sobre uma referência, na fronteira UniFFI.
///
/// Espelha `the_light_core::userdata::highlights::Highlight`: a
/// [`reference`](Self::reference) canônica, a [`color`](Self::color) (nome livre, ex.:
/// `"yellow"`) e uma [`tag`](Self::tag) opcional (etiqueta). `color`/`tag` são **dados
/// do usuário** (anti-alucinação não se aplica); a `reference` é canônica. Persistida
/// num único `highlights.json` (array legível `{ "ref", "color", "tag" }`) — formato
/// aberto e exportável (a serialização vive no core).
///
/// **Gating (como [`Note`]/[`CrossRef`]):** o tipo-fonte
/// `userdata::highlights::Highlight` é `embedded`-only → Record puro em **todos** os
/// alvos ([`Reference`]/`String`/`Option<String>`), [`From`]
/// `#[cfg(not(target_arch = "wasm32"))]`. Construída **somente** via [`From`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Highlight {
    /// Referência canônica marcada (book/chapter/verses).
    pub reference: Reference,
    /// Cor da marcação — nome livre do usuário (ex.: `"yellow"`).
    pub color: String,
    /// Etiqueta opcional do usuário (ex.: `"salvação"`).
    pub tag: Option<String>,
}

#[cfg(not(target_arch = "wasm32"))]
impl From<the_light_core::userdata::highlights::Highlight> for Highlight {
    fn from(h: the_light_core::userdata::highlights::Highlight) -> Self {
        Highlight {
            reference: h.reference.into(),
            color: h.color,
            tag: h.tag,
        }
    }
}

/// Cria ou substitui a **nota** (Markdown) de uma referência, delegando ao core.
///
/// Pipeline no **nativo**: `reference::parse_reference(&reference)` (canonicaliza; PT e
/// EN caem na mesma nota) → `userdata::notes::NoteStore::new(data_dir/"notes")` →
/// `NoteStore::put(&ref, &body)` (**escrita atômica**; cria/substitui o `.md`). **Nenhum**
/// I/O de arquivo ou slug de referência é reimplementado aqui (vive no core). O `body` é
/// **texto livre do usuário** (anti-alucinação não se aplica). Offline-first: só I/O
/// local em `data_dir` — **nunca** toca `bible.sqlite` (sem `db_path`).
///
/// A função **não verifica** se o versículo existe em algum banco bíblico: uma `String`
/// que **não parseia** como referência → [`CoreError`] (antes de qualquer I/O); uma
/// referência **sintaticamente válida** é sempre aceita (é responsabilidade da UI/F1.11
/// só oferecer notas em referências reais).
///
/// **Gating por alvo (ver ADR-0010):** corpo que toca `userdata`
/// `cfg(not(target_arch = "wasm32"))`; stub web retornando [`CoreError`] (paridade web =
/// F1.16), sem arrastar `userdata` para o grafo wasm.
#[uniffi::export]
pub fn put_note(data_dir: String, reference: String, body: String) -> Result<(), CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;
        let store = the_light_core::userdata::notes::NoteStore::new(
            std::path::Path::new(&data_dir).join("notes"),
        );
        store
            .put(&reference, &body)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (data_dir, reference, body);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Lê a **nota** de uma referência (se existir), delegando ao core.
///
/// Pipeline no **nativo**: parse da ref pelo core →
/// `NoteStore::new(data_dir/"notes").get(&ref)` → `Option<Note>` (ausente → `Ok(None)`,
/// **não** erro). **Nenhum** I/O é reimplementado. Referência **válida** sem nota →
/// `Ok(None)`; `String` que não parseia → [`CoreError`]. Offline-first; sem `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo `cfg(not(target_arch = "wasm32"))`; stub web
/// retornando [`CoreError`].
#[uniffi::export]
pub fn get_note(data_dir: String, reference: String) -> Result<Option<Note>, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;
        let store = the_light_core::userdata::notes::NoteStore::new(
            std::path::Path::new(&data_dir).join("notes"),
        );
        let note = store.get(&reference).map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })?;
        Ok(note.map(Note::from))
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (data_dir, reference);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Remove a **nota** de uma referência (idempotente), delegando ao core.
///
/// Pipeline no **nativo**: parse da ref pelo core →
/// `NoteStore::new(data_dir/"notes").delete(&ref)` → `true` se havia nota, `false` se
/// não havia (**idempotente**, não erro). **Nenhum** I/O é reimplementado. `String` que
/// não parseia → [`CoreError`]. Offline-first; sem `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo `cfg(not(target_arch = "wasm32"))`; stub web
/// retornando [`CoreError`].
#[uniffi::export]
pub fn delete_note(data_dir: String, reference: String) -> Result<bool, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;
        let store = the_light_core::userdata::notes::NoteStore::new(
            std::path::Path::new(&data_dir).join("notes"),
        );
        store.delete(&reference).map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (data_dir, reference);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Lista todas as **notas** de um `data_dir`, ordenadas por referência canônica,
/// delegando ao core.
///
/// Pipeline no **nativo**: `NoteStore::new(data_dir/"notes").list()` → `Vec<Note>`
/// (**ordenada** por book/chapter/verse; diretório `notes/` ausente → `Vec` **vazio**,
/// não erro; `.md` não-reconhecível é ignorado). **Nenhuma** ordenação/serialização é
/// reimplementada aqui. Offline-first; sem `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo `cfg(not(target_arch = "wasm32"))`; stub web
/// retornando [`CoreError`].
#[uniffi::export]
pub fn list_notes(data_dir: String) -> Result<Vec<Note>, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let store = the_light_core::userdata::notes::NoteStore::new(
            std::path::Path::new(&data_dir).join("notes"),
        );
        let notes = store.list().map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })?;
        Ok(notes.into_iter().map(Note::from).collect())
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = data_dir;
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Adiciona (ou substitui) uma **marcação** (highlight) por referência, delegando ao
/// core.
///
/// Pipeline no **nativo** (modelo **load → mutate → save**): parse da ref pelo core →
/// `HighlightStore::load(data_dir/"highlights.json")` → `add(Highlight { ref, color,
/// tag })` (**substitui** a marcação de mesma referência, não duplica) → `save()`
/// (**escrita atômica** do arquivo inteiro). **Nenhum** JSON é montado à mão (vive no
/// core). Cada chamada abre um store novo do disco → a persistência é provada relendo de
/// **outro handle**. `color`/`tag` são **dados do usuário**. `String` que não parseia →
/// [`CoreError`]. Offline-first; sem `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo `cfg(not(target_arch = "wasm32"))`; stub web
/// retornando [`CoreError`].
#[uniffi::export]
pub fn add_highlight(
    data_dir: String,
    reference: String,
    color: String,
    tag: Option<String>,
) -> Result<(), CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;
        let path = std::path::Path::new(&data_dir).join("highlights.json");
        let mut store =
            the_light_core::userdata::highlights::HighlightStore::load(&path).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;
        store.add(the_light_core::userdata::highlights::Highlight {
            reference,
            color,
            tag,
        });
        store.save().map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (data_dir, reference, color, tag);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Remove as **marcações** de uma referência (idempotente), delegando ao core.
///
/// Pipeline no **nativo** (load → mutate → save): parse da ref pelo core →
/// `HighlightStore::load(data_dir/"highlights.json")` → `remove(&ref)` (devolve quantas
/// saíram, `usize` → `u32` porque UniFFI não tem `usize`) → `save()`. **Idempotente**:
/// remover uma referência ausente → `0` (não erro). **Nenhum** JSON é reimplementado.
/// `String` que não parseia → [`CoreError`]. Offline-first; sem `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo `cfg(not(target_arch = "wasm32"))`; stub web
/// retornando [`CoreError`].
#[uniffi::export]
pub fn remove_highlight(data_dir: String, reference: String) -> Result<u32, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;
        let path = std::path::Path::new(&data_dir).join("highlights.json");
        let mut store =
            the_light_core::userdata::highlights::HighlightStore::load(&path).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;
        let removed = store.remove(&reference);
        store.save().map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })?;
        Ok(removed as u32)
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (data_dir, reference);
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// Lista todas as **marcações** (highlights) de um `data_dir`, delegando ao core.
///
/// Pipeline no **nativo**: `HighlightStore::load(data_dir/"highlights.json").list()` →
/// `Vec<Highlight>` (arquivo ausente → `Vec` **vazio**, não erro; entradas com referência
/// inválida são ignoradas pelo core). **Nenhuma** desserialização é reimplementada aqui.
/// Offline-first; sem `db_path`.
///
/// **Gating por alvo (ver ADR-0010):** corpo `cfg(not(target_arch = "wasm32"))`; stub web
/// retornando [`CoreError`].
#[uniffi::export]
pub fn list_highlights(data_dir: String) -> Result<Vec<Highlight>, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let path = std::path::Path::new(&data_dir).join("highlights.json");
        let store =
            the_light_core::userdata::highlights::HighlightStore::load(&path).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;
        Ok(store.list().iter().cloned().map(Highlight::from).collect())
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = data_dir;
        Err(CoreError::Generic {
            message: "store local indisponível no alvo web (F0.10: wa-sqlite+OPFS)".to_string(),
        })
    }
}

/// A resposta de uma **pergunta ancorada** (`ask`), na fronteira UniFFI.
///
/// **Separa explicitamente** o que vem do **store local** do que vem do **modelo**
/// — a anti-alucinação materializada no contrato (SPEC §6.2):
/// - [`cited_text`](Self::cited_text): a passagem **numerada, verbatim do store
///   local** (via `ai::numbered_passage`), **nunca** produzida/editada pelo LLM;
/// - [`interpretation`](Self::interpretation): a saída do **modelo** (aqui o
///   `MockLlmProvider`), que apenas **interpreta** o texto citado;
/// - [`reference`](Self::reference): a referência **canônica** (`parse_reference`);
/// - [`provider`](Self::provider)/[`model`](Self::model): identificação do
///   provedor/modelo usado (ex.: `"mock"` / `"mock-1"`).
///
/// Record **puro** (só [`Reference`]/`String`), definido em **todos** os alvos.
/// É montado **na mão** por [`ask_anchored`] (não há um único tipo-fonte do core a
/// converter: `ai::ask` devolve só a `String` da interpretação) — por isso **não**
/// há um `From<ai::…>` a gatear como em [`CrossRef`]/[`Note`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AiAnswer {
    /// Referência canônica da passagem ancorada (book/chapter/verses).
    pub reference: Reference,
    /// Passagem **numerada, verbatim do store local** (uma linha por versículo,
    /// `"{n} {texto}"`). Anti-alucinação: **nunca** vem do LLM.
    pub cited_text: String,
    /// Interpretação produzida pelo **modelo** (aqui o mock) — texto do LLM, não
    /// bíblico. Separado do [`cited_text`](Self::cited_text).
    pub interpretation: String,
    /// Nome do provedor usado (ex.: `"mock"`), via `LlmProvider::name()`.
    pub provider: String,
    /// Modelo usado (ex.: `"mock-1"`), via `LlmProvider::model()`.
    pub model: String,
}

/// **Pergunta ancorada** (`ask`) sobre uma passagem, delegando à camada de IA do
/// `the-light-core` (RAG leve, BYOK).
///
/// Pipeline no **nativo** (tudo no core — uma fonte da verdade):
/// 1. `reference::parse_reference(&reference)` canonicaliza a referência (PT/EN →
///    a mesma `Reference`), como em [`get_passage`];
/// 2. lê a `Passage` **verbatim do store** pela **mesma** rota da F1.2
///    (`Store::open` → `EmbeddedSource::passage(&ref, &TranslationId)`);
/// 3. `ai::numbered_passage(&passage)` → texto **numerado** (o `cited_text`);
/// 4. `ai::ask_context(&label, &numbered, &[])` monta o bloco RAG (rótulo da
///    referência via `reference::format_reference`; `related` vazio ⇒ `"(nenhuma)"`;
///    xrefs no contexto ficam p/ depois);
/// 5. `ai::build_provider(&provider_name, key, model)` — a **chave é argumento**
///    (BYOK); `"mock"` **não** faz rede nem exige chave;
/// 6. `ai::ask(provider, &question, &context, lang)` → **só a interpretação** (a
///    `String` do modelo);
/// 7. compõe [`AiAnswer`] separando `cited_text` (store) de `interpretation`
///    (modelo), com `provider`/`model` do `LlmProvider`.
///
/// **Nenhum** prompt/RAG/SQL é reimplementado aqui — tudo vive em `ai::study`/
/// store. Anti-alucinação: o texto do versículo vem **sempre do store** (verbatim);
/// o LLM só interpreta, recebendo o texto numerado como **contexto**. `lang`
/// aceita `"pt"|"en"` (e sinônimos, via `Lang::from_str`); valor não reconhecido →
/// **Pt** (default sensato p/ o app PT-first) — sem panicar.
///
/// **BYOK / offline-first:** com `provider_name = "mock"` e `key = None` (esta
/// tarefa) não há rede nem chave; nenhuma chave é logada. A chave real do usuário
/// (Gemini/etc.) e a rede opt-in são F2.6.
///
/// **Gating por alvo (ver ADR-0010):** exportada em todos os alvos, mas o corpo que
/// toca `ai`/store é `cfg(not(target_arch = "wasm32"))`; no **web**, stub que
/// retorna [`CoreError`] (paridade web de IA = F2.7), sem arrastar `ai`/`reqwest`/
/// `rusqlite` para o grafo wasm.
#[uniffi::export]
#[allow(clippy::too_many_arguments)]
pub fn ask_anchored(
    db_path: String,
    translation: String,
    reference: String,
    question: String,
    provider_name: String,
    key: Option<String>,
    model: Option<String>,
    lang: String,
) -> Result<AiAnswer, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para chamar `.passage(...)` em `EmbeddedSource` (como em
        // `get_passage`). `name()/model()` do `dyn LlmProvider` dispensam import.
        use the_light_core::source::BibleSource;

        // 1) Referência canônica (delegada ao core), como em `get_passage`.
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;

        // 2) Idioma de exibição/resposta (`"pt"|"en"` + sinônimos); default Pt.
        let lang = lang
            .parse::<the_light_core::model::Lang>()
            .unwrap_or(the_light_core::model::Lang::Pt);

        // 3) Passagem VERBATIM do store, pela MESMA rota da F1.2 (anti-alucinação).
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation_id = the_light_core::model::TranslationId::new(translation);
        let passage =
            source
                .passage(&reference, &translation_id)
                .map_err(|e| CoreError::Generic {
                    message: e.to_string(),
                })?;

        // 4) Texto numerado (store) + bloco de contexto RAG — funções PURAS do core.
        let cited_text = the_light_core::ai::numbered_passage(&passage);
        let label = the_light_core::reference::format_reference(&reference, lang);
        let context = the_light_core::ai::ask_context(&label, &cited_text, &[]);

        // 5) Provedor (BYOK: a chave é argumento; "mock" = sem rede/chave).
        let provider =
            the_light_core::ai::build_provider(&provider_name, key, model).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;

        // 6) Interpretação = SÓ a saída do modelo (o LLM nunca gera texto bíblico).
        let interpretation = the_light_core::ai::ask(provider.as_ref(), &question, &context, lang)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;

        // 7) Contrato anti-alucinação: cited_text (store) separado da interpretation.
        Ok(AiAnswer {
            reference: reference.into(),
            cited_text,
            interpretation,
            provider: provider.name().to_string(),
            model: provider.model().to_string(),
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        // Stub web: o módulo `ai` do core é `embedded`-only (nativo). A paridade web
        // de IA é a F2.7; até lá, falha explícita — sem tocar `ai`/store/`rusqlite`/
        // `reqwest` (mantém o grafo wasm puro).
        let _ = (
            db_path,
            translation,
            reference,
            question,
            provider_name,
            key,
            model,
            lang,
        );
        Err(CoreError::Generic {
            message: "ai não disponível no alvo web (F2.7)".to_string(),
        })
    }
}

/// Callback de **streaming de tokens** da interpretação (D4), na fronteira UniFFI.
///
/// Interface de callback exportada via `#[uniffi::export(callback_interface)]`: a UI
/// (Expo/nativo) fornece uma implementação **do lado foreign**, e o Rust a invoca a
/// cada incremento de texto durante [`ask_anchored_stream`]. A assinatura
/// (`token: String`) é compatível com UniFFI/JSI (o `ubrn` gera o wrapper).
///
/// **Anti-alucinação:** os tokens transmitidos são **da interpretação do modelo**
/// (a saída do LLM/mock), **nunca** do texto bíblico — este vem do store e viaja
/// separado, verbatim, em [`AiAnswer::cited_text`]. `Send + Sync` porque a
/// implementação foreign atravessa a fronteira e pode ser chamada de outra thread.
#[uniffi::export(callback_interface)]
pub trait AiTokenCallback: Send + Sync {
    /// Recebe **um incremento** (token/chunk) da interpretação. Com o default de
    /// streaming do core, é chamado **uma vez** com a resposta inteira; provedores
    /// de rede reais (F2.6) o chamam múltiplas vezes (SSE).
    fn on_token(&self, token: String);
}

/// **Pergunta ancorada com streaming** (`ask` + D4), delegando à camada de IA do
/// `the-light-core` (RAG leve, BYOK) e transmitindo a interpretação por
/// [`AiTokenCallback`].
///
/// Monta o **mesmo contexto ancorado** de [`ask_anchored`] (passagem **verbatim do
/// store** via `EmbeddedSource::passage` → `ai::numbered_passage` → `ai::ask_context`)
/// e então chama `LlmProvider::complete_stream(system, user, on_token)` do core em vez
/// de `ai::ask`. O **default do core** de `complete_stream` é **não-quebrante**: chama
/// `complete` e emite a resposta inteira **uma única vez** pelo callback, devolvendo
/// também a `String` completa — que vira a [`AiAnswer::interpretation`]. Provedores de
/// rede reais (F2.6) sobrescrevem com streaming real (SSE) **sem mudar** esta fronteira.
///
/// **Mapeamento system/user (decisão registrada):** o core **não** expõe um
/// `ask_stream` nem um construtor público do prompt de `ai::ask` (o `system` fixo de
/// `ask` é interno). Para **não reimplementar** a lógica do core (regra "uma fonte da
/// verdade"), esta fronteira **compõe apenas peças públicas**: `system` = o **bloco de
/// contexto ancorado** (`ask_context`, derivado do store) e `user` = a `question`. Com
/// o **mock** isso rende **exatamente** a mesma resposta canônica que `ai::ask`
/// (invariante ao texto bíblico) — a paridade fina de prompt com provedores de rede é
/// F2.6. Nenhum texto bíblico é gerado: o `cited_text` é do store; o LLM só interpreta.
///
/// **Roteamento de provedor (F2.3):** `provider_name` é repassado a
/// `ai::build_provider`, que agora conhece `"gemini"` (além de `mock`/`openai`/
/// `anthropic`/`ollama`). BYOK: a `key` é argumento; `"mock"` não faz rede nem exige
/// chave; `"gemini"`/etc. **sem** chave → [`CoreError`] (NoKey) **sem rede**.
///
/// **Gating por alvo (ver ADR-0010):** exportada em todos os alvos, mas o corpo que
/// toca `ai`/store é `cfg(not(target_arch = "wasm32"))`; no **web**, stub que retorna
/// [`CoreError`] (streaming web = F2.7), sem arrastar `ai`/`reqwest`/`rusqlite` para o
/// grafo wasm. O callback foreign é consumido no stub (args descartados).
#[uniffi::export]
#[allow(clippy::too_many_arguments)]
pub fn ask_anchored_stream(
    db_path: String,
    translation: String,
    reference: String,
    question: String,
    provider_name: String,
    key: Option<String>,
    model: Option<String>,
    lang: String,
    on_token: Box<dyn AiTokenCallback>,
) -> Result<AiAnswer, CoreError> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        // Trait em escopo para `.passage(...)` em `EmbeddedSource` (como em
        // `ask_anchored`). Os métodos de `dyn LlmProvider` (`complete_stream`/`name`/
        // `model`) dispensam import (são do trait object).
        use the_light_core::source::BibleSource;

        // 1) Referência canônica (delegada ao core).
        let reference = the_light_core::reference::parse_reference(&reference).map_err(|e| {
            CoreError::Generic {
                message: e.to_string(),
            }
        })?;

        // 2) Idioma de exibição/resposta (`"pt"|"en"` + sinônimos); default Pt.
        let lang = lang
            .parse::<the_light_core::model::Lang>()
            .unwrap_or(the_light_core::model::Lang::Pt);

        // 3) Passagem VERBATIM do store, pela MESMA rota da F1.2/F2.1 (anti-alucinação).
        let store =
            the_light_core::store::Store::open(&db_path).map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;
        let source = the_light_core::source::EmbeddedSource::new(&store);
        let translation_id = the_light_core::model::TranslationId::new(translation);
        let passage =
            source
                .passage(&reference, &translation_id)
                .map_err(|e| CoreError::Generic {
                    message: e.to_string(),
                })?;

        // 4) Texto numerado (store) + bloco de contexto RAG — funções PURAS do core.
        let cited_text = the_light_core::ai::numbered_passage(&passage);
        let label = the_light_core::reference::format_reference(&reference, lang);
        let context = the_light_core::ai::ask_context(&label, &cited_text, &[]);

        // 5) Provedor (BYOK): "gemini"/etc. sem chave → NoKey (sem rede); "mock" ok.
        let provider =
            the_light_core::ai::build_provider(&provider_name, key, model).map_err(|e| {
                CoreError::Generic {
                    message: e.to_string(),
                }
            })?;

        // 6) Streaming: system = contexto ancorado (store); user = pergunta. O callback
        //    transmite tokens da INTERPRETAÇÃO (não do texto bíblico). O default do core
        //    emite a resposta inteira 1× e devolve a String completa.
        let mut sink = |tok: &str| on_token.on_token(tok.to_string());
        let interpretation = provider
            .complete_stream(&context, &question, &mut sink)
            .map_err(|e| CoreError::Generic {
                message: e.to_string(),
            })?;

        // 7) Contrato anti-alucinação: cited_text (store) separado da interpretation.
        Ok(AiAnswer {
            reference: reference.into(),
            cited_text,
            interpretation,
            provider: provider.name().to_string(),
            model: provider.model().to_string(),
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        // Stub web: o módulo `ai` do core é `embedded`-only (nativo). Streaming no web é
        // a F2.7; até lá, falha explícita — sem tocar `ai`/store/`rusqlite`/`reqwest`
        // (mantém o grafo wasm puro). O callback foreign é consumido aqui.
        let _ = (
            db_path,
            translation,
            reference,
            question,
            provider_name,
            key,
            model,
            lang,
            on_token,
        );
        Err(CoreError::Generic {
            message: "streaming de ai não disponível no alvo web (F2.7)".to_string(),
        })
    }
}

/// Um **versículo de entrada** da fronteira web de IA ([`ai_web_prepare`]), na
/// fronteira UniFFI.
///
/// O `text` vem **verbatim do store web** (subset `reading-sample.sqlite`, F1.13) —
/// a fronteira web de IA **não** lê DB no wasm (o módulo `store`/`rusqlite` é
/// `embedded`-only, ADR-0005). Anti-alucinação: o par `(number, text)` é a **fonte
/// local** que o Rust (`ai-pure`) numera para o `cited_text`; o LLM **nunca** gera
/// texto bíblico. Record **puro** (só `u16`/`String`), presente em todos os alvos.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AiVerseInput {
    /// Número do versículo (ex.: `16`).
    pub number: u16,
    /// Texto do versículo, **verbatim** da tradução no store web.
    pub text: String,
}

/// O **request preparado** de uma pergunta ancorada no web (saída de
/// [`ai_web_prepare`]), na fronteira UniFFI.
///
/// Carrega **tudo que o transporte (`fetch`, no TS) precisa** para chamar o
/// provedor, montado **em Rust `ai-pure`** — a MESMA impl do nativo, logo **zero
/// drift**:
/// - [`cited_text`](Self::cited_text): a passagem numerada, **verbatim do store**
///   (via `ai::numbered_verses`) — **nunca** do LLM;
/// - [`system`](Self::system)/[`user`](Self::user): os prompts **EXATOS** que o
///   nativo enviaria, capturados pela rota pública `ai::ask` (ver
///   [`ai_web_prepare`]); o texto bíblico entra no `user` só como **contexto**
///   ancorado, separado do `cited_text` que a UI exibe;
/// - [`provider`](Self::provider)/[`model`](Self::model): o provedor e o modelo
///   resolvido (default do provedor se não informado).
///
/// Record **puro** ([`Reference`]/`String`), presente em todos os alvos.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AiWebRequest {
    /// Referência canônica da passagem ancorada.
    pub reference: Reference,
    /// Passagem numerada, **verbatim do store** (via `ai::numbered_verses`).
    pub cited_text: String,
    /// System prompt EXATO do `ai-pure` (mesmo do nativo; anti-alucinação).
    pub system: String,
    /// User prompt EXATO do `ai-pure` (pergunta + contexto ancorado).
    pub user: String,
    /// Provedor a usar no transporte (ex.: `"gemini"`).
    pub provider: String,
    /// Modelo resolvido (default do provedor se `model` não informado).
    pub model: String,
}

/// Provedor de **captura** interno (não exportado): implementa
/// [`the_light_core::ai::LlmProvider`] **só** para capturar os prompts `system`/
/// `user` EXATOS que `ai::ask` monta. O helper `ask_user_prompt` do core é
/// **privado**, então a única rota pública que rende o par exato (com o mesmo
/// `ask_system_prompt` + a mesma moldura de `user`) é chamar `ask` sobre um provedor
/// que **não** faz rede: `complete` grava `(system, user)` e devolve vazio. Sem
/// `unsafe`, sem I/O; `RefCell` porque `complete` recebe `&self`.
struct CaptureProvider {
    provider: String,
    model: String,
    captured: std::cell::RefCell<Option<(String, String)>>,
}

impl the_light_core::ai::LlmProvider for CaptureProvider {
    fn name(&self) -> &str {
        &self.provider
    }
    fn model(&self) -> &str {
        &self.model
    }
    fn complete(&self, system: &str, user: &str) -> the_light_core::ai::Result<String> {
        *self.captured.borrow_mut() = Some((system.to_string(), user.to_string()));
        Ok(String::new())
    }
}

/// **Prepara** uma pergunta ancorada para o transporte web (`fetch`), delegando a
/// montagem de prompt/RAG/citação às partes **puras** do `ai` do `the-light-core`
/// (feature `ai-pure`).
///
/// Pipeline (**cfg-free** — só a superfície `pub` do `ai-pure`, disponível no wasm E
/// no nativo; **nenhum** store/`rusqlite`/`reqwest`, então o grafo wasm segue puro):
/// 1. `reference::parse_reference(&reference)` canonicaliza (PT/EN → a mesma ref);
/// 2. `lang.parse::<Lang>()` (default `Pt`);
/// 3. `cited_text = ai::numbered_verses(verses)` — os `verses` vêm **verbatim do
///    store web** (anti-alucinação; a fronteira não lê DB no wasm), numerados pela
///    **mesma** fn do nativo (`numbered_passage` chama `numbered_verses`);
/// 4. `context = ai::ask_context(format_reference(&ref, lang), cited_text, &[])`;
/// 5. `model` = o informado (não-vazio) ou `ai::default_model(provider)`;
/// 6. **system+user EXATOS** via um [`CaptureProvider`] dirigido por
///    `ai::ask(&cap, &question, &context, lang)` — captura o par que o nativo
///    enviaria (o `ask_user_prompt` do core é privado; `ask` é a rota pública).
///
/// Anti-alucinação **com zero drift**: `cited_text` do store; prompt/citação do
/// MESMO Rust `ai-pure` no web e no nativo. O transporte (`fetch` + corpo/parse do
/// provedor) fica no TS (ADR-0025). Sem rede aqui.
#[uniffi::export]
pub fn ai_web_prepare(
    reference: String,
    question: String,
    provider_name: String,
    model: Option<String>,
    lang: String,
    verses: Vec<AiVerseInput>,
) -> Result<AiWebRequest, CoreError> {
    // 1) Referência canônica (delegada ao core), como em `ask_anchored`.
    let reference =
        the_light_core::reference::parse_reference(&reference).map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })?;

    // 2) Idioma de exibição/resposta (`"pt"|"en"` + sinônimos); default Pt.
    let lang = lang
        .parse::<the_light_core::model::Lang>()
        .unwrap_or(the_light_core::model::Lang::Pt);

    // 3) cited_text: VERBATIM do store (verses), numerado pela MESMA fn do nativo.
    let cited_text =
        the_light_core::ai::numbered_verses(verses.iter().map(|v| (v.number, v.text.as_str())));

    // 4) Bloco de contexto RAG — funções PURAS do core (rótulo canônico + numerado).
    let label = the_light_core::reference::format_reference(&reference, lang);
    let context = the_light_core::ai::ask_context(&label, &cited_text, &[]);

    // 5) Modelo: o informado (não-vazio) ou o default do provedor (`ai-pure`).
    let model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| the_light_core::ai::default_model(&provider_name).to_string());

    // 6) system+user EXATOS via a rota pública `ask` (ask_user_prompt é privado).
    let cap = CaptureProvider {
        provider: provider_name.clone(),
        model: model.clone(),
        captured: std::cell::RefCell::new(None),
    };
    // `ask` chama `cap.complete(system, user)`, que grava os prompts e devolve "".
    let _ = the_light_core::ai::ask(&cap, &question, &context, lang);
    let (system, user) = cap
        .captured
        .into_inner()
        .ok_or_else(|| CoreError::Generic {
            message: "falha ao capturar o prompt ancorado (ai_web_prepare)".to_string(),
        })?;

    Ok(AiWebRequest {
        reference: reference.into(),
        cited_text,
        system,
        user,
        provider: provider_name,
        model,
    })
}

/// **Finaliza** uma pergunta ancorada no web: aplica a **citação anti-alucinação em
/// Rust** (mesma impl do nativo) sobre a `interpretation` do `fetch` e monta o
/// [`AiAnswer`], mantendo o `cited_text` do **store** separado da interpretação do
/// LLM.
///
/// Pipeline (**cfg-free** — só `ai-pure`): re-parseia `reference` (canônica) e aplica
/// `citation::rewrite_anchors(&interpretation, &HashSet::new())` (limpeza de âncoras
/// de citação inválidas — a etapa de citação em Rust; no `ask` simples o conjunto de
/// âncoras válidas é vazio ⇒ remove âncoras espúrias, no-op sobre texto sem âncoras).
/// O `cited_text` (store) e a `interpretation` (LLM) viajam **separados** no
/// [`AiAnswer`] — o LLM **nunca** gera texto bíblico.
#[uniffi::export]
pub fn ai_web_finalize(
    reference: String,
    cited_text: String,
    provider: String,
    model: String,
    interpretation: String,
) -> Result<AiAnswer, CoreError> {
    let reference =
        the_light_core::reference::parse_reference(&reference).map_err(|e| CoreError::Generic {
            message: e.to_string(),
        })?;
    // Citação anti-alucinação em Rust (mesma impl do nativo): remove âncoras
    // `[V:…]`/`[W:…]` que não estejam no conjunto de válidas (vazio no `ask` simples).
    let interpretation = the_light_core::ai::citation::rewrite_anchors(
        &interpretation,
        &std::collections::HashSet::new(),
    );
    Ok(AiAnswer {
        reference: reference.into(),
        cited_text,
        interpretation,
        provider,
        model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_constant_pong() {
        assert_eq!(ping(), "pong");
    }

    #[test]
    fn ping_checked_ok_returns_pong() {
        assert_eq!(ping_checked(true).unwrap(), "pong");
    }

    #[test]
    fn ping_checked_err_uses_core_error() {
        let err = ping_checked(false).unwrap_err();
        assert!(matches!(err, CoreError::Generic { .. }));
        assert!(err.to_string().contains("core error"));
    }

    #[test]
    fn pt_and_en_resolve_to_same_reference() {
        // "Jo 3.16" (PT, separador `.`) e "John 3:16" (EN, separador `:`)
        // devem cair na MESMA referência canônica via the-light-core.
        let pt = parse_reference("Jo 3.16".to_string()).expect("PT deve parsear");
        let en = parse_reference("John 3:16".to_string()).expect("EN deve parsear");

        // Campos livro/capítulo/versículo idênticos.
        assert_eq!(pt.book, en.book, "mesmo livro");
        assert_eq!(pt.chapter, en.chapter, "mesmo capítulo");
        assert_eq!(pt.verses, en.verses, "mesmo intervalo de versículos");
        assert_eq!(pt, en, "referência idêntica");

        // Sanidade: João = livro 43, capítulo 3, versículo único 16.
        assert_eq!(pt.book, 43);
        assert_eq!(pt.chapter, 3);
        assert_eq!(pt.verses, VerseRange::Single { verse: 16 });
    }

    #[test]
    fn invalid_input_maps_to_core_error() {
        let err = parse_reference("isto nao e referencia".to_string())
            .expect_err("entrada inválida deve falhar");
        // O erro do core (`ReferenceError`) é mapeado para `CoreError`.
        assert!(matches!(err, CoreError::Generic { .. }));
        assert!(err.to_string().contains("core error"));
    }
}

/// Testes da camada de store (`get_passage`), **apenas no nativo**: o host de
/// teste (`aarch64-apple-darwin`) tem a feature `embedded` ligada (matriz por
/// alvo, ADR-0005), então `Store`/`EmbeddedSource` existem. No wasm este módulo
/// nem é compilado.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod store_tests {
    use super::*;

    /// Sample versionado em `assets/data/sample.sqlite` (subset KJV de domínio
    /// público), gerado de forma reprodutível por `scripts/gen-sample-db.sh`
    /// (schema vindo das migrações do `the-light-core`). Resolvido a partir de
    /// `CARGO_MANIFEST_DIR` (= `core/`) para independer do diretório de execução.
    const SAMPLE_DB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../assets/data/sample.sqlite");

    /// João 3:16 na KJV (domínio público) — texto **verbatim** esperado no store.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

    #[test]
    fn get_passage_reads_john_3_16_verbatim_from_sample() {
        let passage = get_passage(
            SAMPLE_DB.to_string(),
            "John 3:16".to_string(),
            "kjv".to_string(),
        )
        .expect("get_passage deve ler João 3:16 do sample.sqlite");

        // Exatamente um versículo na passagem.
        assert_eq!(passage.verses.len(), 1, "esperado exatamente 1 versículo");
        let verse = &passage.verses[0];

        // Anti-alucinação: o texto vem **verbatim do store local** (KJV).
        assert_eq!(verse.text, JOHN_3_16_KJV, "texto deve ser KJV verbatim");

        // Referência canônica: João = livro 43, capítulo 3, versículo 16.
        assert_eq!(verse.reference.book, 43, "João é o livro 43");
        assert_eq!(verse.reference.chapter, 3, "capítulo 3");
        assert_eq!(
            verse.reference.verses,
            VerseRange::Single { verse: 16 },
            "versículo único 16"
        );
        assert_eq!(verse.translation, "kjv", "tradução kjv");

        // A referência da passagem espelha a pedida.
        assert_eq!(passage.reference.book, 43);
        assert_eq!(passage.reference.chapter, 3);
    }

    #[test]
    fn get_passage_unknown_translation_maps_to_core_error() {
        // Tradução inexistente no store → erro do core mapeado para CoreError.
        let err = get_passage(
            SAMPLE_DB.to_string(),
            "John 3:16".to_string(),
            "nao-existe".to_string(),
        )
        .expect_err("tradução inexistente deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));
    }

    #[test]
    fn get_passage_invalid_reference_maps_to_core_error() {
        // Referência inválida falha no parse (delegado ao core) antes do store.
        let err = get_passage(
            SAMPLE_DB.to_string(),
            "isto nao e referencia".to_string(),
            "kjv".to_string(),
        )
        .expect_err("referência inválida deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));
    }
}

/// Testes de **leitura/navegação** da F1.2 (`list_translations`/`list_books`/
/// `get_chapter`/`chapter_count`), **apenas no nativo** (host com a feature
/// `embedded`, ADR-0005). As asserções primárias são **offline** e
/// **determinísticas**: constroem um fixture KJV pequeno-porém-multi-capítulo num
/// diretório temporário (schema = migrações do core via `Store::open`; DML de
/// domínio público), e leem **de volta** pela fronteira (round-trip), sem
/// depender de `bible.sqlite` nem de rede.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod read_tests {
    use super::*;
    use std::path::PathBuf;

    // ── Texto KJV **verbatim** (domínio público) — usado SÓ no fixture/assert do
    //    teste; nenhum texto bíblico é gerado em produção (anti-alucinação). ─────
    /// João 3:16 — King James Version.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    /// João 3:17 — King James Version.
    const JOHN_3_17_KJV: &str = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";
    /// João 21:1 — King James Version (semeado p/ que `max(chapter)` do fixture = 21).
    const JOHN_21_1_KJV: &str = "After these things Jesus shewed himself again to the disciples at the sea of Tiberias; and on this wise shewed he himself.";

    /// `bible.sqlite` (gerado-ignorado, ADR-0013): existe localmente após a F1.1,
    /// mas é opcional — usado só para asserções **bônus** guardadas por `exists()`.
    const BIBLE_DB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../assets/data/bible.sqlite");

    /// Banco temporário do fixture: remove o arquivo no `Drop` (mesmo em panic).
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            // Remove eventuais sidecars do SQLite (WAL/SHM), se houver.
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f1_2-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture KJV determinístico: schema via migrações do core
    /// (`Store::open`) + DML de domínio público (setup de teste, não produto —
    /// como `embedded.rs::seeded_store`). Semeia João 3:16, 3:17 e 21:1.
    ///
    /// As strings inseridas são as `const`s KJV (sem aspas simples → seguras
    /// inline; nenhum schema é escrito à mão, apenas DML). A conexão é fechada
    /// (`store` sai de escopo) antes do round-trip pela fronteira.
    fn build_kjv_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture KJV");
            let conn = store.conn();

            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");

            for (chapter, verse, text) in [
                (3u16, 16u16, JOHN_3_16_KJV),
                (3, 17, JOHN_3_17_KJV),
                (21, 1, JOHN_21_1_KJV),
            ] {
                let sql = format!(
                    "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                     VALUES ('kjv',43,{chapter},{verse},'{text}')"
                );
                conn.execute(&sql, []).expect("inserir versículo João");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    #[test]
    fn list_translations_contains_kjv() {
        let db = build_kjv_fixture();
        let ts = list_translations(db.path()).expect("listar traduções do fixture");
        let kjv = ts
            .iter()
            .find(|t| t.id == "kjv")
            .expect("fixture contém a tradução kjv");
        // Campos adaptados do core (Lang::code()/License::as_str()), não inventados.
        assert_eq!(kjv.language, "en");
        assert_eq!(kjv.license, "public-domain");
        assert!(kjv.embeddable);
    }

    #[test]
    fn list_books_is_canonical_66_with_john() {
        // Função PURA: independe de banco (delega a reference::BOOKS).
        let books = list_books();
        assert_eq!(books.len(), 66, "cânon protestante = 66 livros");

        let john = books
            .iter()
            .find(|b| b.number == 43)
            .expect("livro 43 (João) presente");
        assert_eq!(john.name_en, "John");
        assert_eq!(john.name_pt, "João");
        assert_eq!(john.testament, Testament::New);
        assert_eq!(
            john.chapter_count, 21,
            "João tem 21 capítulos (canônico, version-independent)"
        );
    }

    #[test]
    fn get_chapter_reads_numbered_verses_verbatim() {
        let db = build_kjv_fixture();
        let passage = get_chapter(db.path(), "kjv".to_string(), 43, 3)
            .expect("ler João 3 do fixture (capítulo inteiro)");

        // Versículos numerados, em ordem crescente, incluindo 16 e 17.
        let nums: Vec<u16> = passage
            .verses
            .iter()
            .map(|v| match v.reference.verses {
                VerseRange::Single { verse } => verse,
                other => panic!("capítulo inteiro deve render versículos Single, veio {other:?}"),
            })
            .collect();
        assert!(
            nums.windows(2).all(|w| w[0] < w[1]),
            "versículos em ordem crescente: {nums:?}"
        );
        assert!(nums.contains(&16) && nums.contains(&17), "contém v16 e v17");

        // Anti-alucinação: o v16 vem **verbatim do store** (KJV, domínio público).
        let v16 = passage
            .verses
            .iter()
            .find(|v| v.reference.verses == VerseRange::Single { verse: 16 })
            .expect("João 3:16 presente");
        assert_eq!(v16.text, JOHN_3_16_KJV, "texto deve ser KJV verbatim");
        assert_eq!(v16.reference.book, 43);
        assert_eq!(v16.reference.chapter, 3);
        assert_eq!(v16.translation, "kjv");
    }

    #[test]
    fn chapter_count_reflects_store_max_chapter() {
        let db = build_kjv_fixture();
        // DB-backed: max(chapter) do fixture = 21 (João 21 foi semeado).
        assert_eq!(
            chapter_count(db.path(), "kjv".to_string(), 43).expect("contar capítulos de João"),
            21
        );
        // Livro não semeado → 0 (sem panic; comportamento do core).
        assert_eq!(
            chapter_count(db.path(), "kjv".to_string(), 1).expect("contar capítulos de Gênesis"),
            0
        );
    }

    #[test]
    fn error_paths_do_not_panic() {
        let db = build_kjv_fixture();

        // Tradução inexistente em get_chapter → CoreError (via core).
        let err = get_chapter(db.path(), "nao-existe".to_string(), 43, 3)
            .expect_err("tradução inexistente deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));

        // Capítulo ausente → Passage vazia (não é erro), sem panic.
        let empty = get_chapter(db.path(), "kjv".to_string(), 43, 99)
            .expect("capítulo ausente não deve panicar");
        assert!(empty.verses.is_empty(), "capítulo fora do alcance = vazio");

        // chapter_count de tradução inexistente → 0 (sem panic).
        assert_eq!(
            chapter_count(db.path(), "nao-existe".to_string(), 43)
                .expect("chapter_count não deve panicar"),
            0
        );
    }

    #[test]
    fn bonus_full_bible_db_when_present() {
        // BÔNUS, NÃO-REQUISITO: só roda se o `bible.sqlite` (gerado-ignorado)
        // existir localmente. As asserções primárias acima passam só com o
        // fixture, offline. Aqui apenas validamos o round-trip num corpus real.
        if !std::path::Path::new(BIBLE_DB).exists() {
            return;
        }
        let passage = get_chapter(BIBLE_DB.to_string(), "kjv".to_string(), 43, 3)
            .expect("ler João 3 do bible.sqlite");
        assert!(
            passage.verses.len() >= 17,
            "João 3 (KJV) tem muitos versículos; veio {}",
            passage.verses.len()
        );
        let v16 = passage
            .verses
            .iter()
            .find(|v| v.reference.verses == VerseRange::Single { verse: 16 })
            .expect("João 3:16 presente no corpus real");
        assert_eq!(v16.text, JOHN_3_16_KJV, "KJV verbatim no corpus real");
    }
}

/// Testes de **busca full-text** da F1.5 (`search`), **apenas no nativo** (host com
/// a feature `embedded`, ADR-0005). As asserções primárias são **offline** e
/// **determinísticas**: constroem um fixture pequeno num diretório temporário
/// (schema = migrações do core via `Store::open`; DML de domínio público) e —
/// crítico — **populam o índice `verses_fts`** com `verse_id` igual ao `verses.id`
/// (o schema do core **não** tem trigger que copie `verses` → `verses_fts`; sem
/// isso a busca volta vazia, como o próprio core faz em `search.rs::seeded`).
#[cfg(all(test, not(target_arch = "wasm32")))]
mod search_tests {
    use super::*;
    use std::path::PathBuf;

    // ── Textos **verbatim** (domínio público), usados SÓ no fixture/assert; nenhum
    //    texto bíblico é gerado em produção (anti-alucinação). ─────────────────────
    /// João 3:16 — King James Version (contém "God"/"world").
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    /// João 3:17 — King James Version (também contém "world" — p/ testar `limit`).
    const JOHN_3_17_KJV: &str = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";
    /// Gênesis 1:1 — Almeida (**acentuado**: prova `remove_diacritics`, `ceus`↔`céus`).
    const GENESIS_1_1_ALM: &str = "No princípio criou Deus os céus e a terra";

    /// `bible.sqlite` (gerado-ignorado, ADR-0013): opcional — só para asserção
    /// **bônus** guardada por `exists()`. As primárias passam só com o fixture.
    const BIBLE_DB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../assets/data/bible.sqlite");

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f1_5-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture de busca: schema via migrações do core (`Store::open`) +
    /// DML de domínio público (setup de teste, não produto). Insere em `verses`
    /// com `id` **explícito** e replica o mesmo `id` em `verses_fts.verse_id` (a
    /// busca faz `JOIN verses v ON v.id = verses_fts.verse_id`). Nenhum schema é
    /// escrito à mão; as `const`s não têm aspas simples → seguras inline em DML.
    fn build_search_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture de busca");
            let conn = store.conn();

            // Traduções de domínio público: KJV (en) e Almeida (pt).
            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");
            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('alm','ALM','Almeida','pt','public-domain',1)",
                [],
            )
            .expect("inserir tradução alm");

            // (id, tradução, livro, capítulo, versículo, texto).
            for (id, tid, book, chapter, verse, text) in [
                (1u16, "kjv", 43u16, 3u16, 16u16, JOHN_3_16_KJV),
                (2, "kjv", 43, 3, 17, JOHN_3_17_KJV),
                (3, "alm", 1, 1, 1, GENESIS_1_1_ALM),
            ] {
                let verse_sql = format!(
                    "INSERT INTO verses(id,translation_id,book_number,chapter,verse,text) \
                     VALUES ({id},'{tid}',{book},{chapter},{verse},'{text}')"
                );
                conn.execute(&verse_sql, []).expect("inserir versículo");
                // CRÍTICO: popular o índice FTS5 (sem trigger no schema do core).
                let fts_sql = format!(
                    "INSERT INTO verses_fts(text, translation_id, verse_id) \
                     VALUES ('{text}','{tid}',{id})"
                );
                conn.execute(&fts_sql, []).expect("popular verses_fts");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    #[test]
    fn search_finds_john_3_16_verbatim() {
        let db = build_search_fixture();
        let hits = search(db.path(), "God".to_string(), "kjv".to_string(), None, None)
            .expect("buscar 'God' na KJV");
        assert!(!hits.is_empty(), "esperado ≥1 hit para 'God'");

        // Há um hit em João 3:16, com a referência canônica e o texto KJV verbatim.
        let hit = hits
            .iter()
            .find(|h| h.reference.verses == VerseRange::Single { verse: 16 })
            .expect("João 3:16 presente nos hits");
        assert_eq!(hit.reference.book, 43, "João é o livro 43");
        assert_eq!(hit.reference.chapter, 3, "capítulo 3");
        assert_eq!(hit.translation, "kjv", "tradução kjv");
        assert_eq!(
            hit.text, JOHN_3_16_KJV,
            "texto deve ser KJV verbatim (anti-alucinação)"
        );
    }

    #[test]
    fn search_is_accent_insensitive_in_pt() {
        let db = build_search_fixture();
        // 'ceus' (sem acento) deve casar 'céus' (acentuado) via remove_diacritics 2.
        let hits = search(db.path(), "ceus".to_string(), "alm".to_string(), None, None)
            .expect("buscar 'ceus' na Almeida");
        assert!(!hits.is_empty(), "esperado ≥1 hit acento-insensível");
        let hit = &hits[0];
        assert_eq!(hit.reference.book, 1, "Gênesis é o livro 1");
        assert!(
            hit.text.contains("céus"),
            "texto verbatim acentuado do store: {}",
            hit.text
        );
    }

    #[test]
    fn search_no_match_and_blank_return_empty_without_panic() {
        let db = build_search_fixture();

        // Query que não casa nada → Vec vazio (não Err, não panic).
        let none = search(
            db.path(),
            "zzqxnomatch".to_string(),
            "kjv".to_string(),
            None,
            None,
        )
        .expect("query sem correspondência não deve panicar");
        assert!(none.is_empty(), "sem correspondência = vazio");

        // Query só de espaços → core devolve Ok(vec![]) (sem termo utilizável).
        let blank = search(db.path(), "   ".to_string(), "kjv".to_string(), None, None)
            .expect("query em branco não deve panicar");
        assert!(blank.is_empty(), "query só de espaços = vazio");
    }

    #[test]
    fn search_unknown_translation_maps_to_core_error() {
        let db = build_search_fixture();
        let err = search(
            db.path(),
            "God".to_string(),
            "nao-existe".to_string(),
            None,
            None,
        )
        .expect_err("tradução inexistente deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));
    }

    #[test]
    fn search_respects_limit() {
        let db = build_search_fixture();
        // "world" aparece em João 3:16 e 3:17 (KJV); limit=1 → exatamente 1 hit.
        let hits = search(
            db.path(),
            "world".to_string(),
            "kjv".to_string(),
            None,
            Some(1),
        )
        .expect("buscar 'world' com limit=1");
        assert_eq!(hits.len(), 1, "limit=1 deve retornar exatamente 1 hit");
    }

    #[test]
    fn bonus_full_bible_db_search_when_present() {
        // BÔNUS, NÃO-REQUISITO: só roda se o `bible.sqlite` (gerado-ignorado)
        // existir. As asserções primárias acima passam só com o fixture, offline.
        if !std::path::Path::new(BIBLE_DB).exists() {
            return;
        }
        let hits = search(
            BIBLE_DB.to_string(),
            "God".to_string(),
            "kjv".to_string(),
            None,
            Some(50),
        )
        .expect("buscar 'God' no bible.sqlite");
        assert!(!hits.is_empty(), "corpus real deve ter hits para 'God'");
    }
}

/// Testes de **referências cruzadas** da F1.8 (`cross_refs`), **apenas no nativo**
/// (host com a feature `embedded`, ADR-0005). As asserções primárias são **offline**
/// e **determinísticas**: constroem um fixture pequeno num diretório temporário
/// (schema = migrações do core via `Store::open`) e — como a tabela
/// `cross_references` nasce **vazia** (sem trigger/seed; mesmo princípio do
/// `verses_fts` na F1.5) — **populam** as linhas de xref à mão (setup de teste, **não**
/// produto; como o próprio core faz em `xref.rs::seeded`). As tríades de domínio
/// partem de João 3:16 (`from_book=43, from_chapter=3, from_verse=16`); **nenhum texto
/// bíblico** é inserido (xref é só referência — anti-alucinação). Não dependem de
/// `bible.sqlite` nem de rede.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod xref_tests {
    use super::*;
    use std::path::PathBuf;

    /// `bible.sqlite` (gerado-ignorado, ADR-0013): opcional — só para asserção
    /// **bônus** guardada por `exists()`. As primárias passam só com o fixture.
    const BIBLE_DB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../assets/data/bible.sqlite");

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f1_8-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture de xref: schema via migrações do core (`Store::open`) + DML
    /// populando `cross_references` à mão (a tabela nasce vazia; sem trigger/seed).
    /// Tríades de domínio **de** João 3:16 (43/3/16): Rm 5:8 (votos 50), Jo 3:15 (30),
    /// Rm 5:8-9 (`to_verse_start != to_verse_end` → Range, 20) e uma disputada
    /// (1:1:1, votos -5). Só inteiros → seguros inline em DML (mesma técnica do
    /// `search_tests`; nenhum schema é escrito à mão). Nenhum texto bíblico — xref é
    /// só referência.
    fn build_xref_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture de xref");
            let conn = store.conn();

            // (from_book, from_chapter, from_verse, to_book, to_chapter,
            //  to_verse_start, to_verse_end, votes).
            for (fb, fc, fv, tb, tc, ts, te, votes) in [
                (43i64, 3i64, 16i64, 45i64, 5i64, 8i64, 8i64, 50i64), // Romanos 5:8
                (43, 3, 16, 43, 3, 15, 15, 30),                       // João 3:15
                (43, 3, 16, 45, 5, 8, 9, 20),                         // Romanos 5:8-9 (Range)
                (43, 3, 16, 1, 1, 1, 1, -5),                          // disputada (votos -5)
            ] {
                let sql = format!(
                    "INSERT INTO cross_references \
                     (from_book,from_chapter,from_verse,to_book,to_chapter,to_verse_start,to_verse_end,votes) \
                     VALUES ({fb},{fc},{fv},{tb},{tc},{ts},{te},{votes})"
                );
                conn.execute(&sql, []).expect("popular cross_references");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    #[test]
    fn cross_refs_lists_by_votes_with_romans_5_8_first() {
        let db = build_xref_fixture();
        let refs = cross_refs(db.path(), 43, 3, 16, None, None).expect("listar xrefs de João 3:16");
        assert!(!refs.is_empty(), "esperado ≥1 xref para João 3:16");

        // Inclui um alvo em Romanos (book 45) capítulo 5, versículo único 8 (Rm 5:8).
        let rm = refs
            .iter()
            .find(|r| {
                r.reference.book == 45
                    && r.reference.chapter == 5
                    && r.reference.verses == VerseRange::Single { verse: 8 }
            })
            .expect("Romanos 5:8 presente nas xrefs");
        assert_eq!(rm.votes, 50, "Romanos 5:8 tem 50 votos no fixture");

        // Ordenado por votos DESC (herdado do core): [0] é o mais votado (Rm 5:8, 50).
        assert_eq!(refs[0].reference.book, 45, "[0] aponta para Romanos");
        assert_eq!(refs[0].reference.chapter, 5, "[0] capítulo 5");
        assert_eq!(
            refs[0].reference.verses,
            VerseRange::Single { verse: 8 },
            "[0] versículo único 8"
        );
        assert_eq!(refs[0].votes, 50, "[0] é o de maior nº de votos");
        assert!(
            refs.windows(2).all(|w| w[0].votes >= w[1].votes),
            "votos em ordem decrescente: {:?}",
            refs.iter().map(|r| r.votes).collect::<Vec<_>>()
        );
    }

    #[test]
    fn cross_refs_maps_range_targets() {
        let db = build_xref_fixture();
        let refs = cross_refs(db.path(), 43, 3, 16, None, None).expect("listar xrefs de João 3:16");
        // to_verse_start=8 != to_verse_end=9 → VerseRange::Range (Romanos 5:8-9).
        let range = refs
            .iter()
            .find(|r| r.reference.verses == VerseRange::Range { start: 8, end: 9 })
            .expect("Romanos 5:8-9 (Range) presente");
        assert_eq!(range.reference.book, 45, "Romanos");
        assert_eq!(range.reference.chapter, 5, "capítulo 5");
    }

    #[test]
    fn cross_refs_default_hides_disputed_lower_threshold_includes() {
        let db = build_xref_fixture();

        // Default (min_votes = None = DEFAULT_MIN_VOTES 1): a disputada (votos -5,
        // alvo 1:1:1) NÃO aparece.
        let default =
            cross_refs(db.path(), 43, 3, 16, None, None).expect("listar xrefs (default min_votes)");
        assert!(
            !default.iter().any(|r| r.votes < 0),
            "referências disputadas (votos negativos) ficam ocultas por padrão: {:?}",
            default.iter().map(|r| r.votes).collect::<Vec<_>>()
        );

        // Limiar menor (Some(-100)): a disputada aparece → a contagem aumenta.
        let with_disputed = cross_refs(db.path(), 43, 3, 16, Some(-100), None)
            .expect("listar xrefs com min_votes baixo");
        assert!(
            with_disputed.len() > default.len(),
            "min_votes menor inclui a disputada: {} vs {}",
            with_disputed.len(),
            default.len()
        );
        assert!(
            with_disputed
                .iter()
                .any(|r| r.reference.book == 1 && r.votes == -5),
            "a disputada (alvo 1:1:1, votos -5) aparece com min_votes = -100"
        );
    }

    #[test]
    fn cross_refs_respects_limit() {
        let db = build_xref_fixture();
        // Com min_votes baixo há 4 xrefs; limit=1 → exatamente 1 (a mais votada).
        let refs = cross_refs(db.path(), 43, 3, 16, Some(-100), Some(1))
            .expect("listar xrefs com limit=1");
        assert_eq!(refs.len(), 1, "limit=1 deve retornar exatamente 1 xref");
        assert_eq!(
            refs[0].votes, 50,
            "o item retornado é o mais votado (Rm 5:8)"
        );
    }

    #[test]
    fn cross_refs_unknown_verse_is_empty_without_panic() {
        let db = build_xref_fixture();
        // Versículo sem xref → Vec vazio (não Err, não panic).
        let refs = cross_refs(db.path(), 1, 1, 1, None, None)
            .expect("versículo sem xref não deve panicar");
        assert!(refs.is_empty(), "versículo sem xref = vazio");
    }

    #[test]
    fn bonus_full_bible_db_xrefs_when_present() {
        // BÔNUS, NÃO-REQUISITO: só roda se o `bible.sqlite` (gerado-ignorado) existir.
        // As asserções primárias acima passam só com o fixture, offline. João 3:16 tem
        // várias xrefs reais no OpenBible; não asserimos contagem exata (o default
        // min_votes=1 filtra disputadas e a contagem pode driftar).
        if !std::path::Path::new(BIBLE_DB).exists() {
            return;
        }
        let refs = cross_refs(BIBLE_DB.to_string(), 43, 3, 16, None, None)
            .expect("listar xrefs de João 3:16 no bible.sqlite");
        assert!(
            !refs.is_empty(),
            "corpus real deve ter ≥1 xref para João 3:16"
        );
    }
}

/// Testes de **notas/marcações** da F1.10 (`put_note`/`get_note`/`delete_note`/
/// `list_notes` + `add_highlight`/`remove_highlight`/`list_highlights`), **apenas no
/// nativo** (host com a feature `embedded`, ADR-0005). As asserções são **offline** e
/// **determinísticas**: criam um **diretório** temporário único (não um arquivo de DB) e
/// exercitam as 7 funções, **relendo de outra chamada/handle** (cada chamada abre um
/// store novo do disco → prova persistência em **disco**, não em memória). **Não**
/// dependem de `bible.sqlite` nem de rede — notas/highlights são chaveadas por
/// **referência**, separadas do conteúdo bíblico só-leitura. Os textos são **do
/// usuário** (não bíblicos): anti-alucinação não se aplica ao corpo/cor/tag.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod userdata_tests {
    use super::*;
    use std::path::PathBuf;

    /// Diretório de dados temporário do fixture: criado no `new`, **removido
    /// recursivamente** no `Drop` (mesmo em panic). Reproduz o `TmpDb`/`Drop` das
    /// F1.2/F1.5/F1.8, porém para um **diretório** (o `data_dir` gravável do app), não um
    /// arquivo de DB. Criar/limpar o diretório é **fixture de teste**, não produto — o
    /// I/O de userdata (slug, `.md`, JSON, ordenação) vive no core.
    struct TmpDir(PathBuf);

    impl TmpDir {
        /// Cria um `data_dir` temporário único e vazio (offline, sem deps externas).
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = std::env::temp_dir().join(format!(
                "the-light-app-f1_10-{}-{nanos}-{n}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("criar data_dir temporário");
            TmpDir(dir)
        }

        /// Caminho do `data_dir` como `String` (o que a fronteira recebe).
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn note_roundtrip_persists_to_disk_across_handles() {
        let dir = TmpDir::new();
        // Texto **do usuário** (não bíblico): anti-alucinação não se aplica ao corpo.
        put_note(
            dir.path(),
            "John 3:16".to_string(),
            "# Amor de Deus\n\nVersículo central.".to_string(),
        )
        .expect("put_note deve gravar a nota");

        // Chamada SEPARADA → abre um NoteStore novo do disco (prova persistência em
        // disco, não em memória).
        let note = get_note(dir.path(), "John 3:16".to_string())
            .expect("get_note não deve falhar")
            .expect("a nota recém-gravada deve existir");
        assert!(
            note.body.contains("Amor de Deus"),
            "corpo da nota verbatim do usuário: {}",
            note.body
        );
        // Referência canônica: João = livro 43, capítulo 3, versículo único 16.
        assert_eq!(note.reference.book, 43, "João é o livro 43");
        assert_eq!(note.reference.chapter, 3, "capítulo 3");
        assert_eq!(
            note.reference.verses,
            VerseRange::Single { verse: 16 },
            "versículo único 16"
        );
        // Um arquivo .md por nota, com nome canônico EN (slug do core: `John_3.16.md`).
        assert!(
            dir.0.join("notes").join("John_3.16.md").exists(),
            "a nota é um .md por referência (nome canônico EN, slug do core)"
        );
    }

    #[test]
    fn note_reference_is_canonical_pt_equals_en() {
        let dir = TmpDir::new();
        // Grava em PT ("Jo 3.16"); lê em EN ("John 3:16") → MESMA nota/arquivo.
        put_note(
            dir.path(),
            "Jo 3.16".to_string(),
            "PT e EN são a mesma nota".to_string(),
        )
        .expect("put_note em PT");
        let note = get_note(dir.path(), "John 3:16".to_string())
            .expect("get_note em EN não deve falhar")
            .expect("PT e EN caem na MESMA nota (canonicalização do core)");
        assert!(note.body.contains("mesma nota"));
        // Só um arquivo (canônico EN), não dois.
        assert!(dir.0.join("notes").join("John_3.16.md").exists());
        assert_eq!(
            list_notes(dir.path()).expect("listar notas").len(),
            1,
            "PT+EN convergem em UMA nota"
        );
    }

    #[test]
    fn list_notes_is_sorted_by_canonical_reference() {
        let dir = TmpDir::new();
        put_note(dir.path(), "John 3:16".to_string(), "joão".to_string()).expect("nota João");
        put_note(dir.path(), "Gn 1.1".to_string(), "gênesis".to_string()).expect("nota Gênesis");

        let notes = list_notes(dir.path()).expect("listar notas");
        assert_eq!(notes.len(), 2, "duas notas distintas: {notes:?}");
        // Ordenada por referência canônica: Gênesis (1) antes de João (43).
        assert_eq!(notes[0].reference.book, 1, "Gênesis (1) primeiro");
        assert_eq!(notes[1].reference.book, 43, "João (43) depois");
    }

    #[test]
    fn delete_note_is_idempotent() {
        let dir = TmpDir::new();
        put_note(dir.path(), "John 3:16".to_string(), "corpo".to_string()).expect("gravar nota");

        // Primeira remoção: havia nota → true.
        assert!(
            delete_note(dir.path(), "John 3:16".to_string()).expect("delete_note 1"),
            "primeira remoção devolve true (havia nota)"
        );
        // Segunda remoção: não havia → false (idempotente, não erro).
        assert!(
            !delete_note(dir.path(), "John 3:16".to_string()).expect("delete_note 2"),
            "segunda remoção devolve false (idempotente)"
        );
        // get_note subsequente → Ok(None).
        assert!(
            get_note(dir.path(), "John 3:16".to_string())
                .expect("get_note pós-delete")
                .is_none(),
            "nota removida → Ok(None)"
        );
    }

    #[test]
    fn empty_data_dir_lists_empty_without_panic() {
        // data_dir recém-criado: sem `notes/` nem `highlights.json`.
        let dir = TmpDir::new();
        assert!(
            list_notes(dir.path())
                .expect("list_notes em data_dir vazio não deve panicar/erro")
                .is_empty(),
            "sem notes/ → Vec vazio"
        );
        assert!(
            list_highlights(dir.path())
                .expect("list_highlights em data_dir vazio não deve panicar/erro")
                .is_empty(),
            "sem highlights.json → Vec vazio"
        );
        // Referência válida sem nota → Ok(None) (não erro).
        assert!(
            get_note(dir.path(), "John 3:16".to_string())
                .expect("get_note de ref válida sem nota não é erro")
                .is_none(),
            "referência válida sem nota → Ok(None)"
        );
    }

    #[test]
    fn highlight_roundtrip_and_replace_same_reference() {
        let dir = TmpDir::new();
        add_highlight(
            dir.path(),
            "John 3:16".to_string(),
            "yellow".to_string(),
            Some("salvação".to_string()),
        )
        .expect("add_highlight amarelo");

        // Chamada nova → relê do disco (outro handle).
        let hls = list_highlights(dir.path()).expect("listar highlights");
        assert_eq!(hls.len(), 1, "um highlight");
        assert_eq!(hls[0].color, "yellow", "cor do usuário");
        assert_eq!(hls[0].tag.as_deref(), Some("salvação"), "tag do usuário");
        assert_eq!(hls[0].reference.book, 43);
        assert_eq!(hls[0].reference.chapter, 3);
        assert_eq!(hls[0].reference.verses, VerseRange::Single { verse: 16 });

        // Mesma referência → substitui (não duplica): cor/tag atualizadas.
        add_highlight(
            dir.path(),
            "John 3:16".to_string(),
            "green".to_string(),
            None,
        )
        .expect("add_highlight verde substitui");
        let hls = list_highlights(dir.path()).expect("listar highlights após substituição");
        assert_eq!(hls.len(), 1, "substituição não duplica: continua 1");
        assert_eq!(hls[0].color, "green", "cor substituída");
        assert_eq!(hls[0].tag, None, "tag substituída por None");
    }

    #[test]
    fn remove_highlight_is_idempotent() {
        let dir = TmpDir::new();
        add_highlight(
            dir.path(),
            "John 3:16".to_string(),
            "yellow".to_string(),
            None,
        )
        .expect("add_highlight");

        // Primeira remoção: 1 saiu.
        assert_eq!(
            remove_highlight(dir.path(), "John 3:16".to_string()).expect("remove 1"),
            1,
            "primeira remoção tira 1"
        );
        // Segunda remoção: nada (idempotente, não erro).
        assert_eq!(
            remove_highlight(dir.path(), "John 3:16".to_string()).expect("remove 2"),
            0,
            "segunda remoção tira 0 (idempotente)"
        );
        assert!(
            list_highlights(dir.path()).expect("listar").is_empty(),
            "lista vazia após remoção"
        );
    }

    #[test]
    fn invalid_reference_maps_to_core_error_before_io() {
        let dir = TmpDir::new();
        // put_note com referência que não parseia → CoreError (antes de qualquer I/O).
        let err = put_note(
            dir.path(),
            "isto nao e referencia".to_string(),
            "x".to_string(),
        )
        .expect_err("referência inválida deve falhar no put_note");
        assert!(matches!(err, CoreError::Generic { .. }));

        // get_note com a mesma string inválida → CoreError.
        let err = get_note(dir.path(), "isto nao e referencia".to_string())
            .expect_err("referência inválida deve falhar no get_note");
        assert!(matches!(err, CoreError::Generic { .. }));

        // Nenhum arquivo/dir foi criado pelo caminho de erro (parse falha antes do I/O).
        assert!(
            !dir.0.join("notes").exists(),
            "ref inválida não cria notes/ (parse falha antes do I/O)"
        );
    }
}

/// Testes da **pergunta ancorada** da F2.1 (`ask_anchored`), **apenas no nativo**
/// (host com a feature `embedded`, ADR-0005 — onde o módulo `ai` do core existe).
/// As asserções são **offline**, **determinísticas** e **sem chave**: usam o
/// **provedor MOCK** do core (`build_provider("mock", None, None)` → resposta fixa,
/// nenhuma chamada HTTP) sobre um fixture KJV de domínio público construído num
/// arquivo temporário (schema = migrações do core via `Store::open`; DML de
/// domínio público — como nas F1.2/F1.5). A prova central é **anti-alucinação**: o
/// `cited_text` é o texto **verbatim do store** (muda com o fixture), enquanto a
/// `interpretation` é a saída do **modelo** (invariante ao texto bíblico).
#[cfg(all(test, not(target_arch = "wasm32")))]
mod ai_tests {
    use super::*;
    use std::path::PathBuf;

    // ── Textos KJV **verbatim** (domínio público), usados SÓ no fixture/assert;
    //    nenhum texto bíblico é gerado em produção (anti-alucinação). ──────────────
    /// João 3:16 — King James Version.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    /// João 3:17 — King James Version (segundo versículo, p/ provar que o
    /// `cited_text` acompanha o STORE e a `interpretation` não).
    const JOHN_3_17_KJV: &str = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f2_1-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture KJV: schema via migrações do core (`Store::open`) + DML de
    /// domínio público (João 3:16 e 3:17). Sem aspas simples nas `const`s → seguras
    /// inline; nenhum schema é escrito à mão. A conexão fecha antes do uso pela
    /// fronteira.
    fn build_kjv_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture KJV");
            let conn = store.conn();

            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");

            for (chapter, verse, text) in [(3u16, 16u16, JOHN_3_16_KJV), (3, 17, JOHN_3_17_KJV)] {
                let sql = format!(
                    "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                     VALUES ('kjv',43,{chapter},{verse},'{text}')"
                );
                conn.execute(&sql, []).expect("inserir versículo João");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    /// Resposta fixa do `MockLlmProvider` do core, obtida **do próprio core** (sem
    /// hardcode): como o `system` não contém o marcador `PERGUNTA:`, `complete`
    /// devolve a resposta canônica — **exatamente** o que `ai::ask` retorna com o
    /// mock, independentemente do texto bíblico. Prova que a `interpretation` é do
    /// **modelo**, não do store.
    fn mock_fixed_response() -> String {
        use the_light_core::ai::LlmProvider;
        the_light_core::ai::MockLlmProvider::default()
            .complete("sistema de teste sem marcador de refinamento", "pergunta")
            .expect("mock complete não deve falhar (sem rede)")
    }

    #[test]
    fn ask_anchored_cites_store_verbatim_and_interprets_via_mock() {
        let db = build_kjv_fixture();

        let answer = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "What does this passage mean?".to_string(),
            "mock".to_string(),
            None, // BYOK: sem chave (mock não faz rede)
            None,
            "en".to_string(),
        )
        .expect("ask_anchored com o mock deve retornar Ok");

        // ── Anti-alucinação: cited_text é VERBATIM do store, numerado. ────────────
        assert!(
            answer.cited_text.contains("16 For God so loved the world"),
            "cited_text deve ser o versículo numerado verbatim do store: {}",
            answer.cited_text
        );
        assert!(
            answer.cited_text.contains(JOHN_3_16_KJV),
            "cited_text deve conter o texto KJV integral verbatim do store: {}",
            answer.cited_text
        );

        // ── interpretation é a saída do MODELO (mock), NÃO o texto bíblico. ───────
        assert_eq!(
            answer.interpretation,
            mock_fixed_response(),
            "interpretation deve ser a resposta fixa do MockLlmProvider"
        );
        assert!(
            !answer.interpretation.contains("For God so loved"),
            "o LLM/mock NÃO reproduz/gera texto bíblico na interpretation: {}",
            answer.interpretation
        );
        assert_ne!(
            answer.cited_text, answer.interpretation,
            "cited_text (store) e interpretation (modelo) são coisas distintas"
        );

        // ── Provedor/modelo e referência canônica. ───────────────────────────────
        assert_eq!(answer.provider, "mock", "provider deve ser 'mock'");
        assert_eq!(answer.model, "mock-1", "modelo do mock do core");
        assert_eq!(answer.reference.book, 43, "João é o livro 43");
        assert_eq!(answer.reference.chapter, 3, "capítulo 3");
        assert_eq!(
            answer.reference.verses,
            VerseRange::Single { verse: 16 },
            "versículo único 16"
        );
    }

    #[test]
    fn cited_text_tracks_store_while_interpretation_is_invariant() {
        // Prova anti-fake: com O MESMO fixture/mock, perguntar de dois versículos
        // distintos muda o `cited_text` (segue o STORE) mas NÃO a `interpretation`
        // (vem do modelo, não do texto bíblico).
        let db = build_kjv_fixture();

        let a16 = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "Explique.".to_string(),
            "mock".to_string(),
            None,
            None,
            "en".to_string(),
        )
        .expect("ask_anchored 3:16");

        let a17 = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "John 3:17".to_string(),
            "Explique.".to_string(),
            "mock".to_string(),
            None,
            None,
            "en".to_string(),
        )
        .expect("ask_anchored 3:17");

        // cited_text acompanha o store (textos verbatim diferentes por versículo).
        assert!(a16.cited_text.contains(JOHN_3_16_KJV));
        assert!(a17.cited_text.contains(JOHN_3_17_KJV));
        assert_ne!(
            a16.cited_text, a17.cited_text,
            "cited_text muda com o versículo do store"
        );

        // interpretation é a MESMA (a do modelo) — invariante ao texto bíblico.
        assert_eq!(
            a16.interpretation, a17.interpretation,
            "a interpretação do mock não depende do texto bíblico"
        );
        assert_eq!(a16.interpretation, mock_fixed_response());
    }

    #[test]
    fn ask_anchored_error_paths_do_not_panic() {
        let db = build_kjv_fixture();

        // Referência inválida → CoreError (parse falha antes de qualquer I/O).
        let err = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "isto nao e referencia".to_string(),
            "?".to_string(),
            "mock".to_string(),
            None,
            None,
            "en".to_string(),
        )
        .expect_err("referência inválida deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));

        // Tradução inexistente no store → CoreError (via core), sem panic.
        let err = ask_anchored(
            db.path(),
            "nao-existe".to_string(),
            "John 3:16".to_string(),
            "?".to_string(),
            "mock".to_string(),
            None,
            None,
            "en".to_string(),
        )
        .expect_err("tradução inexistente deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));

        // Provedor desconhecido → CoreError (via `build_provider`), sem panic.
        let err = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "?".to_string(),
            "provedor-inexistente".to_string(),
            None,
            None,
            "en".to_string(),
        )
        .expect_err("provedor desconhecido deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));
    }

    // ── F2.7b: fronteira web de IA (ai_web_prepare/ai_web_finalize) ──────────────
    // Prova, no HOST (nativo), que o caminho web monta o MESMO `cited_text` do store
    // que o `ask_anchored` nativo (ZERO drift), que `system`/`user` vêm do `ai-pure`
    // (mesmo prompt anti-alucinação), e que `finalize` separa `cited_text` (store) da
    // `interpretation` (LLM). As funções são cfg-free (ai-pure), logo compilam iguais
    // no wasm — este teste é o parity check nativo↔web.

    #[test]
    fn ai_web_prepare_matches_native_anchored_cited_text_zero_drift() {
        // Caminho NATIVO (mock, store) — a referência de paridade.
        let db = build_kjv_fixture();
        let native = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "What does this passage mean?".to_string(),
            "mock".to_string(),
            None,
            None,
            "en".to_string(),
        )
        .expect("ask_anchored nativo (mock)");

        // Caminho WEB: os `verses` vêm do store (aqui, o versículo 16 verbatim).
        let req = ai_web_prepare(
            "John 3:16".to_string(),
            "What does this passage mean?".to_string(),
            "gemini".to_string(),
            None,
            "en".to_string(),
            vec![AiVerseInput {
                number: 16,
                text: JOHN_3_16_KJV.to_string(),
            }],
        )
        .expect("ai_web_prepare");

        // ZERO drift: `cited_text` (store, numerado) idêntico nativo↔web.
        assert_eq!(
            req.cited_text, native.cited_text,
            "cited_text web deve ser IDÊNTICO ao nativo (mesma fn ai-pure)"
        );
        assert!(req.cited_text.contains("16 For God so loved the world"));
        assert!(req.cited_text.contains(JOHN_3_16_KJV));

        // system = o MESMO prompt anti-alucinação do `ai-pure` (mesmo do nativo).
        assert_eq!(
            req.system,
            the_light_core::ai::prompts::ask_system_prompt(the_light_core::model::Lang::En),
            "system deve ser o ask_system_prompt do ai-pure (zero drift)"
        );
        assert!(req.system.contains("NÃO invente"));

        // user embute a pergunta + o contexto ancorado (cited_text do store).
        assert!(req.user.contains("What does this passage mean?"));
        assert!(
            req.user.contains(&req.cited_text),
            "o user prompt ancora no cited_text do store"
        );

        // modelo default do provedor (gemini) via ai-pure.
        assert_eq!(req.model, "gemini-2.5-flash");
        assert_eq!(req.provider, "gemini");
    }

    #[test]
    fn ai_web_finalize_separates_store_cited_text_from_llm_interpretation() {
        let cited = the_light_core::ai::numbered_verses([(16u16, JOHN_3_16_KJV)]);
        // A `interpretation` chega do transporte (`fetch`); aqui uma string do "LLM"
        // com uma âncora Strong ESPÚRIA `[V:G9999]` (bem-formada, mas FORA do conjunto
        // de válidas — vazio no `ask` simples → deve ser removida pelo Rust).
        let ans = ai_web_finalize(
            "John 3:16".to_string(),
            cited.clone(),
            "gemini".to_string(),
            "gemini-2.5-flash".to_string(),
            "Interpretação do modelo [V:G9999] sobre o amor de Deus.".to_string(),
        )
        .expect("ai_web_finalize");

        // cited_text (store) preservado, separado da interpretation (LLM).
        assert_eq!(ans.cited_text, cited);
        assert!(ans.cited_text.contains(JOHN_3_16_KJV));
        // rewrite_anchors (Rust) removeu a âncora espúria (conjunto válido vazio).
        assert!(
            !ans.interpretation.contains("[V:G9999]"),
            "rewrite_anchors deve remover a âncora inválida: {}",
            ans.interpretation
        );
        assert!(ans.interpretation.contains("sobre o amor de Deus"));
        // O LLM NÃO gera texto bíblico: cited_text ≠ interpretation.
        assert_ne!(ans.cited_text, ans.interpretation);
        assert!(!ans.interpretation.contains("For God so loved"));
        assert_eq!(ans.provider, "gemini");
        assert_eq!(ans.model, "gemini-2.5-flash");
    }
}

/// Testes do **streaming ancorado** da F2.3a (`ask_anchored_stream` + roteamento de
/// `"gemini"`), **apenas no nativo** (host com a feature `embedded`, ADR-0005). São
/// **offline**, **determinísticos** e **sem chave/rede**: usam o provedor **MOCK** do
/// core (cujo `complete_stream` cai no **default não-quebrante** → emite a resposta
/// inteira **1×** pelo callback) sobre um fixture KJV de domínio público. Provam a
/// **anti-alucinação** do streaming — o `cited_text` é **verbatim do store** (segue o
/// fixture), enquanto os **tokens** transmitidos são a **interpretação do modelo**
/// (invariante ao texto bíblico) — e o **roteamento de `"gemini"`** pelo caminho
/// **no-key** (→ [`CoreError`], **sem rede**).
#[cfg(all(test, not(target_arch = "wasm32")))]
mod ai_stream_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    // ── Textos KJV **verbatim** (domínio público), usados SÓ no fixture/assert;
    //    nenhum texto bíblico é gerado em produção (anti-alucinação). ──────────────
    /// João 3:16 — King James Version.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    /// João 3:17 — King James Version (segundo versículo, p/ provar que o `cited_text`
    /// acompanha o STORE e os tokens do mock não).
    const JOHN_3_17_KJV: &str = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f2_3a-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture KJV: schema via migrações do core (`Store::open`) + DML de
    /// domínio público (João 3:16 e 3:17). Sem aspas simples nas `const`s → seguras
    /// inline; nenhum schema é escrito à mão.
    fn build_kjv_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture KJV");
            let conn = store.conn();

            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");

            for (chapter, verse, text) in [(3u16, 16u16, JOHN_3_16_KJV), (3, 17, JOHN_3_17_KJV)] {
                let sql = format!(
                    "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                     VALUES ('kjv',43,{chapter},{verse},'{text}')"
                );
                conn.execute(&sql, []).expect("inserir versículo João");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    /// Resposta fixa do `MockLlmProvider` do core, obtida **do próprio core** (sem
    /// hardcode): como o `system` não contém o marcador de refinamento, `complete`
    /// devolve a resposta canônica — exatamente o que o default de `complete_stream`
    /// emite/retorna com o mock. Prova que os tokens são do **modelo**, não do store.
    fn mock_fixed_response() -> String {
        use the_light_core::ai::LlmProvider;
        the_light_core::ai::MockLlmProvider::default()
            .complete("sistema de teste sem marcador de refinamento", "pergunta")
            .expect("mock complete não deve falhar (sem rede)")
    }

    /// Callback de teste que **acumula** os tokens e **conta** as chamadas. O estado é
    /// compartilhado por `Arc` (a instância é movida para dentro do `Box` da fronteira;
    /// lemos o acumulado **após** a chamada retornar).
    struct Collector {
        tokens: Arc<Mutex<Vec<String>>>,
        calls: Arc<AtomicUsize>,
    }

    impl AiTokenCallback for Collector {
        fn on_token(&self, token: String) {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.tokens.lock().expect("lock tokens").push(token);
        }
    }

    #[test]
    fn stream_cites_store_verbatim_and_streams_mock_interpretation() {
        let db = build_kjv_fixture();

        let tokens = Arc::new(Mutex::new(Vec::<String>::new()));
        let calls = Arc::new(AtomicUsize::new(0));
        let cb = Collector {
            tokens: Arc::clone(&tokens),
            calls: Arc::clone(&calls),
        };

        let answer = ask_anchored_stream(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "What does this passage mean?".to_string(),
            "mock".to_string(),
            None, // BYOK: sem chave (mock não faz rede)
            None,
            "en".to_string(),
            Box::new(cb),
        )
        .expect("ask_anchored_stream com o mock deve retornar Ok");

        // ── O callback foi chamado (≥1×) e o acumulado == interpretation == mock. ──
        assert!(
            calls.load(Ordering::Relaxed) >= 1,
            "o callback de streaming deve ser chamado ao menos 1x"
        );
        let accumulated = tokens.lock().expect("lock tokens").concat();
        assert_eq!(
            accumulated, answer.interpretation,
            "os tokens acumulados devem compor a interpretation devolvida"
        );
        assert_eq!(
            accumulated,
            mock_fixed_response(),
            "o acumulado deve ser a resposta fixa do MockLlmProvider"
        );

        // ── Anti-alucinação: cited_text é VERBATIM do store, numerado. ────────────
        assert!(
            answer.cited_text.contains("16 For God so loved the world"),
            "cited_text deve ser o versículo numerado verbatim do store: {}",
            answer.cited_text
        );
        assert!(
            answer.cited_text.contains(JOHN_3_16_KJV),
            "cited_text deve conter o texto KJV integral verbatim do store: {}",
            answer.cited_text
        );

        // ── Os TOKENS são da INTERPRETAÇÃO (modelo), NÃO texto bíblico. ───────────
        assert!(
            !accumulated.contains("For God so loved"),
            "os tokens do mock NÃO reproduzem/geram texto bíblico: {accumulated}"
        );
        assert_ne!(
            answer.cited_text, answer.interpretation,
            "cited_text (store) e interpretation (modelo/tokens) são coisas distintas"
        );

        // ── Provedor/modelo e referência canônica. ───────────────────────────────
        assert_eq!(answer.provider, "mock", "provider deve ser 'mock'");
        assert_eq!(answer.model, "mock-1", "modelo do mock do core");
        assert_eq!(answer.reference.book, 43, "João é o livro 43");
        assert_eq!(answer.reference.chapter, 3, "capítulo 3");
        assert_eq!(
            answer.reference.verses,
            VerseRange::Single { verse: 16 },
            "versículo único 16"
        );
    }

    #[test]
    fn stream_cited_text_tracks_store_while_tokens_are_invariant() {
        // Prova anti-fake: com O MESMO fixture/mock, o streaming de dois versículos
        // distintos muda o `cited_text` (segue o STORE) mas NÃO os tokens/interpretação
        // (vêm do modelo, não do texto bíblico).
        let db = build_kjv_fixture();

        let run = |reference: &str| -> (String, String) {
            let tokens = Arc::new(Mutex::new(Vec::<String>::new()));
            let cb = Collector {
                tokens: Arc::clone(&tokens),
                calls: Arc::new(AtomicUsize::new(0)),
            };
            let answer = ask_anchored_stream(
                db.path(),
                "kjv".to_string(),
                reference.to_string(),
                "Explique.".to_string(),
                "mock".to_string(),
                None,
                None,
                "en".to_string(),
                Box::new(cb),
            )
            .expect("ask_anchored_stream deve retornar Ok");
            let accumulated = tokens.lock().expect("lock tokens").concat();
            (answer.cited_text, accumulated)
        };

        let (cited16, tokens16) = run("John 3:16");
        let (cited17, tokens17) = run("John 3:17");

        // cited_text acompanha o store (textos verbatim diferentes por versículo).
        assert!(cited16.contains(JOHN_3_16_KJV));
        assert!(cited17.contains(JOHN_3_17_KJV));
        assert_ne!(cited16, cited17, "cited_text muda com o versículo do store");

        // tokens/interpretação são os MESMOS (do modelo) — invariantes ao texto bíblico.
        assert_eq!(
            tokens16, tokens17,
            "os tokens do mock não dependem do texto bíblico"
        );
        assert_eq!(tokens16, mock_fixed_response());
    }

    #[test]
    fn gemini_without_key_routes_to_core_error_without_network() {
        // Roteamento F2.3: `"gemini"` SEM chave → CoreError (NoKey), provando que o
        // roteamento alcança o arm gemini de `build_provider` SEM rede (nenhuma chamada
        // HTTP: o erro é síncrono, antes de qualquer request). Via `ask_anchored` (F2.1)
        // — que passa `provider_name` ao MESMO `build_provider`.
        let db = build_kjv_fixture();
        let err = ask_anchored(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "?".to_string(),
            "gemini".to_string(),
            None, // sem chave: NoKey (sem rede)
            None,
            "en".to_string(),
        )
        .expect_err("gemini sem chave deve falhar com CoreError");
        assert!(matches!(err, CoreError::Generic { .. }));
        assert!(
            err.to_string().contains("gemini"),
            "a mensagem de erro prova que o roteamento alcançou o arm gemini: {err}"
        );

        // O mesmo vale pelo caminho de streaming (mesmo `build_provider`).
        let cb = Collector {
            tokens: Arc::new(Mutex::new(Vec::new())),
            calls: Arc::new(AtomicUsize::new(0)),
        };
        let err = ask_anchored_stream(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "?".to_string(),
            "gemini".to_string(),
            None,
            None,
            "en".to_string(),
            Box::new(cb),
        )
        .expect_err("gemini sem chave (stream) deve falhar com CoreError");
        assert!(matches!(err, CoreError::Generic { .. }));
    }

    #[test]
    fn stream_unknown_provider_maps_to_core_error() {
        let db = build_kjv_fixture();
        let cb = Collector {
            tokens: Arc::new(Mutex::new(Vec::new())),
            calls: Arc::new(AtomicUsize::new(0)),
        };
        let err = ask_anchored_stream(
            db.path(),
            "kjv".to_string(),
            "John 3:16".to_string(),
            "?".to_string(),
            "provedor-inexistente".to_string(),
            None,
            None,
            "en".to_string(),
            Box::new(cb),
        )
        .expect_err("provedor desconhecido deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));
    }
}

/// Testes de **léxico verificado** da F3.2 (`lexical_entries` delegando a
/// `ai::lexicon::verified_lexicon`), **apenas no nativo** (host com a feature
/// `embedded`, ADR-0005). Determinísticos e **offline**: constroem um fixture SQLite
/// temporário (`Store::open` cria o schema v2 do core → tabelas de léxico existem) e
/// populam `scholarly_sources`/`original_tokens`/`lexicon` **à mão** (espelhando o
/// `seeded()` do core, `ai/lexicon.rs`), adaptado a **Gênesis 1:1**. Nenhum texto
/// bíblico é gerado — os dados léxicos vêm **só** do acervo verificado
/// (anti-alucinação). O `bible.sqlite` real é só bônus `if exists`.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod lexicon_tests {
    use super::*;
    use std::path::PathBuf;

    /// `bible.sqlite` (gerado-ignorado, ADR-0013): opcional — só para a asserção
    /// **bônus** guardada por `exists()`. As primárias passam só com o fixture.
    const BIBLE_DB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../assets/data/bible.sqlite");

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f3_2-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture de léxico: schema via migrações do core (`Store::open`) + DML
    /// **espelhando o `seeded()` do core** (`ai/lexicon.rs`) para **Gênesis 1:1**
    /// (book=1, chapter=1, verse=1) com 3 base-Strongs distintos: bereshit (`H7225G`),
    /// bara (`H1254A`), elohim (`H0430G`). `scholarly_sources` com atribuição STEP Bible;
    /// `lexicon` mapeando cada Strong à sua glosa. Colunas **exatas** do rev pinado;
    /// nenhum schema escrito à mão.
    fn build_lexicon_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture de léxico");
            let conn = store.conn();

            // Fontes (atribuição CC-BY, verbatim): tokens usam 'tahot', léxico usa 'tbesh'.
            for (id, name) in [("tahot", "TAHOT"), ("tbesh", "TBESH")] {
                let sql = format!(
                    "INSERT INTO scholarly_sources(id,name,license,embeddable,attribution,url,version) \
                     VALUES ('{id}','{name}','cc-by',1,'STEP Bible (CC BY 4.0)','u','v')"
                );
                conn.execute(&sql, []).expect("popular scholarly_sources");
            }

            // Gênesis 1:1 (book=1, chapter=1, verse=1): (word_index, strongs, lemma).
            // Lemas hebraicos **sem aspas simples** → seguros inline em DML (mesma técnica
            // dos demais fixtures; nenhum schema é escrito à mão).
            let toks = [
                (1i64, "H7225G", "רֵאשִׁית"),
                (2, "H1254A", "בָּרָא"),
                (3, "H0430G", "אֱלֹהִים"),
            ];
            for (wi, st, lemma) in toks {
                let sql = format!(
                    "INSERT INTO original_tokens(testament,book_number,chapter,verse,word_index,\
                     surface,lemma,strongs,strongs_raw,source_id) \
                     VALUES ('OT',1,1,1,{wi},'{lemma}','{lemma}','{st}','{st}','tahot')"
                );
                conn.execute(&sql, []).expect("popular original_tokens");
            }

            // Léxico: cada Strong → glosa (H0430G → "God").
            for (st, gloss) in [
                ("H7225G", "beginning"),
                ("H1254A", "to create"),
                ("H0430G", "God"),
            ] {
                let sql = format!(
                    "INSERT INTO lexicon(strongs,lemma,gloss,source_id) \
                     VALUES ('{st}','x','{gloss}','tbesh')"
                );
                conn.execute(&sql, []).expect("popular lexicon");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    #[test]
    fn lexical_entries_genesis_1_1_returns_base_strong_and_gloss() {
        let db = build_lexicon_fixture();
        let vl = lexical_entries(db.path(), 1, 1, Some(1), "pt".to_string(), None)
            .expect("recuperar léxico de Gênesis 1:1");
        assert!(
            !vl.entries.is_empty(),
            "esperado ≥1 entrada léxica em Gn 1:1"
        );

        // Strong BASE (H0430G → H0430, sem o sufixo de desambiguação) é a chave [V:...].
        let elohim = vl
            .entries
            .iter()
            .find(|e| e.strongs == "H0430")
            .expect("entrada de Strong base H0430 (elohim) presente");
        assert_eq!(
            elohim.gloss.as_deref(),
            Some("God"),
            "glosa verificada = God"
        );
        assert!(
            elohim.lemma.is_some(),
            "lema presente (do acervo verificado)"
        );
        assert_eq!(elohim.testament, "OT", "hebraico → testamento OT");
        // Atribuição CC-BY preservada para a exibição obrigatória da F3.5.
        assert!(
            vl.sources.iter().any(|s| s.contains("STEP Bible")),
            "sources deve trazer a atribuição STEP Bible: {:?}",
            vl.sources
        );
    }

    #[test]
    fn lexical_entries_uncovered_passage_is_empty_without_panic() {
        let db = build_lexicon_fixture();
        // Mateus 1:1 (book=40) não tem tokens no fixture → vazio (não Err, não panic).
        let vl = lexical_entries(db.path(), 40, 1, Some(1), "pt".to_string(), None)
            .expect("passagem sem cobertura não deve panicar");
        assert!(vl.entries.is_empty(), "sem tokens → entries vazio");
        assert!(vl.sources.is_empty(), "sem tokens → sources vazio");
    }

    #[test]
    fn lexical_entries_invalid_store_path_is_error() {
        // `Store::open` FALHA quando `db_path` é um **diretório existente** (não um
        // arquivo inexistente, que criaria um banco vazio). O único ponto de erro da
        // fronteira (verified_lexicon é infalível) é mapeado para CoreError.
        let dir = std::env::temp_dir();
        let err = lexical_entries(
            dir.to_string_lossy().into_owned(),
            1,
            1,
            Some(1),
            "pt".to_string(),
            None,
        )
        .expect_err("db_path = diretório deve falhar no Store::open");
        assert!(matches!(err, CoreError::Generic { .. }));
    }

    #[test]
    fn lexical_entries_respects_limit() {
        let db = build_lexicon_fixture();
        // Gn 1:1 tem 3 base-Strongs distintos; limit=Some(1) → exatamente 1 entrada.
        let vl = lexical_entries(db.path(), 1, 1, Some(1), "pt".to_string(), Some(1))
            .expect("recuperar léxico com limit=1");
        assert_eq!(
            vl.entries.len(),
            1,
            "limit=1 deve devolver exatamente 1 entrada"
        );
    }

    #[test]
    fn bonus_full_bible_db_lexicon_when_present() {
        // BÔNUS, NÃO-REQUISITO: só roda se o `bible.sqlite` (gerado-ignorado) existir.
        // As primárias acima passam só com o fixture, offline. Gênesis 1:1 tem Strongs
        // reais (H0430 → God) no acervo da F3.1.
        if !std::path::Path::new(BIBLE_DB).exists() {
            return;
        }
        let vl = lexical_entries(BIBLE_DB.to_string(), 1, 1, Some(1), "pt".to_string(), None)
            .expect("recuperar léxico de Gênesis 1:1 no bible.sqlite");
        assert!(
            !vl.entries.is_empty(),
            "corpus real deve ter léxico em Gn 1:1"
        );
        let elohim = vl
            .entries
            .iter()
            .find(|e| e.strongs == "H0430")
            .expect("H0430 (elohim) presente no corpus real");
        assert!(
            elohim.gloss.as_deref().is_some_and(|g| g.contains("God")),
            "glosa real de H0430 contém 'God': {:?}",
            elohim.gloss
        );
    }
}

/// Testes do **estudo profundo** da F3.3 (`deep_study` delegando a `ai::study::study`),
/// **apenas no nativo** (host com a feature `embedded`, ADR-0005 — onde a superfície
/// pesada do `ai` existe). As asserções são **offline**, **determinísticas** e **sem
/// chave**: usam o **provedor MOCK** do core (`build_provider("mock", None, None)` →
/// resposta fixa, nenhuma chamada HTTP) sobre um fixture KJV de domínio público
/// construído num arquivo temporário (schema = migrações do core via `Store::open`; DML
/// de domínio público — como nas F1.2/F2.1). A prova central é **anti-alucinação**: o
/// `passage_text` é o texto **verbatim do store** (muda com o fixture), enquanto a
/// `interpretation` é a saída do **modelo** (invariante ao texto bíblico).
#[cfg(all(test, not(target_arch = "wasm32")))]
mod study_tests {
    use super::*;
    use std::path::PathBuf;

    // ── Textos KJV **verbatim** (domínio público), usados SÓ no fixture/assert;
    //    nenhum texto bíblico é gerado em produção (anti-alucinação). ──────────────
    /// João 3:16 — King James Version.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    /// João 3:17 — King James Version (segundo versículo, p/ provar que o
    /// `passage_text` acompanha o STORE e a `interpretation` não).
    const JOHN_3_17_KJV: &str = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f3_3-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture KJV: schema via migrações do core (`Store::open`) + DML de
    /// domínio público (João 3:16 e 3:17). Sem aspas simples nas `const`s → seguras
    /// inline; nenhum schema é escrito à mão. A conexão fecha antes do uso pela
    /// fronteira.
    fn build_kjv_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture KJV");
            let conn = store.conn();

            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");

            for (chapter, verse, text) in [(3u16, 16u16, JOHN_3_16_KJV), (3, 17, JOHN_3_17_KJV)] {
                let sql = format!(
                    "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                     VALUES ('kjv',43,{chapter},{verse},'{text}')"
                );
                conn.execute(&sql, []).expect("inserir versículo João");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    /// Resposta fixa do `MockLlmProvider` do core, obtida **do próprio core** (sem
    /// hardcode): como o `system` do estudo não contém o marcador `PERGUNTA:`,
    /// `complete` devolve a resposta canônica — **exatamente** o que `study` retorna com
    /// o mock, independentemente do texto bíblico. Prova que a `interpretation` é do
    /// **modelo**, não do store.
    fn mock_fixed_response() -> String {
        use the_light_core::ai::LlmProvider;
        the_light_core::ai::MockLlmProvider::default()
            .complete("sistema de teste sem marcador de refinamento", "usuario")
            .expect("mock complete não deve falhar (sem rede)")
    }

    #[test]
    fn deep_study_cites_store_verbatim_and_interprets_via_mock() {
        let db = build_kjv_fixture();

        let result = deep_study(
            db.path(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            StudyMode::Academic,
            StudyLens::Presbyterian,
            StudyDepth::Exegetical,
            "en".to_string(),
            "mock".to_string(),
            None, // BYOK: sem chave (mock não faz rede)
            None,
        )
        .expect("deep_study com o mock deve retornar Ok");

        // ── Anti-alucinação: passage_text é VERBATIM do store, numerado. ──────────
        assert!(
            result
                .passage_text
                .contains("16 For God so loved the world"),
            "passage_text deve ser o versículo numerado verbatim do store: {}",
            result.passage_text
        );
        assert!(
            result.passage_text.contains(JOHN_3_16_KJV),
            "passage_text deve conter o texto KJV integral verbatim do store: {}",
            result.passage_text
        );

        // ── interpretation é a saída do MODELO (mock), NÃO o texto bíblico. ───────
        assert_eq!(
            result.interpretation,
            mock_fixed_response(),
            "interpretation deve ser a resposta fixa do MockLlmProvider"
        );
        assert!(
            !result.interpretation.contains("For God so loved"),
            "o LLM/mock NÃO reproduz/gera texto bíblico na interpretation: {}",
            result.interpretation
        );
        assert_ne!(
            result.passage_text, result.interpretation,
            "passage_text (store) e interpretation (modelo) são coisas distintas"
        );

        // ── Provedor/modelo, referência canônica e eco de modo/lente/profundidade. ─
        assert_eq!(result.provider, "mock", "provider deve ser 'mock'");
        assert_eq!(result.model, "mock-1", "modelo do mock do core");
        assert_eq!(result.reference.book, 43, "João é o livro 43");
        assert_eq!(result.reference.chapter, 3, "capítulo 3");
        assert_eq!(
            result.reference.verses,
            VerseRange::Single { verse: 16 },
            "versículo único 16"
        );
        assert_eq!(result.mode, StudyMode::Academic, "modo ecoa a entrada");
        assert_eq!(result.lens, StudyLens::Presbyterian, "lente ecoa a entrada");
        assert_eq!(
            result.depth,
            StudyDepth::Exegetical,
            "profundidade ecoa a entrada"
        );

        // ── Campos tipados presentes; com a resposta fixa do mock (sem `## ` e sem
        //    `[V:…]`) e sem léxico/web semeados: sections/warnings/citations vazios. ─
        assert!(
            result.sections.is_empty(),
            "resposta fixa do mock (sem `## `) → sections vazio: {:?}",
            result.sections
        );
        assert!(
            result.warnings.is_empty(),
            "sem Strong/[W:n] inventado → warnings vazio: {:?}",
            result.warnings
        );
        assert!(
            result.citations.is_empty(),
            "Academic sem léxico/web semeados → citations vazio: {:?}",
            result.citations
        );
    }

    #[test]
    fn passage_text_tracks_store_while_interpretation_is_invariant() {
        // Prova anti-fake (molde F2.1): com O MESMO fixture/mock, estudar dois
        // versículos distintos muda o `passage_text` (segue o STORE) mas NÃO a
        // `interpretation` (vem do modelo, não do texto bíblico).
        let db = build_kjv_fixture();

        let run = |verse: u16| -> StudyResultOut {
            deep_study(
                db.path(),
                "kjv".to_string(),
                43,
                3,
                Some(verse),
                StudyMode::Devotional,
                StudyLens::Baptist,
                StudyDepth::Overview,
                "en".to_string(),
                "mock".to_string(),
                None,
                None,
            )
            .expect("deep_study deve retornar Ok")
        };

        let s16 = run(16);
        let s17 = run(17);

        // passage_text acompanha o store (textos verbatim diferentes por versículo).
        assert!(s16.passage_text.contains(JOHN_3_16_KJV));
        assert!(s17.passage_text.contains(JOHN_3_17_KJV));
        assert_ne!(
            s16.passage_text, s17.passage_text,
            "passage_text muda com o versículo do store"
        );

        // interpretation é a MESMA (a do modelo) — invariante ao texto bíblico.
        assert_eq!(
            s16.interpretation, s17.interpretation,
            "a interpretação do mock não depende do texto bíblico"
        );
        assert_eq!(s16.interpretation, mock_fixed_response());
    }

    #[test]
    fn deep_study_error_paths_do_not_panic() {
        let db = build_kjv_fixture();

        // Provedor desconhecido → CoreError (via `build_provider`), sem panic.
        let err = deep_study(
            db.path(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            StudyMode::Academic,
            StudyLens::Presbyterian,
            StudyDepth::Exegetical,
            "en".to_string(),
            "nope".to_string(),
            None,
            None,
        )
        .expect_err("provedor desconhecido deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));

        // `db_path` = diretório existente → CoreError (via `Store::open`), sem panic.
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        let err = deep_study(
            dir,
            "kjv".to_string(),
            43,
            3,
            Some(16),
            StudyMode::Academic,
            StudyLens::Presbyterian,
            StudyDepth::Exegetical,
            "en".to_string(),
            "mock".to_string(),
            None,
            None,
        )
        .expect_err("db_path = diretório deve falhar no Store::open");
        assert!(matches!(err, CoreError::Generic { .. }));
    }

    #[test]
    fn bonus_full_bible_db_deep_study_when_present() {
        // BÔNUS, NÃO-REQUISITO: só roda se o `bible.sqlite` (gerado-ignorado) existir.
        // As primárias acima passam só com o fixture, offline. Prova a separação
        // passage_text (store) / interpretation (mock) no corpus real.
        const BIBLE_DB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../assets/data/bible.sqlite");
        if !std::path::Path::new(BIBLE_DB).exists() {
            return;
        }
        let result = deep_study(
            BIBLE_DB.to_string(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            StudyMode::Academic,
            StudyLens::Presbyterian,
            StudyDepth::Exegetical,
            "en".to_string(),
            "mock".to_string(),
            None,
            None,
        )
        .expect("deep_study de João 3:16 no bible.sqlite");
        assert!(
            result.passage_text.contains("For God so loved"),
            "corpus real deve citar João 3:16 verbatim: {}",
            result.passage_text
        );
        assert_eq!(
            result.interpretation,
            mock_fixed_response(),
            "interpretation do mock invariante ao corpus"
        );
        assert!(!result.interpretation.contains("For God so loved"));
    }

    /// Constrói o fixture KJV **com léxico** para João 3:16 (NT): verso verbatim +
    /// `scholarly_sources`/`original_tokens`/`lexicon` (espelhando o `seeded()` do core,
    /// `ai/lexicon.rs`, adaptado ao grego de Jo 3:16). Assim `verified_lexicon` retorna
    /// entradas + atribuição **STEP CC-BY**, e o modo Academic emite o aparato de citações
    /// → o Markdown acadêmico traz o rodapé de procedência com a atribuição. Colunas
    /// **exatas** do rev pinado; nenhum schema escrito à mão; lemas gregos sem aspas
    /// simples → seguros inline.
    fn build_kjv_lexicon_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture KJV+léxico");
            let conn = store.conn();

            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");
            let sql = format!(
                "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                 VALUES ('kjv',43,3,16,'{JOHN_3_16_KJV}')"
            );
            conn.execute(&sql, []).expect("inserir João 3:16");

            // Fontes (atribuição CC-BY verbatim): tokens gregos usam 'tagnt', léxico 'tbesg'.
            for (id, name) in [("tagnt", "TAGNT"), ("tbesg", "TBESG")] {
                let sql = format!(
                    "INSERT INTO scholarly_sources(id,name,license,embeddable,attribution,url,version) \
                     VALUES ('{id}','{name}','cc-by',1,'STEP Bible (CC BY 4.0)','u','v')"
                );
                conn.execute(&sql, []).expect("popular scholarly_sources");
            }

            // João 3:16 (book=43, NT): (word_index, strongs, lemma grego).
            let toks = [
                (1i64, "G0025", "ἀγαπάω"),
                (2, "G2889", "κόσμος"),
                (3, "G5207", "υἱός"),
            ];
            for (wi, st, lemma) in toks {
                let sql = format!(
                    "INSERT INTO original_tokens(testament,book_number,chapter,verse,word_index,\
                     surface,lemma,strongs,strongs_raw,source_id) \
                     VALUES ('NT',43,3,16,{wi},'{lemma}','{lemma}','{st}','{st}','tagnt')"
                );
                conn.execute(&sql, []).expect("popular original_tokens");
            }
            for (st, gloss) in [("G0025", "to love"), ("G2889", "world"), ("G5207", "son")] {
                let sql = format!(
                    "INSERT INTO lexicon(strongs,lemma,gloss,source_id) \
                     VALUES ('{st}','x','{gloss}','tbesg')"
                );
                conn.execute(&sql, []).expect("popular lexicon");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    #[test]
    fn academic_markdown_from_core_cites_store_and_step_attribution() {
        // F3.8: o Markdown acadêmico (SBL) vem da MESMA impl do core
        // (`StudyResult::to_academic_markdown`) via a fronteira (campo `academic_markdown`).
        // A fronteira NÃO reimplementa SBL/proveniência — apenas expõe o que o core formata.
        let db = build_kjv_lexicon_fixture();

        let result = deep_study(
            db.path(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            StudyMode::Academic,
            StudyLens::Presbyterian,
            StudyDepth::Exegetical,
            "en".to_string(),
            "mock".to_string(),
            None, // BYOK: sem chave (mock não faz rede)
            None,
        )
        .expect("deep_study (Academic, mock) deve retornar Ok");

        let md = &result.academic_markdown;

        // Bloco YAML do paper acadêmico (formato do core, não reimplementado no app).
        assert!(
            md.starts_with("---\ntitle:"),
            "Markdown acadêmico deve abrir com o bloco YAML do core: {md:.80}"
        );

        // (a) Texto citado VERBATIM do store (anti-alucinação): João 3:16 KJV.
        assert!(
            md.contains(JOHN_3_16_KJV),
            "Markdown acadêmico deve conter o texto do store verbatim (Jo 3:16 KJV): {md}"
        );
        assert!(
            md.contains("## Texto (acervo local)"),
            "seção de texto do acervo local (do core) ausente: {md}"
        );

        // (b) Atribuição STEP CC-BY no rodapé de procedência (do léxico verificado).
        assert!(
            md.contains("STEP Bible"),
            "rodapé de procedência deve trazer a atribuição STEP Bible: {md}"
        );
        assert!(
            md.contains("CC BY 4.0"),
            "rodapé de procedência deve trazer a licença CC BY 4.0: {md}"
        );

        // (c) Rótulo de interpretação GERADA POR IA (separação verificável × modelo).
        assert!(
            md.contains("**Gerado por IA:**"),
            "Markdown acadêmico deve rotular a análise como gerada por IA: {md}"
        );
        assert!(
            md.contains("confira sempre as fontes primárias"),
            "o rodapé de IA deve orientar a conferir as fontes primárias: {md}"
        );
        // O texto bíblico NÃO é produzido pelo modelo (a interpretação do mock não o contém).
        assert!(
            !result.interpretation.contains("For God so loved"),
            "o LLM/mock NÃO gera texto bíblico: {}",
            result.interpretation
        );

        // (d) Citações vêm do BANCO (léxico verificado) — nenhuma inventada pelo modelo.
        assert!(
            !result.citations.is_empty(),
            "Academic com léxico semeado → citations do banco não-vazias"
        );
        assert!(
            result
                .citations
                .iter()
                .any(|c| c.author.as_deref() == Some("STEP Bible")),
            "citações do banco devem trazer o autor STEP Bible (do léxico verificado): {:?}",
            result.citations
        );
        // A atribuição do Markdown reflete AS citações retornadas (mesma fonte, zero drift).
        assert!(
            result
                .citations
                .iter()
                .any(|c| c.license.as_deref() == Some("CC BY 4.0")),
            "citações do banco devem trazer a licença CC BY 4.0: {:?}",
            result.citations
        );
    }
}

/// Testes de host da **conversa/refinamento** da F3.4 (`ask_session_anchored`,
/// `refine_scope`, `parse_refinement`), **apenas no nativo** (o corpo ancorado toca o
/// store; molde F2.1/F3.3). Provam por **MOCK** (sem rede/chave): a âncora vem do **store
/// verbatim** e a interpretação/refinamento do **modelo**; o parser é determinístico.
#[cfg(all(test, not(target_arch = "wasm32")))]
mod session_tests {
    use super::*;
    use std::path::PathBuf;

    // ── Textos KJV **verbatim** (domínio público), usados SÓ no fixture/assert;
    //    nenhum texto bíblico é gerado em produção (anti-alucinação). ──────────────
    /// João 3:16 — King James Version.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
    /// João 3:17 — King James Version (prova de que o `cited_text` acompanha o STORE e a
    /// `interpretation` não).
    const JOHN_3_17_KJV: &str = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";

    /// Banco temporário do fixture: remove o arquivo (e sidecars WAL/SHM) no `Drop`.
    struct TmpDb(PathBuf);

    impl TmpDb {
        fn path(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for TmpDb {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            if let Some(name) = self.0.file_name().and_then(|n| n.to_str()) {
                let dir = self.0.parent().map(PathBuf::from).unwrap_or_default();
                let _ = std::fs::remove_file(dir.join(format!("{name}-wal")));
                let _ = std::fs::remove_file(dir.join(format!("{name}-shm")));
            }
        }
    }

    /// Caminho temporário único (offline, sem deps externas).
    fn unique_tmp_db() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "the-light-app-f3_4-{}-{nanos}-{n}.sqlite",
            std::process::id()
        ))
    }

    /// Constrói o fixture KJV: schema via migrações do core (`Store::open`) + DML de
    /// domínio público (João 3:16 e 3:17). A conexão fecha antes do uso pela fronteira.
    fn build_kjv_fixture() -> TmpDb {
        let path = unique_tmp_db();
        let _ = std::fs::remove_file(&path);

        {
            let store =
                the_light_core::store::Store::open(&path).expect("abrir/migrar fixture KJV");
            let conn = store.conn();

            conn.execute(
                "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
                 VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
                [],
            )
            .expect("inserir tradução kjv");

            for (chapter, verse, text) in [(3u16, 16u16, JOHN_3_16_KJV), (3, 17, JOHN_3_17_KJV)] {
                let sql = format!(
                    "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                     VALUES ('kjv',43,{chapter},{verse},'{text}')"
                );
                conn.execute(&sql, []).expect("inserir versículo João");
            }
        } // `store`/`conn` fecham aqui (flush no arquivo).

        TmpDb(path)
    }

    /// Resposta fixa do `MockLlmProvider` do core, obtida **do próprio core** (sem
    /// hardcode): como o `system` da conversa (`ask_session`) **não** contém o marcador
    /// `PERGUNTA:`, `complete` devolve a resposta canônica — **exatamente** o que a
    /// `ask_session` retorna com o mock, independentemente do texto bíblico. Prova que a
    /// `interpretation` é do **modelo**, não do store.
    fn mock_fixed_response() -> String {
        use the_light_core::ai::LlmProvider;
        the_light_core::ai::MockLlmProvider::default()
            .complete("sistema de teste sem marcador de refinamento", "usuario")
            .expect("mock complete não deve falhar (sem rede)")
    }

    #[test]
    fn ask_session_anchored_cites_store_verbatim_and_interprets_via_mock() {
        let db = build_kjv_fixture();

        let answer = ask_session_anchored(
            db.path(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            "en".to_string(),
            vec![ChatTurn {
                role: ChatRole::User,
                content: "What does this mean?".to_string(),
            }],
            None,
            None,
            "mock".to_string(),
            None, // BYOK: sem chave (mock não faz rede)
            None,
        )
        .expect("ask_session_anchored com o mock deve retornar Ok");

        // ── Anti-alucinação: cited_text é VERBATIM do store, numerado. ────────────
        assert!(
            answer.cited_text.contains("16 For God so loved the world"),
            "cited_text deve ser o versículo numerado verbatim do store: {}",
            answer.cited_text
        );
        assert!(
            answer.cited_text.contains(JOHN_3_16_KJV),
            "cited_text deve conter o texto KJV integral verbatim do store: {}",
            answer.cited_text
        );

        // ── interpretation é a saída do MODELO (mock), NÃO o texto bíblico. ───────
        assert_eq!(
            answer.interpretation,
            mock_fixed_response(),
            "interpretation deve ser a resposta fixa do MockLlmProvider"
        );
        assert!(
            !answer.interpretation.contains("For God so loved"),
            "o LLM/mock NÃO reproduz/gera texto bíblico na interpretation: {}",
            answer.interpretation
        );
        assert_ne!(
            answer.cited_text, answer.interpretation,
            "cited_text (store) e interpretation (modelo) são coisas distintas"
        );

        // ── Provedor/modelo e referência canônica. ───────────────────────────────
        assert_eq!(answer.provider, "mock", "provider deve ser 'mock'");
        assert_eq!(answer.model, "mock-1", "modelo do mock do core");
        assert_eq!(answer.reference.book, 43, "João é o livro 43");
        assert_eq!(answer.reference.chapter, 3, "capítulo 3");
        assert_eq!(
            answer.reference.verses,
            VerseRange::Single { verse: 16 },
            "versículo único 16"
        );
    }

    #[test]
    fn ask_session_anchored_multi_turn_no_panic() {
        // Multi-turno (User/Assistant/User): a invariante "context só no 1º turno de
        // usuário" é do core; a fronteira prova a separação citado/interpretação e que
        // vários turnos não causam panic.
        let db = build_kjv_fixture();

        let answer = ask_session_anchored(
            db.path(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            "en".to_string(),
            vec![
                ChatTurn {
                    role: ChatRole::User,
                    content: "q1".to_string(),
                },
                ChatTurn {
                    role: ChatRole::Assistant,
                    content: "a1".to_string(),
                },
                ChatTurn {
                    role: ChatRole::User,
                    content: "q2".to_string(),
                },
            ],
            None,
            None,
            "mock".to_string(),
            None,
            None,
        )
        .expect("multi-turno com o mock deve retornar Ok");

        assert!(
            answer.cited_text.contains(JOHN_3_16_KJV),
            "cited_text = passagem do store mesmo com múltiplos turnos: {}",
            answer.cited_text
        );
        assert_eq!(
            answer.interpretation,
            mock_fixed_response(),
            "interpretation = resposta fixa do mock (invariante aos turnos)"
        );
    }

    #[test]
    fn cited_text_tracks_store_while_interpretation_is_invariant() {
        // Prova anti-fake (molde F2.1): com O MESMO fixture/mock, conversar sobre dois
        // versículos distintos muda o `cited_text` (segue o STORE) mas NÃO a
        // `interpretation` (vem do modelo, não do texto bíblico).
        let db = build_kjv_fixture();

        let run = |verse: u16| -> AiAnswer {
            ask_session_anchored(
                db.path(),
                "kjv".to_string(),
                43,
                3,
                Some(verse),
                "en".to_string(),
                vec![ChatTurn {
                    role: ChatRole::User,
                    content: "What does this mean?".to_string(),
                }],
                None,
                None,
                "mock".to_string(),
                None,
                None,
            )
            .expect("ask_session_anchored deve retornar Ok")
        };

        let a16 = run(16);
        let a17 = run(17);

        // cited_text acompanha o store (textos verbatim diferentes por versículo).
        assert!(a16.cited_text.contains(JOHN_3_16_KJV));
        assert!(a17.cited_text.contains(JOHN_3_17_KJV));
        assert_ne!(
            a16.cited_text, a17.cited_text,
            "cited_text muda com o versículo do store"
        );

        // interpretation é a MESMA (a do modelo) — invariante ao texto bíblico.
        assert_eq!(
            a16.interpretation, a17.interpretation,
            "a interpretação do mock não depende do texto bíblico"
        );
        assert_eq!(a16.interpretation, mock_fixed_response());
    }

    #[test]
    fn refine_scope_with_mock_returns_canonical_round() {
        // O `refine_system_prompt` contém "PERGUNTA:" → o mock devolve a rodada canônica
        // (determinística, sem rede/chave).
        let refinement = refine_scope(
            StudyMode::Academic,
            "pt".to_string(),
            "graça em Efésios".to_string(),
            Vec::new(), // prior vazio
            1,
            "mock".to_string(),
            None,
            None,
        )
        .expect("refine_scope com o mock deve retornar Ok");

        assert!(
            !refinement.question.is_empty(),
            "a rodada de refinamento traz uma pergunta não-vazia: {:?}",
            refinement
        );
        assert_eq!(
            refinement.options.len(),
            3,
            "a rodada canônica do mock tem 3 opções: {:?}",
            refinement.options
        );
        assert!(
            refinement
                .options
                .iter()
                .any(|o| o.contains("Efésios 2.8-9")),
            "a rodada canônica do mock inclui 'Efésios 2.8-9': {:?}",
            refinement.options
        );
    }

    #[test]
    fn parse_refinement_is_deterministic() {
        // Pergunta explícita + opções.
        let r = parse_refinement("PERGUNTA: Foco?\n- v.16\n- Rm 5".to_string());
        assert_eq!(r.question, "Foco?");
        assert_eq!(r.options, vec!["v.16".to_string(), "Rm 5".to_string()]);

        // 1ª linha não-opção vira a pergunta; sem opções.
        let r = parse_refinement("foca no v.16".to_string());
        assert_eq!(r.question, "foca no v.16");
        assert!(r.options.is_empty());

        // Só opções, com duplicata → dedup; sem pergunta.
        let r = parse_refinement("- a\n- a\n- b".to_string());
        assert_eq!(r.question, "");
        assert_eq!(r.options, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn parse_refinement_empty_and_blank_do_not_panic() {
        let r = parse_refinement(String::new());
        assert_eq!(r.question, "");
        assert!(r.options.is_empty());

        let r = parse_refinement("   ".to_string());
        assert_eq!(r.question, "");
        assert!(r.options.is_empty());
    }

    #[test]
    fn error_paths_do_not_panic() {
        // refine_scope com provedor desconhecido → CoreError (via build_provider), nativo.
        let err = refine_scope(
            StudyMode::Academic,
            "pt".to_string(),
            "graça".to_string(),
            Vec::new(),
            1,
            "nope".to_string(),
            None,
            None,
        )
        .expect_err("provedor desconhecido deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));

        let db = build_kjv_fixture();

        // ask_session_anchored com provedor desconhecido → CoreError, sem panic.
        let err = ask_session_anchored(
            db.path(),
            "kjv".to_string(),
            43,
            3,
            Some(16),
            "en".to_string(),
            vec![ChatTurn {
                role: ChatRole::User,
                content: "q".to_string(),
            }],
            None,
            None,
            "nope".to_string(),
            None,
            None,
        )
        .expect_err("provedor desconhecido deve falhar");
        assert!(matches!(err, CoreError::Generic { .. }));

        // db_path = diretório existente → CoreError (via Store::open), sem panic.
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        let err = ask_session_anchored(
            dir,
            "kjv".to_string(),
            43,
            3,
            Some(16),
            "en".to_string(),
            vec![ChatTurn {
                role: ChatRole::User,
                content: "q".to_string(),
            }],
            None,
            None,
            "mock".to_string(),
            None,
            None,
        )
        .expect_err("db_path = diretório deve falhar no Store::open");
        assert!(matches!(err, CoreError::Generic { .. }));
    }
}
