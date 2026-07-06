// app/lib/verseMarkers.ts — deepening (ADR-0060): redução PURA dos indicadores por-versículo
//
// A lógica que estava presa dentro de `refreshUserData` na tela do capítulo
// (`app/app/read/[book]/[chapter].tsx`): reduzir o retorno das fronteiras de userdata
// (`Note[]` + `Highlight[]`) aos INDICADORES do capítulo corrente. PURA — sem I/O, sem rede,
// sem wasm, sem React — testável em node headless. Só considera `verses.tag === 'Single'`
// (o mesmo recorte de sempre). Anti-alucinação: NÃO toca texto bíblico — só dado do usuário
// (presença de nota + NOME da cor escolhida).
import type { Highlight, Note } from '../web/reading';

export interface VerseMarkers {
  /** Versículos (do capítulo corrente) que têm nota — para o indicador de nota. */
  notedVerses: Set<number>;
  /** Versículo → NOME da cor do highlight (dado do usuário); resolvido p/ hex no render. */
  highlightColors: Map<number, string>;
}

/**
 * Reduz notas + highlights (retorno das fronteiras userdata) aos INDICADORES do capítulo
 * corrente. PURA: sem I/O, sem rede, sem wasm — só FILTRA os Records do book/chapter e mapeia
 * versículo→cor/nota. Só `verses.tag === 'Single'` (o mesmo recorte de hoje; Range/WholeChapter
 * são ignorados). Última cor por versículo vence (ordem de iteração dos highlights).
 */
export function deriveVerseMarkers(
  notes: Note[],
  highlights: Highlight[],
  book: number,
  chapter: number,
): VerseMarkers {
  const notedVerses = new Set<number>();
  for (const note of notes) {
    const r = note.reference;
    if (r.book === book && r.chapter === chapter && r.verses.tag === 'Single') {
      notedVerses.add(r.verses.inner.verse);
    }
  }
  const highlightColors = new Map<number, string>();
  for (const h of highlights) {
    const r = h.reference;
    if (r.book === book && r.chapter === chapter && r.verses.tag === 'Single') {
      highlightColors.set(r.verses.inner.verse, h.color);
    }
  }
  return { notedVerses, highlightColors };
}
