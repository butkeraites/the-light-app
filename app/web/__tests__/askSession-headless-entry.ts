// askSession-headless-entry.ts — F3.12b (ADR-0032; molde askAnchored-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless da PARIDADE WEB DA CONVERSA. É empacotado
// (esbuild) por `askSession.web.test.mjs` num único `.mjs` e executado em node SEM browser
// e SEM rede/chave real (o `fetch` é MOCK). Reexporta exatamente o que a prova precisa:
//   - `init`/`mod`: a fronteira Rust no wasm (`session_web_prepare`/`ai_web_finalize` +
//     `parse_reference` + `list_books`), instanciada com os bytes de `index_bg.wasm`.
//   - `ChatRole`: o enum de papel de turno (User/Assistant) p/ montar o histórico.
//   - `askSessionAnchoredOnHandle`: a MESMA função de PRODUÇÃO do pipeline web de conversa
//     (`../session.web`) — a prova a exercita sobre um VFS de memória (store) + um `fetch`
//     MOCK (transporte), enquanto o browser usa OPFS + `globalThis.fetch` via `reading.web.ts`.
// NÃO importa `reading.web.ts` (que arrasta OPFS/assets). Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod, { ChatRole } from '../generated/the_light_app_core';
import { askSessionAnchoredOnHandle } from '../session.web';

export { init, mod, ChatRole, askSessionAnchoredOnHandle };
