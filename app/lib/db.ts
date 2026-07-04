// app/lib/db.ts — F1.3 (ADR-0014) · guard de staleness no upgrade F6.4
//
// Serviço de BUNDLING do banco de leitura no app NATIVO. O `get_chapter` (rusqlite,
// via the-light-core) precisa de um caminho de arquivo REAL e GRAVÁVEL: no Android
// o asset vive dentro do APK (sem path de arquivo), e `Store::open` roda migrações
// idempotentes (precisa de WRITE). Por isso, no 1º boot, resolvemos o asset
// empacotado (subset de leitura `reading-sample.sqlite` — ADR-0014, hoje Bíblia
// completa de 66 livros, F5.36) e o COPIAMOS para `FileSystem.documentDirectory`,
// devolvendo o caminho real ao app.
//
// F6.4 — GUARD DE STALENESS NO UPGRADE: copiar só `if (!exists)` MANTINHA a cópia
// ANTIGA quando o app atualizava com um DB novo (ex.: F5.36 → 66 livros) — "Mateus
// 404 p/ quem atualiza". Agora comparamos a IDENTIDADE do asset empacotado (o MD5 do
// seu conteúdo, `Asset.hash`, do manifesto do Metro — muda DETERMINISTICAMENTE quando
// o DB muda; prefixado por um DB_VERSION de bump manual) com um SIDECAR local
// (`reading-sample.sqlite.version`). Em MISMATCH (ou sidecar ausente = instalação
// pré-F6.4), RE-COPIAMOS o asset e reescrevemos o sidecar. O sidecar é escrito SÓ APÓS
// a cópia OK (crash-safe: um crash no meio deixa mismatch → re-copia no próximo boot).
//
// Só o banco de LEITURA (asset read-only) é invalidado por versão; o userdata/notas
// (`app/lib/userdata.ts`, subdir `userdata/`) NUNCA é tocado aqui. O nativo usa o DB
// COMBINADO (leitura + léxico), então não há um cache de léxico separado a invalidar.
//
// Offline-first: o asset é local (empacotado pelo Metro), sem rede. Resolução por
// extensão do Metro: este `.ts` vale no NATIVO; no web vale `db.web.ts` (stub — o web
// re-busca o asset a cada sessão, F5.38, sem staleness).
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

// `require` do asset → módulo Metro (id numérico no nativo). Tipado via
// `app/web/assets.d.ts` (`declare module '*.sqlite'`). O SYMLINK versionado
// `app/assets/data/reading-sample.sqlite` mantém o asset dentro do projectRoot.
const DB_MODULE = require('../assets/data/reading-sample.sqlite');
const DB_FILENAME = 'reading-sample.sqlite';
// Sidecar de VERSÃO ao lado da cópia local: guarda a identidade do asset com que a
// cópia atual foi feita. Ausente ⇒ instalação pré-F6.4 (tratada como mismatch).
const VERSION_SIDECAR = `${DB_FILENAME}.version`;

// Bump MANUAL de fallback (prefixo da identidade). A identidade PRIMÁRIA é o
// `Asset.hash` (MD5 do CONTEÚDO do DB), que já muda sozinho quando o conteúdo muda —
// então NÃO é preciso bumpar isto a cada `gen-reading-sample-db.sh`. Bumpe DB_VERSION
// só (a) como rede de segurança caso um alvo não exponha `Asset.hash` (identidade cai
// no constante `<DB_VERSION>:nohash`, e aí o bump é o único lever de re-cópia), ou (b)
// p/ FORÇAR uma re-cópia sem mudar o conteúdo do DB. Ver nota no gen script.
const DB_VERSION = '1';

// Memoiza o caminho resolvido (a cópia/IO só ocorre uma vez por sessão).
let cachedPath: string | null = null;

/**
 * Identidade do asset empacotado: `<DB_VERSION>:<MD5 do conteúdo>`. O `Asset.hash` vem
 * do manifesto do Metro e muda DETERMINISTICAMENTE quando o conteúdo do DB muda; o
 * prefixo DB_VERSION dá um lever de bump manual e cobre o caso raro de `hash` nulo.
 */
function assetVersionId(asset: Asset): string {
  return `${DB_VERSION}:${asset.hash ?? 'nohash'}`;
}

/** Lê o sidecar de versão da cópia local; ausente/erro de leitura → `null`. */
async function readLocalVersion(uri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    return (await FileSystem.readAsStringAsync(uri)).trim();
  } catch {
    return null;
  }
}

/**
 * Reseta a memoização do caminho — SÓ para o self-test de UPGRADE (F6.4) forçar uma
 * reavaliação do gate de versão após pré-semear um DB stale. Não use em produção.
 */
export function __resetReadingDbCacheForTest(): void {
  cachedPath = null;
}

/**
 * Garante que o banco de leitura está num caminho GRAVÁVEL no device, ATUALIZADO em
 * relação ao asset empacotado, e devolve o caminho de ARQUIVO (sem o esquema `file://`,
 * que o rusqlite não entende).
 *
 * 1) resolve a identidade do asset empacotado (`Asset.hash`, prefixado por DB_VERSION);
 * 2) COPIA p/ `documentDirectory + reading-sample.sqlite` se a cópia estiver AUSENTE
 *    (instalação limpa) OU se o sidecar de versão local DIFERIR do asset (upgrade —
 *    inclui o sidecar ausente de instalações pré-F6.4). O sidecar é escrito SÓ APÓS a
 *    cópia OK (crash-safe). O userdata/notas NUNCA é tocado.
 * 3) retorna o caminho real p/ passar a `get_chapter`/`chapter_count`/`list_translations`.
 */
export async function ensureReadingDb(): Promise<string> {
  if (cachedPath) {
    return cachedPath;
  }
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('FileSystem.documentDirectory indisponível neste alvo.');
  }
  const destUri = docDir + DB_FILENAME;
  const sidecarUri = docDir + VERSION_SIDECAR;

  const asset = Asset.fromModule(DB_MODULE);
  const expectedVersion = assetVersionId(asset);

  const info = await FileSystem.getInfoAsync(destUri);
  const localVersion = info.exists ? await readLocalVersion(sidecarUri) : null;

  // Copia SE: (a) instalação limpa (cópia ausente) OU (b) UPGRADE — a versão local
  // (sidecar) difere da identidade do asset empacotado (mismatch ou sidecar ausente).
  if (!info.exists || localVersion !== expectedVersion) {
    await asset.downloadAsync();
    if (!asset.localUri) {
      throw new Error('Falha ao resolver o asset do banco de leitura (localUri vazio).');
    }
    // Re-cópia limpa: remove a cópia velha + os sidecars SQLite (WAL/SHM/journal) que
    // NÃO casam com o DB novo, e o sidecar de versão. Só DEPOIS copia e (só então)
    // grava a nova versão — se um crash ocorrer no meio, o próximo boot vê mismatch e
    // re-copia (idempotente). NADA disto toca o userdata (subdir `userdata/`).
    for (const stale of [
      destUri,
      `${destUri}-wal`,
      `${destUri}-shm`,
      `${destUri}-journal`,
      sidecarUri,
    ]) {
      await FileSystem.deleteAsync(stale, { idempotent: true });
    }
    await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
    await FileSystem.writeAsStringAsync(sidecarUri, expectedVersion);
  }

  // rusqlite (Store::open) abre um CAMINHO de arquivo, não uma URI `file://`.
  cachedPath = destUri.replace(/^file:\/\//, '');
  return cachedPath;
}
