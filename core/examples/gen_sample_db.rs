//! Gera de forma **reprodutível** o `assets/data/sample.sqlite` (subset KJV de
//! domínio público) usado pelo teste de host da F0.9 e, futuramente, embarcado no
//! app nativo.
//!
//! Regra "uma fonte da verdade": o **schema** vem das **migrações do
//! `the-light-core`** (`Store::open` cria/migra), nunca de SQL de schema escrito
//! à mão. Aqui só inserimos as linhas de **dados** (DML), com texto **verbatim**
//! de **domínio público** (KJV) — anti-alucinação: nenhum texto bíblico é
//! inventado.
//!
//! Uso (via `scripts/gen-sample-db.sh`, ou direto):
//!   cargo run --example gen_sample_db -- [caminho/de/saida.sqlite]
//! Sem argumento, escreve em `<core>/../assets/data/sample.sqlite`.
//!
//! Nativo-only: depende de `the_light_core::store` (feature `embedded`), fora do
//! grafo wasm (ADR-0005). No wasm o `main` é um stub vazio.

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    use the_light_core::store::Store;

    // João 3:16 — King James Version (domínio público). Verbatim.
    const JOHN_3_16_KJV: &str = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";

    let out = std::env::args().nth(1).unwrap_or_else(|| {
        format!(
            "{}/../assets/data/sample.sqlite",
            env!("CARGO_MANIFEST_DIR")
        )
    });

    // Regeneração determinística: recria o arquivo do zero (evita conflito de
    // UNIQUE/PK ao reinserir num banco já populado).
    if std::path::Path::new(&out).exists() {
        std::fs::remove_file(&out).expect("remover sample.sqlite antigo");
    }

    // Schema = migrações do core (uma fonte da verdade). Abre/cria/migra.
    let store = Store::open(&out).expect("abrir/migrar sample.sqlite");
    let conn = store.conn();

    // 1 tradução: KJV, inglês, domínio público, embarcável.
    conn.execute(
        "INSERT INTO translations(id,abbrev,name,language,license,embeddable) \
         VALUES ('kjv','KJV','King James Version','en','public-domain',1)",
        [],
    )
    .expect("inserir tradução kjv");

    // 1 livro: João (43), Novo Testamento. Honra o data-model (§6); não é exigido
    // por `passage()`, mas mantém o sample fiel ao schema.
    conn.execute(
        "INSERT INTO books(translation_id,number,name,abbrev,testament) \
         VALUES ('kjv',43,'John','Jhn','NT')",
        [],
    )
    .expect("inserir livro John");

    // 1 versículo: João 3:16, texto KJV **verbatim** (sem aspas simples → seguro
    // inline; nenhum schema é escrito à mão, apenas DML de dado público).
    conn.execute(
        "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
         VALUES ('kjv',43,3,16,'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.')",
        [],
    )
    .expect("inserir João 3:16");

    // Sanidade: o texto inline deve casar com a constante (guarda contra typo).
    let stored: String = conn
        .query_row(
            "SELECT text FROM verses WHERE translation_id='kjv' AND book_number=43 AND chapter=3 AND verse=16",
            [],
            |r| r.get(0),
        )
        .expect("ler João 3:16 recém-inserido");
    assert_eq!(
        stored, JOHN_3_16_KJV,
        "texto inserido deve ser KJV verbatim"
    );

    println!("sample.sqlite gerado: {out}");
}

#[cfg(target_arch = "wasm32")]
fn main() {}
