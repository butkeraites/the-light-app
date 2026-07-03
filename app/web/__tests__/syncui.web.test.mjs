// syncui.web.test.mjs — F5.26 (molde snapshot.web.test.mjs F5.23)
//
// PROVA HEADLESS (node, sem browser/Expo/rede/chave/device) da UI de sync OPT-IN + backup.
// A UI (React Native) não roda 100% headless, então esta prova exercita o MOTOR do produto
// que a tela costura — as duas peças NOVAS da F5.26, sem mocks do que é do produto:
//   (A) o ADAPTADOR `createSnapshotStore` (F5.26) ligado a um store REAL em memória
//       (as MESMAS fns `*Fs`/`*PlanFs` da F5.23 + wasm que a UI usa via
//       `snapshotStore[.web].ts`) — export→import ROUND-TRIP via o adaptador → `store=ok`;
//   (B) `formatReferenceEnPure` (F5.26) == `formatReferenceEn` (F1.16) — sem DRIFT do
//       espelho de `format_reference` do core (anti-alucinação);
//   (C) o flag OPT-IN `createSyncPrefs` (F5.26): KV VAZIO lê `false` (DEFAULT OFF) →
//       `optin_default_off=ok`; ligar grava e relê `true`, desligar volta a `false` →
//       `optin_persist=ok`.
// Marcador: `SYNC_UI store=ok optin_default_off=ok optin_persist=ok`. Sai 0 se tudo bater.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'syncui-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `syncui-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    // `syncPrefs.ts` → `prefs.ts` faz `import('expo-file-system/legacy')` LAZY (nunca
    // chamado aqui: a prova injeta um KV em memória). Marcado external p/ não resolver.
    external: ['expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

// `UserDataDir` EM MEMÓRIA — mock do OPFS (idêntico ao da prova de snapshot F5.23).
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

async function main() {
  const {
    init,
    mod,
    listBooks,
    parseReference,
    addHighlightFs,
    formatReferenceEn,
    listHighlightsFs,
    listNotesFs,
    putNoteFs,
    readActivePlanFs,
    setCompletedFs,
    startPlanFs,
    createSnapshotStore,
    formatReferenceEnPure,
    createSyncPrefs,
    SYNC_OPTIN_PREF_KEY,
    exportSnapshot,
    importSnapshotIntoStore,
    serializeSnapshot,
  } = await loadBundle();

  // Fronteira Rust no wasm — `parseReference` (validação REAL) + nome EN do livro.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const bookNameEn = (book) => listBooks().find((b) => b.number === book)?.nameEn ?? '?';

  // Constrói o `SnapshotStore` do PRODUTO (`createSnapshotStore` — F5.26) ligado às MESMAS
  // fns de produção que a UI usa (via `snapshotStore[.web].ts`), sobre um dir em memória.
  const makeStore = (dir) =>
    createSnapshotStore({
      bookNameEn,
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

  // ── (A) ROUND-TRIP via o ADAPTADOR createSnapshotStore ──────────────────────
  const mapA = new Map();
  const dirA = makeMemoryDir(mapA);
  const storeA = makeStore(dirA);

  await storeA.putNote('John 3:16', '# Amor\n\nDeus amou o mundo.');
  await storeA.putNote('Genesis 1:1', 'No principio…');
  await storeA.addHighlight('John 3:16', 'yellow', 'salvacao');
  await storeA.addHighlight('Psalms 23:1', 'green');
  await storeA.startReadingPlan('gospels', '2026-01-01');
  await storeA.setReadingPlanCompleted(3);

  const snapA = await exportSnapshot(storeA);
  assert.equal(snapA.app, 'the-light-app', 'adapter export: discriminador app');
  assert.equal(snapA.notes.length, 2, 'adapter export: 2 notas');
  assert.equal(snapA.highlights.length, 2, 'adapter export: 2 marcacoes');
  assert.ok(snapA.planProgress && snapA.planProgress.completed === 3, 'adapter export: progresso');
  // ANTI-ALUCINACAO: o snapshot NÃO carrega texto biblico (só a referencia canonica).
  const jsonA = serializeSnapshot(snapA);
  assert.ok(!jsonA.includes('For God so loved'), 'adapter snapshot SEM texto biblico');

  // export → limpar (dir novo) → import via o adaptador → estado IDENTICO.
  const mapB = new Map();
  const storeB = makeStore(makeMemoryDir(mapB));
  assert.equal((await exportSnapshot(storeB)).notes.length, 0, 'store limpo: 0 notas');
  const imp = await importSnapshotIntoStore(jsonA, storeB);
  assert.equal(imp.applied.notes, 2, 'adapter import: 2 notas aplicadas');
  assert.equal(imp.applied.highlights, 2, 'adapter import: 2 marcacoes aplicadas');
  assert.equal(imp.applied.planProgress, true, 'adapter import: progresso aplicado');
  const snapB = await exportSnapshot(storeB);
  assert.deepEqual(snapB, snapA, 'ROUND-TRIP via adaptador: estado reimportado IDENTICO');
  // Idempotente: re-import = no-op.
  const imp2 = await importSnapshotIntoStore(jsonA, storeB);
  assert.deepEqual(
    imp2.applied,
    { notes: 0, highlights: 0, planProgress: false },
    'adapter re-import IDEMPOTENTE (0/0/false)',
  );
  const storeOk = true;

  // ── (B) SEM DRIFT: formatReferenceEnPure (F5.26) == formatReferenceEn (F1.16) ─
  const notes = await listNotesFs(dirA);
  for (const n of notes) {
    const pure = formatReferenceEnPure(n.reference, bookNameEn(n.reference.book));
    const glue = formatReferenceEn(n.reference, bookNameEn(n.reference.book));
    assert.equal(pure, glue, `formatReferenceEnPure == formatReferenceEn (${glue})`);
    // E a string canonica é aceita de volta pelo core (round-trip de referencia).
    assert.ok(parseReference(pure), `parseReference aceita a string canonica (${pure})`);
  }

  // ── (C) OPT-IN default OFF + persistencia (createSyncPrefs — F5.26) ──────────
  const kv = new Map();
  const kvBackend = {
    async getPref(key) {
      return kv.has(key) ? kv.get(key) : null;
    },
    async setPref(key, value) {
      kv.set(key, value);
    },
    async removePref(key) {
      kv.delete(key);
    },
  };
  const syncPrefs = createSyncPrefs(kvBackend);

  // KV VAZIO → DEFAULT OFF.
  assert.equal(await syncPrefs.getSyncOptIn(), false, 'opt-in DEFAULT OFF (KV vazio → false)');
  assert.equal(kv.has(SYNC_OPTIN_PREF_KEY), false, 'KV vazio realmente sem a chave');
  const optinDefaultOff = true;

  // Ligar grava e relê true; desligar remove e volta a false.
  await syncPrefs.setSyncOptIn(true);
  assert.equal(kv.get(SYNC_OPTIN_PREF_KEY), 'true', 'ligar grava true');
  assert.equal(await syncPrefs.getSyncOptIn(), true, 'relê true apos ligar');
  await syncPrefs.setSyncOptIn(false);
  assert.equal(kv.has(SYNC_OPTIN_PREF_KEY), false, 'desligar REMOVE a chave (volta ao default OFF)');
  assert.equal(await syncPrefs.getSyncOptIn(), false, 'relê false apos desligar');
  // Valor-lixo (nao 'true') lê como OFF (robustez do default).
  kv.set(SYNC_OPTIN_PREF_KEY, 'sim');
  assert.equal(await syncPrefs.getSyncOptIn(), false, 'valor != "true" lê como OFF');
  const optinPersist = true;

  const marker = `SYNC_UI store=${storeOk ? 'ok' : 'FAIL'} optin_default_off=${optinDefaultOff ? 'ok' : 'FAIL'} optin_persist=${optinPersist ? 'ok' : 'FAIL'}`;

  console.log('PASS — UI de sync opt-in + backup (motor do produto que a tela costura):');
  console.log(`  (A) adaptador createSnapshotStore -> store REAL (memoria): export→import ROUND-TRIP + idempotente`);
  console.log(`  (B) formatReferenceEnPure == formatReferenceEn (sem drift; referencia canonica do core)`);
  console.log(`  (C) opt-in DEFAULT OFF (KV vazio → false) + persiste (ligar/desligar)`);
  console.log(`  ${marker}`);
  console.log('  OFFLINE-FIRST/PRIVACIDADE: opt-in OFF por padrao (zero rede); snapshot SÓ notas+marcacoes+progresso (sem texto biblico/sessao/chave/token).');

  assert.equal(marker, 'SYNC_UI store=ok optin_default_off=ok optin_persist=ok', 'marcador estavel');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
