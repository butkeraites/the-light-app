// app/lib/snapshotStore.ts — F5.26 (ADR-0054) · wiring NATIVO
//
// Liga o adaptador PURO (`snapshotStore.shared.ts`) ao STORE REAL do usuário no
// NATIVO (iOS/Android): as fns de fronteira de userdata/planos já expostas por F1.10/
// F5.4 via `web/reading.ts` (JSI → the-light-core, fs-backed), casadas ao `dataDir`
// gravável (`lib/userdata.ts`). O nome EN do livro e a validação de referência REAL
// vêm do CORE (`listBooks`/`parseReference` do binding JSI) — anti-alucinação.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO (alvo GARANTIDO — as fns
// fs-backed existem); no web vale `snapshotStore.web.ts` (OPFS). Carregado SOB DEMANDA
// (`import()`) pela UI de sync (F5.26) — fica FORA do entry eager do 1º paint.
import { parseReference as parseReferenceSync } from '../web/native-generated/src/index';
import {
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
 * Cria o `SnapshotStore` REAL do alvo NATIVO, ligado ao `dataDir` gravável do usuário
 * (de `ensureUserDataDir()`). Memoiza o mapa `número→nomeEN` do livro (`listBooks` do
 * CORE) e valida a referência importada com o `parse_reference` SÍNCRONO do CORE
 * (lança em referência irreal ANTES de qualquer escrita — anti-alucinação).
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
