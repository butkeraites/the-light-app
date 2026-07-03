// driveSync.web.test.mjs — F5.25 (molde snapshot.web.test.mjs F5.23 / driveAuth.web.test.mjs F5.24)
//
// PROVA HEADLESS (node, SEM browser/Expo/rede/CONTA/chave) do PUSH/PULL do SNAPSHOT da F5.23
// para/da pasta APP-PRIVATE (`appDataFolder`) do Google Drive, com MERGE no pull. Exercita o
// MESMO código de PRODUÇÃO que a UI de sync (F5.26) vai injetar com `globalThis.fetch` + o
// `currentToken` da F5.24 + um `SnapshotStore` real — mas aqui `fetch` é um MOCK e a "nuvem"
// é um dict EM MEMÓRIA que emula a pasta app-data (NENHUMA chamada real ao Google; a
// validação com conta/Drive REAIS é a F5.27, gate humano; conta/token NUNCA no loop).
//
// REUSO (não reimplementa): o snapshot (build/serialize/parse/merge/aplicar) é 100% da F5.23
// (`exportSnapshot`/`serializeSnapshot`/`importSnapshotIntoStore` sobre um `SnapshotStore`
// ligado às MESMAS fns web `*Fs`/`*PlanFs` num `UserDataDir` em memória + wasm p/ referência
// REAL); o token chega pronto via `getToken` (F5.24). O motor NOVO é só o transporte Drive.
//
// PROVA: (1) PUSH cria 1 arquivo canônico na app-data (list acha 1); 2º push = REPLACE (ainda
// 1 arquivo, id ESTÁVEL). (2) só notas+marcações+progresso sobem (SEM texto bíblico/sessão/
// chave; campos do snapshot). (3) PULL de app-data VAZIO = no-op (store intacto). (4) DOIS
// "dispositivos" (2 stores + 1 nuvem compartilhada): A tem nota X, B tem nota Y → A.syncNow,
// B.syncNow, A.syncNow ⇒ AMBOS convergem p/ {X,Y} (união); progresso = max(completed). (5)
// IDEMPOTÊNCIA: syncNow 2× seguidas ⇒ 0/0/false na 2ª. (6) MERGE NUNCA APAGA local: pull de
// remoto MENOR preserva a nota só-local. (7) NÃO-VAZAMENTO: token só em `Authorization:
// Bearer`, nunca no output; nenhum `console.*` em driveSync.ts (`notoken=ok`). Marcador
// `DRIVE_SYNC push=ok pull=ok converge=ok idempotent=ok notoken=ok`. Sai 0 se tudo bater.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'driveSync-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');
const DRIVESYNC_TS = join(__dirname, '..', '..', 'lib', 'driveSync.ts');

// Access token MOCK (NÃO real): a prova prova que ele NUNCA aparece no output (notoken=ok);
// vai SÓ no header `Authorization: Bearer`, jamais em git/log/rede real.
const MOCK_ACCESS_TOKEN = 'MOCK_DRIVE_ACCESS_TOKEN_not_real_do_not_use';
const SECRETS = [MOCK_ACCESS_TOKEN];

async function loadBundle() {
  const outfile = join(tmpdir(), `drivesync-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

// `UserDataDir` EM MEMÓRIA — mock do OPFS (idêntico ao das provas de snapshot/notas/planos).
function makeMemoryDir(store) {
  return {
    async readFile(relPath) {
      return store.has(relPath) ? store.get(relPath) : null;
    },
    async writeFile(relPath, content) {
      store.set(relPath, content);
    },
    async deleteFile(relPath) {
      return store.delete(relPath);
    },
    async listDir(relDir) {
      const prefix = relDir.endsWith('/') ? relDir : `${relDir}/`;
      const names = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes('/')) {
            names.push(rest);
          }
        }
      }
      return names;
    },
  };
}

// "Nuvem" EM MEMÓRIA — emula a pasta app-data: Map<fileId, {name, content}> + gerador de id.
function makeCloud() {
  return { files: new Map(), seq: 1 };
}

function jsonResp(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return obj;
    },
    async text() {
      return JSON.stringify(obj);
    },
  };
}

function textResp(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(text);
    },
    async text() {
      return text;
    },
  };
}

// Desmonta um corpo multipart/related em {metadata, content} (2 partes: metadados + mídia).
function parseMultipart(contentType, body) {
  const m = /boundary=(.+)$/.exec(contentType);
  assert.ok(m, 'upload multipart declara boundary');
  const boundary = m[1];
  const payloads = [];
  for (const part of body.split(`--${boundary}`)) {
    const trimmed = part.replace(/^\r\n/, '');
    if (trimmed === '' || trimmed === '--' || trimmed === '--\r\n') {
      continue;
    }
    const idx = trimmed.indexOf('\r\n\r\n');
    if (idx === -1) {
      continue;
    }
    payloads.push(trimmed.slice(idx + 4).replace(/\r\n$/, ''));
  }
  return { metadata: JSON.parse(payloads[0]), content: payloads[1] };
}

// `fetch` MOCK ligado a uma nuvem: roteia list/download/create/update do Drive v3 app-data.
// INVARIANTE: TODA request DEVE carregar `Authorization: Bearer <token>` (prova do Bearer).
function makeDriveFetch(cloud, expectedToken, captureReq) {
  return async (url, init) => {
    assert.equal(
      init.headers.Authorization,
      `Bearer ${expectedToken}`,
      'toda request Drive carrega Authorization: Bearer <token>',
    );
    if (captureReq) {
      captureReq({ url, method: init.method, body: init.body });
    }
    const u = new URL(url);
    const path = u.pathname;

    // LIST: GET /drive/v3/files?spaces=appDataFolder&q=name='...'
    if (path === '/drive/v3/files' && init.method === 'GET') {
      assert.equal(u.searchParams.get('spaces'), 'appDataFolder', 'list restrito ao appDataFolder');
      const q = u.searchParams.get('q') ?? '';
      const nameMatch = /name = '([^']*)'/.exec(q);
      const wanted = nameMatch ? nameMatch[1] : null;
      const files = [];
      for (const [id, f] of cloud.files) {
        if (wanted == null || f.name === wanted) {
          files.push({ id, name: f.name });
        }
      }
      return jsonResp({ files });
    }
    // DOWNLOAD: GET /drive/v3/files/{id}?alt=media
    if (path.startsWith('/drive/v3/files/') && init.method === 'GET') {
      assert.equal(u.searchParams.get('alt'), 'media', 'download usa alt=media');
      const id = decodeURIComponent(path.slice('/drive/v3/files/'.length));
      const f = cloud.files.get(id);
      return f ? textResp(f.content) : jsonResp({ error: 'not found' }, 404);
    }
    // CREATE: POST /upload/drive/v3/files?uploadType=multipart
    if (path === '/upload/drive/v3/files' && init.method === 'POST') {
      assert.equal(u.searchParams.get('uploadType'), 'multipart', 'create usa uploadType=multipart');
      const { metadata, content } = parseMultipart(init.headers['Content-Type'], init.body);
      assert.ok(
        Array.isArray(metadata.parents) && metadata.parents.includes('appDataFolder'),
        'create grava na pasta app-private (parents:["appDataFolder"])',
      );
      const id = `file-${cloud.seq++}`;
      cloud.files.set(id, { name: metadata.name, content });
      return jsonResp({ id });
    }
    // UPDATE: PATCH /upload/drive/v3/files/{id}?uploadType=media
    if (path.startsWith('/upload/drive/v3/files/') && init.method === 'PATCH') {
      assert.equal(u.searchParams.get('uploadType'), 'media', 'update usa uploadType=media');
      const id = decodeURIComponent(path.slice('/upload/drive/v3/files/'.length));
      const f = cloud.files.get(id);
      if (!f) {
        return jsonResp({ error: 'not found' }, 404);
      }
      cloud.files.set(id, { name: f.name, content: init.body });
      return jsonResp({ id });
    }
    throw new Error(`mock drive: rota inesperada ${init.method} ${path}`);
  };
}

// Espiona console.* p/ a INVARIANTE de não-vazamento (token nunca logado).
function spyConsole() {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const captured = [];
  const originals = {};
  for (const m of methods) {
    originals[m] = console[m];
    console[m] = (...args) => {
      captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  }
  return {
    captured,
    restore() {
      for (const m of methods) console[m] = originals[m];
    },
  };
}

function assertNoSecretIn(text, where) {
  for (const s of SECRETS) {
    assert.ok(!String(text).includes(s), `${where} NÃO deve conter o access token`);
  }
}

async function main() {
  const {
    init,
    mod,
    listBooks,
    parseReference,
    formatReferenceEn,
    putNoteFs,
    listNotesFs,
    addHighlightFs,
    listHighlightsFs,
    readActivePlanFs,
    startPlanFs,
    setCompletedFs,
    exportSnapshot,
    CANONICAL_SNAPSHOT_FILENAME,
    createDriveSync,
  } = await loadBundle();

  // (1) Fronteira Rust no wasm — p/ `parseReference` (referência REAL) + nome EN do livro.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();
  const bookNameEn = (book) => listBooks().find((b) => b.number === book)?.nameEn ?? '?';

  // Adapter `SnapshotStore` sobre um `UserDataDir` em memória — LIGA o motor às MESMAS fns
  // de produção (parseReference ANTES do I/O; referência canônica/validação do CORE via wasm).
  const makeStore = (dir) => ({
    formatReference: (ref) => formatReferenceEn(ref, bookNameEn(ref.book)),
    assertValidReference: (refStr) => {
      parseReference(refStr); // lança em referência irreal (core) — anti-alucinação
    },
    listNotes: () => listNotesFs(dir),
    listHighlights: () => listHighlightsFs(dir),
    readingPlanProgress: () => readActivePlanFs(dir),
    putNote: (refStr, body) => putNoteFs(dir, parseReference(refStr), body),
    addHighlight: (refStr, color, tag) => addHighlightFs(dir, parseReference(refStr), color, tag),
    startReadingPlan: (planId, startDate) => startPlanFs(dir, planId, startDate),
    setReadingPlanCompleted: (completed) => setCompletedFs(dir, completed),
  });

  const getToken = async () => MOCK_ACCESS_TOKEN;
  const newStore = () => makeStore(makeMemoryDir(new Map()));
  const capturedRequests = [];
  const makeSync = (cloud, store) =>
    createDriveSync({
      fetch: makeDriveFetch(cloud, MOCK_ACCESS_TOKEN, (r) => capturedRequests.push(r)),
      getToken,
      store,
    });

  const spy = spyConsole();
  try {
    // ── (1) PUSH cria o arquivo canônico; 2º push = REPLACE (id estável) ─────────
    const cloud1 = makeCloud();
    const store1 = newStore();
    await store1.putNote('John 3:16', 'nota do device push');
    await store1.addHighlight('John 3:16', 'yellow', 'salvação');
    const sync1 = makeSync(cloud1, store1);

    const p1 = await sync1.pushSnapshot();
    assert.equal(cloud1.files.size, 1, 'push criou 1 arquivo na app-data');
    assert.ok(p1.bytes > 0, 'push reporta bytes gravados');
    const found1 = await sync1.findSnapshotFile();
    assert.equal(found1, p1.fileId, 'findSnapshotFile localiza o arquivo criado (por nome)');
    assert.equal(
      cloud1.files.get(p1.fileId).name,
      CANONICAL_SNAPSHOT_FILENAME,
      'arquivo canônico com o nome esperado',
    );

    const p2 = await sync1.pushSnapshot();
    assert.equal(cloud1.files.size, 1, '2º push NÃO cria novo arquivo (replace)');
    assert.equal(p2.fileId, p1.fileId, 'id ESTÁVEL no replace (PATCH por id)');

    // ── (2) SÓ notas+marcações+progresso sobem (SEM texto bíblico/sessão/chave) ──
    const uploaded = cloud1.files.get(p1.fileId).content;
    const parsed = JSON.parse(uploaded);
    assert.equal(parsed.app, 'the-light-app', 'sobe SÓ o snapshot da F5.23 (discriminador app)');
    assert.equal(parsed.version, 1, 'snapshot version=1');
    const allowed = new Set(['app', 'version', 'exportedAt', 'notes', 'highlights', 'planProgress']);
    for (const k of Object.keys(parsed)) {
      assert.ok(allowed.has(k), `snapshot só carrega campos do userdata (campo inesperado: ${k})`);
    }
    assert.ok(!uploaded.includes('For God so loved'), 'NENHUM texto bíblico no upload (só a referência)');
    assert.ok(
      !/access_token|"?Bearer"?|apiKey|sk-|refresh_token|"sessions"|"messages"/.test(uploaded),
      'NENHUMA chave/token/sessão de IA no upload',
    );
    assertNoSecretIn(uploaded, 'conteúdo enviado ao Drive');

    // ── (3) PULL de app-data VAZIO = no-op (store intacto) ──────────────────────
    const cloudEmpty = makeCloud();
    const storeE0 = newStore();
    await storeE0.putNote('Genesis 1:1', 'local intacto');
    const syncE0 = makeSync(cloudEmpty, storeE0);
    const pullEmpty = await syncE0.pullSnapshot();
    assert.deepEqual(
      pullEmpty.applied,
      { notes: 0, highlights: 0, planProgress: false },
      'pull de app-data vazio = no-op (nada a mesclar)',
    );
    assert.equal((await exportSnapshot(storeE0)).notes.length, 1, 'store INTACTO após pull vazio');

    // ── (4) DOIS dispositivos + 1 nuvem: convergem p/ a UNIÃO ───────────────────
    const cloud = makeCloud();
    const storeA = newStore();
    const storeB = newStore();
    await storeA.putNote('John 3:16', 'nota do device A');
    await storeA.startReadingPlan('gospels', '2026-01-01');
    await storeA.setReadingPlanCompleted(3);
    await storeB.putNote('Genesis 1:1', 'nota do device B');
    await storeB.startReadingPlan('gospels', '2026-01-01');
    await storeB.setReadingPlanCompleted(5);
    const syncA = makeSync(cloud, storeA);
    const syncB = makeSync(cloud, storeB);

    await syncA.syncNow(); // cloud = {X, plano:3}
    const bSync = await syncB.syncNow(); // B mescla X, empurra {X,Y, plano:5}
    assert.equal(bSync.pulled.applied.notes, 1, 'B: pull trouxe a nota do A (merge — não apaga a de B)');
    await syncA.syncNow(); // A mescla Y, plano 3→5

    const finalA = await exportSnapshot(storeA);
    const finalB = await exportSnapshot(storeB);
    assert.deepEqual(finalA, finalB, 'CONVERGÊNCIA: A e B com o MESMO estado após sync');
    assert.equal(finalA.notes.length, 2, 'convergiu p/ a UNIÃO das notas (X + Y)');
    assert.ok(finalA.notes.find((n) => n.reference === 'John 3:16'), 'nota do A presente nos dois');
    assert.ok(finalA.notes.find((n) => n.reference === 'Genesis 1:1'), 'nota do B presente nos dois');
    assert.equal(finalA.planProgress.completed, 5, 'progresso convergiu p/ max(completed)=5');
    assert.equal(cloud.files.size, 1, 'um ÚNICO arquivo canônico no Drive (não duplica)');

    // ── (5) IDEMPOTÊNCIA: syncNow 2× seguidas ⇒ 0/0/false na 2ª ─────────────────
    const idem = await syncA.syncNow();
    assert.deepEqual(
      idem.pulled.applied,
      { notes: 0, highlights: 0, planProgress: false },
      'IDEMPOTENTE: 2ª sync seguida aplica 0/0/false',
    );
    assert.deepEqual(await exportSnapshot(storeA), finalA, 'estado inalterado após sync idempotente');

    // ── (6) MERGE NUNCA APAGA local: pull de remoto MENOR preserva a nota só-local ─
    const cloudSmall = makeCloud();
    const storeSeed = newStore();
    await storeSeed.putNote('John 3:16', 'só no remoto');
    await makeSync(cloudSmall, storeSeed).pushSnapshot(); // remoto tem só 1 nota
    const storeBig = newStore();
    await storeBig.putNote('John 3:16', 'local');
    await storeBig.putNote('Genesis 1:1', 'nota só local (não pode sumir)');
    await makeSync(cloudSmall, storeBig).pullSnapshot();
    const afterBig = await exportSnapshot(storeBig);
    assert.equal(afterBig.notes.length, 2, 'MERGE NÃO APAGA: pull de remoto MENOR preserva a nota só-local');
    assert.ok(
      afterBig.notes.find((n) => n.reference === 'Genesis 1:1'),
      'nota só-local preservada após pull de remoto menor',
    );

    // ── (7) Sem token válido ⇒ rejeita (não linkado/expirado) — sem vazar nada ───
    const syncNoToken = createDriveSync({
      fetch: makeDriveFetch(cloud, MOCK_ACCESS_TOKEN),
      getToken: async () => null,
      store: storeA,
    });
    await assert.rejects(() => syncNoToken.pushSnapshot(), /sem access token/, 'sem token → rejeita');

    // O token foi enviado em `Authorization: Bearer` (o mock exige em TODA request); nunca
    // no corpo. Confirma que houve requests e nenhum corpo capturado carrega o token.
    assert.ok(capturedRequests.length > 0, 'houve requests ao Drive (mock)');
    for (const r of capturedRequests) {
      if (r.body) {
        assertNoSecretIn(r.body, 'corpo de request ao Drive');
      }
    }
  } finally {
    spy.restore();
  }

  // ── INVARIANTE DE NÃO-VAZAMENTO ─────────────────────────────────────────────
  // (a) Nada capturado do console durante a execução contém o token.
  assertNoSecretIn(spy.captured.join('\n'), 'saída de console capturada da prova');
  // (b) O fonte de driveSync.ts NÃO tem NENHUM console.* (token nunca logado).
  const src = await readFile(DRIVESYNC_TS, 'utf8');
  assert.ok(!/\bconsole\s*\./.test(src), 'driveSync.ts NÃO deve conter nenhum console.*');
  // (c) O fonte não embute segredo (token só chega via getToken injetado).
  assert.ok(!/client_secret/.test(src), 'driveSync.ts NÃO envia client_secret');

  const marker = 'DRIVE_SYNC push=ok pull=ok converge=ok idempotent=ok notoken=ok';
  assertNoSecretIn(marker, 'marcador final');

  console.log('PASS — drive sync web (push/pull do snapshot na app-data do Drive, MOCK; só userdata):');
  console.log('  (1) PUSH               -> cria 1 arquivo canônico na app-data; 2º push = replace (id estável)');
  console.log('  (2) só userdata        -> notas+marcações+progresso; SEM texto bíblico/sessão/chave no upload');
  console.log('  (3) PULL vazio         -> no-op (store intacto)');
  console.log('  (4) 2 dispositivos     -> A+B convergem p/ a UNIÃO {X,Y}; progresso = max(completed)');
  console.log('  (5) IDEMPOTÊNCIA       -> syncNow 2× seguidas ⇒ 0/0/false na 2ª');
  console.log('  (6) MERGE não apaga    -> pull de remoto MENOR preserva a nota só-local');
  console.log('  (7) NÃO-VAZAMENTO      -> token só em Authorization: Bearer; nenhum console.* em driveSync.ts');
  console.log('  REUSO: snapshot/merge = F5.23 (buildSnapshot/parseSnapshot/mergeSnapshots/importSnapshotIntoStore); token = F5.24.');
  console.log('  MOCK apenas: NENHUMA chamada real ao Google; validação com conta REAL é a F5.27 (gate humano).');
  console.log(`  ${marker}`);

  assert.match(marker, /converge=ok/, 'marcador prova a convergência entre 2 dispositivos');
  assert.match(marker, /notoken=ok/, 'marcador prova a invariante de não-vazamento');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
