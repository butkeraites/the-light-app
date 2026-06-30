// app/web/passage.web.ts — F0.10 (ADR-0011)
//
// GLUE web do `getPassage` (hand-written, VERSIONADO). Pipeline (ADR-0011):
//   1) parseReference(input) PELO RUST (wasm) — REUSA `reference.web.ts`, sem
//      parser paralelo em TS;
//   2) abre o store local (`wa-sqlite`/OPFS) — `openPassageDbWeb` (browser);
//   3) lê o versículo com a query ESPELHADA (`readPassage`) e compõe a `Passage`
//      (Reference do RUST + TEXTO do store).
//
// Anti-alucinação: o texto vem SEMPRE do store local (`wa-sqlite`/OPFS), verbatim;
// nunca hardcoded. Resolução por extensão do Metro: `.web.ts` vale no web; em
// nativo vale `passage.ts` (stub — leitura nativa é a F0.9 via the-light-core).
import { parseReference } from './reference.web';
import { readPassage } from './sqlite.web';
import { openPassageDbWeb } from './sqlite-opfs.web';
import type { Passage } from './generated/the_light_app_core';

export type { Passage };

/** Tradução default do MVP: KJV (domínio público), a única no `sample.sqlite`. */
const DEFAULT_TRANSLATION = 'kjv';

/**
 * Resolve a referência PELO RUST (wasm) e lê o(s) versículo(s) do store local
 * (`wa-sqlite` sobre OPFS), devolvendo a `Passage` com o TEXTO verbatim do store.
 */
export async function getPassage(
  input: string,
  translation: string = DEFAULT_TRANSLATION,
): Promise<Passage> {
  const reference = await parseReference(input);
  const handle = await openPassageDbWeb();
  try {
    return await readPassage(handle, reference, translation);
  } finally {
    await handle.close();
  }
}
