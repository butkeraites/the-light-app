// interlinear-headless-entry.ts — Rodada 2 (modo interlinear; molde de deepStudy-headless-entry)
//
// Ponto de entrada VERSIONADO da prova headless da PARIDADE WEB do interlinear. Empacotado (esbuild)
// por `interlinear.web.test.mjs` e rodado em node SEM browser. Reexporta `interlinearVerseOnHandle`
// (a fn de PRODUÇÃO do pipeline web, `../study.web` → `queryInterlinearVerse`), exercitada sobre o
// `lexicon-sample.sqlite` em memória. `init`/`mod` (fronteira wasm) por consistência com o molde.
import init from '../generated/wasm-bindgen/index.js';
import mod from '../generated/the_light_app_core';
import { interlinearVerseOnHandle } from '../study.web';

export { init, mod, interlinearVerseOnHandle };
