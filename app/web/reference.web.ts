// app/web/reference.web.ts — F0.6b (ADR-0007)
//
// GLUE web (hand-written, VERSIONADO) entre o app Expo e os bindings web/wasm
// GERADOS (app/web/generated/, ignorados pelo git). Responsabilidades:
//   - inicializar o módulo wasm UMA vez, de forma assíncrona, via o
//     `uniffiInitAsync()` do barrel gerado (instancia o wasm-bindgen + roda os
//     checks de contrato/checksum);
//   - expor `parseReference(input)` tipado que DELEGA ao binding gerado
//     (`the_light_core::reference::parse_reference` compilado p/ wasm).
//
// NÃO há parsing aqui: a referência é resolvida PELO RUST (uma fonte da verdade).
// Resolução por plataforma do Metro: este arquivo (.web.ts) vale no web; em
// nativo vale o stub reference.ts (F0.7/F0.8 ligam iOS/Android).
import { uniffiInitAsync, parseReference as parseReferenceWasm } from './generated/index.web';
import type { Reference } from './generated/the_light_app_core';

export type { Reference };

// Memoiza a inicialização do wasm: a primeira chamada dispara o init; as demais
// reaproveitam a mesma Promise (idempotente mesmo sob hot-reload do Metro).
let initPromise: Promise<void> | null = null;
function ensureWasmReady(): Promise<void> {
  if (initPromise === null) {
    initPromise = uniffiInitAsync();
  }
  return initPromise;
}

/**
 * Resolve uma referência bíblica (PT ou EN) PELO RUST (wasm). Garante que o
 * módulo wasm esteja inicializado antes de delegar ao binding gerado.
 */
export async function parseReference(input: string): Promise<Reference> {
  await ensureWasmReady();
  return parseReferenceWasm(input);
}
