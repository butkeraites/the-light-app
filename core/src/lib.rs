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
