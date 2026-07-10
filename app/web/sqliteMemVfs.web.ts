// app/web/sqliteMemVfs.web.ts — ADR-0072 (deepening): boot ÚNICO do wa-sqlite + MemoryVFS (BROWSER)
//
// O boot do wa-sqlite era re-tipado nos DOIS openers de produção (leitura e léxico), byte-a-byte
// idêntico, variando só na AQUISIÇÃO de bytes: instanciar o factory SÍNCRONO FTS5 com os bytes do
// `.wasm` + o workaround DEV `locateFile` do Metro, registrar um `MemoryVFS` hidratado com os bytes do
// DB, e abrir READONLY. Concentrado aqui UMA vez; os openers viram "obter bytes → openSqliteMemVfs".
// A aquisição de bytes (fetch do asset · cache OPFS · readFile em prova node) é o ÚNICO adapter.
import SQLiteESMFactory from './vendor/wa-sqlite-fts5/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';

import type { ReadingDb } from './sqlite-reading.web';

/** Conexão aberta com `close()` — o que os openers de leitura/léxico devolvem. */
export interface OpenSqliteDb extends ReadingDb {
  close: () => Promise<void>;
}

export interface OpenSqliteOpts {
  /** Bytes do `.wasm` do wa-sqlite (fetch do asset local em prod; readFile em prova node). */
  wasmBytes: ArrayBuffer;
  /** Bytes do banco SQLite a montar no VFS de memória. */
  dbBytes: ArrayBuffer;
  /** Nome lógico do banco no VFS. */
  dbName: string;
  /**
   * Workaround DEV do Metro (prod): sob o bundler DEV `import.meta.url` é "null" → o glue Emscripten faz
   * `new URL("wa-sqlite.wasm", import.meta.url)` e lança "Invalid base URL" (F5.39). Passar `wasmBytes` +
   * este `locateFile` desvia do URL inválido (o valor retornado NÃO é buscado — usa-se `wasmBytes`). Em
   * node/prova é dispensável (import.meta.url é file://) — deixe `undefined`.
   */
  locateFile?: (path: string) => string;
}

/**
 * Boot único: instancia o wa-sqlite (build SÍNCRONO FTS5) sobre um `MemoryVFS` hidratado com `dbBytes`,
 * abre READONLY e devolve `{ sqlite3, db, close }`. NÃO faz I/O de rede/OPFS — só o factory sobre bytes
 * já em mãos; a AQUISIÇÃO de bytes é responsabilidade do chamador (o adapter).
 */
export async function openSqliteMemVfs({ wasmBytes, dbBytes, dbName, locateFile }: OpenSqliteOpts): Promise<OpenSqliteDb> {
  const module = await SQLiteESMFactory(
    locateFile ? { wasmBinary: wasmBytes, locateFile } : { wasmBinary: wasmBytes },
  );
  const sqlite3 = SQLite.Factory(module);

  const vfs = new MemoryVFS();
  vfs.mapNameToFile.set(dbName, {
    name: dbName,
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: dbBytes.byteLength,
    data: dbBytes,
  });
  // Cast: o `.d.ts` do wa-sqlite tem `xRead` divergente entre `VFS.Base` (MemoryVFS) e `SQLiteVFS`;
  // em runtime a MemoryVFS é uma VFS válida.
  sqlite3.vfs_register(vfs as unknown as SQLiteVFS, false);

  const db = await sqlite3.open_v2(dbName, SQLite.SQLITE_OPEN_READONLY, vfs.name);
  return {
    sqlite3,
    db,
    close: async () => {
      await sqlite3.close(db);
    },
  };
}
