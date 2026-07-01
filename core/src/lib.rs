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
}
