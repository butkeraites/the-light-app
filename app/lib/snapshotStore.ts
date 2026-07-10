// app/lib/snapshotStore.ts — F5.26 (ADR-0054) · wiring PLATFORM-AGNOSTIC (ADR-0078)
//
// Liga o adaptador PURO (`snapshotStore.shared.ts`) ao STORE REAL do usuário: as fns de fronteira de
// userdata/planos + `listBooks` + `parseReferenceSync` vêm TODAS da COSTURA `web/reading` (o Metro a
// resolve a `reading.ts` no nativo / `reading.web.ts` no web). Antes este wiring era duplicado BYTE-A-BYTE
// em `snapshotStore.ts` e `snapshotStore.web.ts`, diferindo SÓ na fonte do `parseReferenceSync`; a ADR-0078
// expôs essa 1 linha pela seam de leitura e os dois leaves colapsaram num arquivo só. O nome EN do livro e
// a validação REAL de referência vêm do CORE (anti-alucinação). Carregado SOB DEMANDA (`import()`) pela UI
// de sync (F5.26) — FORA do entry eager do 1º paint.
import {
  parseReferenceSync,
  listBooks,
  listNotes,
  listHighlights,
  readingPlanProgress,
  putNote,
  addHighlight,
  startReadingPlan,
  setReadingPlanCompleted,
} from '../web/reading';
import { createSnapshotStore } from './snapshotStore.shared';
import type { SnapshotStore } from './userdataSnapshot';

/**
 * Cria o `SnapshotStore` REAL do usuário, ligado ao `dataDir` gravável (de `ensureUserDataDir()`).
 * Memoiza o mapa `número→nomeEN` do livro (`listBooks` do CORE) e valida a referência importada com o
 * `parse_reference` SÍNCRONO do CORE (lança em referência irreal ANTES de qualquer escrita — anti-alucinação).
 */
export function createRealSnapshotStore(dataDir: string): SnapshotStore {
  let bookNames: Map<number, string> | null = null;
  const bookNameEn = (book: number): string => {
    if (!bookNames) {
      bookNames = new Map(listBooks().map((b) => [b.number, b.nameEn]));
    }
    return bookNames.get(book) ?? '?';
  };
  return createSnapshotStore({
    bookNameEn,
    assertValidReference: (reference) => {
      parseReferenceSync(reference); // lança (CoreError) em referência irreal
    },
    listNotes: () => listNotes(dataDir),
    listHighlights: () => listHighlights(dataDir),
    readingPlanProgress: () => readingPlanProgress(dataDir),
    putNote: (reference, body) => putNote(dataDir, reference, body),
    addHighlight: (reference, color, tag) => addHighlight(dataDir, reference, color, tag),
    // As fns de plano do core devolvem o `ReadingPlanProgress`; o `SnapshotStore` só
    // precisa do efeito (void) — descartamos o retorno.
    startReadingPlan: async (planId, startDate) => {
      await startReadingPlan(dataDir, planId, startDate);
    },
    setReadingPlanCompleted: async (completed) => {
      await setReadingPlanCompleted(dataDir, completed);
    },
  });
}
