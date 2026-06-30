// xref-headless-entry.ts — F1.15 (ADR-0021; molde search-headless-entry F1.14)
//
// Ponto de entrada VERSIONADO da prova headless do STORE WEB de XREF. É empacotado
// (esbuild) por xref.web.test.mjs num único .mjs e executado em node SEM browser.
// Reexporta exatamente as funções de PRODUÇÃO que a prova precisa, para exercitar o
// MESMO código do produto:
//   - `init`/`mod`/`listBooks`: a fronteira Rust no wasm (necessária p/ compor as
//     referências `VerseRange.Single`/`Range` e resolver o nome do livro — paridade
//     com `reading.web.ts`).
//   - `queryCrossRefs`/`composeCrossRef`/`crossRefsOnHandle`: o glue VFS-agnóstico
//     do store de xref (`../sqlite-xref.web`) — a prova node o roda sobre um VFS de
//     memória; o browser usa OPFS (`../sqlite-reading-opfs.web`), MESMO subset.
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks } from '../generated/the_light_app_core';
import { composeCrossRef, crossRefsOnHandle, queryCrossRefs } from '../sqlite-xref.web';

export { init, mod, listBooks, composeCrossRef, crossRefsOnHandle, queryCrossRefs };
