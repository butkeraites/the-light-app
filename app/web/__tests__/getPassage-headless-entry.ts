// getPassage-headless-entry.ts — F0.10 (ADR-0011)
//
// Ponto de entrada VERSIONADO da prova headless do STORE WEB. É empacotado
// (esbuild) por getPassage.web.test.mjs num único .mjs e executado em node SEM
// browser. Reexporta exatamente o que a prova precisa:
//   - `init`/`mod`/`parseReference`: a fronteira Rust no wasm (idêntico à F0.6b);
//     parseReference resolve a referência PELO RUST (não em TS).
//   - `queryPassage`/`readPassage`/`composePassage`: as MESMAS funções de PRODUÇÃO
//     do glue do store (`../sqlite.web`) — a prova node as exercita sobre um VFS de
//     memória, enquanto o browser usa OPFS (F5.12/ADR-0041: `../sqlite-reading-opfs.web`,
//     o mesmo store da leitura, sobre o subset `reading-sample.sqlite`).
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git); a prova exige que
// a geração tenha rodado antes.
import init from '../generated/wasm-bindgen/index.js';
import mod, { parseReference } from '../generated/the_light_app_core';
import { composePassage, queryPassage, readPassage } from '../sqlite.web';

export { init, mod, parseReference, composePassage, queryPassage, readPassage };
