// app/lib/readingDbLoad.web.ts — WEB. Par de `readingDbLoad.ts` (nativo no-op).
//
// BUS (pub-sub) do carregamento ÚNICO do banco de leitura no web. O subset de leitura
// (`reading-lite.sqlite`, a Bíblia completa — ~64 MB) é baixado 1× por sessão e mantido
// em memória (`sqlite-reading-opfs.web.ts`). Esse download inicial no celular demora, e
// o `openReadingDbWeb` (dynamic-imported) precisa REPORTAR progresso a um componente de
// UI (o aviso global em `_layout`). Como os dois vivem em módulos diferentes (a UI é
// estática; o opener é um chunk async), um bus de módulo compartilhado é a ponte: o
// bundler resolve ESTE módulo a UMA instância para o bundle principal E o chunk do opener.
//
// É um store externo mínimo consumível por `useSyncExternalStore` (React 19): estado
// imutável (nova referência a cada `set`) + listeners. Sem estado de domínio aqui — só o
// progresso de I/O de um asset local (nenhum texto bíblico passa por aqui).
import { useSyncExternalStore } from 'react';

/** Fase do carregamento único do banco de leitura no web. */
export type ReadingDbPhase = 'idle' | 'loading' | 'ready' | 'error';

/** Estado do carregamento único do banco de leitura (bytes baixados / total). */
export interface ReadingDbLoad {
  phase: ReadingDbPhase;
  /** Bytes já recebidos. */
  loaded: number;
  /** Tamanho total em bytes (0 = desconhecido, ex.: sem `Content-Length`). */
  total: number;
}

// Referência NOVA a cada mudança (contrato de `useSyncExternalStore`: snapshot estável
// entre mudanças, distinto ao mudar). Começa em `idle`.
let state: ReadingDbLoad = { phase: 'idle', loaded: 0, total: 0 };
const listeners = new Set<() => void>();

/** Snapshot atual (referência estável até o próximo `setReadingDbLoad`). */
export function getReadingDbLoad(): ReadingDbLoad {
  return state;
}

/** Aplica um patch ao estado e notifica os assinantes (idempotente por referência). */
export function setReadingDbLoad(next: Partial<ReadingDbLoad>): void {
  state = { ...state, ...next };
  for (const l of listeners) {
    l();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook: re-renderiza o consumidor quando o progresso do carregamento muda. */
export function useReadingDbLoad(): ReadingDbLoad {
  return useSyncExternalStore(subscribe, getReadingDbLoad, getReadingDbLoad);
}
