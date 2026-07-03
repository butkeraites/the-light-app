// i18n-coverage.test.mjs — F5.16 (GUARDA de cobertura i18n/tema; molde i18n.test.mjs)
//
// GUARDA HEADLESS DETERMINÍSTICA (node, SEM device/browser, SEM rede, SEM chave) que
// impede REGRESSÃO de i18n/tema depois que as telas foram migradas (F5.5 leitura, F5.8
// busca/nav, F5.11 painéis IA, F5.16 componentes restantes). É um LINT-LIKE sobre o
// FONTE dos arquivos COBERTOS (`app/components/*.tsx` + `app/app/**/*.tsx`). Falha (exit≠0)
// se detectar cromo hardcoded ou hex fora de token de tema. Três checagens:
//
//   (1) PARIDADE de catálogo pt↔en: todo MessageKey existe em pt E en (conjuntos idênticos),
//       e TODA chave está num namespace de CROMO (anti-alucinação estrutural: sem "versículo").
//   (2) CROMO HARDCODED: em cada arquivo coberto, depois de REMOVER comentários (lexer ciente
//       de strings/templates, para não confundir `//` de URL nem PT de comentário), NENHUM
//       texto visível (string literal, chunk estático de template, ou texto de JSX) pode conter
//       letra latina ACENTUADA ou uma PALAVRA-PT de cromo distinta — a menos que esteja na
//       ALLOWLIST (identificadores de licença/atribuição verbatim: OpenBible/STEP/CC-BY). Todo
//       cromo deve passar por `t(...)`; dados do store/usuário entram como `{param}` (nunca
//       como literal de cromo).
//   (3) HEX HARDCODED: nenhum `#rgb/#rgba/#rrggbb/#rrggbbaa` nos arquivos cobertos (as cores
//       vêm de TOKENS de `lib/theme.ts`; a paleta de marcação vive em `lib/highlightColors.ts`
//       — ambos FORA do escopo coberto de propósito; `web/vendor` idem).
//
// ANTI-ALUCINAÇÃO (LEI): a guarda REFORÇA que namespaces são só cromo e que texto bíblico /
// nomes de livro (store, por `locale`) / refs / atribuições CC-BY NÃO passam por `t()`. Ela
// NUNCA obriga traduzir conteúdo de store/modelo (esses entram como `{param}` interpolado).
//
// Um SELF-TEST embutido (§4) prova, com fontes SINTÉTICAS em memória, que o detector REPROVA
// violações (acento/PT em JSX/placeholder/accessibilityLabel; hex) e NÃO gera falso-positivo
// (comentários PT, `t()`, expressões `{...}`, template aninhado, símbolo `×`, atribuição CC-BY).
// Assim o Reviewer reproduz "a guarda pega uma violação" sem quebrar arquivo real.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..', '..'); // .../app
const ENTRY = join(__dirname, 'i18n-headless-entry.ts');

// ── Escopo COBERTO: componentes + telas do expo-router (onde o cromo vive). ───────────────
const COMPONENTS_DIR = join(APP_ROOT, 'components');
const APP_DIR = join(APP_ROOT, 'app');

/** Lista recursiva de arquivos `.tsx` sob `dir`. */
async function listTsx(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listTsx(full)));
    } else if (e.isFile() && e.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// ══ LEXER: remove comentários preservando posições (troca por espaço, mantém `\n`). ═══════
// Ciente de strings ('…'/"…") e template literals (`…` com `${…}` aninhável), para NÃO
// confundir `//`/`/*` dentro de string (ex.: `https://…`) com comentário, nem colher PT de
// comentário. Mantém strings, JSX text e código intactos — só apaga comentários.
function stripComments(src) {
  const n = src.length;
  const out = src.split('');
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (src[k] !== '\n') out[k] = ' ';
  };
  // Pilha de contextos: 'code' (topo / dentro de `${…}`) ou 'template' (dentro de backticks).
  const stack = [{ kind: 'code', brace: 0 }];
  let i = 0;
  while (i < n) {
    const f = stack[stack.length - 1];
    const c = src[i];
    if (f.kind === 'code') {
      // Comentário de linha.
      if (c === '/' && src[i + 1] === '/') {
        let j = i + 2;
        while (j < n && src[j] !== '\n') j++;
        blank(i, j);
        i = j;
        continue;
      }
      // Comentário de bloco (cobre JSX `{/* … */}`, pois o `/* … */` fica em contexto code).
      if (c === '/' && src[i + 1] === '*') {
        let j = i + 2;
        while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
        j = Math.min(n, j + 2);
        blank(i, j);
        i = j;
        continue;
      }
      // String '…' / "…": pula até o fecho (respeita escapes) — NUNCA é comentário.
      if (c === "'" || c === '"') {
        const q = c;
        let j = i + 1;
        while (j < n && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
        i = j < n ? j + 1 : n;
        continue;
      }
      // Início de template literal.
      if (c === '`') {
        stack.push({ kind: 'template' });
        i++;
        continue;
      }
      // Chaves: rastreio p/ saber quando um `${…}` fecha e volta ao template.
      if (c === '{') {
        f.brace++;
        i++;
        continue;
      }
      if (c === '}') {
        if (f.brace === 0 && stack.length > 1 && stack[stack.length - 2].kind === 'template') {
          stack.pop(); // fecha o `${…}`, volta ao template
          i++;
          continue;
        }
        if (f.brace > 0) f.brace--;
        i++;
        continue;
      }
      i++;
      continue;
    }
    // Contexto template.
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      stack.pop();
      i++;
      continue;
    }
    if (c === '$' && src[i + 1] === '{') {
      stack.push({ kind: 'code', brace: 0 }); // entra na expressão `${…}`
      i += 2;
      continue;
    }
    i++;
  }
  return out.join('');
}

// ══ DETECÇÃO de cromo hardcoded ══════════════════════════════════════════════════════════
// Letra latina ACENTUADA (Latin-1 Supplement) — EXCLUI × (U+00D7) e ÷ (U+00F7), que são
// símbolos matemáticos (ex.: `{ocorrências}×` no léxico), não texto humano.
const ACCENTED_RE = /[À-ÖØ-öø-ÿ]/;
// Palavras-PT de CROMO DISTINTAS e SEM acento (as acentuadas já caem no ACCENTED_RE). São
// específicas de UI (não colidem com identificadores/testIDs/EN do código): "note"≠"nota",
// "study"≠"estudo", "compare"≠"comparar" etc. Boundary `\b` evita casar substrings.
const PT_WORD_RE =
  /\b(fechar|notas?|salvar|remover|desmarcar|marcar|votos?|perguntar|pergunta|conversar?|comparar|estudar|estudo|exportar|enviar|buscar|escreva|provedor(?:es)?|minhas?)\b/i;
// Hex de cor hardcoded (3/4/6/8 dígitos). As cores devem vir de tokens de tema.
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;

// ALLOWLIST: linhas que contêm um marcador de licença/atribuição VERBATIM são isentas do
// check de cromo (essas strings ficam intocadas por requisito de licença — ADR-0016/0026).
const ALLOW_MARKERS = ['OpenBible', 'STEPBible', 'STEP Bible', 'CC-BY', 'CC BY', 'Tyndale'];

/** Nº da linha (1-based) do índice `idx` em `src`. */
function lineOfIndex(src, idx) {
  let line = 1;
  for (let k = 0; k < idx && k < src.length; k++) if (src[k] === '\n') line++;
  return line;
}

/** Texto (comment-stripped) da linha que contém `idx`, trimada. */
function lineTextAt(code, idx) {
  let start = idx;
  while (start > 0 && code[start - 1] !== '\n') start--;
  let end = idx;
  while (end < code.length && code[end] !== '\n') end++;
  return code.slice(start, end).trim();
}

/**
 * Encontra violações de CROMO num fonte já sem comentários (`code`). Retorna
 * `[{ line, kind, snippet }]`. `kind`: 'accented' | 'pt-word'.
 */
function findChromeViolations(code) {
  const out = [];
  const seen = new Set(); // dedupe por linha+kind
  const scan = (re, kind) => {
    // Varre cada match; ACCENTED_RE é single (sem /g) → usar exec incremental manual.
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = global.exec(code)) !== null) {
      const idx = m.index;
      const lineText = lineTextAt(code, idx);
      if (ALLOW_MARKERS.some((mk) => lineText.includes(mk))) continue;
      const line = lineOfIndex(code, idx);
      const key = `${line}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ line, kind, snippet: lineText.slice(0, 80) });
    }
  };
  scan(ACCENTED_RE, 'accented');
  scan(PT_WORD_RE, 'pt-word');
  return out;
}

/** Encontra hex hardcoded num fonte já sem comentários. Retorna `[{ line, snippet }]`. */
function findHexViolations(code) {
  const out = [];
  let m;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(code)) !== null) {
    out.push({ line: lineOfIndex(code, m.index), snippet: lineTextAt(code, m.index).slice(0, 80) });
  }
  return out;
}

async function loadCatalogs() {
  const outfile = join(tmpdir(), `i18n-cov-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    external: ['expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  // ══ (1) PARIDADE de catálogo pt↔en + anti-alucinação estrutural ════════════════════════
  const { CATALOGS, MESSAGE_KEYS } = await loadCatalogs();
  const ptKeys = Object.keys(CATALOGS.pt).sort();
  const enKeys = Object.keys(CATALOGS.en).sort();
  assert.deepEqual(ptKeys, enKeys, 'GUARDA: pt e en têm EXATAMENTE as mesmas chaves (paridade)');
  assert.deepEqual([...MESSAGE_KEYS].sort(), ptKeys, 'GUARDA: MESSAGE_KEYS reflete o catálogo');
  for (const key of MESSAGE_KEYS) {
    assert.ok(
      typeof CATALOGS.pt[key] === 'string' && CATALOGS.pt[key].length > 0,
      `GUARDA: pt["${key}"] não-vazio`,
    );
    assert.ok(
      typeof CATALOGS.en[key] === 'string' && CATALOGS.en[key].length > 0,
      `GUARDA: en["${key}"] não-vazio`,
    );
  }
  const CHROME_NAMESPACES = new Set([
    'home', 'search', 'nav', 'read', 'plans', 'ref', 'a11y', 'language', 'theme',
    'ai', 'ask', 'chat', 'compare', 'study', 'common', 'versePanel', 'xref',
    // F5.28: nomes de EXIBIÇÃO das cores da paleta de marcação (highlight.*) — cromo puro.
    'highlight',
    // F5.26 (ADR-0054): cromo da sincronização opt-in + backup — só rótulos/dicas/a11y
    // (o que sincroniza vs. o que nunca sai do aparelho); nenhum dado do store/usuário/token.
    'sync',
    // F5.35: cromo da tela SOBRE / créditos / licenças — rótulos/dicas/a11y + os DOIS
    // identificadores de licença CC-BY VERBATIM (about.xrefAttribution/about.stepAttribution,
    // idênticos pt/en, travados contra drift por `test:about-attr`). Nenhum texto bíblico.
    'about',
  ]);
  for (const key of MESSAGE_KEYS) {
    assert.ok(
      CHROME_NAMESPACES.has(key.split('.')[0]),
      `GUARDA: chave "${key}" está num namespace de CROMO (anti-alucinação)`,
    );
  }

  // ══ (4) SELF-TEST: prova (em memória) que o detector REPROVA violações e NÃO gera FP ════
  // Cada caso é um fonte sintético; validamos o número/tipo de achados após stripComments.
  const scanText = (src) => findChromeViolations(stripComments(src));
  const scanHex = (src) => findHexViolations(stripComments(src));

  // DEVE reprovar:
  assert.ok(
    scanText('const A = () => <Text>Configurações</Text>;').length > 0,
    'SELF-TEST: JSX text acentuado ("Configurações") é REPROVADO',
  );
  assert.ok(
    scanText('const A = () => <TextInput placeholder="Buscar" />;').some((v) => v.kind === 'pt-word'),
    'SELF-TEST: placeholder com palavra-PT ("Buscar") é REPROVADO',
  );
  assert.ok(
    scanText('const A = () => <Pressable accessibilityLabel="Salvar nota" />;').length > 0,
    'SELF-TEST: accessibilityLabel PT ("Salvar nota") é REPROVADO',
  );
  assert.ok(
    scanText('const s = `Olá ${nome}`;').some((v) => v.kind === 'accented'),
    'SELF-TEST: template com chunk estático acentuado ("Olá") é REPROVADO',
  );
  assert.equal(
    scanHex("const s = StyleSheet.create({ x: { color: '#ff0000' } });").length,
    1,
    'SELF-TEST: hex hardcoded ("#ff0000") é REPROVADO',
  );

  // NÃO deve reprovar (falso-positivo):
  assert.equal(
    scanText("const A = () => <Text>{t('versePanel.saveNote')}</Text>;").length,
    0,
    'SELF-TEST: cromo via t() NÃO é reprovado',
  );
  assert.equal(
    scanText('const A = () => <Text>{verse.text}</Text>;').length,
    0,
    'SELF-TEST: texto do store via expressão {…} NÃO é reprovado (anti-alucinação: verse.text é dado)',
  );
  assert.equal(
    scanText('// Não traduzir: versículo é do store; comentário em português.\nconst x = 1;').length,
    0,
    'SELF-TEST: comentário de linha em PT (acentuado) NÃO é reprovado (é removido)',
  );
  assert.equal(
    scanText('const A = () => (\n  <View>\n    {/* Configurações — comentário JSX em PT */}\n    <X/>\n  </View>\n);').length,
    0,
    'SELF-TEST: comentário JSX {/* … */} em PT NÃO é reprovado (é removido)',
  );
  assert.equal(
    scanText("const url = 'https://www.openbible.info/labs/cross-references/';").length,
    0,
    'SELF-TEST: `//` dentro de string (URL) NÃO vira comentário nem viola (sem acento/PT)',
  );
  assert.equal(
    scanText("export const XREF_ATTRIBUTION = 'Cross references courtesy of OpenBible.info (CC-BY)';").length,
    0,
    'SELF-TEST: atribuição CC-BY/OpenBible (allowlist) NÃO é reprovada (verbatim)',
  );
  assert.equal(
    scanText('const A = () => <Text>{e.occurrences}×</Text>;').length,
    0,
    'SELF-TEST: símbolo × (U+00D7) NÃO é confundido com letra acentuada',
  );
  assert.equal(
    scanText('const r = `${bookNameOf(b)} ${ch}${v ? `:${v}` : ""}`;').length,
    0,
    'SELF-TEST: template ANINHADO com chunks só de pontuação/dado NÃO é reprovado',
  );
  assert.equal(
    scanHex('const c = { color: colors.text, bg: colors.background };').length,
    0,
    'SELF-TEST: cores via token de tema NÃO são reprovadas',
  );

  // ══ (2)+(3) VARREDURA REAL dos arquivos cobertos ═══════════════════════════════════════
  const componentFiles = (await listTsx(COMPONENTS_DIR)).filter((f) => f.endsWith('.tsx'));
  const appFiles = await listTsx(APP_DIR);
  const covered = [...componentFiles, ...appFiles].sort();
  assert.ok(covered.length >= 15, `GUARDA: encontrou arquivos cobertos suficientes (${covered.length})`);

  const chromeFindings = [];
  const hexFindings = [];
  for (const file of covered) {
    const rel = relative(APP_ROOT, file);
    const code = stripComments(await readFile(file, 'utf8'));
    for (const v of findChromeViolations(code)) chromeFindings.push({ rel, ...v });
    for (const v of findHexViolations(code)) hexFindings.push({ rel, ...v });
  }

  if (chromeFindings.length > 0) {
    const report = chromeFindings
      .map((v) => `  ${v.rel}:${v.line} [${v.kind}] ${v.snippet}`)
      .join('\n');
    assert.fail(
      `GUARDA: cromo hardcoded (string PT/acentuada fora de t()) em arquivo(s) coberto(s):\n${report}\n` +
        'Migre para t(<key>) (adicione a chave em pt E en) ou interpole dados do store/usuário como {param}.',
    );
  }
  if (hexFindings.length > 0) {
    const report = hexFindings.map((v) => `  ${v.rel}:${v.line} ${v.snippet}`).join('\n');
    assert.fail(
      `GUARDA: hex de cor hardcoded fora de token de tema em arquivo(s) coberto(s):\n${report}\n` +
        'Use um token de lib/theme.ts (useTheme().colors.*).',
    );
  }

  console.log('PASS — GUARDA de cobertura i18n/tema (lint-like determinístico, sem device/rede):');
  console.log(`  (1) paridade pt↔en: ${MESSAGE_KEYS.length} chaves, mesmos conjuntos; todas em namespace de CROMO`);
  console.log(`  (2) cromo: ${covered.length} arquivos cobertos (components/*.tsx + app/**/*.tsx) sem string PT/acentuada fora de t() (comentários/URLs/atribuição CC-BY isentos)`);
  console.log(`  (3) tema: ${covered.length} arquivos sem hex hardcoded (cores só via tokens de theme.ts)`);
  console.log('  (4) self-test: detector REPROVA acento/PT em JSX/placeholder/a11y + hex; NÃO reprova t()/expressão/comentário PT/URL/CC-BY/×/template aninhado');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
