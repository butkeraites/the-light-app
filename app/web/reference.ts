// app/web/reference.ts — F0.7 (ADR-0008)
//
// GLUE NATIVO (hand-written, VERSIONADO) entre o app Expo e o Turbo Module JSI
// GERADO pelo `ubrn build ios` (raiz do repo: src/index.tsx + bindings/, todos
// ignorados). Resolução por extensão do Metro: este `.ts` vale no NATIVO
// (iOS/Android); no web vale `reference.web.ts` (wasm, F0.6b — NÃO alterado).
//
// `../../src` é o barrel gerado do Turbo Module (repo-root/src/index.tsx): ao ser
// importado ele instala o crate Rust no runtime JSI (`installRustCrate()`) e
// reexporta os bindings UniFFI. `parseReference` NÃO faz parsing em TS: delega ao
// `the_light_core::reference` compilado no xcframework (uma fonte da verdade).
import { parseReference as parseReferenceNative } from './native-generated/src/index';
import type { Reference } from './native-generated/bindings/the_light_app_core';

export type { Reference };

/**
 * Resolve uma referência bíblica (PT ou EN) PELO RUST NATIVO via Turbo Module
 * (JSI → UniFFI → the-light-core). O binding nativo é síncrono (o crate já está
 * instalado na importação do barrel); embrulhamos numa Promise para manter a
 * mesma assinatura do glue web (`reference.web.ts`).
 */
export async function parseReference(input: string): Promise<Reference> {
  return parseReferenceNative(input);
}
