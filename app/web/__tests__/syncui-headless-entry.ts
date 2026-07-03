// syncui-headless-entry.ts — F5.26 (molde snapshot-headless-entry.ts F5.23)
//
// Ponto de entrada VERSIONADO da prova headless da UI de sync (F5.26). Empacotado
// (esbuild) por syncui.web.test.mjs num único .mjs e executado em node SEM browser/rede/
// device/chave. Reexporta as fns de PRODUÇÃO que a prova precisa, para exercitar o MESMO
// código do produto:
//   - a fronteira Rust no wasm (`init`/`mod`/`listBooks`/`parseReference`) — referência
//     canônica/validação REAL (anti-alucinação);
//   - `formatReferenceEn` + as fns `*Fs`/`*PlanFs` de userdata/progresso (o glue
//     VFS-agnóstico da F1.16/F5.10) rodadas sobre um `UserDataDir` EM MEMÓRIA;
//   - o ADAPTADOR da F5.26 (`createSnapshotStore`/`formatReferenceEnPure`) que liga o
//     motor da F5.23 ao store REAL;
//   - o flag OPT-IN da F5.26 (`createSyncPrefs`/`SYNC_OPTIN_PREF_KEY`);
//   - o motor da F5.23 (`exportSnapshot`/`importSnapshotIntoStore`/`serializeSnapshot`).
//
// Nenhuma lógica nova aqui — só reexporta. NÃO importa `snapshotStore.web.ts` (que
// puxa o glue OPFS/browser): a prova injeta o backend em memória DIRETO em
// `createSnapshotStore`, exercitando o MESMO adaptador puro do produto.
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
import { createSnapshotStore, formatReferenceEnPure } from '../../lib/snapshotStore.shared';
import { createSyncPrefs, SYNC_OPTIN_PREF_KEY } from '../../lib/syncPrefs';
import {
  exportSnapshot,
  importSnapshotIntoStore,
  serializeSnapshot,
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
  readActivePlanFs,
  setCompletedFs,
  startPlanFs,
  createSnapshotStore,
  formatReferenceEnPure,
  createSyncPrefs,
  SYNC_OPTIN_PREF_KEY,
  exportSnapshot,
  importSnapshotIntoStore,
  serializeSnapshot,
};
