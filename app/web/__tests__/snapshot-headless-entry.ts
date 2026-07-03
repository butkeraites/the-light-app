// snapshot-headless-entry.ts — F5.23 (molde notes-headless-entry.ts F1.16 / plans-headless-entry.ts F5.10)
//
// Ponto de entrada VERSIONADO da prova headless do SNAPSHOT (export/import round-trippável
// dos dados do usuário). É empacotado (esbuild) por snapshot.web.test.mjs num único .mjs e
// executado em node SEM browser/rede. Reexporta exatamente as funções de PRODUÇÃO que a
// prova precisa, para exercitar o MESMO código do produto:
//   - `init`/`mod`/`listBooks`/`parseReference`: a fronteira Rust no wasm (canonicaliza a
//     referência, resolve o nome EN do livro e VALIDA referência real — anti-alucinação).
//   - `formatReferenceEn` + as fns `*Fs` de userdata (notas/marcações) e `*PlanFs` de
//     progresso: o glue VFS-agnóstico (ESPELHO do formato do core) que a prova roda sobre um
//     `UserDataDir` EM MEMÓRIA; o browser usa OPFS (`../userdata-opfs.web`).
//   - O MOTOR PURO do snapshot (`../../lib/userdataSnapshot`): build/serialize/parse/merge +
//     export/import-com-merge sobre um `SnapshotStore` injetado.
//
// Nenhuma lógica nova aqui — apenas reexporta. NÃO importa `reading.web.ts` nem
// `userdata-opfs.web.ts` (OPFS/asset browser-only): a prova injeta o backend em memória nas
// MESMAS funções de produção (mesmo isolamento da F1.16/F5.10).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks, parseReference } from '../generated/the_light_app_core';
import {
  addHighlightFs,
  formatReferenceEn,
  listHighlightsFs,
  listNotesFs,
  putNoteFs,
  deleteNoteFs,
  removeHighlightFs,
} from '../userdata-fs.web';
import {
  clearActivePlanFs,
  readActivePlanFs,
  setCompletedFs,
  startPlanFs,
} from '../plans-fs.web';
import {
  buildSnapshot,
  serializeSnapshot,
  parseSnapshot,
  validateSnapshot,
  mergeSnapshots,
  exportSnapshot,
  importSnapshotIntoStore,
} from '../../lib/userdataSnapshot';

export {
  init,
  mod,
  listBooks,
  parseReference,
  addHighlightFs,
  formatReferenceEn,
  listHighlightsFs,
  listNotesFs,
  putNoteFs,
  deleteNoteFs,
  removeHighlightFs,
  clearActivePlanFs,
  readActivePlanFs,
  setCompletedFs,
  startPlanFs,
  buildSnapshot,
  serializeSnapshot,
  parseSnapshot,
  validateSnapshot,
  mergeSnapshots,
  exportSnapshot,
  importSnapshotIntoStore,
};
