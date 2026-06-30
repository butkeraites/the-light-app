// app/web/wasm.web.ts — F1.13 (ADR-0019)
//
// Pré-aquecimento do wasm da fronteira no WEB. `listBooks()` (cânon de 66 livros)
// vem do RUST (wasm) e é SÍNCRONO no contrato compartilhado com o nativo, mas
// exige o wasm já inicializado (`uniffiInitAsync()`). Este módulo memoiza o init e
// expõe `useWasmReady()` para o `_layout.tsx` gatear a renderização da stack até o
// wasm estar pronto — assim as telas de leitura podem chamar `listBooks()`
// sincronamente sem erro. Idempotente: o `__wbg_init` do wasm-bindgen e o
// `initialize()` dos bindings já guardam contra re-init (carga única).
import { useEffect, useState } from 'react';

import { uniffiInitAsync } from './generated/index.web';

let initPromise: Promise<void> | null = null;

/** Inicializa o wasm da fronteira UMA vez (idempotente sob hot-reload do Metro). */
export function ensureWasmReady(): Promise<void> {
  if (initPromise === null) {
    initPromise = uniffiInitAsync();
  }
  return initPromise;
}

/**
 * Hook que retorna `true` quando o wasm da fronteira está pronto. Dispara o init
 * no 1º render e re-renderiza ao concluir. No nativo (`wasm.ts`) é sempre `true`.
 */
export function useWasmReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    ensureWasmReady()
      .then(() => {
        if (alive) setReady(true);
      })
      .catch(() => {
        // Falha de init: mantém o gate; o erro reaparece de forma explícita ao
        // chamar `listBooks()` nas telas de leitura (sem mascarar o problema).
      });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}
