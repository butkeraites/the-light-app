//! F2.6 — Validação REAL do `ask` ancorado com a chave BYOK do usuário.
//!
//! A chave vem SEMPRE de uma variável de ambiente (`AI_API_KEY`) e **nunca** é
//! impressa nem commitada. Este harness só compila offline; a chamada real ao
//! provedor (rede) só acontece quando VOCÊ o roda com a sua chave.
//!
//! Uso (no SEU terminal — a chave fica só na env var, nunca no chat/git/log):
//!
//!   AI_PROVIDER=gemini AI_API_KEY="<sua-chave>" \
//!     cargo run --manifest-path core/Cargo.toml --example ask_real
//!
//! Env vars:
//!   AI_PROVIDER  (obrigatória)  anthropic | openai | gemini | ollama
//!   AI_API_KEY   (obrigatória p/ provedores de nuvem; ollama pode dispensar)
//!   AI_MODEL     (opcional)     ex.: gemini-2.0-flash — default do provedor se ausente
//!   AI_QUESTION  (opcional)     pergunta; default abaixo
//!   AI_REFERENCE (opcional)     default "John 3:16"
//!   AI_TRANSLATION (opcional)   default "kjv"
//!   AI_LANG      (opcional)     default "en"
//!   TLA_DB       (opcional)     caminho do .sqlite; default = assets/data/sample.sqlite
//!
//! Sucesso = imprime a `interpretation` REAL do provedor E o `cited_text`
//! (que DEVE ser João 3:16 verbatim do STORE — prova de anti-alucinação:
//! o texto bíblico vem do banco local, o LLM só interpreta).

fn main() {
    // A chave é lida para uma variável local e passada à fronteira; NUNCA impressa.
    let provider = std::env::var("AI_PROVIDER").unwrap_or_default();
    if provider.is_empty() {
        eprintln!("ERRO: defina AI_PROVIDER (anthropic|openai|gemini|ollama).");
        std::process::exit(2);
    }
    let key = std::env::var("AI_API_KEY").ok().filter(|k| !k.is_empty());
    let model = std::env::var("AI_MODEL").ok().filter(|m| !m.is_empty());
    let question = std::env::var("AI_QUESTION").unwrap_or_else(|_| {
        "In one short paragraph, what does this verse teach about God's love?".to_string()
    });
    let reference = std::env::var("AI_REFERENCE").unwrap_or_else(|_| "John 3:16".to_string());
    let translation = std::env::var("AI_TRANSLATION").unwrap_or_else(|_| "kjv".to_string());
    let lang = std::env::var("AI_LANG").unwrap_or_else(|_| "en".to_string());
    let db = std::env::var("TLA_DB").unwrap_or_else(|_| {
        format!(
            "{}/../assets/data/sample.sqlite",
            env!("CARGO_MANIFEST_DIR")
        )
    });

    eprintln!("== F2.6 ask_real ==");
    eprintln!("provider = {provider}");
    eprintln!(
        "model    = {}",
        model.as_deref().unwrap_or("(default do provedor)")
    );
    eprintln!(
        "key      = {}",
        if key.is_some() {
            "(presente — não exibida)"
        } else {
            "(ausente)"
        }
    );
    eprintln!("db       = {db}");
    eprintln!("reference= {reference}  translation= {translation}  lang= {lang}");
    eprintln!("question = {question}");
    eprintln!("---- chamando ask_anchored (rede REAL ao provedor) ----");

    match the_light_app_core::ask_anchored(
        db,
        translation,
        reference,
        question,
        provider,
        key,
        model,
        lang,
    ) {
        Ok(ans) => {
            println!("PROVIDER   : {}", ans.provider);
            println!("MODEL      : {}", ans.model);
            println!("REFERENCE  : {:?}", ans.reference);
            println!();
            println!("CITED_TEXT (do STORE — texto bíblico verbatim):");
            println!("{}", ans.cited_text);
            println!();
            println!("INTERPRETATION (IA — confira nas Escrituras):");
            println!("{}", ans.interpretation);
            println!();
            eprintln!(
                "== OK: resposta REAL recebida. Verifique que CITED_TEXT é João 3:16 do store =="
            );
        }
        Err(e) => {
            // Os erros do core NÃO incluem a chave (só nome do provedor/mensagem HTTP).
            eprintln!("ERRO ask_anchored: {e:?}");
            std::process::exit(1);
        }
    }
}
