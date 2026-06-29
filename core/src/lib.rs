//! `the-light-app-core` — fronteira UniFFI do app (esqueleto da F0.2).
//!
//! Esta crate prova que um crate Rust com fronteira **UniFFI** compila, formata
//! e passa em `clippy -D warnings`/`test` neste ambiente, estabelecendo o
//! **padrão de erro** que as tarefas seguintes vão reutilizar.
//!
//! Escopo estrito: **sem lógica de produto** e **sem** depender do
//! `the-light-core`. O `parse_reference` real e a delegação ao
//! `the-light-core::reference` são da **F0.3**.
//!
//! Caminho UniFFI: modo *library* (proc-macros + [`uniffi::setup_scaffolding`]),
//! sem UDL e sem `build.rs` (ver ADR-0003 em `DECISIONS.md`).

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
}
