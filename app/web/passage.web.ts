// app/web/passage.web.ts — F0.10 (ADR-0011) · F5.12 (ADR-0041)
//
// GLUE web do `getPassage` (hand-written, VERSIONADO). Pipeline (ADR-0011):
//   1) parseReference(input) PELO RUST (wasm) — REUSA `reference.web.ts`, sem
//      parser paralelo em TS;
//   2) abre o STORE DE LEITURA local (subset `reading-sample.sqlite` via o build
//      SÍNCRONO do wa-sqlite COM FTS5 vendorado) — `openReadingDbWeb`;
//   3) lê o versículo com a query ESPELHADA (`readPassage`) e compõe a `Passage`
//      (Reference do RUST + TEXTO do store).
//
// F5.12 (ADR-0041): a home passa a REUSAR o MESMO store de leitura (F1.13). O
// caminho F0.10 legado (`sqlite-opfs.web` → build ASYNC do npm `wa-sqlite` +
// `sample.sqlite` de 1 versículo) era um DUPLICADO MORTO: o build vendorado COM
// FTS5 é SUPERSET do npm e o subset `reading-sample.sqlite` já contém João 3:16 KJV
// BYTE-IDÊNTICO ao `sample.sqlite`. Removê-lo tira ~670 KB do bundle web (o npm
// `wa-sqlite.wasm` 558 KB + o `sample.sqlite` 131 KB deixam de ser emitidos). O
// store carrega SOB DEMANDA via `import()` (molde `reading.web.ts` / F5.9),
// COMPARTILHANDO o mesmo chunk async da leitura — a factory wa-sqlite deixa de ser
// arrastada p/ o chunk EAGER de 1º paint. Offline-first: assets LOCAIS, sem rede.
//
// Anti-alucinação: o texto vem SEMPRE do store local, verbatim; nunca hardcoded.
// Resolução por extensão do Metro: `.web.ts` vale no web; em nativo vale
// `passage.ts` (stub — leitura nativa é a F0.9 via the-light-core).
import { parseReference } from './reference.web';
import type { Passage } from './generated/the_light_app_core';

export type { Passage };

/** Tradução default do MVP: KJV (domínio público), presente no subset de leitura. */
const DEFAULT_TRANSLATION = 'kjv';

/**
 * Resolve a referência PELO RUST (wasm) e lê o(s) versículo(s) do store de leitura
 * local (subset `reading-sample.sqlite` sobre `wa-sqlite`+FTS5), devolvendo a
 * `Passage` com o TEXTO verbatim do store. O store (factory wa-sqlite + OPFS) é
 * carregado via `import()` — chunk async LOCAL, COMPARTILHADO com a leitura (F5.9);
 * fica FORA do chunk eager de 1º paint. Offline-first: sem rede.
 */
export async function getPassage(
  input: string,
  translation: string = DEFAULT_TRANSLATION,
): Promise<Passage> {
  const reference = await parseReference(input);
  const [{ openReadingDbWeb }, { readPassage }] = await Promise.all([
    import('./sqlite-reading-opfs.web'),
    import('./sqlite.web'),
  ]);
  const handle = await openReadingDbWeb();
  try {
    return await readPassage(handle, reference, translation);
  } finally {
    await handle.close();
  }
}
