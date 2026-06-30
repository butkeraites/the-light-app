// app/web/sqlite-reading-opfs.web.ts — F1.13 (ADR-0018/ADR-0019; molde F0.10 ADR-0011/0012)
//
// Backend de RUNTIME do store web de LEITURA (BROWSER). Par exato de
// `sqlite-opfs.web.ts`, porém sobre o SUBSET `reading-sample.sqlite` (~4,4 MB — o
// MESMO que o nativo empacota, ADR-0014: KJV + Almeida 1911 de Gn/Sl/Jo).
// Responsabilidades:
//   - PERSISTÊNCIA OFFLINE-FIRST em OPFS: na 1ª vez carrega os bytes do asset
//     EMPACOTADO `reading-sample.sqlite` em OPFS; nas próximas lê do OPFS.
//   - LEITURA via `wa-sqlite`: instancia o SQLite-wasm (build SYNC, sem
//     SharedArrayBuffer/COOP-COEP) sobre um VFS de MEMÓRIA hidratado com os bytes
//     persistidos, e roda as MESMAS `queryChapter`/`queryChapterCount`/
//     `queryTranslations` de `sqlite-reading.web.ts` (espelho dos SELECTs do core).
//
// Subdecisão (ADR-0012, herdada da F0.10): usa um VFS de memória HIDRATADO a
// partir dos bytes do OPFS — não o VFS OPFS "ao vivo" — porque o
// `FileSystemSyncAccessHandle` (exigido pelo VFS OPFS) só existe em Web Worker.
// Assim roda na main thread sem Worker e SEM SharedArrayBuffer. A prova node usa o
// MESMO VFS de memória + as MESMAS queries.
//
// BROWSER-ONLY (guard `typeof navigator`); dynamic-imported por `reading.web.ts`.
// A prova headless NÃO o importa (usa a query isolada direto sobre o subset).
// F1.14 (ADR-0020): o factory/wasm vêm do build SÍNCRONO do wa-sqlite COM FTS5
// (vendored em `app/web/vendor/wa-sqlite-fts5/`, gerado por
// `scripts/build-wa-sqlite-fts5.sh`). O `dist/` do npm NÃO compila FTS5 (probe:
// "no such module: fts5"), o que impediria a BUSCA (F1.14: `verses_fts MATCH`/
// `bm25`/`highlight`). É UM ÚNICO artefato p/ LEITURA e BUSCA (a leitura, F1.13,
// não regride). A API JS (`wa-sqlite`, `MemoryVFS`) segue do npm — casa com este
// build (mesmo commit do release `1.0.0`, `registerVFS`).
import SQLiteESMFactory from './vendor/wa-sqlite-fts5/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';

// Assets EMPACOTADOS pelo Metro (servidos pela própria origem; offline-first).
// eslint-disable-next-line import/no-unresolved
import waSqliteWasmUri from './vendor/wa-sqlite-fts5/wa-sqlite.wasm';
// `app/assets/data/reading-sample.sqlite` é um SYMLINK (versionado) para o subset
// canônico em `<repo>/assets/data` (KJV + Almeida 1911, domínio público) — uma
// única fonte da verdade. Mantê-lo DENTRO do projectRoot permite ao Metro
// empacotá-lo como asset local (offline-first) sem hacks cross-root.
// eslint-disable-next-line import/no-unresolved
import readingDbUri from '../assets/data/reading-sample.sqlite';

import type { ReadingDb } from './sqlite-reading.web';

/** Diretório/arquivo do subset dentro do OPFS (separado do `sample.sqlite` da F0.10). */
const OPFS_DIR = 'the-light';
const OPFS_FILE = 'reading-sample.sqlite';
/** Nome lógico do banco no VFS de memória do `wa-sqlite`. */
const MEM_DB_NAME = 'reading-sample.sqlite';

/** Conexão aberta com um `close()` para liberar recursos. */
export interface OpenReadingDb extends ReadingDb {
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
 * Carrega o `reading-sample.sqlite` em OPFS na 1ª vez (a partir do asset
 * empacotado) e devolve os bytes persistidos. OPFS é o backend de persistência
 * local (offline-first; zero rede em runtime — só fetch da própria origem).
 */
async function readSubsetBytesFromOpfs(): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });

  let fileHandle: FileSystemFileHandle;
  try {
    // Já persistido em execução anterior?
    fileHandle = await dir.getFileHandle(OPFS_FILE);
  } catch {
    // 1ª vez: persiste os bytes do asset empacotado em OPFS (offline-first).
    fileHandle = await dir.getFileHandle(OPFS_FILE, { create: true });
    const seed = await fetchBytes(readingDbUri);
    const writable = await fileHandle.createWritable();
    await writable.write(seed);
    await writable.close();
  }

  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Abre o store web de LEITURA no BROWSER: persiste/lê o `reading-sample.sqlite` do
 * OPFS e abre um `wa-sqlite` (VFS de memória hidratado com esses bytes) pronto para
 * `queryChapter`/`queryChapterCount`/`queryTranslations`. Lança se OPFS não estiver
 * disponível.
 */
export async function openReadingDbWeb(): Promise<OpenReadingDb> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error(
      'Store web de leitura indisponível: requer um browser com OPFS (navigator.storage.getDirectory).',
    );
  }

  // Instancia o SQLite-wasm passando os BYTES do .wasm (asset local) — sem rede
  // externa e sem depender de fetch interno do Emscripten.
  const wasmBinary = await fetchBytes(waSqliteWasmUri);
  const module = await SQLiteESMFactory({ wasmBinary });
  const sqlite3 = SQLite.Factory(module);

  // VFS de memória hidratado com os bytes persistidos no OPFS.
  const vfs = new MemoryVFS();
  const dbBytes = await readSubsetBytesFromOpfs();
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
