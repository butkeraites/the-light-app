// app/lib/useStudyScope.ts — Fase 2 (Escopo de Estudo multi-seleção)
//
// STORE global do Escopo de Estudo + MODO SELEÇÃO do leitor. Vive num MÓDULO singleton (acima das
// rotas) para PERSISTIR ao navegar entre capítulos/livros — é o que permite juntar trechos de
// lugares diferentes num escopo só. Exposto via `useSyncExternalStore` (sem Provider). Só estado
// em memória + notificação; a lógica pura dos trechos vive em `studyScope.ts` (testável headless).
// Offline-first: nada de rede/persistência aqui (o escopo é de sessão; persistir sessões é fase
// posterior). Anti-alucinação: guarda só REFERÊNCIAS (book/chapter/verso) — nunca texto bíblico.
import { useSyncExternalStore } from 'react';

import {
  removeChunk as removeChunkPure,
  toggleVerse as toggleVersePure,
  toggleWholeChapter as toggleWholeChapterPure,
  type ScopeChunk,
} from './studyScope';

export type ScopeState = { chunks: ScopeChunk[]; selecting: boolean };

let state: ScopeState = { chunks: [], selecting: false };
const listeners = new Set<() => void>();

function set(next: ScopeState) {
  state = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot() {
  return state;
}

/** Mutadores do escopo — chamáveis de qualquer lugar (o hook re-renderiza os assinantes). */
export const studyScope = {
  toggleVerse(book: number, chapter: number, verse: number) {
    set({ ...state, chunks: toggleVersePure(state.chunks, book, chapter, verse) });
  },
  toggleWholeChapter(book: number, chapter: number) {
    set({ ...state, chunks: toggleWholeChapterPure(state.chunks, book, chapter) });
  },
  removeChunk(key: string) {
    const chunks = removeChunkPure(state.chunks, key);
    // Escopo vazio → sai do modo seleção (nada mais a montar).
    set({ chunks, selecting: chunks.length > 0 ? state.selecting : false });
  },
  clear() {
    set({ chunks: [], selecting: false });
  },
  setSelecting(selecting: boolean) {
    set({ ...state, selecting });
  },
  /** Entra no modo seleção (usado ao dar long-press no primeiro versículo). */
  startSelecting() {
    if (!state.selecting) set({ ...state, selecting: true });
  },
};

/** Hook reativo: lê `{ chunks, selecting }` do escopo global. */
export function useStudyScope(): ScopeState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
