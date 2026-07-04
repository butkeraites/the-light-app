// app/web/__browser__/assertions.mjs — F6.1 + F6.2 (harness de smoke em browser REAL)
//
// Asserções por FLUXO exercitadas no browser REAL (Chrome via puppeteer-core), em AMBOS os
// alvos (`--target=dev` e `--target=dist`). A F6.1 provou o fluxo ABRIR CAPÍTULO; a F6.2
// adiciona os DEMAIS fluxos críticos que hoje só têm cobertura headless/in-memory e nunca
// foram exercitados no runtime real (OPFS, DOM, download/upload via Blob/<input>, rede de IA):
//
//   1. paralelo/2ª tradução  — "lado a lado" (KJV + Almeida), 2º getChapter via reading.web.
//   2. busca + xref          — /search (FTS5 real) + referências cruzadas (sqlite-xref.web).
//   3. notas persistem        — nota+marcação em João 3:16, page.reload(), persiste (OPFS real);
//                               repetido num BrowserContext ANÔNIMO (comportamento gracioso).
//   4. planos persistem       — iniciar plano, marcar dia, reload, progresso persiste (OPFS).
//   5. export+import round-trip— export (Blob/createObjectURL/<a>.click) capturado por CDP
//                               (Page.setDownloadBehavior) e re-injetado no <input> oculto
//                               (pickJsonFileWeb) via fileChooser — contagens fazem round-trip.
//   6. IA reachability        — Ask com chave DUMMY (JAMAIS real); intercepta a request de saída
//                               p/ o provedor e REGISTRA o estado (401=CORS ok · CORS-wall=R7).
//
// Cada fluxo recebe um `ctx` (ver smoke.browser.mjs) e LANÇA em falha. O driver imprime
// `TLA_WEB_<name> ok|FAIL` por fluxo e sai != 0 se qualquer um lançar.
//
// ANTI-FLAKE: NÃO usamos `setTimeout` fixo p/ "esperar renderizar". Esperamos SINAIS ESTÁVEIS
// de DOM via `page.waitForFunction` — texto/elemento PRESENTE **e** spinner AUSENTE. O estouro
// do timeout É, ele próprio, a falha "spinner infinito / travou em silêncio".
//
// REGRA DURA: só código de teste/harness aqui. Se um fluxo revela um estado REAL de produto
// (ex.: IA CORS-wall p/ Anthropic, ESPERADO até a F6.8), ele REGISTRA o estado e passa — só um
// TRAVAMENTO SILENCIOSO (spinner infinito / falha engolida) vira vermelho.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Assinaturas de pageerror que denunciam a quebra de leitura web (F5.36/38/39). */
const FORBIDDEN_PAGEERROR = /SQLiteESMFactory|openReadingDbWeb|initAsync|Invalid base URL/;

/** react-native-web renderiza `ActivityIndicator` como `role="progressbar"`. */
const SPINNER_SELECTOR = '[role="progressbar"]';

const NAV_TIMEOUT_MS = 120000;
const RENDER_TIMEOUT_MS = 60000;
const ACTION_TIMEOUT_MS = 45000;
const AI_TIMEOUT_MS = 60000;
const DOWNLOAD_TIMEOUT_MS = 30000;

// Texto VERBATIM do store local (anti-alucinação) — usado como sinal de renderização real.
const KJV_JOHN_3_16 = 'For God so loved the world';
const ALM_JOHN_3_16 = 'Porque Deus amou o mundo de tal maneira';
const KJV_MATT_1_1 = 'The book of the generation of Jesus Christ';

// Provedores de IA reais e seus hosts de saída. `ollama` é local (sem host remoto) → fora.
const AI_HOSTS = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  gemini: 'generativelanguage.googleapis.com',
};
// Chave DUMMY — JAMAIS um segredo real. Só serve p/ disparar a request e observar o alcance.
const DUMMY_KEY = 'tla-smoke-DUMMY-not-a-real-key-0000000000';

// ── helpers de baixo nível ───────────────────────────────────────────────────────────────

const q = (testId) => `[data-testid="${testId}"]`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function bodyText(page) {
  try {
    return await page.evaluate(() => (document.body ? document.body.innerText : ''));
  } catch {
    return '';
  }
}

/** Espera o `body.innerText` conter TODAS as `needles` (com/sem spinner). Timeout = falha. */
async function waitBodyIncludes(page, needles, { timeout = RENDER_TIMEOUT_MS, noSpinner = true } = {}) {
  const arr = Array.isArray(needles) ? needles : [needles];
  await page.waitForFunction(
    (ns, spinnerSel, requireNoSpin) => {
      const txt = document.body ? document.body.innerText : '';
      const all = ns.every((n) => txt.includes(n));
      const spinning = document.querySelector(spinnerSel) != null;
      return all && (!requireNoSpin || !spinning);
    },
    { timeout, polling: 300 },
    arr,
    SPINNER_SELECTOR,
    noSpinner,
  );
}

/**
 * Espera um seletor estar ANEXADO ao DOM (não exige visibilidade estrita). Conteúdo dentro de
 * `Modal`/`ScrollView` (RNW) pode ser clipado (área visível 0) e ainda assim ser interativo; a
 * visibilidade real é asseverada pelos `waitForFunction` de CONTEÚDO, não por este utilitário.
 */
async function waitSel(page, sel, timeout = ACTION_TIMEOUT_MS) {
  return page.waitForSelector(sel, { timeout });
}

/** Espera um seletor SUMIR do DOM. */
async function waitGone(page, sel, timeout = ACTION_TIMEOUT_MS) {
  await page.waitForFunction((s) => document.querySelector(s) == null, { timeout, polling: 200 }, sel);
}

/**
 * Clica um seletor: espera anexar, rola até o centro e clica via `el.click()` SINTÉTICO (não o
 * mouse real do CDP). Motivo: `page.click`/`ElementHandle.click` dispara `clickablePoint`
 * (`Runtime.callFunctionOn`) que TRAVA até o `protocolTimeout` (3 min) em alguns `Pressable`
 * do react-native-web — o click sintético dispara o `onPress` do RNW de forma confiável e
 * INSTANTÂNEA (verificado no runtime real). Re-resolve o handle e tenta de novo se um
 * re-render/navegação transitória invalidar o handle ("context destroyed"/"detached").
 */
async function clickSel(page, sel, timeout = ACTION_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const h = await page.waitForSelector(sel, { timeout: Math.max(1000, deadline - Date.now()) });
      await h.evaluate((el) => {
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
        if (typeof el.click === 'function') el.click();
      });
      return h;
    } catch (err) {
      lastErr = err;
      const msg = err && err.message ? err.message : String(err);
      // Re-render/navegação transitória invalidou o handle → re-resolve e tenta de novo.
      if (/context was destroyed|detached|Node is either|Cannot find context/i.test(msg)) {
        await sleep(200);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`clickSel: não foi possível clicar "${sel}" em ${timeout}ms`);
}

/**
 * Foca um input/textarea e digita `text` por cima do conteúdo atual. Usa `focus()`+`select()`
 * via JS (não `click`), pois inputs dentro de `Modal` (RNW) podem não ter ponto clicável durante
 * a animação de slide — `ElementHandle.type` foca via JS, então dispensa o clique.
 */
async function typeSel(page, sel, text, timeout = ACTION_TIMEOUT_MS) {
  const h = await waitSel(page, sel, timeout);
  await h.evaluate((el) => {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    if (typeof el.focus === 'function') el.focus();
    if (typeof el.select === 'function') el.select();
  });
  await h.type(text, { delay: 15 });
  return h;
}

/** Coleta diagnósticos e LANÇA se houver pageerror/URL-error PROIBIDO (quebra de leitura). */
async function assertNoForbidden(ctx, label) {
  const diag = await ctx.collectDiagnostics();
  const offending = [
    ...diag.pageErrors.filter((m) => FORBIDDEN_PAGEERROR.test(m)).map((m) => `pageerror: ${m}`),
    ...diag.urlErrs
      .filter((u) => FORBIDDEN_PAGEERROR.test(u.msg))
      .map((u) => `URL(${JSON.stringify(u.args)}): ${u.msg}`),
  ];
  if (offending.length) {
    throw new Error(`${label}: pageerror PROIBIDO detectado:\n  ${offending.join('\n  ')}`);
  }
}

/** Navega p/ `routePath` no alvo corrente, resetando diagnósticos + o wrap de URL. */
async function goto(ctx, routePath) {
  const { page, baseUrl } = ctx;
  ctx.resetDiagnostics();
  try {
    await page.evaluate(() => {
      window.__urlErrs = [];
    });
  } catch {
    /* página nova ainda sem documento — o wrap reinstala no próximo navigate */
  }
  const url = baseUrl + routePath;
  ctx.log(`  navegando ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 0 (F6.1): ABRIR CAPÍTULO — texto VERBATIM do store, sem spinner infinito, sem quebra.
// ═══════════════════════════════════════════════════════════════════════════════════════

async function openChapter(ctx, { path: routePath, expected }) {
  await goto(ctx, routePath);
  try {
    await waitBodyIncludes(ctx.page, expected);
  } catch {
    const body = (await bodyText(ctx.page)).replace(/\s+/g, ' ').slice(0, 400);
    const spinning = await ctx.page.evaluate((s) => document.querySelector(s) != null, SPINNER_SELECTOR);
    const diag = await ctx.collectDiagnostics();
    throw new Error(
      `${routePath}: em ${RENDER_TIMEOUT_MS}ms o texto "${expected}" NÃO apareceu` +
        (spinning ? ' (SPINNER INFINITO ainda presente)' : '') +
        `.\n  body[0..400]="${body}"` +
        diag.summary,
    );
  }
  await assertNoForbidden(ctx, routePath);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 1 (F6.2): PARALELO / 2ª TRADUÇÃO — "lado a lado" (KJV + Almeida) no MESMO capítulo.
// ═══════════════════════════════════════════════════════════════════════════════════════

async function runParallel(ctx) {
  const { page } = ctx;
  await goto(ctx, '/read/43/3');
  await waitBodyIncludes(page, KJV_JOHN_3_16); // KJV (primária) renderiza
  await clickSel(page, q('parallel-toggle')); // ativa lado a lado (2ª tradução = alm1911)
  try {
    // Ambas as traduções presentes AO MESMO TEMPO, sem spinner (2º getChapter concluiu).
    await waitBodyIncludes(page, [KJV_JOHN_3_16, ALM_JOHN_3_16]);
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400);
    const diag = await ctx.collectDiagnostics();
    throw new Error(
      `parallel: em ${RENDER_TIMEOUT_MS}ms o texto Almeida "${ALM_JOHN_3_16}" não apareceu junto do KJV ` +
        `(2ª tradução não carregou / spinner infinito).\n  body[0..400]="${body}"` +
        diag.summary,
    );
  }
  await assertNoForbidden(ctx, 'parallel');
  ctx.log('  [parallel] KJV + Almeida renderizados lado a lado (2º getChapter real)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 2 (F6.2): BUSCA + XREF — /search (FTS5 real) + referências cruzadas de um versículo.
// ═══════════════════════════════════════════════════════════════════════════════════════

async function runSearchXref(ctx) {
  const { page } = ctx;
  await goto(ctx, '/search');
  await waitSel(page, q('search-input'));

  // (a) "God" retorna ≥1 hit (a busca REAL funciona no runtime real).
  await typeSel(page, q('search-input'), 'God');
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="hit-"]').length >= 1,
      { timeout: RENDER_TIMEOUT_MS, polling: 300 },
    );
  } catch {
    const diag = await ctx.collectDiagnostics();
    throw new Error(`search: "God" não retornou nenhum hit em ${RENDER_TIMEOUT_MS}ms.${diag.summary}`);
  }
  const godHits = await page.evaluate(() => document.querySelectorAll('[data-testid^="hit-"]').length);
  ctx.log(`  [search] "God" → ${godHits} hits`);

  // (b) João 3:16 é ENCONTRÁVEL: uma query específica ("God so loved the world") o traz ao topo
  //     (BM25 não coloca João 3:16 no top-20 de "God" sozinho — verificado no store). O hit é
  //     identificado pelo testID canônico `hit-kjv-43-3-16` (independe de idioma/nome do livro).
  await typeSel(page, q('search-input'), 'God so loved the world');
  try {
    await waitSel(page, q('hit-kjv-43-3-16'), RENDER_TIMEOUT_MS);
  } catch {
    const diag = await ctx.collectDiagnostics();
    throw new Error(`search: João 3:16 (hit-kjv-43-3-16) não apareceu nos resultados.${diag.summary}`);
  }

  // (c) abre o hit → leitor com âncora (?verse=16) → abre o painel do versículo → XREFS renderizam.
  await clickSel(page, q('hit-kjv-43-3-16'));
  await waitBodyIncludes(page, KJV_JOHN_3_16);
  await clickSel(page, q('verse-16')); // abre ReaderVersePanel (nota + marcação + xref)
  await waitSel(page, q('note-input')); // painel aberto (nota carregada)
  try {
    await page.waitForFunction(
      () => document.querySelector('[data-testid^="xref-"]') != null,
      { timeout: RENDER_TIMEOUT_MS, polling: 300 },
    );
  } catch {
    const diag = await ctx.collectDiagnostics();
    throw new Error(`xref: nenhuma referência cruzada de João 3:16 renderizou (sqlite-xref.web).${diag.summary}`);
  }
  const xrefCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="xref-"]').length);
  await clickSel(page, q('verse-panel-close'));
  await assertNoForbidden(ctx, 'search-xref');
  ctx.log(`  [search-xref] João 3:16 encontrado; ${xrefCount} referências cruzadas renderizadas`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 3 (F6.2): NOTAS PERSISTEM no reload (OPFS real) + caso ANÔNIMO gracioso.
// ═══════════════════════════════════════════════════════════════════════════════════════

const NOTE_BODY = 'TLA smoke — nota de teste em João 3:16';

/** Abre João 3:16, cria uma NOTA (e marcação amarela) e espera resolver (spinner some). */
async function addNoteAndHighlight(page, { withHighlight = true } = {}) {
  await clickSel(page, q('verse-16'));
  await waitSel(page, q('note-input'));
  await typeSel(page, q('note-input'), NOTE_BODY);
  await clickSel(page, q('note-save'));
  // Terminal gracioso do save: o marcador de nota (✎) aparece no versículo (leitura OPFS de
  // volta) OU um erro VISÍVEL no painel. Nunca um spinner infinito.
  const outcome = await waitNoteTerminal(page, ACTION_TIMEOUT_MS);
  if (withHighlight && outcome === 'persisted') {
    await clickSel(page, q('highlight-yellow'));
    // Espera o save da marcação resolver (botão de nota re-habilita quando `busy` cai).
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && el.getAttribute('aria-disabled') !== 'true';
      },
      { timeout: ACTION_TIMEOUT_MS, polling: 200 },
      q('note-save'),
    );
  }
  return outcome;
}

/**
 * Espera o save da nota atingir estado TERMINAL gracioso, sem sleep fixo:
 *   - 'persisted' → o versículo 16 mostra o marcador ✎ (nota lida de volta do OPFS);
 *   - 'error'     → um erro VISÍVEL apareceu no painel/tela;
 *   - lança       → nenhum dos dois em `timeout` (travamento silencioso / spinner infinito).
 */
async function waitNoteTerminal(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const verse = document.querySelector('[data-testid="verse-16"]');
      const persisted = verse != null && (verse.textContent || '').includes('✎');
      const body = document.body ? document.body.innerText : '';
      const errorVisible = /Não foi possível|Could not|Failed|Erro|Error|quota|OPFS/i.test(body);
      const spinning = document.querySelector('[role="progressbar"]') != null;
      if (persisted) return 'persisted';
      if (errorVisible && !spinning) return 'error';
      return null;
    });
    if (state) return state;
    await sleep(200);
  }
  throw new Error(`notes: save da nota não atingiu estado terminal em ${timeout}ms (TRAVAMENTO SILENCIOSO)`);
}

async function runNotesPersist(ctx) {
  const { page } = ctx;

  // ── (A) contexto PRINCIPAL: cria nota+marcação, RELOAD, persiste no OPFS real. ──
  await goto(ctx, '/read/43/3');
  await waitBodyIncludes(page, KJV_JOHN_3_16);
  const outcome = await addNoteAndHighlight(page, { withHighlight: true });
  if (outcome !== 'persisted') {
    throw new Error(`notes(principal): a nota não persistiu no OPFS (estado="${outcome}")`);
  }

  // RELOAD real: a nota (OPFS) deve sobreviver → o versículo 16 volta com o marcador ✎.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await waitBodyIncludes(page, KJV_JOHN_3_16);
  try {
    await page.waitForFunction(
      () => {
        const v = document.querySelector('[data-testid="verse-16"]');
        return v != null && (v.textContent || '').includes('✎');
      },
      { timeout: RENDER_TIMEOUT_MS, polling: 300 },
    );
  } catch {
    const diag = await ctx.collectDiagnostics();
    throw new Error(
      `notes(principal): após page.reload() a nota de João 3:16 NÃO persistiu (marcador ✎ ausente) — ` +
        `OPFS não sobreviveu ao reload.${diag.summary}`,
    );
  }
  await assertNoForbidden(ctx, 'notes-persist');
  ctx.log('  [notes] nota+marcação em João 3:16 persistiram no reload real (OPFS)');

  // ── (B) contexto ANÔNIMO (OPFS isolado): comportamento GRACIOSO sob quota restrita (F5.38). ──
  // Nunca deve travar em silêncio: ou persiste, ou mostra um erro VISÍVEL.
  const incognito = await ctx.browser.createBrowserContext();
  try {
    const ipage = await incognito.newPage();
    await ipage.evaluateOnNewDocument(ctx.installUrlWrap);
    await ipage.goto(ctx.baseUrl + '/read/43/3', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await waitBodyIncludes(ipage, KJV_JOHN_3_16);
    let incognitoOutcome;
    try {
      incognitoOutcome = await addNoteAndHighlight(ipage, { withHighlight: false });
    } catch (err) {
      // O único jeito de `addNoteAndHighlight` lançar é o timeout do estado terminal → hang silencioso.
      throw new Error(`notes(anônimo): TRAVAMENTO SILENCIOSO no save da nota — ${err && err.message ? err.message : err}`);
    }
    // Ambos os desfechos são GRACIOSOS (o teste falharia só no hang, já tratado acima).
    ctx.log(`  [notes] contexto anônimo (OPFS isolado): desfecho GRACIOSO="${incognitoOutcome}" (sem hang silencioso)`);
  } finally {
    await incognito.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 4 (F6.2): PLANOS PERSISTEM — iniciar plano, marcar dia, reload, progresso persiste.
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Extrai `{completed,total}` do rótulo de progresso ("N of M days" / "N de M dias"). */
async function readPlanCompleted(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      for (const el of els) {
        const txt = (el.textContent || '').trim();
        const m = /^(\d+)\s+(?:of|de)\s+(\d+)\s+(?:days|dias)/.exec(txt);
        if (m) return { completed: Number(m[1]), total: Number(m[2]) };
      }
      return null;
    });
    if (found) return found;
    await sleep(200);
  }
  return null;
}

async function runPlansPersist(ctx) {
  const { page } = ctx;
  await goto(ctx, '/plans');

  // Estado de escolha (userDataDir limpo → sem plano ativo): inicia o 1º plano do catálogo.
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid^="start-plan-"]') != null, {
      timeout: RENDER_TIMEOUT_MS,
      polling: 300,
    });
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 500);
    const spinning = await page.evaluate((s) => document.querySelector(s) != null, SPINNER_SELECTOR);
    const diag = await ctx.collectDiagnostics();
    throw new Error(
      `plans: seletor de planos (start-plan-*) não renderizou em ${RENDER_TIMEOUT_MS}ms` +
        (spinning ? ' (SPINNER ainda presente — boot travou?)' : '') +
        `.\n  body[0..500]="${body}"${diag.summary}`,
    );
  }
  await clickSel(page, '[data-testid^="start-plan-"]');

  // Plano ativo: o botão "Marcar dia como lido" aparece. Marca 1 dia.
  await waitSel(page, q('mark-day-done'));
  const before = await readPlanCompleted(page, ACTION_TIMEOUT_MS);
  if (!before) {
    throw new Error('plans: rótulo de progresso não apareceu após iniciar o plano.');
  }
  await clickSel(page, q('mark-day-done'));

  // Progresso avança p/ completed=1 (persistido no OPFS).
  const afterMark = await waitPlanCompleted(page, 1, ACTION_TIMEOUT_MS);
  if (!afterMark) {
    const diag = await ctx.collectDiagnostics();
    throw new Error(`plans: marcar 1 dia não refletiu completed=1 no rótulo de progresso.${diag.summary}`);
  }

  // RELOAD real: o progresso (OPFS via plans-fs.web) deve sobreviver → plano ativo + completed=1.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await waitSel(page, q('mark-day-done'), RENDER_TIMEOUT_MS); // active-plan view (não o chooser)
  const afterReload = await waitPlanCompleted(page, 1, RENDER_TIMEOUT_MS);
  if (!afterReload) {
    const diag = await ctx.collectDiagnostics();
    throw new Error(
      `plans: após page.reload() o progresso NÃO persistiu (esperado completed=1) — OPFS não sobreviveu.${diag.summary}`,
    );
  }
  // Reforço: o CHOOSER não deve estar presente (um plano segue ativo).
  const chooserBack = await page.evaluate(() => document.querySelector('[data-testid^="start-plan-"]') != null);
  if (chooserBack) {
    throw new Error('plans: após reload voltou ao seletor de planos (progresso perdido).');
  }
  await assertNoForbidden(ctx, 'plans-persist');
  ctx.log(`  [plans] plano iniciado + 1 dia marcado persistiram no reload real (completed=${afterReload.completed}/${afterReload.total})`);
}

/** Espera `completed` chegar a `target` (via rótulo de progresso). Retorna o par ou null. */
async function waitPlanCompleted(page, target, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const cur = await readPlanCompleted(page, 500);
    if (cur && cur.completed === target) return cur;
    await sleep(200);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 5 (F6.2): EXPORT + IMPORT round-trip — Blob/download (CDP) → <input> oculto (fresh device).
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Espera o download `filename` aparecer estável (sem `.crdownload`) em `dir`. */
async function waitForDownload(dir, filename, timeout) {
  const target = path.join(dir, filename);
  const deadline = Date.now() + timeout;
  let lastSize = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const partial = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.crdownload'));
    if (!partial && fs.existsSync(target)) {
      const size = fs.statSync(target).size;
      if (size > 0 && size === lastSize) {
        if (++stable >= 2) return target;
      } else {
        lastSize = size;
        stable = 0;
      }
    }
    await sleep(200);
  }
  const listing = fs.existsSync(dir) ? fs.readdirSync(dir).join(', ') : '(dir ausente)';
  throw new Error(`export: download "${filename}" não apareceu em ${timeout}ms (dir=[${listing}])`);
}

/** Abre a home → painel de sincronização (SyncSettings). */
async function openSyncPanel(page, baseUrl) {
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await clickSel(page, q('open-sync'));
  await waitSel(page, q('sync-export'));
}

/** Dispara o export e espera o estado "exportado"; devolve o arquivo baixado (via CDP). */
async function exportAndDownload(page, ctx, downloadDir, name) {
  await clickSel(page, q('sync-export')); // Blob → createObjectURL → <a download>.click()
  try {
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="sync-status"]');
        return el != null && /export(ed|ado)/i.test(el.textContent || '');
      },
      { timeout: ACTION_TIMEOUT_MS, polling: 300 },
    );
  } catch {
    const st = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sync-status"]');
      return el ? el.textContent || '' : '(sem sync-status)';
    });
    const diag = await ctx.collectDiagnostics();
    throw new Error(`export: estado "exportado" não apareceu. sync-status="${st}"${diag.summary}`);
  }
  return waitForDownload(downloadDir, name, DOWNLOAD_TIMEOUT_MS);
}

async function runExportImport(ctx) {
  const { page, baseUrl } = ctx;
  ctx.resetDiagnostics();

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tla-smoke-dl-'));
  const NAME = 'the-light-app-backup.json';
  try {
    // ── EXPORT no contexto PRINCIPAL (que já tem nota+marcação do fluxo de notas). ──
    await openSyncPanel(page, baseUrl);
    const client = await page.target().createCDPSession();
    // Preferimos Browser.setDownloadBehavior (moderno); fallback p/ Page.* (deprecado, amplo).
    try {
      await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
        eventsEnabled: true,
      });
    } catch {
      await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    }

    // Export #1 → arquivo real (Blob/CDP) com as contagens do OPFS atual (≥1 nota + ≥1 marcação).
    const file1 = await exportAndDownload(page, ctx, downloadDir, NAME);
    const snap1 = JSON.parse(fs.readFileSync(file1, 'utf8'));
    const nNotes = Array.isArray(snap1.notes) ? snap1.notes.length : 0;
    const nHls = Array.isArray(snap1.highlights) ? snap1.highlights.length : 0;
    if (nNotes < 1 || nHls < 1) {
      throw new Error(`export: arquivo exportado sem dados suficientes (notes=${nNotes}, highlights=${nHls}); esperado ≥1 de cada.`);
    }
    ctx.log(`  [export] backup baixado via Blob/CDP: notes=${nNotes}, highlights=${nHls}`);

    // Preserva o arquivo p/ re-injeção e LIBERA o nome (Chrome renomearia o 2º download).
    const importSrc = path.join(downloadDir, 'import-src.json');
    fs.copyFileSync(file1, importSrc);
    fs.rmSync(file1, { force: true });

    // ── IMPORT: re-injeta o arquivo no <input> OCULTO do SyncSettings (pickJsonFileWeb) via
    //    fileChooser — a ÚNICA cobertura desse caminho Blob/<input> do browser. Merge idempotente
    //    (o OPFS já tem os mesmos Records) → aceito, sem erro. ──
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: ACTION_TIMEOUT_MS }),
      clickSel(page, q('sync-import-file')),
    ]);
    await chooser.accept([importSrc]);
    try {
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="sync-status"]');
          if (el == null) return false;
          const txt = el.textContent || '';
          return /import(ed|ado)/i.test(txt) && !/Could not|Não foi possível/i.test(txt);
        },
        { timeout: ACTION_TIMEOUT_MS, polling: 300 },
      );
    } catch {
      const st = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="sync-status"]');
        return el ? el.textContent || '' : '(sem sync-status)';
      });
      throw new Error(`import: estado "importado" não apareceu (arquivo re-injetado no <input>). sync-status="${st}"`);
    }
    const importStatus = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sync-status"]');
      return el ? el.textContent || '' : '';
    });
    ctx.log(`  [import] arquivo re-injetado no <input> oculto e ACEITO (merge idempotente): "${importStatus.trim()}"`);

    // ── ROUND-TRIP de CONTAGENS: re-exporta e confere que N notas + M marcações sobreviveram
    //    intactas ao ciclo export → download → <input> → store → export. ──
    const file2 = await exportAndDownload(page, ctx, downloadDir, NAME);
    const snap2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
    const nNotes2 = Array.isArray(snap2.notes) ? snap2.notes.length : 0;
    const nHls2 = Array.isArray(snap2.highlights) ? snap2.highlights.length : 0;
    if (nNotes2 !== nNotes || nHls2 !== nHls) {
      throw new Error(
        `export-import: contagens NÃO fizeram round-trip. antes notes=${nNotes}/highlights=${nHls}; ` +
          `após ciclo notes=${nNotes2}/highlights=${nHls2}.`,
      );
    }
    ctx.log(
      `  [export-import] round-trip provado (Blob → download → <input> → store → export): ` +
        `notes ${nNotes}→${nNotes2}, highlights ${nHls}→${nHls2}`,
    );
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 6 (F6.2): IA REACHABILITY — Ask c/ chave DUMMY; registra o alcance por provedor.
//   401 = alcança o provedor (CORS ok) · CORS-wall = barrado (R7, esperado até F6.8).
//   Falha SÓ se o app TRAVAR / engolir a falha em silêncio.
// ═══════════════════════════════════════════════════════════════════════════════════════

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Espera o submit da IA atingir estado TERMINAL (sem sleep fixo). Detecta hang/silêncio. */
async function waitAiTerminal(page, provider, net, timeout) {
  const deadline = Date.now() + timeout;
  let sawBusy = false;
  while (Date.now() < deadline) {
    const busy = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return el.querySelector('[role="progressbar"]') != null || el.getAttribute('aria-disabled') === 'true';
    }, q('ask-submit'));
    if (busy) sawBusy = true;
    const netDone = net[provider].responses.length > 0 || net[provider].failures.length > 0;
    if (!busy && (sawBusy || netDone)) {
      return { hung: false, netDone };
    }
    await sleep(200);
  }
  const stillBusy = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    return el.querySelector('[role="progressbar"]') != null || el.getAttribute('aria-disabled') === 'true';
  }, q('ask-submit'));
  const netDone = net[provider].responses.length > 0 || net[provider].failures.length > 0;
  return { hung: stillBusy, netDone };
}

/** True se há um desfecho VISÍVEL da IA (erro OU interpretação) — descarta "swallow silencioso". */
async function aiOutcomeVisible(page) {
  return page.evaluate(() => {
    const interp = document.querySelector('[data-testid="ask-interpretation-text"]');
    if (interp && (interp.textContent || '').trim().length > 0) return true;
    const body = document.body ? document.body.innerText : '';
    return /respondeu HTTP|Failed to fetch|Load failed|NetworkError|Could not complete|Não foi possível|Configure a chave|refus|vazia/i.test(
      body,
    );
  });
}

function classifyReach(responses, failures) {
  if (responses.length > 0 && failures.length === 0) {
    return `reached provider (HTTP ${responses.join('/')}) — CORS ok`;
  }
  if (responses.length > 0 && failures.length > 0) {
    return `reached provider at network (HTTP ${responses.join('/')}) but CORS-blocked from JS (net: ${failures.join('/')})`;
  }
  if (failures.length > 0) {
    return `CORS-wall / blocked (net: ${failures.join('/')})`;
  }
  return 'no network observed (app-level resolution)';
}

async function runAiReachability(ctx) {
  const { page } = ctx;
  const net = {
    anthropic: { responses: [], failures: [] },
    openai: { responses: [], failures: [] },
    gemini: { responses: [], failures: [] },
  };
  const onResp = (res) => {
    const h = hostOf(res.url());
    for (const [p, host] of Object.entries(AI_HOSTS)) if (h === host) net[p].responses.push(res.status());
  };
  const onFail = (req) => {
    const h = hostOf(req.url());
    for (const [p, host] of Object.entries(AI_HOSTS)) {
      if (h === host) net[p].failures.push((req.failure() && req.failure().errorText) || 'failed');
    }
  };
  page.on('response', onResp);
  page.on('requestfailed', onFail);

  const results = {};
  const problems = [];
  try {
    await goto(ctx, '/read/43/3');
    await waitBodyIncludes(page, KJV_JOHN_3_16);
    await clickSel(page, q('verse-16'));
    await waitSel(page, q('verse-ask'));
    await clickSel(page, q('verse-ask')); // abre o ReaderAskPanel
    await waitSel(page, q('ask-question-input'));
    await typeSel(page, q('ask-question-input'), 'What does this verse mean?');

    for (const provider of ['anthropic', 'openai', 'gemini']) {
      await clickSel(page, q(`ask-provider-${provider}`));
      // Provedor real sem chave → aparece o campo de chave. Espera o bloco de chave montar
      // (o chip é async no React → o bloco só renderiza no próximo commit), insere a DUMMY e salva.
      await page
        .waitForSelector(q('ask-key-input'), { timeout: ACTION_TIMEOUT_MS })
        .catch(() => null);
      const needsKey = await page.$(q('ask-key-input'));
      if (needsKey) {
        await typeSel(page, q('ask-key-input'), DUMMY_KEY);
        try {
          await page.waitForSelector(q('ask-key-save'), { timeout: ACTION_TIMEOUT_MS });
        } catch {
          const ids = await page.evaluate(() =>
            Array.from(document.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid')),
          );
          throw new Error(`ai(${provider}): ask-key-save não montou. testIDs presentes: ${ids.join(', ')}`);
        }
        await clickSel(page, q('ask-key-save'));
        await waitGone(page, q('ask-key-input'), ACTION_TIMEOUT_MS);
      }
      net[provider].responses.length = 0;
      net[provider].failures.length = 0;
      await clickSel(page, q('ask-submit'));
      const term = await waitAiTerminal(page, provider, net, AI_TIMEOUT_MS);
      const visible = await aiOutcomeVisible(page);
      const reach = classifyReach(net[provider].responses, net[provider].failures);
      results[provider] = { ...term, visible, reach };
      ctx.log(`  [ai] ${provider}: ${reach}` + (term.hung ? ' — HANG (busy nunca resolveu)' : '') + (visible ? ' · desfecho visível' : ''));
      // Falha SÓ em travamento silencioso: hang, OU resolveu sem rede E sem desfecho visível (swallow).
      if (term.hung) {
        problems.push(`${provider}: TRAVOU (spinner/submit nunca resolveu em ${AI_TIMEOUT_MS}ms)`);
      } else if (!term.netDone && !visible) {
        problems.push(`${provider}: engoliu a falha em SILÊNCIO (sem request e sem erro/interpretação visível)`);
      }
    }
  } finally {
    page.off('response', onResp);
    page.off('requestfailed', onFail);
  }

  // Marcador de regressão p/ a F6.8 (âncora do estado observado por provedor).
  const summary = Object.entries(results)
    .map(([p, r]) => `${p}=[${r.reach}]`)
    .join(' · ');
  ctx.log(`  [ai] REACHABILITY (âncora F6.8): ${summary}`);

  if (problems.length) {
    throw new Error(`ai-reachability: travamento silencioso detectado:\n  ${problems.join('\n  ')}`);
  }
  // CORS-wall (ex.: Anthropic) é ESPERADO até a F6.8 → registrado, NÃO falha o fluxo.
}

// ═══════════════════════════════════════════════════════════════════════════════════════

export const flows = [
  {
    name: 'open-chapter',
    async run(ctx) {
      // Mateus 1 (KJV) e João 3 (KJV) — texto VERBATIM do store local (anti-alucinação).
      await openChapter(ctx, { path: '/read/40/1', expected: KJV_MATT_1_1 });
      await openChapter(ctx, { path: '/read/43/3', expected: KJV_JOHN_3_16 });
    },
  },
  { name: 'parallel', run: runParallel },
  { name: 'search-xref', run: runSearchXref },
  { name: 'notes-persist', run: runNotesPersist },
  { name: 'plans-persist', run: runPlansPersist },
  { name: 'export-import', run: runExportImport },
  { name: 'ai-reachability', run: runAiReachability },
];
