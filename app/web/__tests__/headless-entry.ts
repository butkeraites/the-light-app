// headless-entry.ts — F0.6b (ADR-0007)
//
// Ponto de entrada VERSIONADO da prova headless. É empacotado (esbuild) por
// parseReference.web.test.mjs num único .mjs e executado em node SEM browser.
//
// Reexporta exatamente o que a prova precisa, a partir dos bindings web GERADOS:
//   - `init`  : init do wasm-bindgen (default export do glue web `index.js`);
//   - `mod`   : default do binding (expõe `initialize()` = checksums/contrato);
//   - `parseReference`: a função da fronteira, resolvida PELO RUST no wasm.
//
// Nenhuma lógica de parsing aqui — apenas reexporta. Os imports apontam para
// app/web/generated/, que é GERADO por scripts/gen-bindings-web.sh (ignorado pelo
// git): a prova exige que a geração tenha rodado antes.
import init from '../generated/wasm-bindgen/index.js';
import mod, { parseReference } from '../generated/the_light_app_core';

export { init, mod, parseReference };
