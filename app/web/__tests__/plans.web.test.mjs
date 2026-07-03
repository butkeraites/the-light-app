// plans.web.test.mjs — F5.10 (molde notes.web.test.mjs F1.16)
//
// PROVA HEADLESS (node, sem browser/Expo/rede/chave) da PARIDADE WEB dos PLANOS DE
// LEITURA. Exercita o MESMO código de PRODUÇÃO que a tela `/plans` usa no browser:
//   - GERAÇÃO cfg-free do core no wasm (`listReadingPlans`/`readingPlanDay`/
//     `readingPlanDayIndex`) — os 3 planos, os dias e as refs (capítulos inteiros) vêm
//     SEMPRE do core (zero-drift nativo↔web; NADA de chunking/índice reimplementado em TS).
//   - PROGRESSO em OPFS (`../plans-fs.web`) sobre um `UserDataDir` EM MEMÓRIA (mock do OPFS —
//     `Map<path, content>`). Em runtime no browser o backend é OPFS
//     (`../userdata-opfs.web.ts`); aqui node injeta o mesmo `UserDataDir` em memória, rodando
//     as MESMAS funções de produção (mesmo isolamento da F1.16).
//
// O FORMATO em disco (`reading-plans/active.json` = `{plan_id, start_date, completed}` snake_case,
// pretty 2-espaços) ESPELHA `the_light_core::userdata::plans::PlanStore` (rev `225b8c9`). O
// `plan_id` é validado contra o CATALOG do core (wasm) ANTES de gravar (anti-alucinação).
//
// Anti-alucinação: as constantes verbatim abaixo existem SÓ na ASSERÇÃO do teste — nunca no
// código de produto. Os planos/dias/refs vêm do core; o `plan_id`/`completed` vêm da
// persistência real. PARIDADE com o `TLA_PLANS` nativo (F5.7): mesmo vertical
// lista→iniciar→dia de hoje→marcar→releitura, mesmo formato `active.json`.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'plans-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `plans-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// `UserDataDir` EM MEMÓRIA — mock do OPFS para a prova node. Backing store é um
// `Map<relPath, content>` COMPARTILHÁVEL: reabrir um novo handle sobre o MESMO Map prova
// persistência (≡ reload do browser relendo o OPFS). Implementa a MESMA interface que
// `userdata-opfs.web.ts` (readFile/writeFile/deleteFile/listDir).
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

/** Data de hoje ISO `YYYY-MM-DD` no fuso LOCAL (mesma convenção da tela de planos). */
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const PLAN_ID = 'gospels';

async function main() {
  const {
    init,
    mod,
    listReadingPlans,
    readingPlanDay,
    readingPlanDayIndex,
    startPlanFs,
    setCompletedFs,
    readActivePlanFs,
    clearActivePlanFs,
  } = await loadBundle();

  // (1) Fronteira Rust no wasm — a GERAÇÃO cfg-free (F5.10) roda no wasm, não em stub.
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  // (2) GERAÇÃO: os 3 planos do CATALOG do core (nomes PT VERBATIM, dias do core). Prova que
  //     o web gera IDÊNTICO ao nativo (zero-drift) — os valores esperados são só da ASSERÇÃO.
  const plans = listReadingPlans();
  assert.equal(plans.length, 3, 'os 3 planos do core (annual + nt + gospels)');
  const byId = new Map(plans.map((p) => [p.id, p]));
  assert.equal(byId.get('annual')?.days, 365, 'annual = 365 dias (do core)');
  assert.equal(byId.get('nt')?.days, 90, 'nt = 90 dias (do core)');
  assert.equal(byId.get('gospels')?.days, 30, 'gospels = 30 dias (do core)');
  // Nomes PT VERBATIM do CATALOG do core (via wasm) — prova zero-drift dos nomes.
  assert.equal(byId.get('annual')?.name, 'Bíblia em 1 ano', 'nome PT do core (annual)');
  assert.equal(byId.get('nt')?.name, 'Novo Testamento em 90 dias', 'nome PT do core (nt)');
  assert.equal(byId.get('gospels')?.name, 'Evangelhos em 30 dias', 'nome PT do core (gospels)');
  const days = byId.get(PLAN_ID).days;

  // (3) DIA 0 de gospels: refs = capítulos inteiros REAIS do core; começa em Mateus 1.
  const day0 = readingPlanDay(PLAN_ID, 0);
  assert.ok(day0.references.length > 0, 'dia 0 tem referências (capítulos inteiros)');
  assert.ok(day0.label.length > 0, 'dia 0 tem rótulo legível (PT)');
  const first = day0.references[0];
  assert.equal(first.book, 40, 'primeiro livro = Mateus (40)');
  assert.equal(first.chapter, 1, 'primeiro capítulo = 1');
  assert.equal(first.verses.tag, 'WholeChapter', 'referência = capítulo inteiro');

  // Plano desconhecido / dia fora do intervalo → vazio (sem throw), herdado do core.
  assert.deepEqual(readingPlanDay('does-not-exist', 0).references, [], 'plano desconhecido → vazio');
  assert.deepEqual(readingPlanDay(PLAN_ID, 10_000).references, [], 'dia fora do intervalo → vazio');

  // (4) PROGRESSO em OPFS (memory dir). Vertical: iniciar → dia de hoje → marcar → releitura.
  const store = new Map();
  const dir = makeMemoryDir(store);

  const start = todayISO();
  const progress = await startPlanFs(dir, PLAN_ID, start);
  assert.equal(progress.planId, PLAN_ID, 'start devolve o plano ativo');
  assert.equal(progress.completed, 0, 'start grava completed=0');
  assert.equal(progress.startDate, start, 'start guarda a start_date ISO');

  // (4a) FORMATO em disco: `reading-plans/active.json` snake_case, pretty 2-espaços.
  const rawJson = store.get('reading-plans/active.json');
  assert.ok(rawJson != null, 'gravou em reading-plans/active.json (layout do core)');
  const parsed = JSON.parse(rawJson);
  assert.deepEqual(
    parsed,
    { plan_id: 'gospels', start_date: start, completed: 0 },
    'active.json = {plan_id, start_date, completed} (snake_case, ordem do core)',
  );
  assert.match(rawJson, /^\{\n {2}"plan_id":/, 'JSON pretty com 2 espaços (espelha to_string_pretty)');

  // (4b) DIA DE HOJE: índice 0-based PELO CORE (início = hoje → 0). Sem cálculo em TS.
  const todayIndex = readingPlanDayIndex(progress.startDate, todayISO(), days);
  assert.equal(todayIndex, 0, 'today_index = 0 (início = hoje, clamp do core)');

  // (4c) MARCAR CONCLUÍDO: avança 1 dia, persiste.
  const advanced = await setCompletedFs(dir, progress.completed + 1);
  assert.equal(advanced.completed, 1, 'set completed = 1');

  // (4d) PERSISTÊNCIA: 2ª leitura INDEPENDENTE do MESMO backing store (novo handle) ≡ reload.
  const dir2 = makeMemoryDir(store);
  const reloaded = await readActivePlanFs(dir2);
  const persisted =
    reloaded != null && reloaded.planId === PLAN_ID && reloaded.completed === 1;
  assert.ok(persisted, 'persistência: plano + completed reencontrados num novo handle');

  // (4e) CLEAR idempotente: true (havia), depois false (não há).
  assert.equal(await clearActivePlanFs(dir2), true, 'clear existente = true');
  assert.equal(await clearActivePlanFs(dir2), false, 'clear ausente = false (idempotente)');
  assert.equal(await readActivePlanFs(dir2), undefined, 'sem plano ativo após clear');

  // (5) ANTI-ALUCINAÇÃO: plan_id fora do CATALOG do core → LANÇA, SEM gravar (mesma msg do nativo).
  const cleanStore = new Map();
  const cleanDir = makeMemoryDir(cleanStore);
  await assert.rejects(
    () => startPlanFs(cleanDir, 'does-not-exist', todayISO()),
    /plano de leitura desconhecido/,
    'plan_id inválido é rejeitado (validado contra o CATALOG do core)',
  );
  assert.equal(cleanStore.size, 0, 'plan_id inválido NÃO grava nada (sem I/O)');

  // (5a) start_date não-ISO → LANÇA (validado pelo CORE via reading_plan_day_index), sem gravar.
  await assert.rejects(
    () => startPlanFs(cleanDir, PLAN_ID, 'not-a-date'),
    'start_date não-ISO é rejeitada (parse NaiveDate do core)',
  );
  assert.equal(cleanStore.size, 0, 'start_date inválida NÃO grava nada');

  // (6) Marcador determinístico (paralelo ao `TLA_PLANS` nativo da F5.7) — do RETORNO REAL.
  const marker = `WEB_PLANS plan_id=${JSON.stringify(progress.planId)} days=${days} today_index=${todayIndex} completed=${advanced.completed} persisted=${persisted}`;

  console.log('PASS — planos web (geração cfg-free/wasm + progresso OPFS em memória, formato do core):');
  console.log(`  geração (3 planos)          -> annual/nt/gospels, dias 365/90/30, nomes PT do core`);
  console.log(`  dia 0 de gospels            -> Mateus 1 (capítulo inteiro), rótulo não-vazio`);
  console.log(`  active.json (OPFS)          -> {plan_id,start_date,completed} snake_case pretty 2sp`);
  console.log(`  vertical iniciar→marcar     -> completed 0 -> 1 (persistido)`);
  console.log(`  PERSISTÊNCIA (novo handle)  -> plano + completed reencontrados`);
  console.log(`  clear idempotente           -> true, depois false`);
  console.log(`  plan_id inválido            -> rejeitado (CATALOG do core), sem I/O`);
  console.log(`  ${marker}`);
  console.log(
    '  ZERO-DRIFT: geração IDÊNTICA ao nativo (core/wasm); formato active.json IGUAL ao do core.',
  );

  assert.match(marker, /persisted=true/, 'marcador deve provar persisted=true');
  assert.match(marker, /today_index=0/, 'marcador deve provar today_index=0');
  assert.equal(advanced.completed, 1, 'completed=1 no fim (do retorno real)');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
