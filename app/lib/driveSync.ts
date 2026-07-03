// app/lib/driveSync.ts — F5.25 (ADR-0053 / ADR-0036, sobre F5.23 e F5.24)
//
// PUSH/PULL do SNAPSHOT da F5.23 (`userdataSnapshot.ts`) para/da pasta APP-PRIVATE
// (`appDataFolder`) do Google Drive do PRÓPRIO usuário — a 3ª etapa da trilha de sync
// (ADR-0036). É o motor PURO / de INJEÇÃO DE DEPENDÊNCIAS (molde `driveAuth.ts`/
// `userdataSnapshot.ts`): nada de rede/store/relógio embutidos. O chamador injeta:
//   - `fetch` (subconjunto do WHATWG fetch usado aqui) — a UI (F5.26) liga `globalThis.fetch`;
//   - `getToken()` — devolve o ACCESS TOKEN válido da F5.24 (`currentToken()`); o token vive
//     só no `TokenStore` injetado lá e é enviado APENAS como `Authorization: Bearer <token>`;
//   - um `SnapshotStore` — o MESMO backend injetável da F5.23 (web = `reading.web.ts`;
//     nativo = frontier). O motor NUNCA importa o glue direto (pureza cross-target).
// Isso mantém o módulo FORA do entry graph eager do web (perf-budget) e testável headless
// com `fetch`+`SnapshotStore` MOCKADOS (a validação com conta/Drive REAIS é a F5.27, gate
// humano; conta/token NUNCA transitam pelo loop).
//
// REUSO (NÃO reimplementa): a serialização/parse/merge/aplicação do snapshot é 100% da
// F5.23 — `exportSnapshot` (monta do store), `serializeSnapshot` (bytes) e
// `importSnapshotIntoStore` (parse + valida app/versão/tipos + `assertValidReference` REAL
// via core ANTES de tocar o store + `mergeSnapshots` união + aplica só o diff). O OAuth é
// 100% da F5.24 (o token chega pronto via `getToken`).
//
// ANTI-ALUCINAÇÃO / PRIVACIDADE: o que SOBE é EXATAMENTE o snapshot da F5.23 — notas +
// marcações + progresso de plano, com referências CANÔNICAS do core e MAIS NADA. NENHUM
// texto bíblico, NENHUMA sessão de IA, NENHUM banco, NENHUMA chave/token. O que BAIXA é
// validado (estrutura + referência real via core) ANTES de qualquer escrita. O MERGE nunca
// apaga dado local (união por referência; progresso `max(completed)` — ver F5.23/ADR-0051).
//
// SEGREDO: o access token chega SÓ do `getToken` injetado, vai SÓ no header
// `Authorization: Bearer` e NUNCA é logado/impresso (este arquivo NÃO faz NENHUMA chamada
// de log). As mensagens de erro citam só o status HTTP (não-secreto), nunca corpo/token.
//
// OFFLINE-FIRST (base): o app é 100% funcional com ZERO conta/rede; isto é estritamente
// OPT-IN e ADITIVO. Nada essencial passa a exigir Google.

import {
  exportSnapshot,
  importSnapshotIntoStore,
  serializeSnapshot,
  type ImportResult,
  type SnapshotStore,
  type UserdataSnapshot,
} from './userdataSnapshot';

// ── Constantes públicas (nada secreto) ───────────────────────────────────────
/** Único arquivo canônico do snapshot na pasta app-private (um por conta). */
export const CANONICAL_SNAPSHOT_FILENAME = 'the-light-app.snapshot.json' as const;
/** Endpoint de metadados/listagem/download de arquivos do Drive v3. */
export const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files' as const;
/** Endpoint de UPLOAD (multipart/media) de arquivos do Drive v3. */
export const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files' as const;
/** Espaço app-private (a pasta oculta do app; NÃO o Drive inteiro do usuário). */
export const DRIVE_APPDATA_SPACE = 'appDataFolder' as const;

// ── fetch injetável (subconjunto do WHATWG fetch usado aqui) ──────────────────
/** Resposta mínima que o motor consome do `fetch` injetado. */
export interface DriveFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Init mínimo de uma request (método, headers, corpo opcional). */
export interface DriveFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** `fetch` injetável (a UI liga `globalThis.fetch`; a prova injeta um mock). */
export type DriveFetch = (url: string, init: DriveFetchInit) => Promise<DriveFetchResponse>;

/** Provedor do access token (da F5.24 `currentToken`); `null` = não linkado/expirado. */
export type GetToken = () => Promise<string | null>;

/** Dependências injetadas do motor de sync (nada de rede/store/token embutido). */
export interface DriveSyncDeps {
  fetch: DriveFetch;
  getToken: GetToken;
  store: SnapshotStore;
  /** Nome do arquivo canônico (default `the-light-app.snapshot.json`). */
  fileName?: string;
}

// ── Resultados ────────────────────────────────────────────────────────────────
/** Resultado do push: id do arquivo canônico + bytes gravados. */
export interface PushResult {
  fileId: string;
  bytes: number;
}

/** Resultado do pull: o que o merge EFETIVAMENTE gravou + o snapshot merged. */
export interface PullResult {
  applied: ImportResult['applied'];
  merged: UserdataSnapshot;
}

/** Resultado de `syncNow` (pull-then-push): o pull mesclado + o push do merge. */
export interface SyncResult {
  pulled: PullResult;
  pushed: PushResult;
}

/** Superfície pública do motor de sync do Drive. */
export interface DriveSync {
  /** Localiza o arquivo canônico na pasta app-private (list por nome); `null` se ausente. */
  findSnapshotFile(): Promise<string | null>;
  /** `exportSnapshot(store)` → serializa → cria (ou substitui por id) o arquivo canônico. */
  pushSnapshot(): Promise<PushResult>;
  /** Baixa o arquivo canônico → valida+merge+aplica via F5.23 (só o diff). No-op se ausente. */
  pullSnapshot(): Promise<PullResult>;
  /** Convergência: pull-then-push. Idempotente (rodar 2× seguidas não muda nada na 2ª). */
  syncNow(): Promise<SyncResult>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Header `Authorization: Bearer <token>` do `getToken` injetado. Lança (sem vazar nada)
 * se não há token válido (link/refresh necessário — a F5.24 é dona do ciclo de vida). O
 * token NUNCA é logado nem colocado em mensagem de erro.
 */
async function authorization(getToken: GetToken): Promise<string> {
  const token = await getToken();
  if (token == null || token.length === 0) {
    throw new Error('drive: sem access token válido (link/refresh necessário)');
  }
  return `Bearer ${token}`;
}

/**
 * Cria o motor de sync do Drive sobre dependências INJETADAS (fetch/getToken/store). Puro/
 * testável: a prova injeta um `fetch` mock + uma "nuvem" em memória; a UI (F5.26) injeta
 * `globalThis.fetch` + `currentToken` da F5.24 + o `SnapshotStore` real. NUNCA loga o token
 * (nenhuma chamada de log neste módulo).
 */
export function createDriveSync(deps: DriveSyncDeps): DriveSync {
  const fileName = deps.fileName ?? CANONICAL_SNAPSHOT_FILENAME;

  async function findSnapshotFile(): Promise<string | null> {
    const auth = await authorization(deps.getToken);
    const params = new URLSearchParams({
      spaces: DRIVE_APPDATA_SPACE,
      q: `name = '${fileName}'`,
      fields: 'files(id,name)',
      pageSize: '10',
    });
    const resp = await deps.fetch(`${DRIVE_FILES_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { Authorization: auth },
    });
    if (!resp.ok) {
      throw new Error(`drive: falha ao listar app-data: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const files = isObject(data) && Array.isArray(data.files) ? data.files : [];
    for (const f of files) {
      if (isObject(f) && typeof f.id === 'string' && f.name === fileName) {
        return f.id;
      }
    }
    return null;
  }

  async function download(fileId: string): Promise<string> {
    const auth = await authorization(deps.getToken);
    const url = `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?alt=media`;
    const resp = await deps.fetch(url, { method: 'GET', headers: { Authorization: auth } });
    if (!resp.ok) {
      throw new Error(`drive: falha ao baixar snapshot: HTTP ${resp.status}`);
    }
    return resp.text();
  }

  async function createFile(content: string): Promise<string> {
    const auth = await authorization(deps.getToken);
    // Upload MULTIPART: parte de metadados (name + parents:["appDataFolder"]) + parte de mídia.
    const boundary = 'the-light-app-snapshot-boundary';
    const metadata = JSON.stringify({ name: fileName, parents: [DRIVE_APPDATA_SPACE] });
    const body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${metadata}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json\r\n\r\n' +
      `${content}\r\n` +
      `--${boundary}--`;
    const resp = await deps.fetch(`${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!resp.ok) {
      throw new Error(`drive: falha ao criar snapshot: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!isObject(data) || typeof data.id !== 'string') {
      throw new Error('drive: resposta de criação sem id');
    }
    return data.id;
  }

  async function updateFile(fileId: string, content: string): Promise<string> {
    const auth = await authorization(deps.getToken);
    // Substitui o conteúdo do arquivo EXISTENTE por id (uploadType=media) — id ESTÁVEL.
    const url = `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`;
    const resp = await deps.fetch(url, {
      method: 'PATCH',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: content,
    });
    if (!resp.ok) {
      throw new Error(`drive: falha ao atualizar snapshot: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!isObject(data) || typeof data.id !== 'string') {
      throw new Error('drive: resposta de atualização sem id');
    }
    return data.id;
  }

  async function pushSnapshot(): Promise<PushResult> {
    // REUSA F5.23: monta o snapshot do store e serializa (só notas+marcações+progresso;
    // referências canônicas; SEM texto bíblico/sessão/chave). Determinístico (ordenado).
    const snapshot = await exportSnapshot(deps.store);
    const content = serializeSnapshot(snapshot);
    const bytes = new TextEncoder().encode(content).length;
    const existing = await findSnapshotFile();
    const fileId =
      existing != null ? await updateFile(existing, content) : await createFile(content);
    return { fileId, bytes };
  }

  async function pullSnapshot(): Promise<PullResult> {
    const fileId = await findSnapshotFile();
    if (fileId == null) {
      // app-data vazio → nada a mesclar; o store fica INTACTO (retorna o estado atual).
      const merged = await exportSnapshot(deps.store);
      return { applied: { notes: 0, highlights: 0, planProgress: false }, merged };
    }
    const json = await download(fileId);
    // REUSA F5.23 tal-e-qual: parseSnapshot (valida app/versão/tipos) + assertValidReference
    // (core, referência REAL) ANTES de tocar o store + mergeSnapshots (união; nunca apaga
    // local) + aplica SÓ o diff. Referência irreal/JSON inválido → lança antes de escrever.
    const result = await importSnapshotIntoStore(json, deps.store);
    return { applied: result.applied, merged: result.merged };
  }

  async function syncNow(): Promise<SyncResult> {
    // Convergência: puxa+mescla (nunca apaga local) e então empurra o merge. Idempotente —
    // na 2ª rodada seguida o remoto já == local, o pull aplica 0/0/false e o push é no-op.
    const pulled = await pullSnapshot();
    const pushed = await pushSnapshot();
    return { pulled, pushed };
  }

  return { findSnapshotFile, pushSnapshot, pullSnapshot, syncNow };
}
