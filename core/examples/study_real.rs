//! F3.10 — Validação REAL do ESTUDO PROFUNDO (+ conversa + pesquisa web) com a chave
//! BYOK do usuário. Molde de `ask_real.rs` (F2.6).
//!
//! A chave vem SEMPRE de `AI_API_KEY` (env var) e **nunca** é impressa/commitada.
//! Só compila offline; a chamada real (rede) ao provedor só acontece quando VOCÊ roda.
//!
//! Uso (no SEU terminal — a chave fica só na env var, nunca no chat/git/log):
//!
//!   AI_PROVIDER=gemini AI_MODEL=gemini-2.5-flash AI_API_KEY="<sua-chave>" \
//!     cargo run --manifest-path core/Cargo.toml --example study_real
//!
//! Para incluir pesquisa web (Wikipedia, keyless, opt-in):
//!   ... AI_RESEARCH=wikipedia cargo run ... --example study_real
//!
//! Env vars:
//!   AI_PROVIDER   (obrig.)  anthropic | openai | gemini | ollama
//!   AI_API_KEY    (obrig. p/ nuvem)   — a chave BYOK; NUNCA impressa
//!   AI_MODEL      (opc.)    ex.: gemini-2.5-flash
//!   AI_MODE       (opc.)    academic | devotional | introductory | sermon   (default academic)
//!   AI_LENS       (opc.)    baptist | presbyterian | lutheran | pentecostal | catholic | orthodox
//!   AI_DEPTH      (opc.)    overview | exegetical | wordstudy   (default exegetical)
//!   AI_RESEARCH   (opc.)    wikipedia | tavily | mock  — liga a pesquisa web (opt-in)
//!   AI_REF_BOOK/AI_REF_CHAPTER/AI_REF_VERSE  (opc.)  default 43/3/16 (João 3:16)
//!   AI_TRANSLATION (opc.)   default kjv    · AI_LANG (opc.) default en
//!   TLA_DB        (opc.)    caminho do .sqlite; default = assets/data/bible.sqlite (tem léxico da F3.1)
//!
//! Sucesso = imprime o `passage_text` (do STORE, verbatim), a `interpretation` REAL do
//! provedor, as `citations` (do banco/léxico/web) e o Markdown acadêmico — prova de
//! anti-alucinação (fatos das fontes locais; o LLM só interpreta).

use the_light_app_core::{StudyDepth, StudyLens, StudyMode};

fn parse_mode(s: &str) -> StudyMode {
    match s.to_lowercase().as_str() {
        "devotional" => StudyMode::Devotional,
        "introductory" => StudyMode::Introductory,
        "sermon" => StudyMode::Sermon,
        _ => StudyMode::Academic,
    }
}
fn parse_lens(s: &str) -> StudyLens {
    match s.to_lowercase().as_str() {
        "presbyterian" => StudyLens::Presbyterian,
        "lutheran" => StudyLens::Lutheran,
        "pentecostal" => StudyLens::Pentecostal,
        "catholic" => StudyLens::Catholic,
        "orthodox" => StudyLens::Orthodox,
        _ => StudyLens::Baptist,
    }
}
fn parse_depth(s: &str) -> StudyDepth {
    match s.to_lowercase().as_str() {
        "overview" => StudyDepth::Overview,
        "wordstudy" => StudyDepth::WordStudy,
        _ => StudyDepth::Exegetical,
    }
}
fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn main() {
    let provider = env("AI_PROVIDER").unwrap_or_default();
    if provider.is_empty() {
        eprintln!("ERRO: defina AI_PROVIDER (anthropic|openai|gemini|ollama).");
        std::process::exit(2);
    }
    let key = env("AI_API_KEY");
    let model = env("AI_MODEL");
    let mode = parse_mode(&env("AI_MODE").unwrap_or_default());
    let lens = parse_lens(&env("AI_LENS").unwrap_or_default());
    let depth = parse_depth(&env("AI_DEPTH").unwrap_or_else(|| "exegetical".into()));
    let research = env("AI_RESEARCH");
    let book: u8 = env("AI_REF_BOOK")
        .and_then(|v| v.parse().ok())
        .unwrap_or(43);
    let chapter: u16 = env("AI_REF_CHAPTER")
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);
    let verse: Option<u16> = Some(
        env("AI_REF_VERSE")
            .and_then(|v| v.parse().ok())
            .unwrap_or(16),
    );
    let translation = env("AI_TRANSLATION").unwrap_or_else(|| "kjv".into());
    let lang = env("AI_LANG").unwrap_or_else(|| "en".into());
    let db = env("TLA_DB")
        .unwrap_or_else(|| format!("{}/../assets/data/bible.sqlite", env!("CARGO_MANIFEST_DIR")));

    eprintln!("== F3.10 study_real ==");
    eprintln!(
        "provider={provider}  model={}",
        model.as_deref().unwrap_or("(default)")
    );
    eprintln!(
        "key={}",
        if key.is_some() {
            "(presente — não exibida)"
        } else {
            "(ausente)"
        }
    );
    eprintln!(
        "mode={mode:?} lens={lens:?} depth={depth:?} research={}",
        research.as_deref().unwrap_or("(off)")
    );
    eprintln!("ref={book}/{chapter}/{verse:?}  translation={translation}  lang={lang}  db={db}");
    eprintln!(
        "---- chamando deep_study (rede REAL ao provedor{}) ----",
        if research.is_some() {
            " + pesquisa web"
        } else {
            ""
        }
    );

    match the_light_app_core::deep_study(
        db,
        translation,
        book,
        chapter,
        verse,
        mode,
        lens,
        depth,
        lang,
        provider,
        key,
        model,
        research,
    ) {
        Ok(s) => {
            println!("PROVIDER   : {}", s.provider);
            println!("MODEL      : {}", s.model);
            println!("REFERENCE  : {}", s.reference_label);
            println!();
            println!("PASSAGE_TEXT (do STORE — texto bíblico verbatim):");
            println!("{}", s.passage_text);
            println!();
            println!("INTERPRETATION (IA — confira nas Escrituras):");
            println!("{}", s.interpretation);
            println!();
            println!("SECTIONS   : {}", s.sections.len());
            println!("WARNINGS   : {:?}", s.warnings);
            println!(
                "CITATIONS  : {} (do banco/léxico/web — nunca do modelo)",
                s.citations.len()
            );
            for c in &s.citations {
                let label = c.title.as_deref().or(c.url.as_deref()).unwrap_or(&c.key);
                println!("  - [{}] {} {}", c.kind, c.key, label);
            }
            println!();
            println!(
                "ACADEMIC_MARKDOWN: {} chars (SBL, do core)",
                s.academic_markdown.len()
            );
            eprintln!("== OK: estudo REAL recebido. Verifique que PASSAGE_TEXT é João 3:16 do store e as citações vêm das fontes locais ==");
        }
        Err(e) => {
            // Erros do core NÃO incluem a chave (só nome do provedor/mensagem HTTP).
            eprintln!("ERRO deep_study: {e:?}");
            std::process::exit(1);
        }
    }
}
