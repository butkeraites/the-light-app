// app/web/__browser__/assertions.mjs — F6.1 (harness de smoke em browser REAL)
//
// Asserções por FLUXO exercitadas no browser REAL. Nesta tarefa (F6.1) só o fluxo
// ABRIR CAPÍTULO; os demais (paralelo/busca/xref/notas/planos/export-import/IA) entram
// na F6.2, cada um como um item de `flows`.
//
// Cada fluxo recebe um `ctx` (ver smoke.browser.mjs) e LANÇA em falha. O driver imprime
// `TLA_WEB_<name> ok|FAIL` por fluxo e sai != 0 se qualquer um lançar.
//
// ANTI-FLAKE: NÃO usamos `setTimeout` fixo. Esperamos SINAIS ESTÁVEIS de DOM via
// `page.waitForFunction` — texto do versículo PRESENTE **e** spinner AUSENTE. O estouro
// do timeout É, ele próprio, a falha "spinner infinito" (a leitura nunca renderizou).

/** Assinaturas de pageerror que denunciam a quebra de leitura web (F5.36/38/39). */
const FORBIDDEN_PAGEERROR = /SQLiteESMFactory|openReadingDbWeb|initAsync|Invalid base URL/;

/** react-native-web renderiza `ActivityIndicator` como `role="progressbar"`. */
const SPINNER_SELECTOR = '[role="progressbar"]';

const NAV_TIMEOUT_MS = 120000;
const RENDER_TIMEOUT_MS = 60000;

async function bodyText(page) {
  try {
    return await page.evaluate(() => (document.body ? document.body.innerText : ''));
  } catch {
    return '';
  }
}

/**
 * Abre um capítulo e valida: (a) o texto VERBATIM do store aparece; (b) sem spinner
 * infinito; (c) ZERO pageerror/URL-error casando a assinatura de quebra de leitura.
 */
async function openChapter(ctx, { path: routePath, expected }) {
  const { page, baseUrl } = ctx;
  ctx.resetDiagnostics();
  await page.evaluate(() => {
    window.__urlErrs = [];
  });

  const url = baseUrl + routePath;
  ctx.log(`  navegando ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

  try {
    await page.waitForFunction(
      (needle, spinnerSel) => {
        const txt = document.body ? document.body.innerText : '';
        const hasText = txt.includes(needle);
        const spinning = document.querySelector(spinnerSel) != null;
        return hasText && !spinning;
      },
      { timeout: RENDER_TIMEOUT_MS, polling: 300 },
      expected,
      SPINNER_SELECTOR,
    );
  } catch {
    const body = (await bodyText(page)).replace(/\s+/g, ' ').slice(0, 400);
    const spinning = await page.evaluate((sel) => document.querySelector(sel) != null, SPINNER_SELECTOR);
    const diag = await ctx.collectDiagnostics();
    throw new Error(
      `${routePath}: em ${RENDER_TIMEOUT_MS}ms o texto "${expected}" NÃO apareceu` +
        (spinning ? ' (SPINNER INFINITO ainda presente)' : '') +
        `.\n  body[0..400]="${body}"` +
        diag.summary,
    );
  }

  // Sanidade extra: o spinner sumiu de fato (o waitForFunction já garante, redundância barata).
  const stillSpinning = await page.evaluate((sel) => document.querySelector(sel) != null, SPINNER_SELECTOR);
  if (stillSpinning) {
    throw new Error(`${routePath}: spinner (${SPINNER_SELECTOR}) ainda presente após renderizar o texto.`);
  }

  const diag = await ctx.collectDiagnostics();
  const offending = [
    ...diag.pageErrors.filter((m) => FORBIDDEN_PAGEERROR.test(m)).map((m) => `pageerror: ${m}`),
    ...diag.urlErrs
      .filter((u) => FORBIDDEN_PAGEERROR.test(u.msg))
      .map((u) => `URL(${JSON.stringify(u.args)}): ${u.msg}`),
  ];
  if (offending.length) {
    throw new Error(`${routePath}: pageerror PROIBIDO detectado:\n  ${offending.join('\n  ')}`);
  }
}

export const flows = [
  {
    name: 'open-chapter',
    async run(ctx) {
      // Mateus 1 (KJV) e João 3 (KJV) — texto VERBATIM do store local (anti-alucinação).
      await openChapter(ctx, {
        path: '/read/40/1',
        expected: 'The book of the generation of Jesus Christ',
      });
      await openChapter(ctx, {
        path: '/read/43/3',
        expected: 'For God so loved the world',
      });
    },
  },
];
