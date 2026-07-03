// plans-headless-entry.ts — F5.10 (molde notes-headless-entry.ts F1.16)
//
// Ponto de entrada VERSIONADO da prova headless dos PLANOS DE LEITURA no web. É
// empacotado (esbuild) por plans.web.test.mjs num único .mjs e executado em node SEM
// browser. Reexporta exatamente as funções de PRODUÇÃO que a prova precisa, para
// exercitar o MESMO código do produto:
//   - `init`/`mod`: a fronteira Rust no wasm (necessária para a GERAÇÃO cfg-free —
//     `listReadingPlans`/`readingPlanDay`/`readingPlanDayIndex` — e para a validação do
//     `plan_id`/`start_date` na persistência).
//   - `listReadingPlans`/`readingPlanDay`/`readingPlanDayIndex`: a GERAÇÃO REAL do core
//     (wasm), IDÊNTICA ao nativo (zero-drift) — NADA de chunking/índice em TS.
//   - `readActivePlanFs`/`startPlanFs`/`setCompletedFs`/`clearActivePlanFs`: o glue
//     VFS-agnóstico de `../plans-fs.web` (ESPELHO do formato `active.json` do core) — a
//     prova node o roda sobre um `UserDataDir` EM MEMÓRIA; o browser usa OPFS
//     (`../userdata-opfs.web`).
//
// Nenhuma lógica nova aqui — apenas reexporta. NÃO importa `reading.web.ts` nem
// `userdata-opfs.web.ts` (OPFS/asset browser-only): a prova injeta o backend em memória
// nas MESMAS funções de produção (mesmo isolamento da F1.16).
import init from '../generated/wasm-bindgen/index.js';
import mod, {
  listReadingPlans,
  readingPlanDay,
  readingPlanDayIndex,
} from '../generated/the_light_app_core';
import {
  clearActivePlanFs,
  readActivePlanFs,
  setCompletedFs,
  startPlanFs,
} from '../plans-fs.web';

export {
  init,
  mod,
  listReadingPlans,
  readingPlanDay,
  readingPlanDayIndex,
  clearActivePlanFs,
  readActivePlanFs,
  setCompletedFs,
  startPlanFs,
};
