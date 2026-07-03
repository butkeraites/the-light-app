// coverage-headless-entry.ts — F5.36 (ADR-0056; molde search-headless-entry F1.14)
//
// Ponto de entrada VERSIONADO da GUARDA DE COBERTURA do STORE WEB de leitura/busca.
// É empacotado (esbuild) por coverage.web.test.mjs num único .mjs e executado em node
// SEM browser. Reexporta exatamente as funções de PRODUÇÃO que a guarda precisa, para
// exercitar o MESMO código do produto sobre o fixture `reading-lite.sqlite`:
//   - `init`/`mod`/`listBooks`: a fronteira Rust no wasm (cânon dos 66 livros).
//   - `queryChapterCount`/`queryTranslations`/`hasTranslation`: o glue do store de
//     LEITURA (`../sqlite-reading.web`) — `queryChapterCount` é EXATAMENTE o que a tela
//     de leitura consulta para saber se um livro tem capítulos (o bug F5.36 era este
//     retornar 0 para Mateus).
//   - `searchOnHandle`: o glue do store de BUSCA (`../sqlite-search.web`) — prova que a
//     busca FTS5 cobre livros FORA de {Gênesis, Salmos, João}.
//
// Nenhuma lógica nova aqui — apenas reexporta. Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks } from '../generated/the_light_app_core';
import { hasTranslation, queryChapterCount, queryTranslations } from '../sqlite-reading.web';
import { searchOnHandle } from '../sqlite-search.web';

export { init, mod, listBooks, hasTranslation, queryChapterCount, queryTranslations, searchOnHandle };
