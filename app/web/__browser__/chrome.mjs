// app/web/__browser__/chrome.mjs — F6.1 (harness de smoke em browser REAL)
//
// Resolvedor do binário do Chrome usado pelo smoke em browser REAL. Ordem de busca
// (a mesma provada na F5.39 / scratchpad/browser-repro): $SMOKE_CHROME → o Chrome do
// sistema no macOS → o cache do Playwright → `google-chrome`/`chromium` no PATH.
//
// REGRA DE OURO (nunca um falso verde): se NENHUM Chrome for encontrado, isto é uma
// FALHA VERMELHA (exit != 0) com banner alto — não um "verde silencioso". O único jeito
// de PULAR (exit 0) é setar explicitamente `SMOKE_SKIP_IF_NO_CHROME=1`, e ainda assim
// o smoke imprime `SMOKE SKIPPED — NOT VERIFIED`. O bloco de verificação do loop NUNCA
// seta esse flag → ausência de Chrome = vermelho no gate.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/** Caminho do Chrome do sistema no macOS (symlink p/ Chromium-for-Testing na F5.39). */
const MACOS_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** true se `p` existe e é executável. */
function isExecutable(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Varre o cache do Playwright (macOS e Linux) por um Chromium baixado. */
function fromPlaywrightCache() {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const dir of entries.sort().reverse()) {
      if (!/^chromium/.test(dir)) continue;
      const candidates = [
        path.join(root, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(root, dir, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(root, dir, 'chrome-linux', 'chrome'),
      ];
      for (const c of candidates) if (isExecutable(c)) return c;
    }
  }
  return null;
}

/** Procura `google-chrome`/`chromium` no PATH. */
function fromPath() {
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const out = execSync(`command -v ${bin} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (out && isExecutable(out)) return out;
    } catch {
      // não está no PATH — segue
    }
  }
  return null;
}

/**
 * Resolve o binário do Chrome, ou `null` se nenhum for encontrado.
 *
 * `SMOKE_FORCE_NO_CHROME=1` é um SEAM DE TESTE que finge ausência de Chrome. Ele só
 * consegue produzir VERMELHO/skip (nunca um falso verde), por isso é seguro: o loop
 * jamais o seta e ele não pode "passar" o gate indevidamente.
 */
export function findChrome() {
  if (process.env.SMOKE_FORCE_NO_CHROME === '1') return null;

  const env = process.env.SMOKE_CHROME;
  if (env) {
    // Override explícito: se o usuário apontou um binário, ele TEM de existir
    // (apontar p/ um binário ausente é erro do operador, não motivo p/ auto-detectar).
    if (isExecutable(env)) return env;
    return null;
  }
  if (isExecutable(MACOS_CHROME)) return MACOS_CHROME;
  const pw = fromPlaywrightCache();
  if (pw) return pw;
  return fromPath();
}

/** Banner alto impresso quando nenhum Chrome é encontrado (falha VERMELHA). */
function loudBanner() {
  const line = '='.repeat(72);
  process.stderr.write(
    `\n${line}\n` +
      '  SMOKE FAILED — nenhum Chrome REAL encontrado.\n' +
      '  Este gate dirige um BROWSER REAL; Chrome ausente é VERMELHO, não skip.\n' +
      '  Aponte $SMOKE_CHROME p/ um binário Chrome/Chromium, ou instale o Google Chrome.\n' +
      '  (Só SMOKE_SKIP_IF_NO_CHROME=1 transforma isto num skip NÃO-VERIFICADO.)\n' +
      `${line}\n\n`,
  );
}

/**
 * Resolve o Chrome ou encerra o processo:
 *   - encontrado         → retorna o caminho.
 *   - ausente + skip flag → imprime `SMOKE SKIPPED — NOT VERIFIED` e sai 0.
 *   - ausente            → banner alto + sai 1 (VERMELHO).
 */
export function resolveChromeOrExit() {
  const chrome = findChrome();
  if (chrome) return chrome;

  if (process.env.SMOKE_SKIP_IF_NO_CHROME === '1') {
    process.stdout.write('SMOKE SKIPPED — NOT VERIFIED (nenhum Chrome encontrado; SMOKE_SKIP_IF_NO_CHROME=1)\n');
    process.exit(0);
  }
  loudBanner();
  process.exit(1);
}

// Execução direta (`node web/__browser__/chrome.mjs`): resolve e imprime o caminho,
// ou aplica o comportamento de saída acima. Útil p/ verificar a resolução isolada.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chrome = resolveChromeOrExit();
  process.stdout.write(`chrome: ${chrome}\n`);
}
