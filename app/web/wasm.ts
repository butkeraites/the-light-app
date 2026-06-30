// app/web/wasm.ts — F1.13 (ADR-0019)
//
// Stub NATIVO do pré-aquecimento do wasm. No nativo o cânon/leitura vêm do JSI
// (the-light-core via Turbo Module) — NÃO há módulo wasm a inicializar — então
// `useWasmReady()` é sempre `true` (o layout compartilhado renderiza de imediato,
// sem regressão) e `ensureWasmReady()` resolve na hora. No web vale `wasm.web.ts`
// (init real do wasm da fronteira) — resolução por extensão do Metro.
export async function ensureWasmReady(): Promise<void> {
  // no-op no nativo
}

export function useWasmReady(): boolean {
  return true;
}
