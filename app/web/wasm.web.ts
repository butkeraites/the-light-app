// app/web/wasm.web.ts — F1.13 (ADR-0019) · F6.3 (erro VISÍVEL + retry, nunca spinner infinito)
//
// Pré-aquecimento do wasm da fronteira no WEB. `listBooks()` (cânon de 66 livros)
// vem do RUST (wasm) e é SÍNCRONO no contrato compartilhado com o nativo, mas
// exige o wasm já inicializado (`uniffiInitAsync()`). Este módulo memoiza o init e
// expõe `useWasmReady()` para o `WasmGate` gatear a renderização das telas de leitura
// até o wasm estar pronto — assim elas podem chamar `listBooks()` sincronamente sem
// erro. Idempotente: o `__wbg_init` do wasm-bindgen e o `initialize()` dos bindings
// já guardam contra re-init (carga única).
//
// F6.3: o hook NÃO ENGOLE mais uma falha de init. Antes, o `.catch` descartava o erro
// e deixava `ready=false` para sempre → `WasmGate` ficava num spinner INFINITO SEM erro
// (foi esse padrão de "erro engolido parece carregando" que deixou a leitura web quebrada
// por 3 ciclos). Agora expõe `{ ready, error, retry }`: a falha vira ESTADO visível e
// `retry()` reseta a promise memoizada para uma NOVA tentativa REAL.
import { useCallback, useEffect, useState } from 'react';

import { uniffiInitAsync } from './generated/index.web';

/**
 * Estado do pré-aquecimento do wasm da fronteira exposto às telas de leitura (F6.3):
 * `ready` quando pronto; `error` quando o init FALHOU (nunca mais spinner silencioso);
 * `retry()` para uma nova tentativa real. No nativo (`wasm.ts`) é sempre `ready=true`.
 */
export type WasmReadyState = {
  ready: boolean;
  error: Error | null;
  retry: () => void;
};

let initPromise: Promise<void> | null = null;

/** Inicializa o wasm da fronteira UMA vez (idempotente sob hot-reload do Metro). */
export function ensureWasmReady(): Promise<void> {
  if (initPromise === null) {
    initPromise = uniffiInitAsync();
  }
  return initPromise;
}

/**
 * Reseta a promise memoizada de init para forçar uma NOVA tentativa REAL na próxima
 * chamada de `ensureWasmReady()` (usado pelo `retry` do hook após uma falha). O
 * `__wbg_init` do wasm-bindgen só faz curto-circuito quando o módulo JÁ carregou — se a
 * tentativa anterior FALHOU (ex.: wasm inválido), o retry re-busca/instancia de verdade.
 */
function resetWasmInit(): void {
  initPromise = null;
}

/**
 * Hook que reporta o estado do wasm da fronteira. Dispara o init no 1º render e
 * re-renderiza ao CONCLUIR (`ready=true`) ou FALHAR (`error` preenchido). `retry()`
 * reseta o init memoizado e re-dispara — uma tentativa nova de verdade.
 */
export function useWasmReady(): WasmReadyState {
  const [state, setState] = useState<{ ready: boolean; error: Error | null }>({
    ready: false,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ ready: false, error: null });
    ensureWasmReady()
      .then(() => {
        if (alive) setState({ ready: true, error: null });
      })
      .catch((err: unknown) => {
        // F6.3: NÃO engole mais — expõe o erro para o gate mostrar retry (antes: preso em false).
        if (alive) {
          setState({ ready: false, error: err instanceof Error ? err : new Error(String(err)) });
        }
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    resetWasmInit();
    setAttempt((n) => n + 1);
  }, []);

  return { ready: state.ready, error: state.error, retry };
}
