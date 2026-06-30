// app/web/sqlite-opfs.web.ts — F0.10 (ADR-0011/ADR-0012)
//
// Backend de RUNTIME do store web (BROWSER). Responsabilidades:
//   - PERSISTÊNCIA OFFLINE-FIRST em OPFS (Origin Private File System): na 1ª vez,
//     carrega os bytes do `sample.sqlite` (asset local EMPACOTADO) em OPFS; nas
//     próximas, lê do OPFS (sem re-fetch). OPFS é o store LOCAL do versículo.
//   - LEITURA via `wa-sqlite`: instancia o módulo SQLite-wasm (build SYNC, sem
//     SharedArrayBuffer/COOP-COEP) sobre um VFS de memória hidratado com os bytes
//     persistidos no OPFS, e roda a MESMA `queryPassage`/`readPassage` de
//     `sqlite.web.ts` (espelho de `EmbeddedSource::passage`).
//
// Subdecisão (ADR-0012): a leitura usa um VFS de memória do `wa-sqlite`
// HIDRATADO a partir dos bytes do OPFS — e não o VFS OPFS "ao vivo" — porque os
// `FileSystemSyncAccessHandle` do OPFS (exigidos pelo VFS OPFS do `wa-sqlite`)
// só existem em Web Worker. Assim o caminho roda na main thread sem Worker e SEM
// SharedArrayBuffer, mantendo: store local = OPFS, leitura via `wa-sqlite`, texto
// verbatim do store. A prova node usa o MESMO VFS de memória + a MESMA query.
//
// Este arquivo é BROWSER-ONLY (guard `typeof navigator`) e é dynamic-imported por
// `passage.web.ts`; a prova headless NÃO o importa (usa a query isolada direto).
import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';

// Assets EMPACOTADOS pelo Metro (servidos pela própria origem; offline-first).
// eslint-disable-next-line import/no-unresolved
import waSqliteWasmUri from 'wa-sqlite/dist/wa-sqlite.wasm';
// `app/assets/data/sample.sqlite` é um SYMLINK (versionado) para o `sample.sqlite`
// canônico em `<repo>/assets/data` (KJV domínio público) — uma única fonte da
// verdade. Mantê-lo DENTRO do projectRoot permite ao Metro empacotá-lo como asset
// local (offline-first) sem hacks de resolução cross-root.
// eslint-disable-next-line import/no-unresolved
import sampleDbUri from '../assets/data/sample.sqlite';

import type { PassageDb } from './sqlite.web';

/** Diretório/arquivo do sample dentro do OPFS. */
const OPFS_DIR = 'the-light';
const OPFS_FILE = 'sample.sqlite';
/** Nome lógico do banco no VFS de memória do `wa-sqlite`. */
const MEM_DB_NAME = 'sample.sqlite';

/** Conexão aberta com um `close()` para liberar recursos. */
export interface OpenPassageDb extends PassageDb {
  close: () => Promise<void>;
}

async function fetchBytes(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(`Falha ao carregar asset local (${uri}): HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

/**
 * Carrega o `sample.sqlite` em OPFS na 1ª vez (a partir do asset empacotado) e
 * devolve os bytes persistidos. OPFS é o backend de persistência local.
 */
async function readSampleBytesFromOpfs(): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });

  let fileHandle: FileSystemFileHandle;
  try {
    // Já persistido em execução anterior?
    fileHandle = await dir.getFileHandle(OPFS_FILE);
  } catch {
    // 1ª vez: persiste os bytes do asset empacotado em OPFS (offline-first).
    fileHandle = await dir.getFileHandle(OPFS_FILE, { create: true });
    const seed = await fetchBytes(sampleDbUri);
    const writable = await fileHandle.createWritable();
    await writable.write(seed);
    await writable.close();
  }

  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Abre o store web no BROWSER: persiste/lê o `sample.sqlite` do OPFS e abre um
 * `wa-sqlite` (VFS de memória hidratado com esses bytes) pronto para
 * `queryPassage`/`readPassage`. Lança se OPFS não estiver disponível.
 */
export async function openPassageDbWeb(): Promise<OpenPassageDb> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error(
      'Store web indisponível: requer um browser com OPFS (navigator.storage.getDirectory).',
    );
  }

  // Instancia o SQLite-wasm passando os BYTES do .wasm (asset local) — sem rede
  // externa e sem depender de fetch interno do Emscripten.
  const wasmBinary = await fetchBytes(waSqliteWasmUri);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);

  // VFS de memória hidratado com os bytes persistidos no OPFS.
  const vfs = new MemoryVFS();
  const dbBytes = await readSampleBytesFromOpfs();
  vfs.mapNameToFile.set(MEM_DB_NAME, {
    name: MEM_DB_NAME,
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: dbBytes.byteLength,
    data: dbBytes,
  });
  // Cast: o `.d.ts` do wa-sqlite tem assinaturas de `xRead` divergentes entre
  // `VFS.Base` (MemoryVFS) e `SQLiteVFS`; em runtime a MemoryVFS é uma VFS válida.
  sqlite3.vfs_register(vfs as unknown as SQLiteVFS, false);

  const db = await sqlite3.open_v2(MEM_DB_NAME, SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return {
    sqlite3,
    db,
    close: async () => {
      await sqlite3.close(db);
    },
  };
}
