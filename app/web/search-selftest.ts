// app/web/search-selftest.ts — F1.6 (ADR-0014/0015)
//
// Self-test HEADLESS de BUSCA no NATIVO (molde F1.3/F1.4). Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco bundled (db.ts) e
// exercita a BUSCA REAL pela fronteira nativa (reading.ts → binding gerado `search`
// → JSI → the_light_core::search, FTS5/BM25). Emite um marcador estável COMPOSTO
// DO RETORNO REAL do Rust — sem hardcode do texto bíblico (anti-alucinação).
// Capturado por `simctl log` (iOS) / `adb logcat`.
//
// Marcador:
//   TLA_SEARCH query="God" hits=<N> first_ref="John 3:16" first_text="For God so loved..."
//     - `hits`       = result.length (do retorno de `search`).
//     - `first_ref`  = referência do hit de João 3:16 LOCALIZADO no resultado
//                      (nome via listBooks().nameEn + capítulo:versículo).
//     - `first_text` = `hit.text` VERBATIM do store (texto LIMPO, sem os marcadores
//                      de controle HL_START/HL_END — esses só existem em
//                      `hit.highlighted` e viram estilo na UI, nunca no marcador).
//
// DETERMINISMO da prova (F6.5): a busca "God" na KJV da Bíblia COMPLETA (F5.36) tem
// ~3892 hits e o BM25 do core ranqueia João 3:16 em ~1980º (uma única ocorrência de
// "God" num versículo longo) — FORA de qualquer top-N ou limite estável (o antigo
// PROOF_LIMIT=1000 achava João 3:16 só no subset de 3 livros). Em vez de aumentar
// cegamente o limite, ESCOPAMOS a busca ao LIVRO 43 (João) pela fronteira `search`
// (parâmetro `book`, F1.5): assim o versículo CONHECIDO (João 3:16) está SEMPRE no
// conjunto retornado — determinístico e independente do ranking global —, provando a
// MESMA busca/texto que o headless `search.web.test.mjs` (search(...,"kjv",43,1000))
// e a F6.2, SEM hardcodear nem reimplementar busca/ranking. `limit` segue generoso.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `search-selftest.web.ts` (SKIP — busca web = F1.14), mantendo `expo-file-system`
// e o banco bundled FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { stripMarkers } from '../lib/highlight';
import { search, listBooks } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_SEARCH';

// Livro-alvo da prova: 43 = João. ESCOPAR a busca a João (F6.5) torna João 3:16
// determinístico no retorno na Bíblia completa, sem depender do ranking BM25 global.
const SEARCH_BOOK = 43;

// Limite generoso (>> total de hits de "God" em João) p/ garantir que o versículo-alvo
// conhecido (João 3:16) esteja no conjunto retornado pela fronteira mesmo com o escopo.
const PROOF_LIMIT = 1000;

/** Emite uma linha nos dois canais (log + error) p/ robustez de captura. */
function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/**
 * Prova de busca. Emite (tudo do RETORNO de `search`, não hardcoded):
 *   TLA_SEARCH query="God" hits=<N> first_ref="John 3:16" first_text="For God so loved..."
 */
export async function runSearchSelfTest(): Promise<void> {
  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  try {
    // Busca REAL pela fronteira (FTS5/BM25 no core). `book`=SEARCH_BOOK (João, 43 —
    // escopo determinístico p/ João 3:16 na Bíblia completa; ver nota no topo),
    // `limit`=PROOF_LIMIT (completude).
    const result = await search(dbPath, 'God', 'kjv', SEARCH_BOOK, PROOF_LIMIT);

    // Localiza o hit de João 3:16 (livro 43, cap. 3, versículo único 16) NO RETORNO.
    const hit = result.find((h) => {
      const v = h.reference.verses;
      return (
        h.reference.book === 43 &&
        h.reference.chapter === 3 &&
        v.tag === 'Single' &&
        v.inner.verse === 16
      );
    });

    if (!hit) {
      emit(`${MARK} ERROR john_3_16_not_found hits=${result.length}`);
      return;
    }

    // Referência legível: nome EN do livro (cânon puro) + capítulo:versículo.
    const bookName =
      listBooks().find((b) => b.number === hit.reference.book)?.nameEn ?? `Book ${hit.reference.book}`;
    const firstRef = `${bookName} ${hit.reference.chapter}:16`;

    // `hit.text` já é o texto LIMPO (verbatim) do store; `stripMarkers` é defensivo
    // (os marcadores de controle nunca devem entrar no marcador de log). JSON.stringify
    // gera as aspas → casa o formato `first_ref="John 3:16"` / `first_text="..."`.
    emit(
      `${MARK} query="God" hits=${result.length} first_ref=${JSON.stringify(firstRef)} first_text=${JSON.stringify(stripMarkers(hit.text))}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
