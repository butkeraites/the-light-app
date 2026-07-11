// app/lib/readingDbLoad.ts — NATIVO (default). Par de `readingDbLoad.web.ts`.
//
// No NATIVO a Bíblia é EMBUTIDA no app (APK/IPA) — não há download em runtime, então o
// "aviso de preparação offline" NUNCA aparece. Este stub existe só para o Metro/`tsc`
// resolverem o mesmo import nos dois alvos (o web usa `readingDbLoad.web.ts`, que faz o
// bus real do fetch de 64 MB). Mantém a forma da API idêntica.

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

const IDLE: ReadingDbLoad = { phase: 'idle', loaded: 0, total: 0 };

/** Snapshot atual — no nativo é sempre `idle` (sem download). */
export function getReadingDbLoad(): ReadingDbLoad {
  return IDLE;
}

/** No-op no nativo (nada dispara o carregamento; a Bíblia já está embutida). */
export function setReadingDbLoad(_next: Partial<ReadingDbLoad>): void {}

/** Hook: no nativo devolve sempre `idle`, então o aviso jamais renderiza. */
export function useReadingDbLoad(): ReadingDbLoad {
  return IDLE;
}
