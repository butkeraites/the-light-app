// notes-headless-entry.ts — F1.16 (ADR-0022; molde xref-headless-entry F1.15)
//
// Ponto de entrada VERSIONADO da prova headless do USERDATA web (notas/marcações).
// É empacotado (esbuild) por notes.web.test.mjs num único .mjs e executado em node
// SEM browser. Reexporta exatamente as funções de PRODUÇÃO que a prova precisa, para
// exercitar o MESMO código do produto:
//   - `init`/`mod`/`listBooks`/`parseReference`: a fronteira Rust no wasm (necessária
//     p/ canonicalizar a referência e resolver o nome EN do livro — paridade com
//     `reading.web.ts`, que resolve `parseReference` ANTES do I/O).
//   - As 7 funções `*Fs` + `slugForNote`/`formatReferenceEn`: o glue VFS-agnóstico de
//     `../userdata-fs.web` (ESPELHO do formato do core) — a prova node o roda sobre
//     um `UserDataDir` EM MEMÓRIA; o browser usa OPFS (`../userdata-opfs.web`).
//   - `buildNotesExport`: o agregado PURO dos Records (`../../lib/notesExport`),
//     IDÊNTICO ao nativo (export portável).
//
// Nenhuma lógica nova aqui — apenas reexporta. NÃO importa `reading.web.ts` nem
// `userdata-opfs.web.ts` (OPFS/asset browser-only): a prova injeta o backend em
// memória nas MESMAS funções de produção (mesmo isolamento da F1.13/F1.15).
import init from '../generated/wasm-bindgen/index.js';
import mod, { listBooks, parseReference } from '../generated/the_light_app_core';
import {
  addHighlightFs,
  deleteNoteFs,
  formatReferenceEn,
  getNoteFs,
  listHighlightsFs,
  listNotesFs,
  putNoteFs,
  removeHighlightFs,
  slugForNote,
} from '../userdata-fs.web';
import { buildNotesExport } from '../../lib/notesExport';

export {
  init,
  mod,
  listBooks,
  parseReference,
  addHighlightFs,
  deleteNoteFs,
  formatReferenceEn,
  getNoteFs,
  listHighlightsFs,
  listNotesFs,
  putNoteFs,
  removeHighlightFs,
  slugForNote,
  buildNotesExport,
};
