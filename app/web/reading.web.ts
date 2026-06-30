// app/web/reading.web.ts — F1.3 (ADR-0014)
//
// STUB web do glue de leitura. A paridade web (ler capítulos do store no browser
// via wa-sqlite/OPFS) é a F1.13 — NÃO construída nesta tarefa. Este stub mantém
// `tsc`/Metro web verdes e lança erro explícito se chamado. Os TIPOS (Book/
// Passage/Translation) vêm dos bindings gerados (web) p/ assinatura única entre
// alvos; `import type` é apagado em runtime (o web não carrega os bindings nativos).
import type {
  Book,
  Passage,
  Translation,
  SearchHit,
  CrossRef,
  Note,
  Highlight,
} from './generated/the_light_app_core';

export type { Book, Passage, Translation, SearchHit, CrossRef, Note, Highlight };

const WEB_MSG =
  'leitura web (store wa-sqlite/OPFS) = F1.13; a leitura nativa usa o the-light-core via Turbo Module.';

// Busca web (FTS5 sobre o store wa-sqlite/OPFS) = F1.14 (pós-gate F1.12). Até lá,
// o glue web de busca é um stub que lança em runtime, mantendo `tsc`/build web verdes.
const WEB_SEARCH_MSG =
  'busca web (FTS5 sobre wa-sqlite/OPFS) = F1.14; a busca nativa usa o the-light-core::search via Turbo Module.';

// Xref no web (cross_refs sobre o store wa-sqlite/OPFS) = F1.15 (pós-gate F1.12). Até
// lá, o glue web de xref é um stub que lança em runtime, mantendo `tsc`/build web
// verdes. O par nativo (`reading.ts`) faz a xref real via a fronteira `cross_refs`.
const WEB_XREF_MSG =
  'referências cruzadas web (cross_refs sobre wa-sqlite/OPFS) = F1.15; a xref nativa usa o the_light_core::xref via Turbo Module.';

// Notas/highlights no web (userdata sobre wa-sqlite/OPFS) = F1.16 (pós-gate F1.12).
// Até lá, o glue web de userdata é um stub que lança em runtime, mantendo `tsc`/build
// web verdes. O par nativo (`reading.ts`) grava/lê real via a fronteira `userdata`.
const WEB_NOTES_MSG =
  'notas/highlights web (userdata sobre wa-sqlite/OPFS) = F1.16; o userdata nativo usa o the_light_core::userdata via Turbo Module.';

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

export async function crossRefs(
  _dbPath: string,
  _book: number,
  _chapter: number,
  _verse: number,
  _minVotes?: bigint,
  _limit?: number,
): Promise<CrossRef[]> {
  throw new Error(WEB_XREF_MSG);
}

// ── USERDATA (notas/highlights) — STUB web (F1.16) ───────────────────────────
export async function putNote(_dataDir: string, _reference: string, _body: string): Promise<void> {
  throw new Error(WEB_NOTES_MSG);
}

export async function getNote(_dataDir: string, _reference: string): Promise<Note | undefined> {
  throw new Error(WEB_NOTES_MSG);
}

export async function deleteNote(_dataDir: string, _reference: string): Promise<boolean> {
  throw new Error(WEB_NOTES_MSG);
}

export async function listNotes(_dataDir: string): Promise<Note[]> {
  throw new Error(WEB_NOTES_MSG);
}

export async function addHighlight(
  _dataDir: string,
  _reference: string,
  _color: string,
  _tag?: string,
): Promise<void> {
  throw new Error(WEB_NOTES_MSG);
}

export async function removeHighlight(_dataDir: string, _reference: string): Promise<number> {
  throw new Error(WEB_NOTES_MSG);
}

export async function listHighlights(_dataDir: string): Promise<Highlight[]> {
  throw new Error(WEB_NOTES_MSG);
}
