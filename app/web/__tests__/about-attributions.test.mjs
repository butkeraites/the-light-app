// about-attributions.test.mjs — F5.35 (guard de FONTE-DA-VERDADE das atribuições CC-BY)
//
// GUARDA HEADLESS DETERMINÍSTICA (node, SEM device/browser/rede/chave) que trava as DUAS
// strings de atribuição CC-BY exibidas na tela SOBRE (`app/app/about.tsx`, via i18n) como
// CÓPIAS BYTE-A-BYTE das constantes FONTE-DA-VERDADE nos painéis de leitura:
//
//   about.xrefAttribution  ==  XREF_ATTRIBUTION  (components/ReaderXrefPanel.tsx) — OpenBible CC-BY
//   about.stepAttribution  ==  STEP_ATTRIBUTION  (components/ReaderStudyPanel.tsx) — STEP/Tyndale CC BY 4.0
//
// Também exige que pt E en tenham a MESMA string p/ cada uma (são IDENTIFICADORES de licença
// VERBATIM, não texto traduzível). Extrai os literais por TEXTO (sem bundlar os painéis
// pesados) — robusto e offline. Se alguém editar a constante fonte OU a string do catálogo e
// elas divergirem (drift), esta guarda FALHA (exit≠0), preservando o requisito de licença.
//
// Um SELF-TEST (§1) prova que o extrator lê literais aspas-simples/duplas e multi-linha, e que
// o comparador PEGA um drift. Sai 0 se tudo bater; ≠0 caso contrário.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..', '..'); // .../app
const XREF_PANEL = join(APP_ROOT, 'components', 'ReaderXrefPanel.tsx');
const STEP_PANEL = join(APP_ROOT, 'lib', 'attribution.ts'); // ADR-0074: STEP_ATTRIBUTION saiu do painel p/ o lib
const ABOUT_SCREEN = join(APP_ROOT, 'app', 'about.tsx'); // Rodada 3: BLIVRE_ATTRIBUTION (CC-BY BLIVRE)
const I18N = join(APP_ROOT, 'lib', 'i18n.ts');

/** Lê um literal de string JS a partir de `fromIdx` (pula espaços; aspas simples OU duplas). */
function readStringAt(src, fromIdx) {
  let i = fromIdx;
  while (i < src.length && /\s/.test(src[i])) i++;
  const quote = src[i];
  assert.ok(quote === "'" || quote === '"', `esperava aspas em ${i}, achei ${JSON.stringify(quote)}`);
  i++;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const next = src[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next; // \' \" \\ \n \t
      i += 2;
      continue;
    }
    if (c === quote) break;
    out += c;
    i++;
  }
  return out;
}

/** Primeiro literal após `marker` (RegExp) em `src`, ou lança se ausente. */
function extractAfter(src, marker) {
  const m = marker.exec(src);
  assert.ok(m, `marcador ${marker} não encontrado`);
  return readStringAt(src, m.index + m[0].length);
}

/** TODOS os literais após cada ocorrência de `marker` (global) em `src`. */
function extractAll(src, marker) {
  const re = new RegExp(marker.source, marker.flags.includes('g') ? marker.flags : marker.flags + 'g');
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(readStringAt(src, m.index + m[0].length));
  return out;
}

async function main() {
  // ══ (1) SELF-TEST — extrator + comparador ══════════════════════════════════════════════
  assert.equal(
    extractAfter("export const X =\n  'hello world';", /export const X\s*=/),
    'hello world',
    'SELF-TEST: literal aspas-simples multi-linha é lido',
  );
  assert.equal(
    extractAfter(`const K = "it's a 'test'";`, /const K\s*=/),
    "it's a 'test'",
    'SELF-TEST: literal aspas-duplas contendo aspas-simples é lido inteiro',
  );
  assert.equal(extractAll("a:'x'\nb:'x'", /[ab]:/).length, 2, 'SELF-TEST: extractAll acha todas as ocorrências');
  assert.notEqual('CC-BY', 'CC BY 4.0', 'SELF-TEST: o comparador distingue strings diferentes (não-vacuoso)');

  // ══ (2) FONTES DA VERDADE (constantes dos painéis) ═════════════════════════════════════
  const xrefSrc = await readFile(XREF_PANEL, 'utf8');
  const stepSrc = await readFile(STEP_PANEL, 'utf8');
  const aboutSrc = await readFile(ABOUT_SCREEN, 'utf8');
  const xrefConst = extractAfter(xrefSrc, /export const XREF_ATTRIBUTION\s*=/);
  const stepConst = extractAfter(stepSrc, /export const STEP_ATTRIBUTION\s*=/);
  const blivreConst = extractAfter(aboutSrc, /export const BLIVRE_ATTRIBUTION\s*=/);
  assert.ok(blivreConst.includes('BLIVRE') && blivreConst.includes('CC-BY'), 'BLIVRE_ATTRIBUTION e a atribuicao Biblia Livre CC-BY');
  assert.ok(xrefConst.includes('OpenBible') && xrefConst.includes('CC-BY'), 'XREF_ATTRIBUTION é a atribuição OpenBible CC-BY');
  assert.ok(stepConst.includes('STEP Bible') && stepConst.includes('CC BY 4.0'), 'STEP_ATTRIBUTION é a atribuição STEP CC BY 4.0');

  // ══ (3) CATÁLOGO i18n — pt E en idênticos E == constante fonte ═════════════════════════
  const i18nSrc = await readFile(I18N, 'utf8');
  const xrefCatalog = extractAll(i18nSrc, /'about\.xrefAttribution':/);
  const stepCatalog = extractAll(i18nSrc, /'about\.stepAttribution':/);
  const blivreCatalog = extractAll(i18nSrc, /'about\.blivreAttribution':/);
  assert.equal(blivreCatalog.length, 2, 'about.blivreAttribution aparece em pt E en (2x)');
  for (const [i, v] of blivreCatalog.entries()) {
    assert.equal(v, blivreConst, `about.blivreAttribution[${i}] == BLIVRE_ATTRIBUTION (byte-a-byte)`);
  }
  assert.equal(blivreCatalog[0], blivreCatalog[1], 'about.blivreAttribution identico pt/en (identificador de licenca)');
  assert.equal(xrefCatalog.length, 2, "about.xrefAttribution aparece em pt E en (2 ocorrências)");
  assert.equal(stepCatalog.length, 2, "about.stepAttribution aparece em pt E en (2 ocorrências)");

  for (const [i, v] of xrefCatalog.entries()) {
    assert.equal(v, xrefConst, `about.xrefAttribution[${i}] é cópia byte-a-byte de XREF_ATTRIBUTION`);
  }
  for (const [i, v] of stepCatalog.entries()) {
    assert.equal(v, stepConst, `about.stepAttribution[${i}] é cópia byte-a-byte de STEP_ATTRIBUTION`);
  }
  assert.equal(xrefCatalog[0], xrefCatalog[1], 'about.xrefAttribution é IDÊNTICO em pt/en (identificador de licença)');
  assert.equal(stepCatalog[0], stepCatalog[1], 'about.stepAttribution é IDÊNTICO em pt/en (identificador de licença)');

  console.log('PASS — GUARDA fonte-da-verdade das atribuições CC-BY da tela Sobre (headless, sem device/rede):');
  console.log(`  about.xrefAttribution == XREF_ATTRIBUTION (OpenBible CC-BY), idêntico pt/en: "${xrefConst}"`);
  console.log(`  about.stepAttribution == STEP_ATTRIBUTION (STEP/Tyndale CC BY 4.0), idêntico pt/en`);
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
