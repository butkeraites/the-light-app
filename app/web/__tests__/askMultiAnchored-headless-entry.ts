// askMultiAnchored-headless-entry.ts — Fase 5 (ADR-0069 Caminho A; molde de askAnchored-headless-entry)
//
// Ponto de entrada VERSIONADO da prova headless da SÍNTESE CONJUNTA web. Empacotado
// (esbuild) por `askMultiAnchored.web.test.mjs` e rodado em node SEM browser/rede/chave
// real (o `fetch` é MOCK). Reexporta:
//   - `init`/`mod`: a fronteira Rust no wasm (`ai_multi_web_prepare`/`ai_multi_web_finalize`
//     + `parse_reference`), instanciada com os bytes de `index_bg.wasm`.
//   - `askMultiAnchoredOnHandle`: a MESMA função de PRODUÇÃO do pipeline web multi-passagem
//     (`../ai-anchored.web`) — a prova a exercita sobre um VFS de memória (store) + `fetch`
//     MOCK. NÃO importa `reading.web.ts` (que arrasta OPFS/assets).
//
// Nenhuma lógica nova aqui — só reexporta. Os imports `../generated/` são GERADOS por
// scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod from '../generated/the_light_app_core';
import { askMultiAnchoredOnHandle } from '../ai-anchored.web';

export { init, mod, askMultiAnchoredOnHandle };
