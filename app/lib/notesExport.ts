// app/lib/notesExport.ts — F1.11 (ADR-0017)
//
// EXPORT portável dos dados do usuário, montado APENAS a partir dos Records
// `Note`/`Highlight` retornados por `list_notes`/`list_highlights` (apresentação dos
// Records — NÃO reimplementa a serialização do store: nada de escrever `.md` por
// nota nem `highlights.json` à mão; o core já produziu esses arquivos no `data_dir`).
//
// É uma função PURA (sem I/O, sem rede, sem `expo-file-system`) → segura nos dois
// alvos. A UI passa o texto resultante ao Share sheet (`react-native` `Share`); o
// self-test confere, headless, que o exportável BATE com `list_notes`/`list_highlights`.
//
// Só vaza dados do PRÓPRIO usuário (notas/highlights) — nenhum texto bíblico do
// banco, nenhum segredo. A `reference` é canônica (vem do core).
import type { Note, Highlight } from '../web/reading';

/** Versículo (ou início de intervalo) de uma referência, p/ rótulo legível. */
function verseOf(verses: Note['reference']['verses']): number | null {
  if (verses.tag === 'Single') {
    return verses.inner.verse;
  }
  if (verses.tag === 'Range') {
    return verses.inner.start;
  }
  return null;
}

/** Rótulo legível de uma referência (`<livro> cap:verso`), via `bookNameOf`. */
function refLabel(
  reference: Note['reference'],
  bookNameOf: (book: number) => string,
): string {
  const v = verseOf(reference.verses);
  return `${bookNameOf(reference.book)} ${reference.chapter}${v != null ? `:${v}` : ''}`;
}

/**
 * Monta o conteúdo exportável (Markdown legível) a partir dos Records do usuário.
 * Reaproveita `list_notes`/`list_highlights` — não reescreve o formato do store.
 */
export function buildNotesExport(
  notes: Note[],
  highlights: Highlight[],
  bookNameOf: (book: number) => string,
): string {
  const lines: string[] = ['# The Light — minhas notas e marcações', ''];

  lines.push(`## Notas (${notes.length})`, '');
  if (notes.length === 0) {
    lines.push('_Sem notas._', '');
  } else {
    for (const n of notes) {
      lines.push(`### ${refLabel(n.reference, bookNameOf)}`, '', n.body, '');
    }
  }

  lines.push(`## Marcações (${highlights.length})`, '');
  if (highlights.length === 0) {
    lines.push('_Sem marcações._', '');
  } else {
    for (const h of highlights) {
      const tag = h.tag ? ` — ${h.tag}` : '';
      lines.push(`- ${refLabel(h.reference, bookNameOf)} · ${h.color}${tag}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
