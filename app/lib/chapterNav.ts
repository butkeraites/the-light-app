// app/lib/chapterNav.ts — navegação capítulo-a-capítulo (adjacência canônica) · leitura contínua
//
// PURO e sem I/O (nem store nem wasm): calcula o capítulo ANTERIOR e o PRÓXIMO a partir da lista de
// livros do cânon (`listBooks()`, síncrona), cruzando fronteiras de livro (Gênesis 50 → Êxodo 1) e
// parando nos limites (Gênesis 1 não tem anterior; Apocalipse 22 não tem próximo). Isto SÓ decide
// PARA ONDE navegar — o texto continua vindo VERBATIM do store na tela (anti-alucinação). Testável
// headless (molde de `verseOfDay.ts`).

/** Referência de capítulo (mesma convenção do app: `book` 1..66, 1-based). */
export type ChapterRef = { book: number; chapter: number };
/** Vizinhos de um capítulo; `null` num extremo do cânon. */
export type ChapterAdjacency = { prev: ChapterRef | null; next: ChapterRef | null };

/**
 * Forma MÍNIMA de um livro que este helper precisa — `Book` (de `listBooks()`) é estruturalmente
 * atribuível. Manter o tipo local deixa o módulo dependency-free (bundle puro p/ o teste headless).
 */
type BookLike = { number: number; chapterCount: number };

/**
 * Vizinhos (anterior/próximo) do capítulo `chapter` do livro `book`, dado o cânon `books`.
 *   • próximo: `chapter < chapterCount` → mesmo livro, +1; senão existe `book+1` → próximo livro, cap. 1; senão `null`.
 *   • anterior: `chapter > 1` → mesmo livro, −1; senão existe `book−1` → livro anterior, ÚLTIMO capítulo; senão `null`.
 * Livro desconhecido / fora de faixa → `{ prev: null, next: null }` (degrada sem crash).
 */
export function chapterNav(books: readonly BookLike[], book: number, chapter: number): ChapterAdjacency {
  const cur = books.find((b) => b.number === book);
  if (!cur) return { prev: null, next: null };

  let next: ChapterRef | null = null;
  if (chapter < cur.chapterCount) {
    next = { book, chapter: chapter + 1 };
  } else {
    const nb = books.find((b) => b.number === book + 1);
    if (nb) next = { book: nb.number, chapter: 1 };
  }

  let prev: ChapterRef | null = null;
  if (chapter > 1) {
    prev = { book, chapter: chapter - 1 };
  } else {
    const pb = books.find((b) => b.number === book - 1);
    if (pb) prev = { book: pb.number, chapter: pb.chapterCount };
  }

  return { prev, next };
}
