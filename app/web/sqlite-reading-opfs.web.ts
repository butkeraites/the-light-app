// app/web/sqlite-reading-opfs.web.ts — F1.13 (ADR-0018/ADR-0019; molde F0.10 ADR-0011/0012)
// · F5.15 (ADR-0044: léxico fora do caminho de leitura)
// · F5.38 (ADR-0057: leitura web = fetch-direto do asset p/ MemoryVFS; OPFS só p/ userdata)
//
// Backend de RUNTIME do store web de LEITURA (BROWSER). Par exato de
// `sqlite-opfs.web.ts`, porém sobre o SUBSET WEB de LEITURA `reading-lite.sqlite`
// (~4,3 MB — F5.15/ADR-0044: translations/books/verses/cross_references/verses_fts,
// SEM as tabelas de léxico). O DADO do léxico (~9 MB: original_tokens/lexicon/
// scholarly_sources/morph_legend) SAIU deste arquivo e virou `lexicon-sample.sqlite`,
// carregado ON-DEMAND só ao abrir estudo/léxico (`sqlite-lexicon-opfs.web.ts`). Assim
// leitores puros baixam ~4,3 MB (não ~14,4 MB) — a LEITURA funciona 100% offline SEM
// jamais tocar o léxico. O NATIVO segue no combinado `reading-sample.sqlite` (F1.3/
// ADR-0014; o split é WEB-scoped). O `reading-lite.sqlite` NÃO tem as tabelas de léxico:
// uma consulta de léxico neste handle FALHA por design (não retorna vazio silencioso).
// Responsabilidades:
//   - CARGA OFFLINE-FIRST: a cada sessão faz `fetch` do asset LOCAL EMPACOTADO
//     `reading-lite.sqlite` (mesma origem, zero rede externa) DIRETO para um VFS de
//     MEMÓRIA — sem round-trip OPFS (F5.38/ADR-0057; ver justificativa abaixo).
//   - LEITURA via `wa-sqlite`: instancia o SQLite-wasm (build SYNC, sem
//     SharedArrayBuffer/COOP-COEP) sobre esse VFS de MEMÓRIA, e roda as MESMAS
//     `queryChapter`/`queryChapterCount`/`queryTranslations` de
//     `sqlite-reading.web.ts` (espelho dos SELECTs do core).
//
// F5.38 (ADR-0057): a LEITURA parou de usar OPFS. Antes (F1.13) `openReadingDbWeb`
// fazia `fetch(asset) → grava em OPFS → lê de volta → MemoryVFS`. O `reading-lite.sqlite`
// é asset LOCAL empacotado (mesma origem, já offline-first pelo próprio asset) e é
// READ-ONLY — o OPFS NÃO adicionava capacidade offline, era só um cache que passou a
// quebrar quando o subset virou a Bíblia completa (F5.36: 4,3 → 38,4 MB): a gravação de
// 38 MB em OPFS é frágil e, em janela anônima/incognito (quota de storage restrita),
// falha — Mateus não abria. Um repro Node provou que 38 MB via `MemoryVFS` + o MESMO
// wasm abre e consulta OK (Mateus 1 verbatim, 66 livros). Buscar o asset local a cada
// sessão para o MemoryVFS é robusto (qualquer tamanho, janela normal E anônima), casa
// com o caminho de prova Node (`readFile → MemoryVFS`) e ELIMINA o problema de
// invalidação de cache/auto-reseed. OPFS segue APENAS para userdata (notas, que exigem
// persistência real) e para o léxico (`sqlite-lexicon-opfs.web.ts`, separado) — intactos.
//
// Subdecisão (ADR-0012, herdada da F0.10): usa um VFS de memória HIDRATADO a
// partir dos bytes do asset — não o VFS OPFS "ao vivo" — porque o
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
import { openSqliteMemVfs } from './sqliteMemVfs.web';

// Assets EMPACOTADOS pelo Metro (servidos pela própria origem; offline-first).
// eslint-disable-next-line import/no-unresolved
import waSqliteWasmUri from './vendor/wa-sqlite-fts5/wa-sqlite.wasm';
// `app/assets/data/reading-lite.sqlite` é um SYMLINK (versionado) para o subset WEB
// de leitura em `<repo>/assets/data` (KJV + Almeida 1911, domínio público; SEM léxico
// — F5.15/ADR-0044) — uma única fonte da verdade. Mantê-lo DENTRO do projectRoot
// permite ao Metro empacotá-lo como asset local (offline-first) sem hacks cross-root.
// eslint-disable-next-line import/no-unresolved
import readingDbUri from '../assets/data/reading-lite.sqlite';

import type { ReadingDb } from './sqlite-reading.web';

/** Nome lógico do banco no VFS de memória do `wa-sqlite`. */
const MEM_DB_NAME = 'reading-lite.sqlite';

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
 * Abre o store web de LEITURA no BROWSER: faz `fetch` do asset LOCAL empacotado
 * `reading-lite.sqlite` (subset SEM léxico, F5.15/ADR-0044) DIRETO para um `wa-sqlite`
 * (VFS de memória hidratado com esses bytes) pronto para
 * `queryChapter`/`queryChapterCount`/`queryTranslations`. NÃO usa OPFS (F5.38/ADR-0057:
 * dado read-only de asset local — OPFS só quebrava em 38 MB / janela anônima). NÃO
 * carrega o léxico (~9 MB) — esse é on-demand via `openLexiconDbWeb`. Lança fora de um
 * browser (node/SSR) para não quebrar de forma obscura.
 */
export async function openReadingDbWeb(): Promise<OpenReadingDb> {
  if (typeof navigator === 'undefined' || typeof fetch === 'undefined') {
    throw new Error(
      'Store web de leitura indisponível: requer um browser (navigator/fetch). ' +
        'Em node/SSR use o caminho de prova (readFile → MemoryVFS).',
    );
  }

  // Bytes do asset LOCAL (fetch da própria origem — offline-first, sem round-trip OPFS; F5.38/ADR-0057).
  // O boot do wa-sqlite (+ o workaround DEV `locateFile`) vive na costura `openSqliteMemVfs` (ADR-0072).
  const [wasmBytes, dbBytes] = await Promise.all([fetchBytes(waSqliteWasmUri), fetchBytes(readingDbUri)]);
  return openSqliteMemVfs({ wasmBytes, dbBytes, dbName: MEM_DB_NAME, locateFile: (path) => path });
}
