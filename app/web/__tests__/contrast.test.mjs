// contrast.test.mjs — F5.18 (ADR-0046; molde theme.test.mjs)
//
// GUARDA HEADLESS de CONTRASTE WCAG AA (node, SEM device/browser, SEM rede) das paletas de
// tema (claro/escuro). Bundla (esbuild) `app/lib/themePalettes.ts` (tokens de cor PUROS) +
// `app/lib/contrast.ts` (matemática WCAG 2.x + spec dos pares) e assevera, deterministicamente:
//   1) MATEMÁTICA WCAG conferida contra âncoras conhecidas (preto/branco = 21:1; simétrica;
//      #767676 sobre branco ≈ 4.54:1 — o cinza AA-mínimo canônico);
//   2) GUARDA: TODO par texto/UI SIGNIFICATIVO (AUDITED_PAIRS) em LIGHT e DARK atinge AA
//      (4.5:1 normal / 3:1 grande+UI). FALHA se algum reprovar — é a guarda anti-regressão;
//   3) PROVA de que a guarda PEGA uma regressão: injeta um token que reprova numa CÓPIA da
//      paleta e exige que a auditoria acuse `pass:false` (a guarda não é vacuosa);
//   4) DECORATIVOS (faint/divider/border) são REPORTADOS (contra 3:1) mas NÃO bloqueiam
//      (WCAG 1.4.11 decorativo) — documenta a política sem esconder os números;
//   5) HIGIENE: `themePalettes.ts`/`contrast.ts` sem `console.*`; todo token é hex #rrggbb.
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
const ENTRY = join(__dirname, 'contrast-headless-entry.ts');
const PALETTES_TS = join(__dirname, '..', '..', 'lib', 'themePalettes.ts');
const CONTRAST_TS = join(__dirname, '..', '..', 'lib', 'contrast.ts');

async function loadBundle() {
  const outfile = join(tmpdir(), `contrast-headless-${randomBytes(6).toString('hex')}.mjs`);
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

const fmt = (r) => `${r.toFixed(2)}:1`;

async function main() {
  const {
    PALETTES,
    AUDITED_PAIRS,
    DECORATIVE_PAIRS,
    auditPair,
    auditPalettes,
    contrastRatio,
    relativeLuminance,
    hexToRgb,
  } = await loadBundle();

  // ══ (1) MATEMÁTICA WCAG — âncoras conhecidas ═══════════════════════════════════════════
  assert.equal(relativeLuminance('#000000'), 0, 'luminância do preto = 0');
  assert.equal(relativeLuminance('#ffffff'), 1, 'luminância do branco = 1');
  assert.ok(
    Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9,
    'preto↔branco = 21:1 (contraste máximo)',
  );
  assert.equal(
    contrastRatio('#ffffff', '#000000'),
    contrastRatio('#000000', '#ffffff'),
    'contrastRatio é simétrica',
  );
  assert.equal(contrastRatio('#abcdef', '#abcdef'), 1, 'cor consigo mesma = 1:1');
  // #767676 sobre branco é o CINZA AA-mínimo canônico (~4.54:1) — valida a fórmula real.
  const grayMin = contrastRatio('#767676', '#ffffff');
  assert.ok(grayMin >= 4.5 && grayMin < 4.6, `#767676/#fff ≈ 4.54:1 (veio ${fmt(grayMin)})`);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5, '#777 sobre branco reprova (abaixo do mínimo)');
  // hexToRgb: #rrggbb e forma curta #rgb; hex inválido lança (guarda de higiene).
  assert.deepEqual(hexToRgb('#ffffff'), [255, 255, 255], 'hexToRgb(#ffffff)');
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255], 'hexToRgb(#fff) expande a forma curta');
  assert.deepEqual(hexToRgb('#916c00'), [145, 108, 0], 'hexToRgb(#916c00)');
  assert.throws(() => hexToRgb('nope'), /hex inválido/, 'hex inválido lança');

  // ══ (2) GUARDA — todo par SIGNIFICATIVO passa AA em LIGHT e DARK ════════════════════════
  const results = auditPalettes(AUDITED_PAIRS, PALETTES);
  assert.equal(
    results.length,
    AUDITED_PAIRS.length * Object.keys(PALETTES).length,
    'auditou cada par em cada modo',
  );
  const failures = results.filter((r) => !r.pass);
  const report = (rows) =>
    rows
      .map((r) => `    ${r.pass ? 'PASS' : 'FAIL'}  ${fmt(r.ratio)}  (≥${r.target})  [${r.mode}] ${r.fg}/${r.bg} — ${r.role}`)
      .join('\n');
  assert.equal(
    failures.length,
    0,
    `TODOS os pares significativos devem atingir AA. Reprovaram:\n${report(failures)}`,
  );
  // Sanidade: os pares AJUSTADOS na F5.18 (LIGHT muted/accent/chipLang) agora passam com margem.
  const byId = (mode, fg, bg) => results.find((r) => r.mode === mode && r.fg === fg && r.bg === bg);
  assert.ok(byId('light', 'muted', 'background').ratio >= 4.5, 'LIGHT muted/bg ≥ 4.5 (ajustado)');
  assert.ok(byId('light', 'accent', 'background').ratio >= 4.5, 'LIGHT accent/bg ≥ 4.5 (ajustado)');
  assert.ok(byId('light', 'chipLang', 'background').ratio >= 4.5, 'LIGHT chipLang/bg ≥ 4.5 (ajustado)');

  // ══ (3) A GUARDA PEGA UMA REGRESSÃO — não é vacuosa ════════════════════════════════════
  // Injeta um token de texto que REPROVA numa CÓPIA da paleta (não muta a real) e exige que
  // a auditoria acuse pass:false. Se a guarda deixasse passar, ELA MESMA falharia aqui.
  const broken = {
    light: { ...PALETTES.light, muted: '#bdbdbd' }, // cinza claro sobre branco → ~1.9:1
    dark: { ...PALETTES.dark },
  };
  const brokenResults = auditPalettes(AUDITED_PAIRS, broken);
  const injected = brokenResults.find((r) => r.mode === 'light' && r.fg === 'muted' && r.bg === 'background');
  assert.ok(injected && !injected.pass, 'a guarda ACUSA o token injetado que reprova (não é vacuosa)');
  assert.ok(injected.ratio < 4.5, `token injetado reprova de fato (${fmt(injected.ratio)} < 4.5)`);
  // E a paleta REAL segue intacta/verde (a injeção foi só na cópia).
  assert.ok(
    auditPalettes(AUDITED_PAIRS, PALETTES).every((r) => r.pass),
    'a paleta REAL permanece 100% verde (a injeção não a mutou)',
  );
  // Prova simétrica com auditPair direto: um alvo 'large' (3:1) também é PEGO quando reprova.
  const uiFail = auditPair('light', { ...PALETTES.light, faint: '#f0f0f0' }, {
    fg: 'faint',
    bg: 'background',
    level: 'large',
    role: 'ui probe',
  });
  assert.ok(!uiFail.pass && uiFail.target === 3, 'alvo 3:1 (grande/UI) também é aplicado e pego');

  // ══ (4) DECORATIVOS — reportados, NÃO bloqueiam (WCAG 1.4.11 decorativo) ════════════════
  const decorative = auditPalettes(DECORATIVE_PAIRS, PALETTES);
  assert.equal(
    decorative.length,
    DECORATIVE_PAIRS.length * Object.keys(PALETTES).length,
    'decorativos são AUDITADOS (reportados) — só não entram na guarda bloqueante',
  );

  // ══ (5) HIGIENE — sem console.*; todo token é hex #rrggbb ═══════════════════════════════
  const palettesSrc = await readFile(PALETTES_TS, 'utf8');
  const contrastSrc = await readFile(CONTRAST_TS, 'utf8');
  assert.ok(!/console\./.test(palettesSrc), 'themePalettes.ts sem `console.*`');
  assert.ok(!/console\./.test(contrastSrc), 'contrast.ts sem `console.*`');
  for (const [mode, colors] of Object.entries(PALETTES)) {
    for (const [token, hex] of Object.entries(colors)) {
      assert.ok(/^#[0-9a-f]{6}$/.test(hex), `[${mode}] ${token}="${hex}" é hex #rrggbb`);
    }
  }

  console.log('PASS — GUARDA de contraste WCAG AA das paletas de tema (headless, sem device/rede):');
  console.log('  matemática WCAG: preto↔branco=21:1, simétrica, #767676/#fff≈4.54 (cinza AA-mínimo), #777 reprova');
  console.log(`  guarda: ${AUDITED_PAIRS.length} pares × ${Object.keys(PALETTES).length} modos = ${results.length} — TODOS passam AA (4.5 normal / 3 grande+UI)`);
  console.log('  LIGHT (ajustados na F5.18):');
  console.log(`    muted/bg    ${fmt(byId('light', 'muted', 'background').ratio)}  (era 3.54 ✗ → #6b6b6b)`);
  console.log(`    accent/bg   ${fmt(byId('light', 'accent', 'background').ratio)}  (era 3.42 ✗ → #916c00)`);
  console.log(`    chipLang/bg ${fmt(byId('light', 'chipLang', 'background').ratio)}  (era 2.85 ✗ → #737373)`);
  console.log('  guarda NÃO-vacuosa: token injetado (#bdbdbd) é ACUSADO (pass:false); paleta real segue verde');
  console.log(`  decorativos (faint/divider/border): ${decorative.length} reportados, não bloqueiam (1.4.11)`);
  console.log('  higiene: themePalettes.ts / contrast.ts sem console.*; todo token é hex #rrggbb');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
