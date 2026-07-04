// app/web/wasm.ts — F1.13 (ADR-0019) · F6.3
//
// Stub NATIVO do pré-aquecimento do wasm. No nativo o cânon/leitura vêm do JSI
// (the-light-core via Turbo Module) — NÃO há módulo wasm a inicializar — então
// `useWasmReady()` é sempre `ready=true` (as telas de leitura renderizam de imediato,
// sem regressão) e `ensureWasmReady()` resolve na hora. No web vale `wasm.web.ts`
// (init real do wasm da fronteira, com estado de erro + retry — F6.3) — resolução por
// extensão do Metro.

/**
 * Estado do pré-aquecimento do wasm exposto às telas de leitura (paridade com
 * `wasm.web.ts`, F6.3). No nativo nunca há init a falhar, então `error` é sempre
 * `null` e `retry` é um no-op.
 */
export type WasmReadyState = {
  ready: boolean;
  error: Error | null;
  retry: () => void;
};

export async function ensureWasmReady(): Promise<void> {
  // no-op no nativo
}

export function useWasmReady(): WasmReadyState {
  // No nativo o cânon vem do JSI — nunca há init a falhar: pronto de imediato.
  return { ready: true, error: null, retry: noop };
}

function noop(): void {
  // sem init a re-tentar no nativo
}
