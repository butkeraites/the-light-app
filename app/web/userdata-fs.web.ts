// app/web/userdata-fs.web.ts — F1.16 (ADR-0022; par de sqlite-xref.web.ts / sqlite-search.web.ts)
//
// GLUE web de USERDATA (notas/marcações) — hand-written, VERSIONADO. Camada de
// INFRAESTRUTURA que reimplementa o I/O de userdata em TS no web, ESPELHANDO o
// FORMATO EM DISCO do core (`the_light_core::userdata::{NoteStore,HighlightStore}`,
// rev pinado `8f66004`) — NÃO a lógica de domínio. Precedente: ADR-0011/0019/0020/
// 0021 (o SELECT/SQL do core foi espelhado em TS como infra). O módulo `userdata`
// do core é `#[cfg(feature="embedded")]` (nativo-only) → NÃO entra no grafo wasm
// (ADR-0005/0010) → o web NÃO pode delegar; reimplementa o I/O.
//
// É infra de ARMAZENAMENTO, não domínio:
//   - O CORPO da nota / a TAG são dado livre do usuário (anti-alucinação NÃO se
//     aplica ao corpo — igual ao nativo, ADR-0017).
//   - A REFERÊNCIA é canonicalizada pelo WASM (`parseReference`), NÃO inventada em
//     TS, nas DUAS direções (gravar e ler). O nome EN do livro vem de `listBooks()`
//     (wasm). A única "format" em TS é a convenção de nome de arquivo/`ref` (infra).
//
// VFS-agnóstica (par de sqlite-xref.web.ts): opera sobre uma `UserDataDir` mínima
// que o backend OPFS do browser (`userdata-opfs.web.ts`) e o mock em memória da
// prova headless implementam. A prova node exercita EXATAMENTE estas funções.
import { listBooks, noteSlug, parseNoteSlug, parseReference } from './generated/the_light_app_core';
import type { Highlight, Note, Reference } from './generated/the_light_app_core';

/**
 * Diretório de userdata VFS-agnóstico (mínimo). O backend OPFS (browser) e o mock
 * em memória (prova headless) o implementam — as MESMAS 7 funções rodam sobre ambos.
 * Caminhos relativos ao `data_dir` web (ex.: `notes/John_3.16.md`, `highlights.json`).
 */
export interface UserDataDir {
  /** Lê o arquivo; `null` se ausente (espelha `NotFound → None/empty` do core). */
  readFile(relPath: string): Promise<string | null>;
  /** Grava (cria/substitui) o arquivo verbatim; cria subdiretórios sob demanda. */
  writeFile(relPath: string, content: string): Promise<void>;
  /** Remove o arquivo; `true` se existia (idempotente, espelha `delete`/`remove`). */
  deleteFile(relPath: string): Promise<boolean>;
  /** Nomes dentro de um diretório; vazio se ausente (espelha `read_dir` do core). */
  listDir(relDir: string): Promise<string[]>;
}

/** Subdiretório das notas (um arquivo `.md` por referência) — espelha `notes/`. */
const NOTES_DIR = 'notes';
/** Arquivo único das marcações — espelha `highlights.json`. */
const HIGHLIGHTS_FILE = 'highlights.json';

// ── Nome EN do livro (do WASM, fonte da verdade do cânon) ────────────────────
let bookNamesEn: Map<number, string> | null = null;
/**
 * Nome inglês do livro (`Book.nameEn`, de `listBooks()` — wasm), casado por
 * `number === book`. Espelha `book_info(book).name_en` (`reference.rs`); livro fora
 * de 1..=66 → `"?"` (mesma semântica de `book_info(_) == None`). Memoizado (cânon
 * imutável). NÃO relista os 66 à mão — uma fonte da verdade (igual a `listBooks`).
 */
function nameEnOf(book: number): string {
  if (!bookNamesEn) {
    bookNamesEn = new Map(listBooks().map((b) => [b.number, b.nameEn]));
  }
  return bookNamesEn.get(book) ?? '?';
}

// ── Espelho de format_reference / slug ───────────────────────────────────────
/**
 * Espelha `format_reference(reference, Lang::En)` (`reference.rs::format_reference`,
 * rev `8f66004`): a string LEGÍVEL EN, separador `:` (En). NÃO troca `_`/`.` — esta
 * é a forma usada no `ref` do `highlights.json` e a base do slug de nota.
 *   - WholeChapter → `"{nameEn} {chapter}"`
 *   - Single(v)    → `"{nameEn} {chapter}:{v}"`
 *   - Range{a,b}   → `"{nameEn} {chapter}:{a}-{b}"`
 */
export function formatReferenceEn(reference: Reference, nameEn: string): string {
  const { chapter, verses } = reference;
  switch (verses.tag) {
    case 'Single':
      return `${nameEn} ${chapter}:${verses.inner.verse}`;
    case 'Range':
      return `${nameEn} ${chapter}:${verses.inner.start}-${verses.inner.end}`;
    default:
      // WholeChapter
      return `${nameEn} ${chapter}`;
  }
}

/**
 * Nome de arquivo da nota de uma referência (`John 3:16` → `John_3.16.md`) — DELEGA à
 * fronteira `noteSlug` (= `the_light_core::userdata::note_slug::slug`, ADR-0062): fonte
 * ÚNICA do formato, compartilhada com o nativo. O TS não re-deriva mais o slug.
 */
export function slugForNote(reference: Reference): string {
  return noteSlug(reference);
}

/** Versículo inicial p/ ordenação canônica (espelha `VerseRange::start().unwrap_or(0)`). */
function startOf(verses: Reference['verses']): number {
  if (verses.tag === 'Single') {
    return verses.inner.verse;
  }
  if (verses.tag === 'Range') {
    return verses.inner.start;
  }
  return 0; // WholeChapter
}

/** Igualdade estrutural de `Reference` (espelha `Reference: PartialEq` do core). */
function referenceEquals(a: Reference, b: Reference): boolean {
  if (a.book !== b.book || a.chapter !== b.chapter || a.verses.tag !== b.verses.tag) {
    return false;
  }
  if (a.verses.tag === 'Single' && b.verses.tag === 'Single') {
    return a.verses.inner.verse === b.verses.inner.verse;
  }
  if (a.verses.tag === 'Range' && b.verses.tag === 'Range') {
    return a.verses.inner.start === b.verses.inner.start && a.verses.inner.end === b.verses.inner.end;
  }
  return true; // ambos WholeChapter
}

// ── NOTAS (notes/<slug>.md, um arquivo por referência) ───────────────────────
/**
 * Grava (ou substitui) a nota de uma `Reference` (já resolvida pelo wasm). Espelha
 * `NoteStore::put`: grava o `body` VERBATIM (Markdown puro — SEM título/front-matter)
 * em `notes/<slug>`. `reading.web.ts::putNote` resolve a referência por
 * `parseReference` ANTES (paridade com `put_note`, que parseia antes de gravar).
 */
export async function putNoteFs(dir: UserDataDir, reference: Reference, body: string): Promise<void> {
  await dir.writeFile(`${NOTES_DIR}/${slugForNote(reference)}`, body);
}

/**
 * Lê a nota de uma `Reference` (já resolvida pelo wasm). Espelha `NoteStore::get`:
 * ausente → `undefined`; senão `{ reference, body }` com o ARQUIVO INTEIRO como
 * `body` (a `reference` é a já-resolvida, não re-parseada).
 */
export async function getNoteFs(dir: UserDataDir, reference: Reference): Promise<Note | undefined> {
  const body = await dir.readFile(`${NOTES_DIR}/${slugForNote(reference)}`);
  if (body === null) {
    return undefined;
  }
  return { reference, body };
}

/**
 * Remove a nota de uma `Reference`. Espelha `NoteStore::delete`: `true` se existia,
 * `false` caso contrário (idempotente).
 */
export async function deleteNoteFs(dir: UserDataDir, reference: Reference): Promise<boolean> {
  return dir.deleteFile(`${NOTES_DIR}/${slugForNote(reference)}`);
}

/**
 * Lista todas as notas, ORDENADAS por referência canônica. Espelha `NoteStore::list`:
 * lê `notes/`, IGNORA não-`.md`, re-analisa o stem por `parseReference(stem.replace(
 * '_', ' '))` (WASM — ignora os que não parseiam), lê o body, e ORDENA por
 * `(book, chapter, verses.start)`. Diretório ausente → `[]` (sem erro).
 */
export async function listNotesFs(dir: UserDataDir): Promise<Note[]> {
  const names = await dir.listDir(NOTES_DIR);
  const notes: Note[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) {
      continue; // não-.md: ignora (espelha o filtro de extensão do core)
    }
    const stem = name.slice(0, -'.md'.length);
    // Read-back: UMA fonte da verdade — o parse do slug vem da fronteira `parseNoteSlug`
    // (= `note_slug::parse_slug` do core, ADR-0062); `undefined` → arquivo não-reconhecível.
    const reference = parseNoteSlug(stem);
    if (reference === undefined) {
      continue;
    }
    const body = await dir.readFile(`${NOTES_DIR}/${name}`);
    if (body === null) {
      continue;
    }
    notes.push({ reference, body });
  }
  notes.sort((a, b) => {
    if (a.reference.book !== b.reference.book) {
      return a.reference.book - b.reference.book;
    }
    if (a.reference.chapter !== b.reference.chapter) {
      return a.reference.chapter - b.reference.chapter;
    }
    return startOf(a.reference.verses) - startOf(b.reference.verses);
  });
  return notes;
}

// ── MARCAÇÕES (highlights.json, array único) ─────────────────────────────────
/** Forma serializada (espelha `HighlightDto`): ordem de chaves `ref`, `color`, `tag`. */
interface HighlightDto {
  ref: string;
  color: string;
  tag?: string;
}

/**
 * Carrega as marcações de `highlights.json`. Espelha `HighlightStore::load`: arquivo
 * ausente → `[]`; entradas com `ref` INVÁLIDA são ignoradas (re-analisadas por
 * `parseReference` — WASM, a fonte da verdade). Ordem do array = ordem de inserção.
 */
async function loadHighlights(dir: UserDataDir): Promise<Highlight[]> {
  const raw = await dir.readFile(HIGHLIGHTS_FILE);
  if (raw === null) {
    return [];
  }
  const dtos = JSON.parse(raw) as HighlightDto[];
  const items: Highlight[] = [];
  for (const dto of dtos) {
    let reference: Reference;
    try {
      reference = parseReference(dto.ref);
    } catch {
      continue; // `ref` inválida: ignora (espelha `from_dto` → None filtrado)
    }
    items.push(dto.tag != null ? { reference, color: dto.color, tag: dto.tag } : { reference, color: dto.color });
  }
  return items;
}

/**
 * Persiste as marcações em `highlights.json`. Espelha `HighlightStore::save` +
 * `to_dto`: `ref` = `format_reference(_, En)` (legível, SEM `_`/`.`), `tag` OMITIDO
 * quando ausente (`skip_serializing_if = Option::is_none`), `JSON.stringify(_, null,
 * 2)` (2 espaços, ordem de chaves `ref`,`color`,`tag` — espelha `to_string_pretty`).
 */
async function saveHighlights(dir: UserDataDir, items: Highlight[]): Promise<void> {
  const dtos: HighlightDto[] = items.map((h) => {
    const ref = formatReferenceEn(h.reference, nameEnOf(h.reference.book));
    return h.tag != null ? { ref, color: h.color, tag: h.tag } : { ref, color: h.color };
  });
  await dir.writeFile(HIGHLIGHTS_FILE, JSON.stringify(dtos, null, 2));
}

/**
 * Adiciona uma marcação para uma `Reference` (já resolvida pelo wasm). Espelha
 * `HighlightStore::add`: SUBSTITUI a entrada de MESMA referência (remove a antiga,
 * faz push) → a ordem fica de INSERÇÃO. `tag` opcional.
 */
export async function addHighlightFs(
  dir: UserDataDir,
  reference: Reference,
  color: string,
  tag?: string,
): Promise<void> {
  const items = (await loadHighlights(dir)).filter((h) => !referenceEquals(h.reference, reference));
  items.push(tag != null ? { reference, color, tag } : { reference, color });
  await saveHighlights(dir, items);
}

/**
 * Remove todas as marcações de uma `Reference`. Espelha `HighlightStore::remove`:
 * devolve a CONTAGEM removida (idempotente: 0 se não havia).
 */
export async function removeHighlightFs(dir: UserDataDir, reference: Reference): Promise<number> {
  const items = await loadHighlights(dir);
  const kept = items.filter((h) => !referenceEquals(h.reference, reference));
  const removed = items.length - kept.length;
  if (removed > 0) {
    await saveHighlights(dir, kept);
  }
  return removed;
}

/**
 * Lista as marcações na ORDEM DE INSERÇÃO (≠ notas, que ordenam por referência).
 * Espelha `HighlightStore::list` (devolve `&self.items` na ordem do array).
 */
export async function listHighlightsFs(dir: UserDataDir): Promise<Highlight[]> {
  return loadHighlights(dir);
}
