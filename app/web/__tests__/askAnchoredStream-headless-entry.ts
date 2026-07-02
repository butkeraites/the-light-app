// askAnchoredStream-headless-entry.ts — F4.1 (ADR-0033; molde askAnchored-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless do STREAMING WEB REAL. É empacotado
// (esbuild) por `askAnchoredStream.web.test.mjs` num único `.mjs` e executado em node SEM
// browser e SEM rede/chave real (o `fetch` é MOCK e devolve um `ReadableStream` SSE).
// Reexporta exatamente o que a prova precisa:
//   - `init`/`mod`: a fronteira Rust no wasm (`ai_web_prepare`/`ai_web_finalize` +
//     `parse_reference`), instanciada com os bytes de `index_bg.wasm` — INALTERADA (o
//     streaming muda só o transporte TS; a fronteira `ai-pure` não muda).
//   - `askAnchoredOnHandle`: a MESMA função de PRODUÇÃO do pipeline web de IA
//     (`../ai-anchored.web`), agora com o parâmetro opcional `onToken` — a prova a exercita
//     sobre um VFS de memória (store) + um `fetch` MOCK que STREAMA (transporte), enquanto o
//     browser usa OPFS + `globalThis.fetch` via `reading.web.ts`. NÃO importa `reading.web.ts`
//     (que arrasta OPFS/assets).
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são GERADOS por
// scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod from '../generated/the_light_app_core';
import { askAnchoredOnHandle } from '../ai-anchored.web';

export { init, mod, askAnchoredOnHandle };
