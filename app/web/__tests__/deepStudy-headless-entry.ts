// deepStudy-headless-entry.ts — F3.12a (ADR-0031; molde askAnchored-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless da PARIDADE WEB DO ESTUDO. É empacotado
// (esbuild) pelos testes `deepStudy.web.test.mjs`/`lexicalEntries.web.test.mjs`/
// `export.web.test.mjs` num único `.mjs` e executado em node SEM browser e SEM rede/chave
// real (o `fetch` é MOCK ou o provedor é `"mock"` offline). Reexporta exatamente o que as
// provas precisam:
//   - `init`/`mod`: a fronteira Rust no wasm (`study_web_prepare`/`study_web_finalize` +
//     `parse_reference`), instanciada com os bytes de `index_bg.wasm`.
//   - `deepStudyOnHandle`/`lexicalEntriesOnHandle`: as MESMAS funções de PRODUÇÃO do
//     pipeline web de estudo (`../study.web`) — exercitadas sobre um VFS de memória (store
//     + léxico) + um `fetch` MOCK, enquanto o browser usa OPFS + `globalThis.fetch`.
//   - `buildStudyExport`: a função PURA de export acadêmico (`../../lib/studyExport`),
//     provada sobre o RETORNO real de `deepStudyOnHandle`.
// NÃO importa `reading.web.ts` (que arrasta OPFS/assets). Os imports `../generated/` são
// GERADOS por scripts/gen-bindings-web.sh (ignorados pelo git).
import init from '../generated/wasm-bindgen/index.js';
import mod, { StudyDepth, StudyLens, StudyMode } from '../generated/the_light_app_core';
import { deepStudyOnHandle, lexicalEntriesOnHandle } from '../study.web';
import { buildStudyExport } from '../../lib/studyExport';

export {
  init,
  mod,
  StudyMode,
  StudyLens,
  StudyDepth,
  deepStudyOnHandle,
  lexicalEntriesOnHandle,
  buildStudyExport,
};
