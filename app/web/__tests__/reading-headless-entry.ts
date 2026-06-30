// reading-headless-entry.ts — F1.13 (ADR-0018/ADR-0019; molde F0.10 ADR-0011)
//
// Ponto de entrada VERSIONADO da prova headless do STORE WEB de LEITURA. É
// empacotado (esbuild) por reading.web.test.mjs num único .mjs e executado em node
// SEM browser. Reexporta exatamente o que a prova precisa:
//   - `init`/`mod`/`listBooks`: a fronteira Rust no wasm; `listBooks` resolve o
//     CÂNON (66 livros) PELO RUST (não em TS) — paridade com `reading.web.ts`.
//   - `queryChapter`/`composeChapterPassage`/`queryChapterCount`/
//     `queryTranslations`/`hasTranslation`: as MESMAS funções de PRODUÇÃO do glue
//     do store de leitura (`../sqlite-reading.web`) — a prova node as exercita
//     sobre um VFS de memória, enquanto o browser usa OPFS
//     (`../sqlite-reading-opfs.web`).
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks } from '../generated/the_light_app_core';
import {
  composeChapterPassage,
  hasTranslation,
  queryChapter,
  queryChapterCount,
  queryTranslations,
} from '../sqlite-reading.web';

export {
  init,
  mod,
  listBooks,
  composeChapterPassage,
  hasTranslation,
  queryChapter,
  queryChapterCount,
  queryTranslations,
};
