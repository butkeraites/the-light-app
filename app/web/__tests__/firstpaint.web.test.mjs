// firstpaint.web.test.mjs — F5.3
//
// PROVA HEADLESS (node + react-test-renderer, sem browser/Expo) de que o SHELL do app
// NÃO bloqueia o 1º paint no wasm da fronteira (~4 MB). Monta o `RootLayout` REAL
// (`app/app/_layout.tsx`) com `ensureWasmReady()` stubado para uma promessa que NUNCA
// resolve e asserta que a NAVEGAÇÃO (as `Stack.Screen`) monta SÍNCRONO mesmo assim —
// exatamente o que a F5.3 mudou (antes o `_layout` fazia `if (!wasmReady) return
// <ActivityIndicator/>`, então com o wasm pendente NADA além do spinner apareceria).
//
// Estratégia: esbuild empacota SÓ o `_layout.tsx`, com um plugin `onResolve` que
// desvia `react-native`, `expo-router`, `../web/wasm`, `../lib/i18n`, `../lib/theme`
// e `../components/*` para stubs headless (firstpaint-stubs/). `react`/`jsx-runtime`
// ficam EXTERNOS → uma única instância de React compartilhada com o test-renderer.
//
// Sai 0 se o shell montar as telas com o wasm pendente; ≠0 caso contrário.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

import React from 'react';
import TestRenderer from 'react-test-renderer';

// Silencia o warning de ambiente do `act` (react-test-renderer fora de um test runner).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUBS = join(__dirname, 'firstpaint-stubs');
const LAYOUT = join(__dirname, '..', '..', 'app', '_layout.tsx');

// Mapeia os specifiers do `_layout.tsx` (e sua árvore) para os stubs headless.
const STUB_MAP = [
  [/^react-native$/, join(STUBS, 'react-native.js')],
  [/^expo-router$/, join(STUBS, 'expo-router.js')],
  [/(^|\/)web\/wasm$/, join(STUBS, 'wasm.js')],
  [/(^|\/)lib\/i18n$/, join(STUBS, 'providers.js')],
  [/(^|\/)lib\/theme$/, join(STUBS, 'providers.js')],
  [/(^|\/)components\/(LanguageToggleButton|ThemeModeSelector)$/, join(STUBS, 'providers.js')],
];

const stubPlugin = {
  name: 'firstpaint-stubs',
  setup(b) {
    for (const [filter, target] of STUB_MAP) {
      b.onResolve({ filter }, () => ({ path: target }));
    }
  },
};

async function loadRootLayout() {
  // O bundle fica DENTRO da árvore do app (não em /tmp) para que o `import ... from
  // 'react'` EXTERNO resolva para `app/node_modules/react` — a MESMA instância que o
  // `react-test-renderer` usa (senão hooks/dispatcher divergem). Removido no finally.
  const outfile = join(__dirname, `.firstpaint-bundle-${randomBytes(6).toString('hex')}.mjs`);
  try {
    await build({
      entryPoints: [LAYOUT],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node18',
      jsx: 'automatic',
      logLevel: 'silent',
      // React (e o runtime JSX) EXTERNOS: mesma instância do test-renderer.
      external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      plugins: [stubPlugin],
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(outfile, { force: true });
  }
}

// `act` unifica commit + flush de efeitos (o warm do wasm dispara num useEffect).
const act = TestRenderer.act ?? React.act;

async function main() {
  const mod = await loadRootLayout();
  const RootLayout = mod.default;
  assert.equal(typeof RootLayout, 'function', 'RootLayout deve ser o default export do _layout');

  globalThis.__wasmWarmCalls = 0;

  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(RootLayout));
  });

  // (1) O shell montou a NAVEGAÇÃO (as Stack.Screen) mesmo com o wasm NUNCA pronto.
  //     Se o gate render-blocking antigo ainda existisse, o único host seria um
  //     ActivityIndicator e NÃO haveria nenhuma 'screen'.
  const screens = renderer.root.findAll((n) => n.type === 'screen');
  const names = screens.map((s) => s.props.name);
  assert.ok(
    screens.length >= 1,
    `esperava >= 1 <Stack.Screen> no 1º paint (wasm pendente), veio ${screens.length}`,
  );
  assert.ok(
    names.includes('index'),
    `a HOME (index) deve montar no 1º paint sem esperar o wasm; telas: [${names.join(', ')}]`,
  );
  assert.ok(
    names.includes('read/index'),
    `as rotas de leitura devem estar registradas no shell; telas: [${names.join(', ')}]`,
  );

  // (2) NENHUM spinner render-blocking no shell (o gate global do wasm foi removido).
  const spinners = renderer.root.findAll((n) => n.type === 'ActivityIndicator');
  assert.equal(
    spinners.length,
    0,
    `o shell não deve conter ActivityIndicator render-blocking; veio ${spinners.length}`,
  );

  // (3) O wasm AQUECEU em 2º plano: ensureWasmReady() foi chamado (mas não bloqueou,
  //     pois a promessa nunca resolve — as asserções acima já valem SÍNCRONO).
  assert.ok(
    globalThis.__wasmWarmCalls >= 1,
    'ensureWasmReady() deve ter sido chamado (warm em 2º plano) no mount do shell',
  );

  act(() => {
    renderer.unmount();
  });

  console.log('PASS — 1º paint do shell NÃO espera o wasm da fronteira (F5.3):');
  console.log(`  Stack.Screen montadas SÍNCRONO   -> [${names.join(', ')}]`);
  console.log(`  spinner render-blocking no shell -> ${spinners.length}`);
  console.log(
    `  ensureWasmReady() (warm 2º plano) -> chamado ${globalThis.__wasmWarmCalls}x, promessa NÃO resolvida`,
  );
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
