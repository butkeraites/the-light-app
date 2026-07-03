// firstpaint-stubs/wasm.js — F5.3
//
// Stub do pré-aquecimento do wasm da fronteira: `ensureWasmReady()` NUNCA resolve
// (promessa pendente para sempre) — é exatamente a condição que a prova de 1º paint
// exige: se o shell montar a navegação mesmo assim, ele NÃO está bloqueando no wasm.
// Registra a contagem de chamadas num global compartilhado (bundle ↔ teste) para o
// teste asserir que o warm em 2º plano REALMENTE disparou.
export function ensureWasmReady() {
  globalThis.__wasmWarmCalls = (globalThis.__wasmWarmCalls || 0) + 1;
  return new Promise(() => {
    // nunca resolve — prova que o shell não espera o wasm
  });
}

export function useWasmReady() {
  // Simula "wasm ainda não pronto" (as telas de leitura gateadas mostrariam spinner).
  return false;
}
