// driveSync-headless-entry.ts — F5.25 (molde snapshot-headless-entry.ts F5.23 / driveAuth F5.24)
//
// Ponto de entrada VERSIONADO da prova headless do PUSH/PULL do snapshot na pasta app-data
// do Google Drive (MOCK). É empacotado (esbuild) por driveSync.web.test.mjs num único .mjs e
// executado em node SEM browser/rede/CONTA. Reexporta EXATAMENTE as funções de PRODUÇÃO que
// a prova precisa — o MESMO código que a UI de sync da F5.26 vai injetar com
// `globalThis.fetch` + o `currentToken` da F5.24 + um `SnapshotStore` real:
//   - `init`/`mod`/`listBooks`/`parseReference`: a fronteira Rust no wasm (canonicaliza a
//     referência, resolve o nome EN do livro e VALIDA referência real — anti-alucinação).
//   - `formatReferenceEn` + as fns `*Fs` de userdata + `*PlanFs` de progresso: o glue
//     VFS-agnóstico que a prova roda sobre um `UserDataDir` EM MEMÓRIA (mock OPFS), o MESMO
//     backend que a F5.23 liga ao `SnapshotStore`.
//   - `exportSnapshot`/`serializeSnapshot`/`mergeSnapshots` (F5.23): asserções de estado.
//   - `createDriveSync` + constantes (F5.25): o motor PURO push/pull/sync sobre `fetch`+
//     `getToken`+`SnapshotStore` INJETADOS (a prova injeta um fetch mock + "nuvem" em memória).
//
// Nenhuma lógica nova aqui — apenas reexporta. NÃO importa nada browser-only; o motor é
// puro/injetável (fora do entry graph eager do web — perf-budget).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks, parseReference } from '../generated/the_light_app_core';
import {
  addHighlightFs,
  formatReferenceEn,
  listHighlightsFs,
  listNotesFs,
  putNoteFs,
} from '../userdata-fs.web';
import { readActivePlanFs, setCompletedFs, startPlanFs } from '../plans-fs.web';
import { exportSnapshot, mergeSnapshots, serializeSnapshot } from '../../lib/userdataSnapshot';
import {
  CANONICAL_SNAPSHOT_FILENAME,
  DRIVE_APPDATA_SPACE,
  DRIVE_FILES_ENDPOINT,
  DRIVE_UPLOAD_ENDPOINT,
  createDriveSync,
} from '../../lib/driveSync';

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
  readActivePlanFs,
  setCompletedFs,
  startPlanFs,
  exportSnapshot,
  mergeSnapshots,
  serializeSnapshot,
  CANONICAL_SNAPSHOT_FILENAME,
  DRIVE_APPDATA_SPACE,
  DRIVE_FILES_ENDPOINT,
  DRIVE_UPLOAD_ENDPOINT,
  createDriveSync,
};
