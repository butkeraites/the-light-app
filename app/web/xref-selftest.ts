// app/web/xref-selftest.ts — F1.9 (ADR-0014/0015/0016)
//
// Self-test HEADLESS de REFERÊNCIAS CRUZADAS (xref) no NATIVO (molde F1.6). Disparado
// SÓ sob `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco bundled (db.ts)
// e exercita a xref REAL pela fronteira nativa (reading.ts → binding gerado `crossRefs`
// → JSI → the_light_core::xref::for_verse). Emite um marcador estável COMPOSTO DO
// RETORNO REAL do Rust — sem hardcode (anti-alucinação: xref é só referência + votos,
// nenhum texto bíblico). Capturado por `simctl log` (iOS) / `adb logcat`.
//
// Marcador:
//   TLA_XREF verse="John 3:16" count=<N> first_ref="John 3:15" first_votes=439
//     - `count`       = result.length (do retorno de `crossRefs`).
//     - `first_ref`   = referência do PRIMEIRO item (result[0], top por votos DESC —
//                       ordenado pelo core): listBooks().nameEn + cap + verso(s).
//     - `first_votes` = String(result[0].votes) — `votes` é i64 → `bigint` no binding;
//                       `String(...)` é robusto a `number`/`bigint`, nunca assume number.
// Se `result` vier vazio → `TLA_XREF verse="John 3:16" ERROR empty` (o script exige
// count≥1 → falha visível, sem mascarar).
//
// Determinismo: as xrefs de João 3:16 que apontam p/ Romanos/1João etc. ficam FORA do
// subset {Gn,Sl,Jo} e são filtradas no gerador; dentro do subset o top por votos é
// João 3:15 (≈439 votos). A asserção do script usa um padrão (livro do subset), não a
// fonte — o `first_ref`/`first_votes`/`count` vêm SEMPRE do retorno de `cross_refs`.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `xref-selftest.web.ts` (SKIP — xref web = F1.15), mantendo `expo-file-system` e o
// banco bundled FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { crossRefs, listBooks, type CrossRef } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_XREF';
// Rótulo do versículo de ORIGEM (entrada da xref, não texto bíblico) — espelha o
// formato `query="God"` do self-test de busca.
const SOURCE = 'John 3:16';

/** Emite uma linha nos dois canais (log + error) p/ robustez de captura. */
function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/** Formata o(s) versículo(s) de destino de uma xref (Single/Range). */
function formatVerses(verses: CrossRef['reference']['verses']): string {
  switch (verses.tag) {
    case 'Single':
      return String(verses.inner.verse);
    case 'Range':
      return `${verses.inner.start}-${verses.inner.end}`;
    default:
      return '';
  }
}

/**
 * Prova de xref. Emite (tudo do RETORNO de `crossRefs`, não hardcoded):
 *   TLA_XREF verse="John 3:16" count=<N> first_ref="John 3:15" first_votes=439
 */
export async function runXrefSelfTest(): Promise<void> {
  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  try {
    // Xref REAL pela fronteira. João 3:16 (livro 43, cap. 3, versículo 16);
    // minVotes/limit = undefined → defaults do core (oculta disputadas; top 20). O
    // retorno já vem ORDENADO por votos DESC (a UI/self-test não reordena nada).
    const result = await crossRefs(dbPath, 43, 3, 16);

    if (result.length === 0) {
      emit(`${MARK} verse=${JSON.stringify(SOURCE)} ERROR empty`);
      return;
    }

    // Primeiro item = top por votos (ordenado pelo core). Referência legível: nome
    // EN do livro (cânon puro) + capítulo:versículo(s).
    const top = result[0];
    const bookName =
      listBooks().find((b) => b.number === top.reference.book)?.nameEn ??
      `Book ${top.reference.book}`;
    const verseLabel = formatVerses(top.reference.verses);
    const firstRef = `${bookName} ${top.reference.chapter}${verseLabel ? `:${verseLabel}` : ''}`;

    // JSON.stringify gera as aspas → casa o formato `first_ref="John 3:15"`.
    // `String(top.votes)` é robusto a `number`/`bigint` (votes é i64 no core).
    emit(
      `${MARK} verse=${JSON.stringify(SOURCE)} count=${result.length} first_ref=${JSON.stringify(firstRef)} first_votes=${String(top.votes)}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
