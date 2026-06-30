// app/web/notes-selftest.ts — F1.11 (ADR-0017)
//
// Self-test HEADLESS de NOTAS/HIGHLIGHTS + PERSISTÊNCIA no NATIVO (molde F1.9).
// Disparado SÓ sob `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts). Exercita a
// fronteira `userdata` REAL (reading.ts → bindings gerados → JSI → the_light_core::
// userdata) sobre um diretório de teste ISOLADO e LIMPO no início (idempotente),
// SEPARADO do banco só-leitura. Emite um marcador COMPOSTO DO RETORNO REAL — sem
// hardcode (anti-alucinação: a referência é canônica via o core; o corpo é dado do
// usuário). Capturado por `simctl log` (iOS) / `adb logcat`.
//
// Marcador:
//   TLA_NOTES note_ref="John 3:16" note_len=<n> highlights=<m> persisted=<true|false> export_ok=<true|false>
//     - note_ref   = referência da nota encontrada em list_notes/get_note (nome EN de
//                    listBooks() + cap:verso, casando book=43,chapter=3,verse=16).
//     - note_len   = comprimento do `body` retornado (round-trip da fronteira).
//     - highlights = list_highlights(dir).length (>=1 após add_highlight).
//     - persisted  = true sse uma 2ª leitura INDEPENDENTE (novo handle do store, do
//                    disco) reencontra a nota + o highlight.
//     - export_ok  = true sse o exportável (buildNotesExport, montado dos Records de
//                    list_notes/list_highlights) BATE com a nota/highlight (prova
//                    headless do export; sem abrir o Share sheet).
// Se algo falhar (nota não achada por referência, highlights=0, 2ª leitura vazia) →
// `TLA_NOTES ERROR <motivo>` (a asserção do script falha visível, sem mascarar).
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `notes-selftest.web.ts` (SKIP — notas web = F1.16), mantendo `expo-file-system`/
// userdata FORA do bundle web.
import * as FileSystem from 'expo-file-system/legacy';

import { buildNotesExport } from '../lib/notesExport';
import {
  addHighlight,
  getNote,
  listBooks,
  listHighlights,
  listNotes,
  putNote,
  type Highlight,
  type Note,
} from './reading';

const MARK = 'TLA_NOTES';
// Referência canônica EN (parse_reference aceita; PT e EN caem na mesma nota).
const REF = 'John 3:16';
// Corpo de teste — texto LIVRE do usuário (anti-alucinação não se aplica ao corpo).
const BODY = 'Versículo central do evangelho — nota de teste (F1.11).';

function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/** Nome EN do livro pelo número canônico (cânon puro). */
function bookNameEn(book: number): string {
  return listBooks().find((b) => b.number === book)?.nameEn ?? `Book ${book}`;
}

/** Casa exatamente João 3:16 (livro 43, cap. 3, versículo 16) numa referência. */
function isJohn316(reference: Note['reference'] | Highlight['reference']): boolean {
  const v = reference.verses;
  return reference.book === 43 && reference.chapter === 3 && v.tag === 'Single' && v.inner.verse === 16;
}

/** Rótulo legível (`<livro EN> cap:verso`) de uma referência. */
function refLabel(reference: Note['reference']): string {
  const v = reference.verses;
  const verse = v.tag === 'Single' ? v.inner.verse : v.tag === 'Range' ? v.inner.start : null;
  return `${bookNameEn(reference.book)} ${reference.chapter}${verse != null ? `:${verse}` : ''}`;
}

/**
 * Prova de notas/highlights + persistência. Emite (tudo do RETORNO da fronteira):
 *   TLA_NOTES note_ref="John 3:16" note_len=<n> highlights=<m> persisted=true export_ok=true
 */
export async function runNotesSelfTest(): Promise<void> {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    emit(`${MARK} ERROR no-documentDirectory`);
    return;
  }

  // Diretório de teste ISOLADO, LIMPO no início (idempotente entre execuções).
  const dirUri = `${docDir}userdata-selftest/`;
  try {
    await FileSystem.deleteAsync(dirUri, { idempotent: true });
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  } catch (err) {
    emit(`${MARK} ERROR ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // O core (std::fs) espera um path real, sem o esquema file://.
  const dir = dirUri.replace(/^file:\/\//, '');

  try {
    // 1) put_note (cria/substitui; escrita atômica no core).
    await putNote(dir, REF, BODY);

    // 2) round-trip: get_note + list_notes (1ª leitura).
    const got = await getNote(dir, REF);
    const notes = await listNotes(dir);

    // 3) add_highlight ("yellow", sem tag → undefined).
    await addHighlight(dir, REF, 'yellow', undefined);

    // 4) list_highlights.
    const highlights = await listHighlights(dir);

    // EXPORT: agregado montado dos Records (apresentação) — não reescreve o store.
    const exported = buildNotesExport(notes, highlights, bookNameEn);
    const exportOk =
      notes.length > 0 &&
      highlights.length > 0 &&
      exported.includes(REF) &&
      exported.includes(BODY);

    // Nota de João 3:16 a partir do RETORNO (list_notes, com fallback no get_note).
    const noteRec =
      notes.find((n) => isJohn316(n.reference)) ?? (got && isJohn316(got.reference) ? got : undefined);
    if (!noteRec) {
      emit(`${MARK} ERROR note-not-found-by-reference`);
      return;
    }
    if (highlights.length === 0) {
      emit(`${MARK} ERROR no-highlights`);
      return;
    }

    // 5) PERSISTÊNCIA: 2ª leitura INDEPENDENTE (novo handle do store, a partir do
    //    disco — cada chamada da fronteira reabre NoteStore/HighlightStore).
    const notes2 = await listNotes(dir);
    const highlights2 = await listHighlights(dir);
    const persisted =
      notes2.some((n) => isJohn316(n.reference)) && highlights2.some((h) => isJohn316(h.reference));

    emit(
      `${MARK} note_ref=${JSON.stringify(refLabel(noteRec.reference))} note_len=${noteRec.body.length} highlights=${highlights.length} persisted=${persisted} export_ok=${exportOk}`,
    );
  } catch (err) {
    emit(`${MARK} ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
}
