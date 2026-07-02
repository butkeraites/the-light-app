// multiProvider-headless-entry.ts — F4.2 (ADR-0034; molde askAnchoredStream-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless do TRANSPORTE WEB MULTI-PROVEDOR
// (anthropic/openai/ollama). É empacotado (esbuild) por `multiProvider.web.test.mjs` num único
// `.mjs` e executado em node SEM browser e SEM rede/chave real (o `fetch` é MOCK e devolve o
// corpo SSE/NDJSON de cada provedor). Reexporta exatamente o que a prova precisa:
//   - `init`/`mod`: a fronteira Rust no wasm (`ai_web_prepare`/`ai_web_finalize` +
//     `parse_reference`), instanciada com os bytes de `index_bg.wasm` — INALTERADA (o
//     multi-provedor muda SÓ o transporte TS; a fronteira `ai-pure` não muda).
//   - `askAnchoredOnHandle`: a MESMA função de PRODUÇÃO do pipeline web de IA
//     (`../ai-anchored.web`) — a prova a exercita sobre um VFS de memória (store) + um `fetch`
//     MOCK que despacha por provedor (transporte). NÃO importa `reading.web.ts` (OPFS/assets).
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são GERADOS por
// scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod from '../generated/the_light_app_core';
import { askAnchoredOnHandle } from '../ai-anchored.web';

export { init, mod, askAnchoredOnHandle };
