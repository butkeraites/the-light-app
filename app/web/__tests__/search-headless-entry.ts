// search-headless-entry.ts — F1.14 (ADR-0020; molde reading-headless-entry F1.13)
//
// Ponto de entrada VERSIONADO da prova headless do STORE WEB de BUSCA. É
// empacotado (esbuild) por search.web.test.mjs num único .mjs e executado em node
// SEM browser. Reexporta exatamente as funções de PRODUÇÃO que a prova precisa,
// para exercitar o MESMO código do produto:
//   - `init`/`mod`/`listBooks`: a fronteira Rust no wasm (necessária p/ compor a
//     referência `VerseRange.Single` e resolver o nome do livro — paridade com
//     `reading.web.ts`).
//   - `buildMatchQuery`/`querySearch`/`searchOnHandle`/`hasTranslation`: o glue
//     VFS-agnóstico do store de busca (`../sqlite-search.web` + `../sqlite-reading.web`)
//     — a prova node o roda sobre um VFS de memória; o browser usa OPFS
//     (`../sqlite-reading-opfs.web`), MESMO subset.
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks } from '../generated/the_light_app_core';
import { hasTranslation } from '../sqlite-reading.web';
import { buildMatchQuery, querySearch, searchOnHandle } from '../sqlite-search.web';

export { init, mod, listBooks, hasTranslation, buildMatchQuery, querySearch, searchOnHandle };
