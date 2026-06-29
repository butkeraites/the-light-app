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
