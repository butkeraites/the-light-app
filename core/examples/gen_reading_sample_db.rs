//! Gera de forma **reprodutível** o `assets/data/reading-sample.sqlite`: um
//! **subset de leitura** (KJV + Almeida 1911, domínio público) extraído do
//! `bible.sqlite` (corpus completo, gerado-ignorado, ADR-0013), contendo alguns
//! livros inteiros para a UI de leitura nativa da F1.3 (ADR-0014).
//!
//! Por que um subset (ADR-0014): o `bible.sqlite` completo tem ~47 MB. Empacotá-lo
//! como asset no app nativo inflaria o bundle. Para **provar a leitura real no
//! device** (e habilitar a navegação livro→capítulo→texto + seletor de versão)
//! basta um subset com **João KJV completo (21 capítulos)** — exigido pelas
//! asserções do self-test (`chapter_count(kjv,43)==21`, `get_chapter(kjv,43,3)`
//! v16 verbatim) — mais Gênesis e Salmos (AT) para uma navegação plausível em
//! ambas as traduções. O banco completo fica para uma otimização posterior.
//!
//! Regra "uma fonte da verdade" + anti-alucinação: o **schema** vem das
//! **migrações do `the-light-core`** (`Store::open` cria/migra), nunca de SQL de
//! schema à mão; o **texto** é copiado **verbatim do store** (`bible.sqlite`,
//! domínio público), nunca inventado/hardcodado.
//!
//! Uso (via `scripts/gen-reading-sample-db.sh`, ou direto):
//!   cargo run --example gen_reading_sample_db -- [saida.sqlite] [origem.sqlite]
//! Sem argumentos: saída = `<core>/../assets/data/reading-sample.sqlite`,
//! origem = `<core>/../assets/data/bible.sqlite`.
//!
//! Nativo-only: depende de `the_light_core::store` (feature `embedded`), fora do
//! grafo wasm (ADR-0005). No wasm o `main` é um stub vazio.

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    use the_light_core::store::Store;

    // João 3:16 — King James Version (domínio público). Usado SÓ para a asserção
    // de sanidade (guarda contra corpus de origem corrompido); o dado gravado vem
    // do `bible.sqlite`, não desta constante (anti-alucinação).
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

    // Livros incluídos no subset (números canônicos): Gênesis (1), Salmos (19),
    // João (43). João é **obrigatório** (asserções do self-test). Gênesis/Salmos
    // dão navegação plausível em AT + NT, nas duas traduções.
    const BOOKS: &[u8] = &[1, 19, 43];

    let mut args = std::env::args().skip(1);
    let out = args.next().unwrap_or_else(|| {
        format!(
            "{}/../assets/data/reading-sample.sqlite",
            env!("CARGO_MANIFEST_DIR")
        )
    });
    let source = args
        .next()
        .unwrap_or_else(|| format!("{}/../assets/data/bible.sqlite", env!("CARGO_MANIFEST_DIR")));

    if !std::path::Path::new(&source).exists() {
        eprintln!(
            "gen_reading_sample_db: corpus de origem ausente em {source}\n  \
             (gere primeiro com ./scripts/gen-bible-db.sh — ADR-0013)"
        );
        std::process::exit(1);
    }
    // Segurança do inline do ATTACH: o caminho não pode conter aspas simples.
    assert!(
        !source.contains('\''),
        "caminho de origem com aspas simples não é suportado: {source}"
    );

    // Regeneração determinística: recria o arquivo do zero.
    if std::path::Path::new(&out).exists() {
        std::fs::remove_file(&out).expect("remover reading-sample.sqlite antigo");
    }

    // Schema = migrações do core (uma fonte da verdade). Abre/cria/migra.
    let store = Store::open(&out).expect("abrir/migrar reading-sample.sqlite");
    let conn = store.conn();

    // Anexa o corpus completo como `src` e copia SOMENTE os dados (DML) do subset.
    conn.execute(&format!("ATTACH DATABASE '{source}' AS src"), [])
        .expect("anexar bible.sqlite como src");

    // Traduções: as que existirem no corpus (kjv + alm1911).
    conn.execute(
        "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
         SELECT id,abbrev,name,language,license,embeddable FROM src.translations",
        [],
    )
    .expect("copiar traduções");

    let in_list = BOOKS
        .iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");

    // Livros (metadado por tradução): mantém o subset fiel ao schema.
    conn.execute(
        &format!(
            "INSERT INTO books(translation_id,number,name,abbrev,testament) \
             SELECT translation_id,number,name,abbrev,testament FROM src.books \
             WHERE number IN ({in_list})"
        ),
        [],
    )
    .expect("copiar livros");

    // Versículos: o texto **verbatim do store** (domínio público).
    let inserted = conn
        .execute(
            &format!(
                "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
                 SELECT translation_id,book_number,chapter,verse,text FROM src.verses \
                 WHERE book_number IN ({in_list})"
            ),
            [],
        )
        .expect("copiar versículos");

    conn.execute("DETACH DATABASE src", [])
        .expect("desanexar src");

    // ── Sanidade (asserções do self-test) ───────────────────────────────────
    let john_chapters: u16 = conn
        .query_row(
            "SELECT COALESCE(max(chapter),0) FROM verses WHERE translation_id='kjv' AND book_number=43",
            [],
            |r| r.get(0),
        )
        .expect("max(chapter) de João KJV");
    assert_eq!(
        john_chapters, 21,
        "João KJV deve ter 21 capítulos no subset"
    );

    let john_3_16: String = conn
        .query_row(
            "SELECT text FROM verses WHERE translation_id='kjv' AND book_number=43 AND chapter=3 AND verse=16",
            [],
            |r| r.get(0),
        )
        .expect("João 3:16 KJV presente no subset");
    assert_eq!(
        john_3_16, JOHN_3_16_KJV,
        "João 3:16 KJV deve ser verbatim do store"
    );

    let translations: i64 = conn
        .query_row("SELECT count(*) FROM translations", [], |r| r.get(0))
        .expect("contar traduções");

    println!(
        "reading-sample.sqlite gerado: {out}\n  \
         traduções={translations} livros={:?} versículos={inserted} joão_capítulos_kjv={john_chapters}",
        BOOKS
    );
}

#[cfg(target_arch = "wasm32")]
fn main() {}
