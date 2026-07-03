// app/web/sqlite-lexicon-opfs.web.ts — F5.15 (ADR-0044; par de sqlite-reading-opfs.web.ts)
//
// Backend de RUNTIME do store web de LÉXICO (BROWSER), carregado ON-DEMAND. Par exato
// de `sqlite-reading-opfs.web.ts`, porém sobre `lexicon-sample.sqlite` (~9 MB — o DADO
// do léxico STEP CC-BY: scholarly_sources/original_tokens/lexicon/morph_legend), que
// a F5.15/ADR-0044 SEPAROU do caminho de LEITURA. Este arquivo NÃO é tocado por
// leitores puros: ele só é buscado/persistido quando o usuário abre ESTUDO/LÉXICO
// (opt-in, IA), via `import()` dinâmico em `reading.web.ts` (`deepStudy`/
// `lexicalEntries`). Assim a LEITURA funciona 100% offline SEM baixar o léxico.
//
// Responsabilidades (idênticas ao store de leitura, offline-first):
//   - PERSISTÊNCIA em OPFS: na 1ª vez que o estudo/léxico roda, carrega os bytes do
//     asset EMPACOTADO `lexicon-sample.sqlite` em OPFS; nas próximas lê do OPFS
//     (uma única "descida" de ~9 MB por origem; depois é local/instantâneo).
//   - LEITURA via `wa-sqlite`: instancia o mesmo build SÍNCRONO wa-sqlite+FTS5 sobre um
//     VFS de MEMÓRIA hidratado com esses bytes, e devolve o handle que
//     `queryVerifiedLexicon`/`queryAttributions` (`sqlite-lexicon.web.ts`) consomem.
//
// Anti-alucinação / ZERO DRIFT: as tabelas de léxico neste arquivo são CÓPIA VERBATIM
// das do `reading-sample.sqlite` combinado (mesmo pipeline `gen-reading-sample-db.sh`),
// então as glosas/lemas/Strong/atribuição STEP CC-BY são IDÊNTICAS — separar o DADO do
// caminho de leitura NÃO muda o conteúdo. BROWSER-ONLY (guard `typeof navigator`).
import SQLiteESMFactory from './vendor/wa-sqlite-fts5/wa-sqlite.mjs';
import * as SQLite from 'wa-sqlite';
import { MemoryVFS } from 'wa-sqlite/src/examples/MemoryVFS.js';

// eslint-disable-next-line import/no-unresolved
import waSqliteWasmUri from './vendor/wa-sqlite-fts5/wa-sqlite.wasm';
// `app/assets/data/lexicon-sample.sqlite` é um SYMLINK (versionado) para o subset de
// LÉXICO em `<repo>/assets/data` (STEP Bible / TBESH–TBESG, CC BY 4.0 — F5.15/ADR-0044).
// O import é ESTÁTICO aqui, mas ESTE módulo só é `import()`-ado sob demanda (estudo/
// léxico), então o Metro coloca o asset num CHUNK ASYNC — fora do 1º paint/caminho de
// leitura. Symlink dentro do projectRoot: o Metro empacota como asset local (offline).
// eslint-disable-next-line import/no-unresolved
import lexiconDbUri from '../assets/data/lexicon-sample.sqlite';

import type { ReadingDb } from './sqlite-reading.web';

/** Diretório/arquivo do léxico dentro do OPFS (separado do subset de leitura). */
const OPFS_DIR = 'the-light';
const OPFS_FILE = 'lexicon-sample.sqlite';
/** Nome lógico do banco no VFS de memória do `wa-sqlite`. */
const MEM_DB_NAME = 'lexicon-sample.sqlite';

/** Conexão aberta com um `close()` para liberar recursos (par de `OpenReadingDb`). */
export interface OpenLexiconDb extends ReadingDb {
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
 * Carrega o `lexicon-sample.sqlite` (~9 MB) em OPFS na 1ª vez (a partir do asset
 * empacotado) e devolve os bytes persistidos. É a ÚNICA "descida" do léxico por
 * origem — depois lê do OPFS (offline-first; zero rede em runtime — só fetch da
 * própria origem, on-demand ao abrir estudo/léxico).
 */
async function readLexiconBytesFromOpfs(): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });

  let fileHandle: FileSystemFileHandle;
  try {
    // Já persistido em uma sessão anterior (estudo/léxico já foi aberto antes)?
    fileHandle = await dir.getFileHandle(OPFS_FILE);
  } catch {
    // 1ª vez que o estudo/léxico roda: persiste os bytes do asset em OPFS (offline-first).
    fileHandle = await dir.getFileHandle(OPFS_FILE, { create: true });
    const seed = await fetchBytes(lexiconDbUri);
    const writable = await fileHandle.createWritable();
    await writable.write(seed);
    await writable.close();
  }

  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Abre o store web de LÉXICO no BROWSER (ON-DEMAND): persiste/lê o `lexicon-sample.sqlite`
 * do OPFS e abre um `wa-sqlite` (VFS de memória hidratado com esses bytes) pronto para
 * `queryVerifiedLexicon`/`queryAttributions`. Chamado SÓ pelo estudo/léxico (opt-in) —
 * nunca no caminho de leitura. Lança se OPFS não estiver disponível.
 */
export async function openLexiconDbWeb(): Promise<OpenLexiconDb> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error(
      'Store web de léxico indisponível: requer um browser com OPFS (navigator.storage.getDirectory).',
    );
  }

  const wasmBinary = await fetchBytes(waSqliteWasmUri);
  // `locateFile` p/ NÃO tomar o branch `new URL("wa-sqlite.wasm", import.meta.url)` do glue
  // Emscripten: sob o bundler DEV do Metro `import.meta.url` é "null" → `new URL(...)` lança
  // "Failed to construct 'URL': Invalid base URL" (mesmo bug da leitura, F5.39). Passamos os bytes
  // do wasm direto (`wasmBinary`); `locateFile` só desvia do URL inválido.
  const module = await SQLiteESMFactory({ wasmBinary, locateFile: (path: string) => path });
  const sqlite3 = SQLite.Factory(module);

  const vfs = new MemoryVFS();
  const dbBytes = await readLexiconBytesFromOpfs();
  vfs.mapNameToFile.set(MEM_DB_NAME, {
    name: MEM_DB_NAME,
    flags: SQLite.SQLITE_OPEN_READONLY,
    size: dbBytes.byteLength,
    data: dbBytes,
  });
  // Cast: assinaturas de `xRead` divergem no `.d.ts` do wa-sqlite (igual ao store de
  // leitura); em runtime a MemoryVFS é uma VFS válida.
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
