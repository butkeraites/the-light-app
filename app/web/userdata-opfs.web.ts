// app/web/userdata-opfs.web.ts — F1.16 (ADR-0022; molde sqlite-reading-opfs.web.ts)
//
// Backend de RUNTIME do USERDATA web (BROWSER) — implementa a `UserDataDir`
// VFS-agnóstica de `userdata-fs.web.ts` sobre o OPFS (offline-first; zero rede).
// Usa as MESMAS APIs OPFS de ARQUIVO INTEIRO da F1.13 (`navigator.storage.
// getDirectory` + `getDirectoryHandle`/`getFileHandle` + `createWritable`/`getFile`/
// `removeEntry`/iterar `entries()`) na MAIN THREAD — SEM Worker, SEM
// SyncAccessHandle, SEM SharedArrayBuffer/COOP-COEP.
//
// O `data_dir` web é SEPARADO do conteúdo público só-leitura: o subset de leitura
// vive em `the-light/reading-sample.sqlite` (F1.13); o userdata GRAVÁVEL vive em
// `the-light/userdata/` (subdir `notes/` + `highlights.json`). Persiste através de
// reload (OPFS), espelhando o `data_dir` nativo.
//
// BROWSER-ONLY (guard `typeof navigator`); dynamic-imported por `reading.web.ts`. A
// prova headless NÃO o importa (injeta um `UserDataDir` em memória nas MESMAS funções
// de produção de `userdata-fs.web.ts` — mesmo padrão de isolamento da F1.13/F1.15).
import type { UserDataDir } from './userdata-fs.web';

/** Diretório raiz do app no OPFS (o MESMO da leitura, F1.13). */
const OPFS_ROOT_DIR = 'the-light';
/** Subdiretório GRAVÁVEL do userdata (separado do `reading-sample.sqlite`). */
const OPFS_USERDATA_DIR = 'userdata';

/**
 * Resolve o handle do diretório de um caminho relativo (ex.: `notes/John_3.16.md`):
 * navega/cria os segmentos de diretório sob `the-light/userdata/`, devolvendo
 * `{ parent, fileName }`. Com `create=false`, um diretório ausente devolve `null`
 * (leitura/remoção de algo inexistente). Com `create=true`, cria sob demanda
 * (espelha `create_dir_all` do `atomic_write` do core).
 */
async function resolveParent(
  relPath: string,
  create: boolean,
): Promise<{ parent: FileSystemDirectoryHandle; fileName: string } | null> {
  const root = await navigator.storage.getDirectory();
  // Os dirs raiz/`userdata` (`the-light/userdata/`) também podem estar AUSENTES numa OPFS
  // VAZIA (instalação limpa, antes de qualquer ESCRITA de userdata) — ex.: importar um backup
  // num aparelho novo, cujo passo 3 (`exportSnapshot`) LÊ o estado antes de gravar. Com
  // `create=false` (LEITURA), um dir ausente devolve `null` gracioso (dir/arquivo tratado como
  // vazio), IGUAL ao guard dos segmentos abaixo — nunca propaga `NotFoundError`. Com
  // `create=true` (ESCRITA), os dirs são CRIADOS sob demanda como antes (nunca lança aqui).
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.getDirectoryHandle(OPFS_ROOT_DIR, { create });
    dir = await dir.getDirectoryHandle(OPFS_USERDATA_DIR, { create });
  } catch {
    if (!create) {
      return null; // raiz/userdata ausente em OPFS vazia (leitura) → tratado como vazio/ausente
    }
    throw new Error(
      `Falha ao criar diretório OPFS de userdata: ${OPFS_ROOT_DIR}/${OPFS_USERDATA_DIR}`,
    );
  }
  const segments = relPath.split('/');
  const fileName = segments.pop() as string;
  for (const segment of segments) {
    try {
      dir = await dir.getDirectoryHandle(segment, { create });
    } catch {
      if (!create) {
        return null; // diretório ausente em leitura → tratado como vazio/ausente
      }
      throw new Error(`Falha ao criar diretório OPFS de userdata: ${segment}`);
    }
  }
  return { parent: dir, fileName };
}

/**
 * Abre o `UserDataDir` web sobre o OPFS (browser). Lança se OPFS indisponível
 * (mesma mensagem-família da F1.13). Implementa o I/O de ARQUIVO INTEIRO; o FORMATO
 * (slug/`.md`/`highlights.json`) vive em `userdata-fs.web.ts` (espelho do core).
 */
export async function openUserDataWeb(): Promise<UserDataDir> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error(
      'Userdata web indisponível: requer um browser com OPFS (navigator.storage.getDirectory).',
    );
  }

  return {
    async readFile(relPath: string): Promise<string | null> {
      const resolved = await resolveParent(relPath, false);
      if (!resolved) {
        return null;
      }
      try {
        const handle = await resolved.parent.getFileHandle(resolved.fileName);
        const file = await handle.getFile();
        return await file.text();
      } catch {
        return null; // arquivo ausente → null (espelha NotFound → None/empty)
      }
    },

    async writeFile(relPath: string, content: string): Promise<void> {
      const resolved = await resolveParent(relPath, true);
      if (!resolved) {
        throw new Error(`Falha ao resolver caminho OPFS de userdata: ${relPath}`);
      }
      const handle = await resolved.parent.getFileHandle(resolved.fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    },

    async deleteFile(relPath: string): Promise<boolean> {
      const resolved = await resolveParent(relPath, false);
      if (!resolved) {
        return false;
      }
      try {
        await resolved.parent.removeEntry(resolved.fileName);
        return true;
      } catch {
        return false; // ausente → false (idempotente)
      }
    },

    async listDir(relDir: string): Promise<string[]> {
      // `relDir` é um único segmento (ex.: `notes`) — resolvido sob `userdata/`.
      const resolved = await resolveParent(`${relDir}/_`, false);
      if (!resolved) {
        return [];
      }
      const names: string[] = [];
      // `entries()` existe na FileSystemDirectoryHandle (async iterator) no browser.
      for await (const [name] of (
        resolved.parent as unknown as {
          entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
        }
      ).entries()) {
        names.push(name);
      }
      return names;
    },
  };
}
