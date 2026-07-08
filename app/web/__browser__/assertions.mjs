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
//                               p/ o provedor e ASSEVERA o alcance (401=CORS ok). F6.8/ADR-0058:
//                               a âncora FLIPOU — Anthropic passou de CORS-wall a ALCANÇADA (header
//                               opt-in de browser); anthropic/openai/gemini devem estar alcançados.
//
// Cada fluxo recebe um `ctx` (ver smoke.browser.mjs) e LANÇA em falha. O driver imprime
// `TLA_WEB_<name> ok|FAIL` por fluxo e sai != 0 se qualquer um lançar.
//
// ANTI-FLAKE: NÃO usamos `setTimeout` fixo p/ "esperar renderizar". Esperamos SINAIS ESTÁVEIS
// de DOM via `page.waitForFunction` — texto/elemento PRESENTE **e** spinner AUSENTE. O estouro
// do timeout É, ele próprio, a falha "spinner infinito / travou em silêncio".
//
// REGRA DURA: só código de teste/harness aqui. Um fluxo revela o estado REAL de produto: a partir
// da F6.8/ADR-0058 a IA de nuvem (anthropic/openai/gemini) DEVE alcançar o provedor no browser (401
// com chave dummy = CORS ok) — a Anthropic via o header opt-in de browser. CORS-wall p/ esses três
// vira vermelho (regressão); e um TRAVAMENTO SILENCIOSO (spinner infinito / falha engolida) também.
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
// Fluxo 5b (F6.11): IMPORT em OPFS VAZIA — importar um backup num APARELHO NOVO (fresh install).
//
// O round-trip da F6.2 (`export-import`) só provou o import no contexto PRINCIPAL, que JÁ tinha
// userdata escrito. O caminho que quebrava — e que o smoke em browser REAL pegou — é importar
// num aparelho NOVO cuja OPFS está VAZIA (nenhum userdata gravado ainda): o passo de LEITURA-
// antes-de-escrita do import (`importSnapshotIntoStore` → `exportSnapshot` → `listNotes`/
// `listHighlights`/`readingPlanProgress`) resolvia `the-light/userdata/` com `{create:false}`
// numa OPFS vazia e lançava `NotFoundError` ("A requested file or directory could not be found")
// em vez do caminho gracioso "ausente→vazio". A F6.11 guarda essa leitura em `userdata-opfs.web.ts`
// (a ESCRITA segue criando os dirs com `{create:true}`). Este fluxo usa um `BrowserContext` FRESCO
// (OPFS isolada e limpa por contexto) → reproduz o bug se o guard for revertido e passa com o fix.
// ═══════════════════════════════════════════════════════════════════════════════════════

async function runImportFresh(ctx) {
  const { page, baseUrl } = ctx;
  ctx.resetDiagnostics();

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tla-smoke-fresh-'));
  const NAME = 'the-light-app-backup.json';
  let fresh; // BrowserContext isolado (OPFS VAZIA) — teardown garantido no finally
  try {
    // (1) Exporta um backup do contexto PRINCIPAL (já tem a nota+marcação de João 3:16 dos
    //     fluxos anteriores) — é exatamente o snapshot que um aparelho NOVO importaria.
    await openSyncPanel(page, baseUrl);
    const client = await page.target().createCDPSession();
    try {
      await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir,
        eventsEnabled: true,
      });
    } catch {
      await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
    }
    const srcFile = await exportAndDownload(page, ctx, downloadDir, NAME);
    const snap = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
    const nNotes = Array.isArray(snap.notes) ? snap.notes.length : 0;
    const nHls = Array.isArray(snap.highlights) ? snap.highlights.length : 0;
    if (nNotes < 1) {
      throw new Error(
        `import-fresh: backup de origem sem notas (notes=${nNotes}); esperado ≥1 p/ provar o import em OPFS vazia.`,
      );
    }
    // Estabiliza o caminho de re-injeção (libera o nome que o <input>/fileChooser consumiria).
    const importSrc = path.join(downloadDir, 'fresh-import-src.json');
    fs.copyFileSync(srcFile, importSrc);
    ctx.log(`  [import-fresh] backup de origem: notes=${nNotes}, highlights=${nHls}`);

    // (2) Contexto FRESCO = OPFS ISOLADA e VAZIA (aparelho novo; nenhum userdata escrito ainda).
    fresh = await ctx.browser.createBrowserContext();
    const fpage = await fresh.newPage();
    await fpage.evaluateOnNewDocument(ctx.installUrlWrap);

    // Abre o painel de sync na OPFS vazia e IMPORTA via <input> oculto (pickJsonFileWeb). ANTES do
    // fix, a leitura-antes-de-escrita lançaria `NotFoundError` na OPFS vazia → import com erro.
    await openSyncPanel(fpage, baseUrl);
    const [chooser] = await Promise.all([
      fpage.waitForFileChooser({ timeout: ACTION_TIMEOUT_MS }),
      clickSel(fpage, q('sync-import-file')),
    ]);
    await chooser.accept([importSrc]);
    try {
      await fpage.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="sync-status"]');
          if (el == null) return false;
          const txt = el.textContent || '';
          return /import(ed|ado)/i.test(txt) && !/Could not|Não foi possível/i.test(txt);
        },
        { timeout: ACTION_TIMEOUT_MS, polling: 300 },
      );
    } catch {
      const st = await fpage.evaluate(() => {
        const el = document.querySelector('[data-testid="sync-status"]');
        return el ? el.textContent || '' : '(sem sync-status)';
      });
      throw new Error(
        `import-fresh: import em OPFS VAZIA (aparelho novo) NÃO foi aceito — provável NotFoundError na ` +
          `leitura-antes-de-escrita (bug F6.11 revertido?). sync-status="${st}"`,
      );
    }
    const importStatus = await fpage.evaluate(() => {
      const el = document.querySelector('[data-testid="sync-status"]');
      return el ? el.textContent || '' : '';
    });
    ctx.log(`  [import-fresh] backup importado numa OPFS VAZIA e ACEITO: "${importStatus.trim()}"`);

    // (3) As notas do backup APARECEM na OPFS antes vazia: João 3:16 volta com o marcador ✎
    //     (o import EFETIVAMENTE gravou no aparelho novo — a ESCRITA cria os dirs `{create:true}`).
    await fpage.goto(baseUrl + '/read/43/3', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await waitBodyIncludes(fpage, KJV_JOHN_3_16);
    try {
      await fpage.waitForFunction(
        () => {
          const v = document.querySelector('[data-testid="verse-16"]');
          return v != null && (v.textContent || '').includes('✎');
        },
        { timeout: RENDER_TIMEOUT_MS, polling: 300 },
      );
    } catch {
      const body = (await bodyText(fpage)).replace(/\s+/g, ' ').slice(0, 400);
      throw new Error(
        `import-fresh: após importar na OPFS vazia, a nota de João 3:16 NÃO apareceu (marcador ✎ ausente) — ` +
          `o import não gravou no aparelho novo.\n  body[0..400]="${body}"`,
      );
    }
    ctx.log('  [import-fresh] nota importada visível em João 3:16 (✎) na OPFS antes vazia — import em aparelho novo OK');
  } finally {
    if (fresh) {
      await fresh.close();
    }
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo (F6.6): CTA "configurar provedor" → TELA DE AJUSTES (/settings). Abre um painel de IA
// SEM nenhum provedor configurado (cofre de sessão vazio após o `goto` fresco), clica no CTA do
// AiProviderNotice e assevera que ATERRISSA em /settings (a tela renderiza + a URL muda), com os
// 4 provedores listados. Antes da F6.6 o CTA levava a /about (informativo, sem campos) — beco sem
// saída. NENHUMA chave é inserida aqui (só o ROTEAMENTO + render); se exercitasse o input, seria
// só com chave DUMMY, JAMAIS real. Status é só-nome (`listProviders`) — nenhum valor é observado.
// ═══════════════════════════════════════════════════════════════════════════════════════

async function runSettingsCta(ctx) {
  const { page } = ctx;
  // `goto` fresco reinstancia o JS (cofre de sessão in-memory zera) → nenhum provedor configurado.
  await goto(ctx, '/read/43/3');
  await waitBodyIncludes(page, KJV_JOHN_3_16);
  await clickSel(page, q('verse-16'));
  await waitSel(page, q('verse-ask'));
  await clickSel(page, q('verse-ask')); // abre o ReaderAskPanel

  // Sem provedor configurado → o aviso "sem provedor de IA" (+ CTA) aparece.
  try {
    await waitSel(page, q('ai-provider-notice'), RENDER_TIMEOUT_MS);
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(
      `settings-cta: o aviso "sem provedor" (ai-provider-notice) NÃO apareceu no painel de IA ` +
        `sem provedor configurado.\n  body[0..400]="${body}"`,
    );
  }
  await clickSel(page, q('ai-provider-configure')); // CTA → router.push('/settings')

  // Aterrissa em /settings: a tela renderiza (settings-screen) E a URL passa a conter /settings.
  try {
    await waitSel(page, q('settings-screen'), RENDER_TIMEOUT_MS);
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(
      `settings-cta: após o CTA "configurar provedor", a tela /settings NÃO renderizou ` +
        `(settings-screen ausente) — o CTA não roteou p/ Ajustes.\n  body[0..400]="${body}"`,
    );
  }
  const url = page.url();
  if (!/\/settings(\b|\/|\?|#|$)/.test(url)) {
    throw new Error(`settings-cta: CTA não navegou p/ /settings (url atual="${url}").`);
  }

  // Os 4 provedores BYOK aparecem listados (status só-nome; nunca valores).
  for (const p of ['anthropic', 'openai', 'gemini', 'ollama']) {
    try {
      await waitSel(page, q(`settings-provider-${p}`), ACTION_TIMEOUT_MS);
    } catch {
      throw new Error(`settings-cta: a linha do provedor "${p}" (settings-provider-${p}) não renderizou em /settings.`);
    }
  }
  await assertNoForbidden(ctx, 'settings');
  ctx.log('  [settings] CTA "configurar provedor" aterrissou em /settings; 4 provedores listados (status só-nomes, sem valores)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo (F6.7): SELETOR de provedor nos painéis ESTUDO e CONVERSA — des-mock. Abre cada painel
// pela ação por-versículo e assevera que o SELETOR de provedor renderiza (chip `mock` default
// offline + um chip de provedor BYOK real), provando que Study/Chat deixaram de hardcodar o
// mock e agora expõem a escolha de provedor (a chave BYOK é lida sob demanda no envio real —
// NÃO exercitado aqui: sem chave/rede, determinístico). Não envia (só abre + verifica o cromo).
// ═══════════════════════════════════════════════════════════════════════════════════════

async function runStudyChatSelector(ctx) {
  const { page } = ctx;

  // ── ESTUDO: abre via verse-study, assevera o seletor (mock default + provedor real). ──
  await goto(ctx, '/read/43/3');
  await waitBodyIncludes(page, KJV_JOHN_3_16);
  await clickSel(page, q('verse-16'));
  await waitSel(page, q('verse-study'));
  await clickSel(page, q('verse-study'));
  await waitSel(page, q('study-provider-mock'), RENDER_TIMEOUT_MS); // seletor: `mock` default offline
  await waitSel(page, q('study-provider-anthropic'), ACTION_TIMEOUT_MS); // + chip BYOK real
  await waitSel(page, q('study-submit'), ACTION_TIMEOUT_MS); // painel abriu por inteiro
  await assertNoForbidden(ctx, 'study-chat-selector/study');
  ctx.log('  [study-chat] painel de ESTUDO abre com seletor de provedor (mock default + BYOK reais)');

  // ── CONVERSA: `goto` fresco RESETA a UI (sem depender de fechar o modal); abre via verse-chat. ──
  await goto(ctx, '/read/43/3');
  await waitBodyIncludes(page, KJV_JOHN_3_16);
  await clickSel(page, q('verse-16'));
  await waitSel(page, q('verse-chat'));
  await clickSel(page, q('verse-chat'));
  await waitSel(page, q('chat-provider-mock'), RENDER_TIMEOUT_MS); // seletor: `mock` default offline
  await waitSel(page, q('chat-provider-anthropic'), ACTION_TIMEOUT_MS); // + chip BYOK real
  await waitSel(page, q('chat-send'), ACTION_TIMEOUT_MS); // painel abriu por inteiro
  await assertNoForbidden(ctx, 'study-chat-selector/chat');
  ctx.log('  [study-chat] painel de CONVERSA abre com seletor de provedor (mock default + BYOK reais)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo 6 (F6.2 → FLIPADO na F6.8/ADR-0058): IA REACHABILITY — Ask c/ chave DUMMY; assevera o
// alcance por provedor. 401 = alcança o provedor (CORS ok). A partir da F6.8, os 3 provedores de
// nuvem (anthropic/openai/gemini) DEVEM alcançar o provedor — a Anthropic via o header opt-in de
// browser (`anthropic-dangerous-direct-browser-access`). CORS-wall p/ esses três = regressão
// (vermelho); TRAVAMENTO SILENCIOSO (spinner infinito / falha engolida) idem.
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
      const responses = [...net[provider].responses];
      const failures = [...net[provider].failures];
      const reach = classifyReach(responses, failures);
      // "Alcançou o provedor" = houve resposta HTTP E nenhuma falha de rede/CORS (net::ERR_FAILED).
      // Com a chave DUMMY isso é um 401 do provedor — prova que o CORS foi liberado e a request
      // chegou ao endpoint (o mesmo estado "CORS ok" de `classifyReach`).
      const reached = responses.length > 0 && failures.length === 0;
      results[provider] = { ...term, visible, reach, responses, failures, reached };
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

  // Marcador de regressão da F6.8 (âncora FLIPADA): o estado observado por provedor no browser real.
  const summary = Object.entries(results)
    .map(([p, r]) => `${p}=[${r.reach}]`)
    .join(' · ');
  ctx.log(`  [ai] REACHABILITY (âncora F6.8 FLIPADA): ${summary}`);

  // F6.8 (ADR-0058): com o header opt-in `anthropic-dangerous-direct-browser-access`, a Anthropic
  // deixa de bater parede de CORS e passa a ALCANÇAR o provedor no browser real (401 com a chave
  // dummy). A âncora da F6.2 (Anthropic=CORS-wall) FLIPA: agora TODOS os 3 provedores de nuvem
  // (anthropic/openai/gemini) devem estar ALCANÇADOS. Se algum voltar a CORS-wall, é regressão.
  for (const provider of ['anthropic', 'openai', 'gemini']) {
    const r = results[provider];
    if (!r || !r.reached) {
      problems.push(
        `${provider}: NÃO alcançou o provedor no browser (esperado 401/CORS ok; observado "${r ? r.reach : 'sem resultado'}") — ` +
          `a âncora F6.8 deveria estar FLIPADA (Anthropic com o header opt-in de browser).`,
      );
    }
  }

  if (problems.length) {
    throw new Error(`ai-reachability: ${problems.join('\n  ')}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo (F6.3): UI de ERRO do wasm da FRONTEIRA — falha de init VISÍVEL + retry, nunca spinner
// infinito. Roda SÓ sob `SMOKE_WASM_WRONG_MIME=1` no dist (o static-server corrompe o CORPO do
// `index_bg.wasm` da fronteira → `uniffiInitAsync` rejeita). Prova o endurecimento da F6.3:
//   (a) a falha de init vira UI de ERRO VISÍVEL (mensagem + botão "Tentar de novo") e o spinner
//       SOME — antes esse mesmo defeito ficava ENGOLIDO como spinner infinito silencioso;
//   (b) o RETRY re-tenta DE VERDADE: após "consertar" o wasm (control route do static-server),
//       clicar em "Tentar de novo" re-instancia com bytes válidos e a leitura RECUPERA.
// ═══════════════════════════════════════════════════════════════════════════════════════

async function runWasmErrorUi(ctx) {
  const { page, baseUrl } = ctx;
  await goto(ctx, '/read/43/3');

  // (a) A falha de init deve virar UI de ERRO VISÍVEL (wasm-error + wasm-retry) — NUNCA um
  //     spinner infinito. O estouro do timeout aqui É a regressão "erro engolido parece loading".
  try {
    await page.waitForFunction(
      (errSel, retrySel, spinnerSel) => {
        const errEl = document.querySelector(errSel);
        const retryEl = document.querySelector(retrySel);
        const hasErr = errEl != null && (errEl.textContent || '').trim().length > 0;
        const hasRetry = retryEl != null && (retryEl.textContent || '').trim().length > 0;
        const spinning = document.querySelector(spinnerSel) != null;
        return hasErr && hasRetry && !spinning;
      },
      { timeout: RENDER_TIMEOUT_MS, polling: 300 },
      q('wasm-error'),
      q('wasm-retry'),
      SPINNER_SELECTOR,
    );
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400);
    const spinning = await page.evaluate((s) => document.querySelector(s) != null, SPINNER_SELECTOR);
    throw new Error(
      `wasm-error-ui: com o wasm da fronteira corrompido, a UI de erro (wasm-error + wasm-retry) NÃO ` +
        `apareceu em ${RENDER_TIMEOUT_MS}ms` +
        (spinning ? ' (SPINNER INFINITO ainda presente — a falha continua ENGOLIDA!)' : '') +
        `.\n  body[0..400]="${body}"`,
    );
  }
  // O gate deve ter BLOQUEADO os children: o texto de leitura NÃO pode ter vazado.
  const leaked = await page.evaluate((needle) => (document.body?.innerText || '').includes(needle), KJV_JOHN_3_16);
  if (leaked) {
    throw new Error('wasm-error-ui: os children de leitura montaram apesar do erro de init (o gate não bloqueou).');
  }
  ctx.log('  [wasm-error-ui] init da fronteira falhou → UI de erro VISÍVEL + retry (spinner ausente)');

  // (b) RETRY RECUPERA: "conserta" o wasm no servidor e clica em "Tentar de novo" → children montam.
  const fix = await fetch(baseUrl + '/__smoke/fix-frontier-wasm');
  if (!fix.ok) {
    throw new Error(`wasm-error-ui: control route de conserto respondeu HTTP ${fix.status} (esperado 200).`);
  }
  await clickSel(page, q('wasm-retry'));
  try {
    await waitBodyIncludes(page, KJV_JOHN_3_16); // espera o texto VERBATIM (e o spinner sumir)
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400);
    throw new Error(
      `wasm-error-ui: após consertar o wasm e clicar em "Tentar de novo", a leitura NÃO recuperou ` +
        `(John 3:16 ausente) — o retry NÃO re-tentou de verdade.\n  body[0..400]="${body}"`,
    );
  }
  await assertNoForbidden(ctx, 'wasm-error-ui');
  ctx.log('  [wasm-error-ui] retry re-tentou de verdade → leitura recuperou (John 3:16 renderizado)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo (Rodada 4): VERSÍCULO DO DIA — devocional determinístico na Home. Prova que o cartão
// aparece com TEXTO REAL do store (anti-alucinação: o texto vem de `getChapter`, não da UI) e leva
// ao leitor. A REFERÊNCIA do dia é determinística, mas o smoke NÃO fixa a data — assevera o
// invariante: cartão presente + texto não-vazio + referência com "cap:verso" + toque abre /read/.
async function runVerseOfDayUi(ctx) {
  const { page } = ctx;
  await goto(ctx, '/');
  // O cartão só aparece depois de abrir o store de leitura e buscar o texto → timeout de RENDER.
  await waitSel(page, q('verse-of-day'), RENDER_TIMEOUT_MS);
  await waitSel(page, q('verse-of-day-text'), ACTION_TIMEOUT_MS);
  const info = await page.evaluate((textSel, cardSel) => {
    const txt = document.querySelector(textSel);
    const card = document.querySelector(cardSel);
    return { text: txt ? (txt.textContent || '').trim() : '', card: card ? (card.textContent || '').trim() : '' };
  }, q('verse-of-day-text'), q('verse-of-day'));
  if (info.text.length < 8) {
    throw new Error(`verse-of-day: texto do versículo vazio/curto (store não retornou?): "${info.text}"`);
  }
  if (!/\d+:\d+/.test(info.card)) {
    throw new Error(`verse-of-day: referência "cap:verso" ausente no cartão: "${info.card.slice(0, 120)}"`);
  }
  // Toque → abre o versículo no leitor (rota /read/<book>/<chapter>).
  await clickSel(page, q('verse-of-day'));
  await page.waitForFunction(() => /\/read\/\d+\/\d+/.test(location.pathname + location.search + location.hash), {
    timeout: ACTION_TIMEOUT_MS,
    polling: 200,
  });
  await assertNoForbidden(ctx, 'verse-of-day');
  ctx.log(`  [verse-of-day] cartão na Home com texto do store + referência; toque abriu o leitor`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Fluxo (Rodada 2): INTERLINEAR — palavra-a-palavra na língua original. É o PRIMEIRO fluxo do
// smoke que exercita o léxico on-demand REAL no browser (`lexicon-sample.sqlite` via OPFS, o
// mesmo caminho da F5.15 do word-study). Abre João 3:16 → painel por-versículo → "Interlinear",
// e assevera que a grade renderiza tokens em GREGO (o texto original vem do STORE, nunca da UI/
// IA — anti-alucinação) + a atribuição STEP CC-BY obrigatória. Spinner infinito / grade vazia em
// livro COBERTO (João) = regressão (o timeout de render É a falha).
async function runInterlinearUi(ctx) {
  const { page } = ctx;
  await goto(ctx, '/read/43/3');
  await waitBodyIncludes(page, KJV_JOHN_3_16); // leitura renderizou (texto verbatim)
  await clickSel(page, q('verse-16'));
  await waitSel(page, q('verse-interlinear'));
  await clickSel(page, q('verse-interlinear')); // abre o ReaderInterlinearPanel
  // A grade só aparece após o léxico ON-DEMAND (~9 MB) baixar via OPFS → timeout de RENDER. A grade
  // só é montada com tokens (branch `tokens.length > 0`), então esperar o SCRIPT GREGO nela cobre
  // tanto o download quanto a pintura das células — sem depender do índice-base do `wordIndex`.
  await page.waitForFunction(
    (sel) => {
      const grid = document.querySelector(sel);
      return grid != null && /[Ͱ-Ͽ]/.test(grid.textContent || '');
    },
    { timeout: RENDER_TIMEOUT_MS, polling: 300 },
    q('interlinear-grid'),
  );
  // O texto original é GREGO (João = NT) — o dado vem do store; a UI não inventa. Também exige a
  // atribuição STEP CC-BY (ADR-0026).
  const gridInfo = await page.evaluate((sel) => {
    const grid = document.querySelector(sel);
    const attr = document.querySelector('[data-testid="interlinear-attribution"]');
    return {
      gridText: grid ? grid.textContent || '' : '',
      attrText: attr ? attr.textContent || '' : '',
    };
  }, q('interlinear-grid'));
  if (!/[Ͱ-Ͽ]/.test(gridInfo.gridText)) {
    throw new Error(
      `interlinear: a grade de João 3:16 NÃO trouxe texto grego (língua original ausente).\n  grid[0..160]="${gridInfo.gridText.slice(0, 160)}"`,
    );
  }
  if (!/STEP Bible/.test(gridInfo.attrText)) {
    throw new Error(`interlinear: atribuição STEP CC-BY ausente.\n  attr="${gridInfo.attrText.slice(0, 200)}"`);
  }
  await assertNoForbidden(ctx, 'interlinear-ui');
  ctx.log('  [interlinear] João 3:16 → grade palavra-a-palavra em GREGO (store) + STEP CC-BY');
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
  // F6.11: import de backup numa OPFS VAZIA (aparelho novo) — o caminho que o round-trip da F6.2
  // não cobria (contexto principal já tinha userdata). Roda após `export-import` (reusa o backup).
  { name: 'import-fresh', run: runImportFresh },
  // F6.6: CTA "configurar provedor" (AiProviderNotice) → tela de AJUSTES (/settings). Roda com
  // `goto` fresco (cofre de sessão vazio) ANTES do ai-reachability (que configura chaves dummy).
  { name: 'settings', run: runSettingsCta },
  // F6.7: Study/Chat des-mockados — o seletor de provedor abre em ambos (mock default + BYOK).
  // Roda com goto fresco (offline, sem chave/rede); não envia — só prova o cromo do seletor.
  { name: 'study-chat-selector', run: runStudyChatSelector },
  // Rodada 4: versículo do dia na Home — cartão com texto REAL do store + toque abre o leitor.
  { name: 'verse-of-day', run: runVerseOfDayUi },
  // Rodada 2: modo interlinear — PRIMEIRO fluxo a baixar o léxico on-demand real (OPFS) no browser;
  // prova a grade palavra-a-palavra em grego (store) + STEP CC-BY. Antes do ai-reachability (chaves dummy).
  { name: 'interlinear', run: runInterlinearUi },
  { name: 'ai-reachability', run: runAiReachability },
  // F6.3: roda SÓ sob SMOKE_WASM_WRONG_MIME=1 (dist) — o driver filtra os fluxos (ver
  // smoke.browser.mjs). Sob o flag, ESTE é o ÚNICO fluxo; sem o flag, ele é EXCLUÍDO.
  { name: 'wasm-error-ui', run: runWasmErrorUi },
];
