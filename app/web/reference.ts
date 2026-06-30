// app/web/reference.ts — F0.6b (ADR-0007)
//
// Stub NATIVO do glue de referência. O caminho wasm é WEB-only (este `.ts` é o
// fallback do Metro quando NÃO é web; o `.web.ts` ao lado é o real). A ligação
// nativa (iOS/Android via JSI/turbo-module) chega nas fases F0.7/F0.8 — até lá,
// nativo não resolve referências e isto deixa explícito (sem eco, sem parsing
// em TS: a fronteira nativa é a única fonte futura).
import type { Reference } from './generated/the_light_app_core';

export type { Reference };

export async function parseReference(_input: string): Promise<Reference> {
  throw new Error(
    'parseReference (wasm) é WEB-only por enquanto; a ponte nativa chega em F0.7/F0.8.',
  );
}
