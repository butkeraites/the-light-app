// app/web/__browser__/smoke.browser.mjs — F6.1 (harness de smoke em browser REAL)
//
// Driver do smoke em BROWSER REAL (Chrome via puppeteer-core), generalizado de
// scratchpad/browser-repro/repro2.mjs. Fecha o buraco que deixou a leitura web
// quebrada por 3 ciclos (F5.36/38/39) sem nenhum gate reprovar: a suíte `test:web:*`
// roda sobre `MemoryVFS`/in-memory e NUNCA exercita o runtime real (OPFS, fetch de
// asset do Metro, wasm-instantiate, expo-router).
//
// Uso: node web/__browser__/smoke.browser.mjs --target=dev|dist
//
// DETERMINÍSTICO e RODÁVEL-PELO-LOOP:
//   - resolve o Chrome (chrome.mjs) ANTES de qualquer setup; ausência = VERMELHO (banner)
//     salvo SMOKE_SKIP_IF_NO_CHROME=1 (skip NÃO-VERIFICADO). O loop nunca seta o skip.
//   - `userDataDir` LIMPO por run (mkdtemp) e viewport fixa → sem estado herdado.
//   - trap-teardown (finalize) em fim normal, erro e sinais → sem processos órfãos
//     (servidor do alvo + browser + userDataDir).
//   - instrumentação: `page.on('pageerror'|'requestfailed')` + o wrap de `URL` (captura de
//     stack) do repro2.mjs, p/ flagrar "Failed to construct 'URL': Invalid base URL".
//   - ANTI-FLAKE: as asserções esperam sinais estáveis de DOM (waitForFunction), não
//     `setTimeout` fixo — o estouro do timeout É a falha "spinner infinito".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import puppeteer from 'puppeteer-core';

import { resolveChromeOrExit } from './chrome.mjs';
import { startTarget } from './server.mjs';
import { flows } from './assertions.mjs';

function parseTarget() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--target='));
  const target = arg ? arg.split('=')[1] : process.env.SMOKE_TARGET;
  if (target !== 'dev' && target !== 'dist') {
    process.stderr.write('uso: node web/__browser__/smoke.browser.mjs --target=dev|dist\n');
    process.exit(2);
  }
  return target;
}

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Wrap de `URL` idêntico ao repro2.mjs: captura a stack toda vez que a construção lança
// (é assim que "Invalid base URL" — a quebra da F5.39 — vira evidência inspecionável).
function installUrlWrap() {
  window.__urlErrs = [];
  const NativeURL = window.URL;
  function PatchedURL(...args) {
    try {
      return new NativeURL(...args);
    } catch (e) {
      try {
        window.__urlErrs.push({
          args: args.map(String),
          msg: e && e.message ? e.message : String(e),
          stack: (new Error().stack || '').split('\n').slice(1, 9).join('\n'),
        });
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
  PatchedURL.prototype = NativeURL.prototype;
  PatchedURL.createObjectURL = NativeURL.createObjectURL ? NativeURL.createObjectURL.bind(NativeURL) : undefined;
  PatchedURL.revokeObjectURL = NativeURL.revokeObjectURL ? NativeURL.revokeObjectURL.bind(NativeURL) : undefined;
  window.URL = PatchedURL;
}

async function main() {
  const target = parseTarget();
  // Resolve o Chrome ANTES de subir servidor/browser (falha rápida; ausência = vermelho).
  const executablePath = resolveChromeOrExit();

  const cleanups = [];
  let finalized = false;
  const finalize = async (code) => {
    if (finalized) return;
    finalized = true;
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {
        /* best-effort */
      }
    }
    if (typeof code === 'number') process.exit(code);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      finalize(130);
    });
  }

  log(`==> smoke (browser REAL) target=${target}`);
  log(`    chrome: ${executablePath}`);

  let failures = 0;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tla-smoke-'));
  cleanups.push(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

  try {
    // Sobe o alvo (dev = expo start; dist = expo export + static-server).
    const server = await startTarget(target);
    cleanups.push(server.cleanup);

    // Lança o Chrome do sistema com userDataDir LIMPO e viewport fixa.
    const browser = await puppeteer.launch({
      executablePath,
      headless: 'new',
      userDataDir,
      defaultViewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    cleanups.push(() => browser.close());

    const page = await browser.newPage();
    await page.evaluateOnNewDocument(installUrlWrap);

    // Instrumentação: acumula pageerror/requestfailed (reset por fluxo/navegação).
    const diagnostics = { pageErrors: [], requestFailures: [] };
    page.on('pageerror', (e) => diagnostics.pageErrors.push(e && e.message ? e.message : String(e)));
    page.on('requestfailed', (req) => {
      const f = req.failure();
      diagnostics.requestFailures.push(`${req.method()} ${req.url()} — ${f ? f.errorText : 'failed'}`);
    });

    const ctx = {
      page,
      // F6.2: alguns fluxos abrem um BrowserContext ANÔNIMO (OPFS isolado) — expostos aqui
      // p/ o fluxo criar/instrumentar/fechar seu próprio contexto (teardown no finalize do
      // fluxo). `installUrlWrap` reaproveita a MESMA instrumentação de URL do page principal.
      browser,
      installUrlWrap,
      baseUrl: server.baseUrl,
      target,
      log,
      resetDiagnostics: () => {
        diagnostics.pageErrors.length = 0;
        diagnostics.requestFailures.length = 0;
      },
      collectDiagnostics: async () => {
        let urlErrs = [];
        try {
          urlErrs = await page.evaluate(() => window.__urlErrs || []);
        } catch {
          /* página pode ter sido descartada */
        }
        const summary =
          `\n  --- diagnósticos ---` +
          `\n  pageErrors(${diagnostics.pageErrors.length}): ${diagnostics.pageErrors.slice(-6).join(' | ') || '(nenhum)'}` +
          `\n  requestFailed(${diagnostics.requestFailures.length}): ${diagnostics.requestFailures.slice(-6).join(' | ') || '(nenhum)'}` +
          `\n  urlErrs(${urlErrs.length}): ${urlErrs.map((u) => u.msg).slice(-6).join(' | ') || '(nenhum)'}`;
        return { pageErrors: diagnostics.pageErrors, requestFailures: diagnostics.requestFailures, urlErrs, summary };
      },
    };

    // F6.3: o fluxo `wasm-error-ui` exige o wasm da fronteira CORROMPIDO (SMOKE_WASM_WRONG_MIME=1,
    // só afeta o static-server do dist) — que QUEBRARIA todos os outros fluxos. Então sob o flag
    // rodamos SÓ ele; sem o flag, rodamos todos os DEMAIS (fluxos normais da F6.2 seguem verdes).
    const wasmErrorMode = process.env.SMOKE_WASM_WRONG_MIME === '1';
    let selectedFlows = wasmErrorMode
      ? flows.filter((f) => f.name === 'wasm-error-ui')
      : flows.filter((f) => f.name !== 'wasm-error-ui');
    if (wasmErrorMode) {
      log('    modo SMOKE_WASM_WRONG_MIME=1 → só o fluxo wasm-error-ui (fronteira corrompida de propósito)');
    }
    // Afordância de DEV (não-CI): `SMOKE_ONLY=chapter-nav,verse-of-day` roda só esses fluxos p/
    // iterar rápido. Sem o env, roda tudo (comportamento do guard inalterado).
    const only = (process.env.SMOKE_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (only.length > 0) {
      selectedFlows = selectedFlows.filter((f) => only.includes(f.name));
      log(`    modo SMOKE_ONLY=${only.join(',')} → ${selectedFlows.length} fluxo(s)`);
    }

    for (const flow of selectedFlows) {
      try {
        await flow.run(ctx);
        log(`TLA_WEB_${flow.name} ok`);
      } catch (err) {
        failures += 1;
        log(`TLA_WEB_${flow.name} FAIL`);
        process.stderr.write(`  ${err && err.stack ? err.stack : err}\n`);
      }
    }
  } catch (err) {
    failures += 1;
    process.stderr.write(`smoke setup FAIL: ${err && err.stack ? err.stack : err}\n`);
  }

  if (failures > 0) {
    log(`==> SMOKE FAIL (target=${target}, fluxos com falha=${failures})`);
    await finalize(1);
  } else {
    log(`==> SMOKE OK (target=${target})`);
    await finalize(0);
  }
}

main().catch(async (err) => {
  process.stderr.write(`smoke fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
