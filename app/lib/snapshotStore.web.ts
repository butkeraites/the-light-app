// app/lib/snapshotStore.web.ts — F5.26 (ADR-0054) · wiring WEB
//
// Liga o adaptador PURO (`snapshotStore.shared.ts`) ao STORE REAL do usuário no WEB:
// as MESMAS fns de fronteira de userdata/planos de `web/reading.web.ts` (I/O sobre
// OPFS espelhando o formato do core — F1.16/F5.10), com o `dataDir` sentinela
// (`ensureUserDataDir()` web devolve `'web:userdata'`; o store abre o OPFS
// internamente). O nome EN do livro e a validação de referência REAL vêm do CORE no
// wasm (`listBooks`/`parseReference` SÍNCRONOS) — anti-alucinação.
//
// PRÉ-REQUISITO WEB: o wasm da fronteira precisa estar inicializado antes de usar o
// store (a UI de sync chama `ensureWasmReady()` antes de export/import). Carregado
// SOB DEMANDA (`import()`) pela UI — FORA do entry eager do 1º paint (perf-budget).
import { parseReference as parseReferenceSync } from '../web/generated/the_light_app_core';
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
 * Cria o `SnapshotStore` REAL do alvo WEB. Memoiza o mapa `número→nomeEN` do livro
 * (`listBooks` do CORE/wasm) e valida a referência importada com o `parse_reference`
 * SÍNCRONO do CORE (lança em referência irreal ANTES de qualquer escrita OPFS —
 * anti-alucinação). Exige o wasm já inicializado (garantido pela UI).
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
      parseReferenceSync(reference); // lança em referência irreal (core/wasm)
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
