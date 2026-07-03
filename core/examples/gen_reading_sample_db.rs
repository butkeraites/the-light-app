//! Gera de forma **reprodutível** o `assets/data/reading-sample.sqlite`: a
//! **Bíblia de LEITURA completa** (KJV + Almeida 1911, domínio público) extraída do
//! `bible.sqlite` (corpus completo, gerado-ignorado, ADR-0013), com TODOS os
//! **66 livros × 2 traduções** para a UI de leitura/busca/xref (F1.3, ADR-0014).
//!
//! LEITURA = Bíblia COMPLETA (ADR-0056, F5.36): abrir Mateus 1 (ou qualquer livro fora
//! de Gênesis/Salmos/João) e a busca/xref cobrir a Bíblia inteira são parte do produto
//! — não um extra de dev. Por isso as tabelas de LEITURA (`books`, `verses`,
//! `cross_references`, `verses_fts`) copiam **todos os 66 livros** do `src`
//! (`bible.sqlite`). É DADO local, offline-first (download único cacheado em OPFS no web,
//! asset bundled no nativo) — nenhuma dependência de rede em runtime para ler.
//!
//! LÉXICO = ainda AMOSTRADO ({Gn,Sl,Jo}, ver `LEXICON_BOOKS`; ADR-0056): o léxico STEP
//! completo é ~90 MB e o estudo profundo é on-demand + AI-gated + secundário. Copiamos
//! `scholarly_sources` inteiro (poucas linhas: atribuição/FK) e `original_tokens`/
//! `lexicon` SÓ dos livros de `LEXICON_BOOKS` — assim `lexical_entries`/`deep_study`
//! (F3.2/F3.3) e a UI de estudo (F3.5) seguem com léxico + atribuição STEP no device para
//! esse subset. Léxico completo = follow-up F5.38 (opcional/nativo, on-demand).
//!
//! Regra "uma fonte da verdade" + anti-alucinação: o **schema** vem das
//! **migrações do `the-light-core`** (`Store::open` cria/migra), nunca de SQL de
//! schema à mão; o **texto** e o **léxico** são copiados **verbatim do store**
//! (`bible.sqlite`, domínio público / STEP Bible CC-BY), nunca inventados/hardcodados.
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

    // Léxico AINDA amostrado (ADR-0056, F5.36): Gênesis (1), Salmos (19), João (43).
    // A LEITURA (books/verses/cross_references/verses_fts) é a Bíblia COMPLETA — SEM
    // filtro de livro. `LEXICON_BOOKS` limita SÓ `original_tokens`/`lexicon` (o léxico
    // completo é ~90 MB, on-demand + AI-gated; completo = follow-up F5.38). João é
    // **obrigatório** aqui (asserções do self-test de estudo). Gênesis/Salmos dão
    // léxico em AT + NT nas duas traduções.
    const LEXICON_BOOKS: &[u8] = &[1, 19, 43];

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

    // Lista de livros do LÉXICO (só p/ `original_tokens`/`lexicon` abaixo; a LEITURA
    // é completa e não usa filtro de livro — ADR-0056).
    let lex_in_list = LEXICON_BOOKS
        .iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");

    // Livros (metadado por tradução): Bíblia COMPLETA — TODOS os 66 livros × 2
    // traduções, SEM filtro (ADR-0056/F5.36). É o que a UI de leitura lista.
    conn.execute(
        "INSERT INTO books(translation_id,number,name,abbrev,testament) \
         SELECT translation_id,number,name,abbrev,testament FROM src.books",
        [],
    )
    .expect("copiar livros (Bíblia completa: 66 × 2)");

    // Versículos: o texto **verbatim do store** (domínio público), Bíblia COMPLETA —
    // SEM filtro de livro (ADR-0056/F5.36). Nada reimplementado/inventado.
    let inserted = conn
        .execute(
            "INSERT INTO verses(translation_id,book_number,chapter,verse,text) \
             SELECT translation_id,book_number,chapter,verse,text FROM src.verses",
            [],
        )
        .expect("copiar versículos (verbatim do store, Bíblia completa)");

    // ── Referências cruzadas (xref) — pipeline de DADOS (ADR-0016, CC-BY) ─────
    // O schema do core cria `cross_references` (via `Store::open`) mas **não** tem
    // trigger que a popule a partir do corpus (mesmo princípio do `verses_fts`):
    // sem isto, `cross_refs(...)` no device (F1.8/F1.9) retornaria **vazio**.
    // Copiamos do corpus completo (`src`) TODAS as xrefs — SEM o filtro "ambos os
    // lados no subset" (ADR-0056/F5.36): agora que a leitura tem os 66 livros, o
    // capítulo de DESTINO de qualquer xref existe em `reading-sample.sqlite` (ao
    // tocar uma xref na UI, F1.9, `get_chapter` resolve). É DADO/fixture (verbatim
    // do store, ADR-0016/CC-BY): a query/ordenação por votos/filtro de xref
    // continuam no core (`xref::for_verse`), chamados pela fronteira `cross_refs`
    // (F1.8) — nada de xref é reimplementado aqui.
    let xrefs = conn
        .execute(
            "INSERT INTO cross_references(from_book,from_chapter,from_verse,\
             to_book,to_chapter,to_verse_start,to_verse_end,votes) \
             SELECT from_book,from_chapter,from_verse,\
             to_book,to_chapter,to_verse_start,to_verse_end,votes \
             FROM src.cross_references",
            [],
        )
        .expect("copiar referências cruzadas (Bíblia completa)");

    // ── Léxico / línguas originais (pipeline de DADOS, ADR-0027; STEP Bible CC-BY) ──
    // O schema v2 do core cria `scholarly_sources`/`original_tokens`/`lexicon` (via
    // `Store::open`) mas o gerador NÃO as populava — sem isto, `lexical_entries(...)`/
    // `deep_study(...)` no device (F3.2/F3.3, UI da F3.5) retornariam léxico VAZIO e a
    // atribuição STEP CC-BY não apareceria. Propagamos do corpus completo (`src`) —
    // mesmo molde do xref/`verses_fts` acima. É DADO/fixture (verbatim do store, STEP
    // Bible / TBESH–TBESG, CC BY 4.0, ADR-0026): a query/JOIN/agregação de léxico
    // continuam no core (`ai::lexicon::verified_lexicon`), chamados pela fronteira
    // `lexical_entries` — nada de léxico é reimplementado aqui.
    //
    // ORDEM (FKs ligadas por `Store::open`): `scholarly_sources` ANTES de
    // `original_tokens`/`lexicon` (ambos `REFERENCES scholarly_sources(id)`).
    //
    // (a) TODAS as `scholarly_sources` (4 linhas: tahot/tagnt/tbesh/tbesg — atribuição
    //     STEP CC-BY verbatim). Poucas linhas; copiar todas evita FK órfã e mantém as
    //     atribuições disponíveis para qualquer token/léxico copiado.
    let sources = conn
        .execute(
            "INSERT INTO scholarly_sources(id,name,license,embeddable,attribution,url,version) \
             SELECT id,name,license,embeddable,attribution,url,version FROM src.scholarly_sources",
            [],
        )
        .expect("copiar scholarly_sources (atribuição STEP CC-BY)");

    // (b) `original_tokens` dos versículos dos livros de `LEXICON_BOOKS` {Gn,Sl,Jo} —
    //     léxico AINDA amostrado (ADR-0056; completo = ~90 MB, F5.38). Chaveados por
    //     (book_number,chapter,verse) — casam com `verses` (que agora tem a Bíblia
    //     inteira); é o que o `verified_lexicon` do core lê para agregar por Strong base.
    let tokens = conn
        .execute(
            &format!(
                "INSERT INTO original_tokens(id,testament,book_number,chapter,verse,\
                 word_index,surface,translit,lemma,strongs,strongs_raw,morph_code,gloss,source_id) \
                 SELECT id,testament,book_number,chapter,verse,\
                 word_index,surface,translit,lemma,strongs,strongs_raw,morph_code,gloss,source_id \
                 FROM src.original_tokens WHERE book_number IN ({lex_in_list})"
            ),
            [],
        )
        .expect("copiar original_tokens dos livros de LEXICON_BOOKS");

    // (c) `lexicon`: SOMENTE as linhas referenciadas pelos Strong dos tokens copiados
    //     (poucos milhares vs. o léxico inteiro ~22,7k) — mantém o léxico amostrado
    //     enxuto (ADR-0056). O JOIN `l.strongs = t.strongs` do core casa por Strong;
    //     copiamos o léxico dessas chaves.
    let lexicon = conn
        .execute(
            &format!(
                "INSERT INTO lexicon(strongs,lemma,translit,pron,gloss,gloss_pt,definition,derivation,source_id) \
                 SELECT strongs,lemma,translit,pron,gloss,gloss_pt,definition,derivation,source_id \
                 FROM src.lexicon WHERE strongs IN (\
                   SELECT DISTINCT strongs FROM src.original_tokens \
                   WHERE book_number IN ({lex_in_list}) AND strongs IS NOT NULL AND strongs <> ''\
                 )"
            ),
            [],
        )
        .expect("copiar lexicon referenciado pelos tokens de LEXICON_BOOKS");

    conn.execute("DETACH DATABASE src", [])
        .expect("desanexar src");

    // ── Índice FTS5 (pipeline de DADOS, não busca) ───────────────────────────
    // O schema do core cria `verses_fts` mas **não** tem trigger que o popule a
    // partir de `verses` (gotcha documentado na F1.5: sem isto, `search(...)` no
    // subset retorna 0 hits). Replicamos cada linha de `verses` no índice com
    // `verse_id` = `verses.id` — exatamente o que a busca do core espera no JOIN
    // `verses v ON v.id = verses_fts.verse_id` (idêntico ao fixture da F1.5 e ao
    // importador do core). É DADO/fixture: o `MATCH`/BM25/`highlight` continuam no
    // core, chamados pela fronteira `search` (F1.5) — nada de busca é reimplementado.
    let indexed = conn
        .execute(
            "INSERT INTO verses_fts(text, translation_id, verse_id) \
             SELECT text, translation_id, id FROM verses",
            [],
        )
        .expect("popular verses_fts a partir do subset");

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

    // Sanidade Bíblia COMPLETA (ADR-0056/F5.36): 66 livros DISTINTOS por tradução e
    // Mateus (livro 40) presente com ≥1 capítulo em KJV e Almeida — o bug que esta
    // tarefa corrige ("Mateus 1 indisponível") não pode voltar sem falhar aqui.
    for tid in ["kjv", "alm1911"] {
        let n_books: i64 = conn
            .query_row(
                "SELECT count(DISTINCT number) FROM books WHERE translation_id=?1",
                [tid],
                |r| r.get(0),
            )
            .unwrap_or_else(|e| panic!("contar livros de {tid}: {e}"));
        assert_eq!(
            n_books, 66,
            "leitura deve ter 66 livros em {tid} (Bíblia completa), veio {n_books}"
        );
        let matthew_chapters: u16 = conn
            .query_row(
                "SELECT COALESCE(max(chapter),0) FROM verses WHERE translation_id=?1 AND book_number=40",
                [tid],
                |r| r.get(0),
            )
            .unwrap_or_else(|e| panic!("max(chapter) de Mateus em {tid}: {e}"));
        assert!(
            matthew_chapters >= 1,
            "Mateus (livro 40) deve ter ≥1 capítulo em {tid} (bug F5.36), veio {matthew_chapters}"
        );
    }

    // Sanidade do índice FTS5: 1 linha por versículo (a busca depende disto).
    // A prova de que a BUSCA retorna hits vive no device (self-test TLA_SEARCH,
    // que chama a fronteira `search` → core); aqui só garantimos que o índice
    // está povoado (sem reimplementar `MATCH`/BM25 no pipeline).
    assert_eq!(
        indexed as i64, inserted as i64,
        "verses_fts deve ter 1 linha por versículo copiado"
    );

    // Sanidade xref (anti-fake; dado LIDO do banco): a tabela ficou populada e
    // João 3:16 tem ≥1 xref no subset. A prova de que `cross_refs` ORDENA/FILTRA
    // por votos vive no core (testes da F1.8) e no device (self-test TLA_XREF da
    // F1.9, que chama a fronteira `cross_refs` → core); aqui só garantimos que os
    // DADOS existem (sem reimplementar a xref no pipeline).
    let xref_total: i64 = conn
        .query_row("SELECT count(*) FROM cross_references", [], |r| r.get(0))
        .expect("contar cross_references do subset");
    assert!(
        xref_total > 0,
        "cross_references deve ser populada (Bíblia completa, ADR-0056)"
    );
    let john_3_16_xrefs: i64 = conn
        .query_row(
            "SELECT count(*) FROM cross_references \
             WHERE from_book=43 AND from_chapter=3 AND from_verse=16",
            [],
            |r| r.get(0),
        )
        .expect("contar xrefs de João 3:16");
    assert!(
        john_3_16_xrefs >= 1,
        "João 3:16 deve ter ≥1 xref (Bíblia completa)"
    );

    // Sanidade léxico (ADR-0027; dado LIDO do banco): João 3:16 tem ≥1 token com Strong
    // (base da prova TLA_STUDY: `lexicon>=1`) e a atribuição STEP CC-BY está presente. A
    // prova de que `lexical_entries`/`deep_study` AGREGAM/verificam vive no core (F3.2/
    // F3.3) e no device (self-test TLA_STUDY da F3.5); aqui só garantimos que os DADOS
    // existem (sem reimplementar o léxico no pipeline).
    let john_3_16_tokens: i64 = conn
        .query_row(
            "SELECT count(*) FROM original_tokens \
             WHERE book_number=43 AND chapter=3 AND verse=16 \
             AND strongs IS NOT NULL AND strongs <> ''",
            [],
            |r| r.get(0),
        )
        .expect("contar tokens Strong de João 3:16 no léxico amostrado");
    assert!(
        john_3_16_tokens >= 1,
        "João 3:16 deve ter ≥1 token com Strong (léxico amostrado LEXICON_BOOKS, ADR-0027/0056)"
    );
    let step_sources: i64 = conn
        .query_row(
            "SELECT count(*) FROM scholarly_sources WHERE attribution LIKE '%STEP Bible%'",
            [],
            |r| r.get(0),
        )
        .expect("contar fontes STEP no subset");
    assert!(
        step_sources >= 1,
        "atribuição STEP Bible CC-BY deve estar presente no subset (ADR-0026/0027)"
    );

    println!(
        "reading-sample.sqlite gerado: {out}\n  \
         [LEITURA=Bíblia completa 66×2] traduções={translations} versículos={inserted} \
         verses_fts={indexed} cross_references={xrefs} joão_3_16_xrefs={john_3_16_xrefs} \
         joão_capítulos_kjv={john_chapters}\n  \
         [LÉXICO=amostrado {LEXICON_BOOKS:?}] scholarly_sources={sources} original_tokens={tokens} \
         lexicon={lexicon} joão_3_16_tokens_strong={john_3_16_tokens} step_sources={step_sources}"
    );
}

#[cfg(target_arch = "wasm32")]
fn main() {}
