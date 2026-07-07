// a11y-scan.test.mjs — F5.20 (ADR-0048; molde i18n-coverage.test.mjs / contrast.test.mjs)
//
// GUARDA HEADLESS DETERMINÍSTICA (node, SEM device/browser, SEM rede, SEM chave) que impede
// REGRESSÃO de acessibilidade dos elementos INTERATIVOS depois da varredura da F5.20. É um
// LINT-LIKE sobre o FONTE de `app/components/*.tsx` + `app/app/**/*.tsx`: para cada elemento
// interativo (`<Pressable>`, `<TouchableOpacity/Highlight/WithoutFeedback>`, `<Switch>`,
// `<TextInput>`, `<Link>`) assevera, deterministicamente, TRÊS coisas — e FALHA (exit≠0) se
// alguma faltar:
//
//   (1) PAPEL (role): todo TOUCHABLE GENÉRICO (Pressable/Touchable*) — que renderiza uma View
//       SEM papel implícito — deve declarar `accessibilityRole`. `TextInput` (textbox),
//       `Switch` (switch) e `Link` (link) têm papel IMPLÍCITO do nativo → isentos do check de
//       role (forçar role neles pode até quebrar a semântica nativa).
//   (2) RÓTULO (label): todo interativo precisa de uma FONTE de rótulo — `accessibilityLabel`,
//       OU `placeholder` (TextInput), OU TEXTO FILHO (um `t(...)` de cromo, um `<Text>`, ou
//       palavra visível). ANTI-ALUCINAÇÃO: o rótulo pode vir de DADO do store (ex.: uma
//       referência "John 3:16" ou o abbrev/idioma da tradução) — isso NÃO é traduzido; só o
//       CROMO passa por `t()`. A guarda checa PRESENÇA de rótulo, não o idioma (isso é a
//       i18n-coverage).
//   (3) ALVO DE TOQUE (≥44): todo touchable genérico + Link deve declarar uma afordância de
//       alvo EXPLÍCITA — `hitSlop`, OU estilo que PREENCHE o container (`flex`/absolute-fill),
//       OU um tamanho/`padding`. FALHA se: (a) não há NENHUMA pista de tamanho, OU (b) há um
//       `height`/`minHeight`/`width`/`minWidth` FIXO numérico < 44 SEM `hitSlop` (alvo pequeno
//       demais, ex.: swatch 34×34). `TextInput`/`Switch` são controles NATIVOS com tamanho
//       intrínseco → isentos do check de tamanho.
//
// O texto do versículo/lexicon/atribuição NUNCA é tocado: isto é a11y de CROMO. A guarda não
// obriga traduzir dado do store (rótulos podem ser {param} do store — anti-alucinação).
//
// Um SELF-TEST embutido (§1) prova, com fontes SINTÉTICAS em memória, que o detector REPROVA
// violações (sem role; sem label; alvo fixo <44; sem tamanho) e NÃO gera falso-positivo
// (touchable completo; backdrop flex+label; swatch<44 mas com hitSlop; TextInput/Switch
// nativos; Link com texto+padding; chip com texto-filho como rótulo). Assim o Reviewer
// reproduz "a guarda pega uma violação" sem quebrar arquivo real.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..', '..'); // .../app
const COMPONENTS_DIR = join(APP_ROOT, 'components');
const APP_DIR = join(APP_ROOT, 'app');

// ── Tags interativas e políticas por tag ──────────────────────────────────────────────────
// Touchables GENÉRICOS: View pressionável SEM papel implícito → role E tamanho obrigatórios.
const GENERIC_TOUCHABLES = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'];
// Nativos com papel/tamanho INTRÍNSECOS: só rótulo é obrigatório.
const NATIVE_CONTROLS = ['TextInput', 'Switch'];
// Link: papel implícito (link), MAS é wrapper sem tamanho intrínseco → tamanho obrigatório.
const LINK_TAGS = ['Link'];
const ALL_TAGS = [...GENERIC_TOUCHABLES, ...NATIVE_CONTROLS, ...LINK_TAGS];

const roleRequired = (tag) => GENERIC_TOUCHABLES.includes(tag);
const sizeRequired = (tag) => GENERIC_TOUCHABLES.includes(tag) || LINK_TAGS.includes(tag);

const TOUCH_MIN = 44; // pt (iOS HIG); Android Material ~48dp — usamos 44 conservador.
const SIZE_KEYS = [
  'minHeight', 'height', 'minWidth', 'width',
  'padding', 'paddingVertical', 'paddingHorizontal', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
];

// ══ LEXER: remove comentários preservando posições (troca por espaço, mantém `\n`). ═══════
// Ciente de strings e template literals (com `${…}` aninhável) — igual à i18n-coverage — para
// NÃO confundir `//` de URL com comentário nem colher texto de comentário como filho.
function stripComments(src) {
  const n = src.length;
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (src[k] !== '\n') out[k] = ' '; };
  const stack = [{ kind: 'code', brace: 0 }];
  let i = 0;
  while (i < n) {
    const f = stack[stack.length - 1];
    const c = src[i];
    if (f.kind === 'code') {
      if (c === '/' && src[i + 1] === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; continue; }
      if (c === '/' && src[i + 1] === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j = Math.min(n, j + 2); blank(i, j); i = j; continue; }
      if (c === "'" || c === '"') { const q = c; let j = i + 1; while (j < n && src[j] !== q) j += src[j] === '\\' ? 2 : 1; i = j < n ? j + 1 : n; continue; }
      if (c === '`') { stack.push({ kind: 'template' }); i++; continue; }
      if (c === '{') { f.brace++; i++; continue; }
      if (c === '}') { if (f.brace === 0 && stack.length > 1 && stack[stack.length - 2].kind === 'template') { stack.pop(); i++; continue; } if (f.brace > 0) f.brace--; i++; continue; }
      i++; continue;
    }
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { stack.pop(); i++; continue; }
    if (c === '$' && src[i + 1] === '{') { stack.push({ kind: 'code', brace: 0 }); i += 2; continue; }
    i++;
  }
  return out.join('');
}

/** Lista recursiva de `.tsx` sob `dir`. */
async function listTsx(dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listTsx(full)));
    else if (e.isFile() && e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Nº da linha (1-based) do índice `idx`. */
function lineOfIndex(src, idx) {
  let line = 1;
  for (let k = 0; k < idx && k < src.length; k++) if (src[k] === '\n') line++;
  return line;
}

/**
 * A partir do `<` (índice `lt`), acha o fim da TAG DE ABERTURA respeitando strings, template
 * literals e `{…}` aninhados. Retorna `{ attrsEnd, selfClose }`. `attrs` = `code[lt..attrsEnd)`.
 */
function openingTagEnd(code, lt) {
  let i = lt + 1;
  while (i < code.length && /[A-Za-z0-9_.]/.test(code[i])) i++; // nome da tag
  let depth = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"') { const q = c; i++; while (i < code.length && code[i] !== q) i += code[i] === '\\' ? 2 : 1; i++; continue; }
    if (c === '`') { i++; while (i < code.length) { if (code[i] === '\\') { i += 2; continue; } if (code[i] === '`') { i++; break; } i++; } continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    if (depth === 0 && c === '/' && code[i + 1] === '>') return { attrsEnd: i + 2, selfClose: true };
    if (depth === 0 && c === '>') return { attrsEnd: i + 1, selfClose: false };
    i++;
  }
  return { attrsEnd: code.length, selfClose: false };
}

/** Acha o `</tag>` casado a partir de `fromIdx` (conta abre/fecha da MESMA tag). */
function findClose(code, tag, fromIdx) {
  const openRe = new RegExp('<' + tag + '\\b', 'g');
  const closeRe = new RegExp('</' + tag + '\\s*>', 'g');
  let depth = 1;
  let i = fromIdx;
  while (i < code.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(code);
    const cl = closeRe.exec(code);
    if (!cl) return code.length;
    if (o && o.index < cl.index) { depth++; i = o.index + '<'.length; }
    else { depth--; if (depth === 0) return cl.index; i = cl.index + 1; }
  }
  return code.length;
}

/** Extrai a expressão JSX `{ … }` do atributo `style=` (ou null). */
function styleAttrValue(attrs) {
  const m = /\bstyle\s*=/.exec(attrs);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (i < attrs.length && /\s/.test(attrs[i])) i++;
  if (attrs[i] !== '{') return null;
  let depth = 0;
  const start = i;
  for (; i < attrs.length; i++) {
    if (attrs[i] === '{') depth++;
    else if (attrs[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return attrs.slice(start, i);
}

/** Corpo de `NAME: { … }` de TODOS os blocos `StyleSheet.create({ … })` do arquivo. */
function parseStyleSheets(code) {
  const map = {};
  const createRe = /StyleSheet\.create\s*\(/g;
  let cm;
  while ((cm = createRe.exec(code)) !== null) {
    // captura o objeto-argumento balanceado
    let i = cm.index + cm[0].length;
    while (i < code.length && /\s/.test(code[i])) i++;
    if (code[i] !== '{') continue;
    let depth = 0;
    const objStart = i;
    for (; i < code.length; i++) { if (code[i] === '{') depth++; else if (code[i] === '}') { depth--; if (depth === 0) { i++; break; } } }
    const obj = code.slice(objStart + 1, i - 1);
    // membros de TOPO `name: { … }`
    let j = 0;
    while (j < obj.length) {
      const mm = /([A-Za-z0-9_]+)\s*:\s*\{/g;
      mm.lastIndex = j;
      const r = mm.exec(obj);
      if (!r) break;
      let k = r.index + r[0].length - 1;
      let d = 0;
      const s = k;
      for (; k < obj.length; k++) { if (obj[k] === '{') d++; else if (obj[k] === '}') { d--; if (d === 0) break; } }
      map[r[1]] = obj.slice(s, k + 1);
      j = k + 1;
    }
  }
  return map;
}

/** Todos os `styles.NAME` referenciados no valor de `style=`. */
function referencedStyleNames(styleValue) {
  const names = new Set();
  if (!styleValue) return names;
  const re = /styles\.([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(styleValue)) !== null) names.add(m[1]);
  return names;
}

const hasKey = (text, key) => new RegExp('\\b' + key + '\\s*:').test(text);
function numericOf(text, key) {
  const m = new RegExp('\\b' + key + '\\s*:\\s*(-?\\d+)').exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Varre um FONTE já sem comentários e devolve as violações de a11y interativa:
 * `[{ tag, line, kind, detail }]`. `kind` ∈ {'role','label','size'}.
 */
function scanSource(code) {
  const sheet = parseStyleSheets(code);
  const violations = [];
  let count = 0;
  for (const tag of ALL_TAGS) {
    const re = new RegExp('<' + tag + '\\b', 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const lt = m.index;
      const { attrsEnd, selfClose } = openingTagEnd(code, lt);
      const attrs = code.slice(lt, attrsEnd);
      const line = lineOfIndex(code, lt);
      count++;

      // filhos (para texto-rótulo)
      let children = '';
      if (!selfClose) {
        const cl = findClose(code, tag, attrsEnd);
        children = code.slice(attrsEnd, cl);
      }

      // ── (1) PAPEL ──────────────────────────────────────────────────────────────────────
      const hasRole = /\baccessibilityRole\s*=/.test(attrs);
      if (roleRequired(tag) && !hasRole) {
        violations.push({ tag, line, kind: 'role', detail: 'sem accessibilityRole (touchable genérico não tem papel implícito)' });
      }

      // ── (2) RÓTULO ─────────────────────────────────────────────────────────────────────
      const hasLabel = /\baccessibilityLabel\s*=/.test(attrs);
      const hasPlaceholder = /\bplaceholder\s*=/.test(attrs);
      const childStripped = children.replace(/<[^>]*>/g, ' ');
      const hasChildText = /\bt\(/.test(children) || /<Text\b/.test(children) || /[A-Za-zÀ-ÿ]{2,}/.test(childStripped);
      if (!(hasLabel || hasPlaceholder || hasChildText)) {
        violations.push({ tag, line, kind: 'label', detail: 'sem accessibilityLabel / placeholder / texto-filho' });
      }

      // ── (3) ALVO DE TOQUE ──────────────────────────────────────────────────────────────
      if (sizeRequired(tag)) {
        const styleValue = styleAttrValue(attrs) ?? '';
        const names = referencedStyleNames(styleValue);
        const bodies = [styleValue, ...[...names].map((n) => sheet[n] ?? '')].join('\n');
        const hasHitSlop = /\bhitSlop\s*=/.test(attrs);
        const hasFill = /\bflex\s*:/.test(bodies) || /position\s*:\s*['"]absolute['"]/.test(bodies) || /absoluteFill/.test(bodies);
        const anySize = SIZE_KEYS.some((k) => hasKey(bodies, k));
        // dimensão FIXA numérica < 44 (sem hitSlop) = alvo pequeno demais
        const fixedDims = ['minHeight', 'height', 'minWidth', 'width']
          .map((k) => ({ k, v: numericOf(bodies, k) }))
          .filter((d) => d.v != null);
        const tooSmall = fixedDims.find((d) => d.v < TOUCH_MIN);

        if (hasHitSlop || hasFill) {
          // ok: hitSlop expande a área; flex/fill preenche o container (alvo grande)
        } else if (tooSmall) {
          violations.push({ tag, line, kind: 'size', detail: `${tooSmall.k}:${tooSmall.v} < ${TOUCH_MIN} sem hitSlop` });
        } else if (!anySize) {
          violations.push({ tag, line, kind: 'size', detail: 'sem pista de alvo de toque (hitSlop/minHeight/padding/flex)' });
        }
      }
    }
  }
  return { violations, count };
}

async function main() {
  // ══ (1) SELF-TEST — o detector REPROVA violações e NÃO gera falso-positivo ══════════════
  const SYN_SHEET = `const styles = StyleSheet.create({
    ok: { paddingVertical: 12, paddingHorizontal: 16 },
    back: { flex: 1 },
    sw: { width: 34, height: 34 },
    big: { minHeight: 52, minWidth: 52 },
  });`;
  const scan = (jsx) => scanSource(stripComments(`function C(){ return (${jsx}); } ${SYN_SHEET}`)).violations;
  const kinds = (jsx) => scan(jsx).map((v) => v.kind).sort();

  // DEVE reprovar:
  assert.deepEqual(
    kinds(`<Pressable style={styles.ok} onPress={x}><Text>{t('a.b')}</Text></Pressable>`),
    ['role'],
    'SELF-TEST: Pressable SEM accessibilityRole é REPROVADO (role)',
  );
  assert.deepEqual(
    kinds(`<Pressable accessibilityRole="button" style={styles.back} onPress={x} />`),
    ['label'],
    'SELF-TEST: Pressable auto-fechado SEM rótulo/filho é REPROVADO (label)',
  );
  assert.deepEqual(
    kinds(`<Pressable accessibilityRole="button" accessibilityLabel={t('a.b')} style={styles.sw} onPress={x} />`),
    ['size'],
    'SELF-TEST: alvo FIXO 34×34 sem hitSlop é REPROVADO (size)',
  );
  assert.deepEqual(
    kinds(`<Pressable accessibilityRole="button" onPress={x}><Text>{t('a.b')}</Text></Pressable>`),
    ['size'],
    'SELF-TEST: Pressable SEM pista de tamanho é REPROVADO (size)',
  );

  // NÃO deve reprovar (falso-positivo):
  assert.deepEqual(
    scan(`<Pressable accessibilityRole="button" style={styles.ok} onPress={x}><Text>{t('a.b')}</Text></Pressable>`),
    [],
    'SELF-TEST: Pressable completo (role+filho+padding) NÃO é reprovado',
  );
  assert.deepEqual(
    scan(`<Pressable accessibilityRole="button" accessibilityLabel={t('a.b')} style={styles.back} onPress={x} />`),
    [],
    'SELF-TEST: backdrop (role+label+flex) NÃO é reprovado (flex preenche o container)',
  );
  assert.deepEqual(
    scan(`<Pressable accessibilityRole="button" accessibilityLabel={t('a.b')} style={styles.sw} hitSlop={8} onPress={x} />`),
    [],
    'SELF-TEST: swatch 34×34 COM hitSlop NÃO é reprovado (hitSlop expande o alvo)',
  );
  assert.deepEqual(
    scan(`<TextInput placeholder={t('a.b')} value={v} onChangeText={f} />`),
    [],
    'SELF-TEST: TextInput (nativo) com placeholder NÃO exige role/tamanho',
  );
  assert.deepEqual(
    scan(`<Switch value={v} onValueChange={f} accessibilityLabel={t('a.b')} />`),
    [],
    'SELF-TEST: Switch (nativo) com label NÃO exige role/tamanho',
  );
  assert.deepEqual(
    scan(`<Link href="/read" style={styles.ok} accessibilityRole="link" accessibilityLabel={t('a.b')}>{t('a.b')}</Link>`),
    [],
    'SELF-TEST: Link com padding + texto NÃO é reprovado',
  );
  assert.deepEqual(
    scan(`<Pressable accessibilityRole="button" style={styles.ok} onPress={x}><Text>{item.abbrev}</Text></Pressable>`),
    [],
    'SELF-TEST: chip com TEXTO-FILHO (dado do store) serve de rótulo — NÃO reprovado (anti-alucinação)',
  );
  assert.deepEqual(
    scan(`<Pressable accessibilityRole="button" accessibilityLabel={t('a.b')} style={styles.big} onPress={x} />`),
    [],
    'SELF-TEST: alvo fixo 52×52 (≥44) NÃO é reprovado',
  );

  // ══ (2) VARREDURA REAL dos arquivos cobertos ═══════════════════════════════════════════
  const componentFiles = await listTsx(COMPONENTS_DIR);
  const appFiles = await listTsx(APP_DIR);
  const covered = [...componentFiles, ...appFiles].sort();
  assert.ok(covered.length >= 15, `GUARDA: arquivos cobertos suficientes (${covered.length})`);

  const findings = [];
  let total = 0;
  const byTag = {};
  for (const file of covered) {
    const rel = relative(APP_ROOT, file);
    const { violations, count } = scanSource(stripComments(await readFile(file, 'utf8')));
    total += count;
    for (const v of violations) findings.push({ rel, ...v });
  }
  for (const tag of ALL_TAGS) byTag[tag] = 0;
  // reconta por tag (para o relatório)
  for (const file of covered) {
    const code = stripComments(await readFile(file, 'utf8'));
    for (const tag of ALL_TAGS) {
      const re = new RegExp('<' + tag + '\\b', 'g');
      while (re.exec(code) !== null) byTag[tag]++;
    }
  }
  // Piso de sanidade ("o scanner não está vazio/quebrado"), NÃO um alvo de cobertura. Conforme o
  // kit Vigil (ADR-0066/0068) é adotado, N usos de <Button>/<Chip>/<ListRow> colapsam no ÚNICO
  // <Pressable> interno de cada primitiva (contado uma vez), então o total de interativos CRUS
  // encolhe legitimamente. As checagens reais (role/label/alvo) seguem rodando em cada interativo.
  assert.ok(total >= 25, `GUARDA: varreu elementos interativos suficientes (${total}) — o scanner não está vazio`);

  if (findings.length > 0) {
    const report = findings.map((v) => `  ${v.rel}:${v.line} <${v.tag}> [${v.kind}] ${v.detail}`).join('\n');
    assert.fail(
      `GUARDA a11y: elemento(s) interativo(s) sem role/label/alvo-de-toque:\n${report}\n` +
        'Adicione accessibilityRole (touchable genérico), um rótulo (accessibilityLabel/placeholder/texto), e um alvo ≥44 (hitSlop/minHeight/padding/flex).',
    );
  }

  const tagSummary = ALL_TAGS.filter((t) => byTag[t] > 0).map((t) => `${t}×${byTag[t]}`).join(', ');
  console.log('PASS — GUARDA de a11y de elementos INTERATIVOS (lint-like determinístico, sem device/rede):');
  console.log(`  varreu ${total} interativos em ${covered.length} arquivos (${tagSummary})`);
  console.log('  (1) role: todo Pressable/Touchable* declara accessibilityRole (TextInput/Switch/Link: papel implícito)');
  console.log('  (2) label: todo interativo tem accessibilityLabel / placeholder / texto-filho (rótulo pode ser dado do store)');
  console.log(`  (3) alvo de toque: hitSlop/flex/tamanho — falha se dim fixa < ${TOUCH_MIN} sem hitSlop (TextInput/Switch: nativos)`);
  console.log('  (4) self-test: detector REPROVA sem-role / sem-label / fixo<44 / sem-tamanho; NÃO reprova completo / backdrop-flex / swatch+hitSlop / nativo / Link / texto-filho');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
