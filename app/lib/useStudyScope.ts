// app/lib/useStudyScope.ts — Fase 2 (Escopo de Estudo multi-seleção)
//
// STORE global do Escopo de Estudo + MODO SELEÇÃO do leitor. Vive num MÓDULO singleton (acima das
// rotas) para PERSISTIR ao navegar entre capítulos/livros — é o que permite juntar trechos de
// lugares diferentes num escopo só. Exposto via `useSyncExternalStore` (sem Provider). Só estado
// em memória + notificação; a lógica pura dos trechos vive em `studyScope.ts` (testável headless).
// Fase 4b: a SESSÃO de escopo agora PERSISTE no KV de prefs OFFLINE (re-hidrata no boot, grava a
// cada mudança de trechos) — offline-first, sem rede. Anti-alucinação: guarda só REFERÊNCIAS
// (book/chapter/verso) — nunca texto bíblico.
import { useSyncExternalStore } from 'react';

import { getPref, removePref, setPref } from './prefs';
import {
  parseChunks,
  removeChunk as removeChunkPure,
  serializeChunks,
  STUDY_SCOPE_KEY,
  toggleVerse as toggleVersePure,
  toggleWholeChapter as toggleWholeChapterPure,
  type ScopeChunk,
} from './studyScope';

export type ScopeState = { chunks: ScopeChunk[]; selecting: boolean };

let state: ScopeState = { chunks: [], selecting: false };
const listeners = new Set<() => void>();
// `true` assim que o usuário MEXER nos trechos: a hidratação assíncrona não sobrescreve isso.
let mutated = false;

// Grava a sessão (só quando os trechos mudam). Escopo vazio → limpa a chave. Fire-and-forget:
// falha de KV é tolerada (offline-first). `selecting` é UI efêmera e NÃO é persistido.
function persistScope(chunks: ScopeChunk[]) {
  void (async () => {
    try {
      if (chunks.length === 0) await removePref(STUDY_SCOPE_KEY);
      else await setPref(STUDY_SCOPE_KEY, serializeChunks(chunks));
    } catch {
      /* tolerado */
    }
  })();
}

function set(next: ScopeState) {
  const chunksChanged = next.chunks !== state.chunks;
  state = next;
  if (chunksChanged) {
    mutated = true;
    persistScope(next.chunks);
  }
  for (const l of listeners) l();
}

// Re-hidrata a última sessão no BOOT do módulo — a menos que o usuário já tenha mexido nos trechos
// (aí a interação dele vence). Aplica direto (sem `set`) p/ não re-gravar o que acabou de ler.
void (async () => {
  let raw: string | null;
  try {
    raw = await getPref(STUDY_SCOPE_KEY);
  } catch {
    return; // KV indisponível → começa vazio (offline-first)
  }
  if (mutated) return;
  const chunks = parseChunks(raw);
  if (chunks.length === 0) return;
  state = { ...state, chunks };
  for (const l of listeners) l();
})();
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
