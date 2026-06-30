// app/web/reading.web.ts — F1.3 (ADR-0014)
//
// STUB web do glue de leitura. A paridade web (ler capítulos do store no browser
// via wa-sqlite/OPFS) é a F1.13 — NÃO construída nesta tarefa. Este stub mantém
// `tsc`/Metro web verdes e lança erro explícito se chamado. Os TIPOS (Book/
// Passage/Translation) vêm dos bindings gerados (web) p/ assinatura única entre
// alvos; `import type` é apagado em runtime (o web não carrega os bindings nativos).
import type { Book, Passage, Translation, SearchHit } from './generated/the_light_app_core';

export type { Book, Passage, Translation, SearchHit };

const WEB_MSG =
  'leitura web (store wa-sqlite/OPFS) = F1.13; a leitura nativa usa o the-light-core via Turbo Module.';

// Busca web (FTS5 sobre o store wa-sqlite/OPFS) = F1.14 (pós-gate F1.12). Até lá,
// o glue web de busca é um stub que lança em runtime, mantendo `tsc`/build web verdes.
const WEB_SEARCH_MSG =
  'busca web (FTS5 sobre wa-sqlite/OPFS) = F1.14; a busca nativa usa o the-light-core::search via Turbo Module.';

export function listBooks(): Book[] {
  throw new Error(WEB_MSG);
}

export async function listTranslations(_dbPath: string): Promise<Translation[]> {
  throw new Error(WEB_MSG);
}

export async function getChapter(
  _dbPath: string,
  _translation: string,
  _book: number,
  _chapter: number,
): Promise<Passage> {
  throw new Error(WEB_MSG);
}

export async function chapterCount(
  _dbPath: string,
  _translation: string,
  _book: number,
): Promise<number> {
  throw new Error(WEB_MSG);
}

export async function search(
  _dbPath: string,
  _query: string,
  _translation: string,
  _book?: number,
  _limit?: number,
): Promise<SearchHit[]> {
  throw new Error(WEB_SEARCH_MSG);
}
