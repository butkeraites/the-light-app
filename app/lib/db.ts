// app/lib/db.ts — F1.3 (ADR-0014)
//
// Serviço de BUNDLING do banco de leitura no app NATIVO. O `get_chapter` (rusqlite,
// via the-light-core) precisa de um caminho de arquivo REAL e GRAVÁVEL: no Android
// o asset vive dentro do APK (sem path de arquivo), e `Store::open` roda migrações
// idempotentes (precisa de WRITE). Por isso, no 1º boot, resolvemos o asset
// empacotado (subset de leitura `reading-sample.sqlite` — ADR-0014) e o COPIAMOS
// para `FileSystem.documentDirectory`, devolvendo o caminho real ao app.
//
// Offline-first: o asset é local (empacotado pelo Metro), sem rede. Idempotente:
// só copia se o destino ainda não existe. Resolução por extensão do Metro: este
// `.ts` vale no NATIVO; no web vale `db.web.ts` (stub — leitura web = F1.13).
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

// `require` do asset → módulo Metro (id numérico no nativo). Tipado via
// `app/web/assets.d.ts` (`declare module '*.sqlite'`). O SYMLINK versionado
// `app/assets/data/reading-sample.sqlite` mantém o asset dentro do projectRoot.
const DB_MODULE = require('../assets/data/reading-sample.sqlite');
const DB_FILENAME = 'reading-sample.sqlite';

// Memoiza o caminho resolvido (a cópia/IO só ocorre uma vez por sessão).
let cachedPath: string | null = null;

/**
 * Garante que o banco de leitura está num caminho GRAVÁVEL no device e devolve o
 * caminho de ARQUIVO (sem o esquema `file://`, que o rusqlite não entende).
 *
 * 1) resolve o asset empacotado (`Asset.fromModule(...).downloadAsync()`);
 * 2) copia p/ `documentDirectory + reading-sample.sqlite` SE ainda não existir
 *    (idempotente);
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

  const info = await FileSystem.getInfoAsync(destUri);
  if (!info.exists) {
    const asset = Asset.fromModule(DB_MODULE);
    await asset.downloadAsync();
    if (!asset.localUri) {
      throw new Error('Falha ao resolver o asset do banco de leitura (localUri vazio).');
    }
    await FileSystem.copyAsync({ from: asset.localUri, to: destUri });
  }

  // rusqlite (Store::open) abre um CAMINHO de arquivo, não uma URI `file://`.
  cachedPath = destUri.replace(/^file:\/\//, '');
  return cachedPath;
}
