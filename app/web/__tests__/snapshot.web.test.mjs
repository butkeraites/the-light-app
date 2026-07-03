// snapshot.web.test.mjs — F5.23 (molde notes.web.test.mjs F1.16 / plans.web.test.mjs F5.10)
//
// PROVA HEADLESS (node, sem browser/Expo/rede/chave) do SNAPSHOT JSON round-trippável
// dos dados do usuário (notas + marcações + progresso de plano). Exercita o MESMO código
// de PRODUÇÃO que a UI de sync (F5.26) vai usar:
//   - O MOTOR PURO `../../lib/userdataSnapshot` (build/serialize/parse/merge + export/
//     import-com-merge sobre um `SnapshotStore`).
//   - As fns de userdata (`*Fs`) e progresso (`*PlanFs`) sobre um `UserDataDir` EM
//     MEMÓRIA (mock do OPFS — `Map<path, content>`). Em runtime no browser o backend é
//     OPFS (`../userdata-opfs.web.ts`); aqui node injeta o mesmo backend em memória.
//   - A fronteira Rust no wasm p/ canonicalizar/validar a referência (`parseReference`) e
//     o nome EN do livro (`listBooks`) — anti-alucinação (referência REAL do core).
//
// PROVA: (A) export → snapshot com N notas/M marcações/progresso; (B) ROUND-TRIP (export →
// limpar → import → estado idêntico); (C) MERGE (dois snapshots divergentes → união
// determinística; colisão → importado vence; progresso = max(completed) no mesmo plano,
// LWW em plano diferente); (D) import inválido/corrompido REJEITADO sem corromper; (E)
// re-import IDEMPOTENTE (no-op). Só dados do usuário — NENHUM texto bíblico além da
// referência, NENHUMA sessão/banco/chave. Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'snapshot-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `snapshot-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// `UserDataDir` EM MEMÓRIA — mock do OPFS (idêntico ao das provas de notas/planos).
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
    formatReferenceEn,
    putNoteFs,
    listNotesFs,
    addHighlightFs,
    listHighlightsFs,
    readActivePlanFs,
    startPlanFs,
    setCompletedFs,
    buildSnapshot,
    serializeSnapshot,
    parseSnapshot,
    mergeSnapshots,
    exportSnapshot,
    importSnapshotIntoStore,
  } = await loadBundle();

  // (1) Fronteira Rust no wasm — p/ `parseReference` + nome EN do livro (listBooks).
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const bookNameEn = (book) => listBooks().find((b) => b.number === book)?.nameEn ?? '?';

  // Adapter `SnapshotStore` sobre um `UserDataDir` em memória — LIGA o motor puro às
  // MESMAS fns de produção que `reading.web.ts` chama (parseReference ANTES do I/O; a
  // referência canônica/validação vêm do CORE via wasm). O nativo (F5.26) ligaria as fns
  // do frontier equivalentes.
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

  // ── (A) EXPORT: snapshot montado dos Records ────────────────────────────────
  const storeAmap = new Map();
  const dirA = makeMemoryDir(storeAmap);
  const storeA = makeStore(dirA);

  await storeA.putNote('John 3:16', '# Amor\n\nDeus amou o mundo.');
  await storeA.putNote('Genesis 1:1', 'No princípio…');
  await storeA.addHighlight('John 3:16', 'yellow', 'salvação');
  await storeA.addHighlight('Psalms 23:1', 'green'); // sem tag
  await storeA.startReadingPlan('gospels', '2026-01-01');
  await storeA.setReadingPlanCompleted(3);

  const snapA = await exportSnapshot(storeA);
  assert.equal(snapA.app, 'the-light-app', 'snapshot.app discriminador');
  assert.equal(snapA.version, 1, 'snapshot.version = 1');
  assert.equal(snapA.notes.length, 2, 'export: 2 notas');
  assert.equal(snapA.highlights.length, 2, 'export: 2 marcações');
  assert.ok(snapA.planProgress, 'export: progresso presente');
  assert.equal(snapA.planProgress.planId, 'gospels', 'progresso: plano gospels');
  assert.equal(snapA.planProgress.startDate, '2026-01-01', 'progresso: startDate');
  assert.equal(snapA.planProgress.completed, 3, 'progresso: completed=3');
  // Referência canônica (string do core), NENHUM texto bíblico no snapshot.
  const refs = snapA.notes.map((n) => n.reference);
  assert.deepEqual(refs, ['Genesis 1:1', 'John 3:16'], 'notas: refs canônicas ordenadas');
  // ANTI-ALUCINAÇÃO: o snapshot NÃO carrega texto bíblico (só a referência + corpo do usuário).
  const serialized = serializeSnapshot(snapA);
  assert.ok(!serialized.includes('For God so loved'), 'snapshot SEM texto bíblico (só referência)');
  assert.match(serialized, /^\{\n {2}"app":/, 'JSON pretty 2 espaços');

  // ── (B) ROUND-TRIP: export → limpar (dir novo/vazio) → import → estado idêntico ─
  const jsonA = serializeSnapshot(snapA);
  const storeBmap = new Map(); // "limpo": store vazio (≡ apagar tudo)
  const dirB = makeMemoryDir(storeBmap);
  const storeB = makeStore(dirB);
  assert.equal((await exportSnapshot(storeB)).notes.length, 0, 'store limpo tem 0 notas');

  const imp = await importSnapshotIntoStore(jsonA, storeB);
  assert.equal(imp.applied.notes, 2, 'import aplicou 2 notas no store limpo');
  assert.equal(imp.applied.highlights, 2, 'import aplicou 2 marcações');
  assert.equal(imp.applied.planProgress, true, 'import aplicou o progresso');

  const snapB = await exportSnapshot(storeB);
  assert.deepEqual(snapB, snapA, 'ROUND-TRIP: estado reimportado IDÊNTICO ao exportado');

  // ── (E) IDEMPOTÊNCIA: reimportar o MESMO snapshot = no-op ────────────────────
  const imp2 = await importSnapshotIntoStore(jsonA, storeB);
  assert.deepEqual(
    imp2.applied,
    { notes: 0, highlights: 0, planProgress: false },
    'IDEMPOTENTE: re-import do mesmo snapshot não grava nada',
  );
  assert.deepEqual(await exportSnapshot(storeB), snapA, 'estado inalterado após re-import');

  // ── (C) MERGE: dois snapshots divergentes → união determinística ────────────
  // Snapshot divergente (device C): nota colidente (body novo), nota nova, marcação nova,
  // MESMO plano com completed maior.
  const notesC = [
    { reference: 'John 3:16', body: 'corpo NOVO (device C)' }, // colisão → C vence
    { reference: 'Romans 8:28', body: 'todas as coisas' }, // nova
  ];
  const highlightsC = [
    { reference: 'Romans 8:28', color: 'blue' }, // nova
    { reference: 'John 3:16', color: 'orange', tag: 'amor' }, // colisão → C vence
  ];
  const snapC = {
    app: 'the-light-app',
    version: 1,
    notes: notesC,
    highlights: highlightsC,
    planProgress: { planId: 'gospels', startDate: '2026-01-01', completed: 7 }, // > 3
  };
  const merged = mergeSnapshots(snapA, snapC);
  // União de notas: Genesis(base) + John(C vence) + Romans(novo) = 3.
  assert.equal(merged.notes.length, 3, 'merge notas: união = 3');
  const mNote = (r) => merged.notes.find((n) => n.reference === r);
  assert.equal(mNote('John 3:16').body, 'corpo NOVO (device C)', 'colisão de nota: importado vence');
  assert.equal(mNote('Genesis 1:1').body, 'No princípio…', 'nota só-local preservada');
  assert.ok(mNote('Romans 8:28'), 'nota nova do import presente');
  // União de marcações: Psalms(base) + John(C vence) + Romans(novo) = 3.
  assert.equal(merged.highlights.length, 3, 'merge marcações: união = 3');
  const mHi = (r) => merged.highlights.find((h) => h.reference === r);
  assert.equal(mHi('John 3:16').color, 'orange', 'colisão de marcação: importado vence (cor)');
  assert.equal(mHi('John 3:16').tag, 'amor', 'colisão de marcação: tag importada vence');
  assert.equal(mHi('Psalms 23:1').color, 'green', 'marcação só-local preservada');
  // Progresso do MESMO plano: max(completed) = 7 (nunca regride).
  assert.equal(merged.planProgress.completed, 7, 'progresso mesmo plano: max(completed)=7');

  // DETERMINISMO: merge repetido → resultado IDÊNTICO.
  assert.deepEqual(mergeSnapshots(snapA, snapC), merged, 'merge DETERMINÍSTICO (repetível)');

  // Progresso LWW em plano DIFERENTE: importado vence.
  const snapDiffPlan = {
    app: 'the-light-app',
    version: 1,
    notes: [],
    highlights: [],
    planProgress: { planId: 'nt', startDate: '2026-02-01', completed: 1 },
  };
  const mergedPlan = mergeSnapshots(snapA, snapDiffPlan);
  assert.equal(mergedPlan.planProgress.planId, 'nt', 'plano diferente: LWW → importado vence');
  assert.equal(mergedPlan.planProgress.completed, 1, 'plano diferente: completed importado');

  // MERGE APLICADO ao store (import de snapC sobre o estado A) → estado = merged.
  const storeMergeMap = new Map(storeBmap); // cópia do estado A (já importado em B)
  const dirMerge = makeMemoryDir(storeMergeMap);
  const storeMerge = makeStore(dirMerge);
  const impMerge = await importSnapshotIntoStore(serializeSnapshot(snapC), storeMerge);
  assert.equal(impMerge.applied.notes, 2, 'import-merge: 2 notas mudaram (John colisão + Romans nova)');
  assert.equal(impMerge.applied.highlights, 2, 'import-merge: 2 marcações mudaram');
  assert.equal(impMerge.applied.planProgress, true, 'import-merge: progresso mudou (3→7)');
  const snapMerged = await exportSnapshot(storeMerge);
  assert.deepEqual(
    snapMerged,
    mergeSnapshots(snapA, snapC),
    'import-merge aplicado ao store == mergeSnapshots(A, C)',
  );

  // ── (D) IMPORT INVÁLIDO/CORROMPIDO: rejeitado SEM corromper o estado ────────
  const before = await exportSnapshot(storeMerge);
  const rejects = [
    ['JSON malformado', '{ not json'],
    ['app errado', JSON.stringify({ app: 'outro', version: 1, notes: [], highlights: [], planProgress: null })],
    ['versão não suportada', JSON.stringify({ app: 'the-light-app', version: 999, notes: [], highlights: [], planProgress: null })],
    ['notes não-array', JSON.stringify({ app: 'the-light-app', version: 1, notes: {}, highlights: [], planProgress: null })],
    ['body não-string', JSON.stringify({ app: 'the-light-app', version: 1, notes: [{ reference: 'John 3:16', body: 42 }], highlights: [], planProgress: null })],
    ['completed negativo', JSON.stringify({ app: 'the-light-app', version: 1, notes: [], highlights: [], planProgress: { planId: 'nt', startDate: '2026-01-01', completed: -1 } })],
  ];
  for (const [label, bad] of rejects) {
    await assert.rejects(
      () => importSnapshotIntoStore(bad, storeMerge),
      /snapshot inválido/,
      `import rejeitado: ${label}`,
    );
  }
  // Referência IRREAL (estrutura válida, mas ref não-canônica) → rejeitada ANTES de escrever.
  const bogusRef = JSON.stringify({
    app: 'the-light-app',
    version: 1,
    notes: [{ reference: 'Nonexistent 9:9', body: 'x' }],
    highlights: [],
    planProgress: null,
  });
  await assert.rejects(() => importSnapshotIntoStore(bogusRef, storeMerge), 'referência irreal rejeitada');
  // ESTADO INTACTO após todas as rejeições (nada foi gravado).
  assert.deepEqual(await exportSnapshot(storeMerge), before, 'estado INALTERADO após imports inválidos');

  // ── (F) buildSnapshot puro dos Records (sem I/O) + parse round-trip ─────────
  const pureNotes = await listNotesFs(dirA);
  const pureHi = await listHighlightsFs(dirA);
  const pureProg = await readActivePlanFs(dirA);
  const built = buildSnapshot(pureNotes, pureHi, pureProg, (r) => formatReferenceEn(r, bookNameEn(r.book)));
  assert.deepEqual(built, snapA, 'buildSnapshot(Records) == exportSnapshot(store)');
  assert.deepEqual(parseSnapshot(serializeSnapshot(built)), built, 'parse(serialize(s)) == s');

  // Marcador determinístico (do RETORNO REAL, nada hardcoded no produto).
  const marker = `WEB_SNAPSHOT notes=${snapA.notes.length} highlights=${snapA.highlights.length} plan=${snapA.planProgress.planId}:${snapA.planProgress.completed} roundtrip=ok merge_notes=${merged.notes.length} idempotent=ok`;

  console.log('PASS — snapshot web (motor PURO + store em memória, dados SÓ do usuário):');
  console.log(`  (A) EXPORT dos Records        -> ${snapA.notes.length} notas, ${snapA.highlights.length} marcações, plano ${snapA.planProgress.planId}(${snapA.planProgress.completed})`);
  console.log('  (B) ROUND-TRIP               -> export → limpar → import → estado IDÊNTICO');
  console.log('  (C) MERGE determinístico     -> união por referência (import vence), progresso max/LWW');
  console.log('  (D) import inválido/irreal   -> REJEITADO sem corromper o estado');
  console.log('  (E) re-import                -> IDEMPOTENTE (no-op: 0/0/false)');
  console.log(`  ${marker}`);
  console.log('  ANTI-ALUCINAÇÃO: só referência canônica do core no snapshot; NENHUM texto bíblico/sessão/chave.');

  assert.match(marker, /roundtrip=ok/, 'marcador prova round-trip');
  assert.match(marker, /idempotent=ok/, 'marcador prova idempotência');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
