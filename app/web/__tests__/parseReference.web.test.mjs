// parseReference.web.test.mjs — F0.6b (ADR-0007)
//
// PROVA HEADLESS (node, sem browser/Expo) de que o caminho WEB/WASM resolve
// referências bíblicas PELO RUST (the-light-core via fronteira UniFFI compilada
// p/ wasm32 + bindings web do ubrn) — não por eco nem parsing em TS.
//
// Verifica que parseReference("Jo 3.16") (PT) e parseReference("John 3:16") (EN)
// produzem AMBOS: book === 43 (João), chapter === 3, verses = Single { verse: 16 }.
//
// Como roda em node:
//   1) empacota app/web/__tests__/headless-entry.ts com esbuild (bundle único,
//      ESM, platform=node) — resolve os bindings GERADOS + @ubjs/core + o glue
//      wasm-bindgen `index.js` (alvo `web`);
//   2) instancia o wasm MANUALMENTE passando os bytes de index_bg.wasm ao init
//      (o alvo `web` aceita `{ module_or_path: <bytes> }` — em node não há fetch);
//   3) roda mod.initialize() (confere contrato/checksums do wasm) e chama
//      parseReference, asseverando os campos resolvidos pelo Rust.
//
// Sai 0 se ambas as referências baterem; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'headless-entry.ts');
const WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `parseref-headless-${randomBytes(6).toString('hex')}.mjs`);
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

function assertJohn316(ref, label) {
  assert.equal(ref.book, 43, `[${label}] book deve ser 43 (João), veio ${ref.book}`);
  assert.equal(ref.chapter, 3, `[${label}] chapter deve ser 3, veio ${ref.chapter}`);
  assert.equal(ref.verses.tag, 'Single', `[${label}] verses.tag deve ser "Single", veio ${ref.verses.tag}`);
  assert.equal(
    ref.verses.inner.verse,
    16,
    `[${label}] verses.inner.verse deve ser 16, veio ${ref.verses.inner.verse}`,
  );
}

async function main() {
  const { init, mod, parseReference } = await loadBundle();

  // Instancia o wasm a partir dos BYTES (node não tem fetch p/ asset local).
  const wasmBytes = await readFile(WASM);
  await init({ module_or_path: wasmBytes });

  // Confere contrato/checksums entre bindings e wasm (lança se divergir).
  mod.initialize();

  const pt = parseReference('Jo 3.16');
  const en = parseReference('John 3:16');

  assertJohn316(pt, 'PT "Jo 3.16"');
  assertJohn316(en, 'EN "John 3:16"');

  // PT e EN devem resolver para a MESMA referência (uma fonte da verdade).
  assert.deepEqual(
    { book: pt.book, chapter: pt.chapter, tag: pt.verses.tag, verse: pt.verses.inner.verse },
    { book: en.book, chapter: en.chapter, tag: en.verses.tag, verse: en.verses.inner.verse },
    'PT e EN devem resolver para a mesma Reference',
  );

  console.log('PASS — parseReference via wasm:');
  console.log(`  "Jo 3.16"   -> book=${pt.book} chapter=${pt.chapter} verses=Single{verse:${pt.verses.inner.verse}}`);
  console.log(`  "John 3:16" -> book=${en.book} chapter=${en.chapter} verses=Single{verse:${en.verses.inner.verse}}`);
}

main().catch((err) => {
  console.error('FAIL —', err?.message ?? err);
  process.exit(1);
});
