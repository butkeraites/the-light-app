// app/lib/readingNav.ts — ADR-0070 (deepening): UMA costura para abrir o leitor
//
// Seis sites de navegação montavam à mão os params da rota de leitura e cada um precisava LEMBRAR de
// anexar `version:` — esquecer era exatamente o bug reportado (o leitor caía em KJV). Aqui os
// construtores de href são a fonte única: `version` é um campo OBRIGATÓRIO do alvo, então o TypeScript
// impede abrir o leitor sem carregar a versão. Puro (sem `router`) → headless-testável; o chamador
// escolhe `router.push` vs `router.replace` (o virar-capítulo usa replace de propósito).

/** Alvo de leitura de um CAPÍTULO. `version` é obrigatório — a costura carrega a versão sempre. */
export interface ReadingChapterTarget {
  book: number;
  chapter: number;
  /** Versículo-âncora opcional (busca/xref); ausente → topo do capítulo. */
  verse?: number | null;
  version: string;
}

/** Alvo de leitura de um LIVRO (lista de capítulos). `version` é herdada adiante ao abrir um capítulo. */
export interface ReadingBookTarget {
  book: number;
  version: string;
}

/** `{pathname, params}` para `/read/[book]/[chapter]` — versão sempre presente, verso só se houver. */
export function readingChapterHref(target: ReadingChapterTarget) {
  return {
    pathname: '/read/[book]/[chapter]' as const,
    params: {
      book: String(target.book),
      chapter: String(target.chapter),
      version: target.version,
      ...(target.verse != null ? { verse: String(target.verse) } : {}),
    },
  };
}

/** `{pathname, params}` para `/read/[book]` — a lista de capítulos herda a versão. */
export function readingBookHref(target: ReadingBookTarget) {
  return {
    pathname: '/read/[book]' as const,
    params: { book: String(target.book), version: target.version },
  };
}
