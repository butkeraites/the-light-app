// app/lib/verseOfDay.ts — Rodada 4 (engajamento): versículo do dia DETERMINÍSTICO e LOCAL
//
// Escolhe uma REFERÊNCIA por dia, de forma determinística (mesma data → mesma referência, em
// qualquer aparelho, SEM rede/conta) — rotação sobre uma lista curada de passagens de domínio
// público. Isto devolve SÓ a REFERÊNCIA (livro/capítulo/versículo); o TEXTO é buscado VERBATIM do
// store pela fronteira de leitura na tela (anti-alucinação — nunca hardcodado aqui). Offline-first.
//
// A lista é CROMO de curadoria (referências conhecidas), não texto bíblico: nenhuma palavra de
// Escritura vive neste arquivo. Todas as referências caem dentro do cânon 66 e de capítulos/
// versículos que existem em ambas as traduções embarcadas (KJV / Almeida 1911).

/** Referência canônica numérica (mesma convenção do resto do app: book 1..66, 1-based). */
export type VerseRef = { book: number; chapter: number; verse: number };

// Rotação curada (30 dias) — passagens amplamente conhecidas, AT + NT, de domínio público. São só
// PONTEIROS (livro/cap/verso); o texto vem do store. Ordem estável (o índice do dia mapeia nela).
export const VERSE_OF_DAY_REFS: readonly VerseRef[] = [
  { book: 43, chapter: 3, verse: 16 }, // João 3:16
  { book: 19, chapter: 23, verse: 1 }, // Salmos 23:1
  { book: 20, chapter: 3, verse: 5 }, // Provérbios 3:5
  { book: 50, chapter: 4, verse: 13 }, // Filipenses 4:13
  { book: 45, chapter: 8, verse: 28 }, // Romanos 8:28
  { book: 23, chapter: 41, verse: 10 }, // Isaías 41:10
  { book: 24, chapter: 29, verse: 11 }, // Jeremias 29:11
  { book: 19, chapter: 46, verse: 1 }, // Salmos 46:1
  { book: 40, chapter: 11, verse: 28 }, // Mateus 11:28
  { book: 6, chapter: 1, verse: 9 }, // Josué 1:9
  { book: 19, chapter: 118, verse: 24 }, // Salmos 118:24
  { book: 47, chapter: 5, verse: 17 }, // 2 Coríntios 5:17
  { book: 48, chapter: 2, verse: 20 }, // Gálatas 2:20
  { book: 50, chapter: 4, verse: 6 }, // Filipenses 4:6
  { book: 46, chapter: 13, verse: 4 }, // 1 Coríntios 13:4
  { book: 19, chapter: 119, verse: 105 }, // Salmos 119:105
  { book: 45, chapter: 12, verse: 2 }, // Romanos 12:2
  { book: 49, chapter: 2, verse: 8 }, // Efésios 2:8
  { book: 58, chapter: 11, verse: 1 }, // Hebreus 11:1
  { book: 19, chapter: 27, verse: 1 }, // Salmos 27:1
  { book: 23, chapter: 40, verse: 31 }, // Isaías 40:31
  { book: 40, chapter: 6, verse: 33 }, // Mateus 6:33
  { book: 43, chapter: 14, verse: 6 }, // João 14:6
  { book: 19, chapter: 51, verse: 10 }, // Salmos 51:10
  { book: 20, chapter: 16, verse: 3 }, // Provérbios 16:3
  { book: 25, chapter: 3, verse: 22 }, // Lamentações 3:22
  { book: 19, chapter: 91, verse: 1 }, // Salmos 91:1
  { book: 45, chapter: 15, verse: 13 }, // Romanos 15:13
  { book: 51, chapter: 3, verse: 23 }, // Colossenses 3:23
  { book: 60, chapter: 5, verse: 7 }, // 1 Pedro 5:7
];

/** Dias inteiros (UTC) desde a época — base determinística da rotação (vira à meia-noite UTC). */
export function dayIndexUtc(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/**
 * Referência do versículo do dia para `date` (determinística): `dayIndex % N` sobre a lista curada.
 * Mesma data → mesma referência, em qualquer aparelho, sem estado nem rede. Pura (testável).
 */
export function verseOfDayRef(date: Date): VerseRef {
  const n = VERSE_OF_DAY_REFS.length;
  const idx = ((dayIndexUtc(date) % n) + n) % n; // normaliza (datas pré-época não dão índice negativo)
  return VERSE_OF_DAY_REFS[idx];
}
