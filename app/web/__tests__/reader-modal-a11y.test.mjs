// reader-modal-a11y.test.mjs — F5.21 (ADR-0049; molde a11y-scan.test.mjs / i18n-coverage.test.mjs)
//
// GUARDA HEADLESS DETERMINÍSTICA (node, SEM device/browser, SEM rede, SEM chave) da a11y de
// RUNTIME dos PAINÉIS MODAIS de leitura (Ask/Chat/Compare/Study/Verse/Xref). a11y de "dynamic
// type" e "semântica de modal" são PROPRIEDADES ESTÁTICAS de React Native (props JSX), não uma
// chamada de fronteira/runtime do core — logo a prova HONESTA é uma varredura LINT-LIKE do
// FONTE, não um marcador de runtime. Emite o marcador `TLA_A11Y` (grep-ável, molde dos TLA_*),
// que o `scripts/run-ios-selftest.sh` assevera SEM regressão dos marcadores de FRONTEIRA (core).
//
// Para CADA painel de leitura que renderiza `<Modal>`, assevera TRÊS coisas — e FALHA (exit≠0)
// se alguma faltar:
//   (1) SEMÂNTICA DE MODAL: a View-folha declara `accessibilityViewIsModal` (foco PRESO — o
//       leitor de tela IGNORA o conteúdo atrás do painel). [modal=true]
//   (2) FOCO/ANÚNCIO: o painel usa o hook `useReaderModalA11y(...)` (ao abrir, pousa o foco no
//       título) E o título tem `accessibilityRole="header"` (ordem de foco lógica: cabeçalho→
//       conteúdo→ações; o leitor LÊ o título = anúncio idiomático de abertura). [focus=ok]
//   (3) RÓTULO DA DIALOG: o painel tem um `<Text>` de título como âncora de nome acessível
//       (o mesmo header do (2)). Os RÓTULOS dos controles interativos são cobertos pela guarda
//       F5.20 (`test:a11y-scan`) — aqui só o rótulo da REGIÃO modal. [labels=ok]
//
// DYNAMIC TYPE (escala de fonte): varre components/*.tsx + app/**/*.tsx e FALHA se algum
// `allowFontScaling={false}` (ou `: false`) TRAVAR a escala de fonte do sistema no texto de
// leitura/cromo — a UI deve RESPEITAR o dynamic type (RN escala por padrão). Uma afordância
// minúscula legítima pode manter o lock DESDE QUE a linha traga o marcador de política
// `a11y-allow-fontscale-lock` (escape documentado). [scale=ok]
//
// ANTI-ALUCINAÇÃO: a11y de CROMO — nenhum texto bíblico é tocado (o versículo escala com o
// tema/fonte, mas o conteúdo vem do store, verbatim). A guarda checa PRESENÇA de props, não
// idioma (isso é a i18n-coverage) nem contraste (contrast) nem role/label de controle (a11y-scan).
//
// Um SELF-TEST embutido (§1) prova, com fontes SINTÉTICAS em memória, que o detector REPROVA
// violações (Modal sem accessibilityViewIsModal; sem hook; sem header; lock de fonte sem marker)
// e NÃO gera falso-positivo (painel completo; lock COM marker). Assim o Reviewer reproduz "a
// guarda pega uma violação" sem quebrar arquivo real.
//
// Sai 0 (e emite TLA_A11Y ...) se tudo bater; ≠0 caso contrário.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, basename } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, '..', '..'); // .../app
const COMPONENTS_DIR = join(APP_ROOT, 'components');
const APP_DIR = join(APP_ROOT, 'app');

// Painel de leitura = componente `Reader*Panel.tsx` (Verse/Ask/Study/Compare/Chat/Xref).
const READING_PANEL_RE = /^Reader.*Panel\.tsx$/;
// Escape DOCUMENTADO p/ manter um lock de escala numa afordância minúscula legítima.
const FONTSCALE_LOCK_ALLOW = 'a11y-allow-fontscale-lock';

// ══ LEXER: remove comentários preservando posições (troca por espaço, mantém `\n`). ═══════
// Ciente de strings e template literals (com `${…}` aninhável) — igual às guardas F5.16/F5.20 —
// para NÃO confundir `//` de URL com comentário nem colher props de código comentado.
function stripComments(src) {
  const n = src.length;
  const out = src.split('');
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (src[k] !== '\n') out[k] = ' ';
  };
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

/** Texto da linha que contém `idx`, trimada. */
function lineTextAt(code, idx) {
  let s = idx; while (s > 0 && code[s - 1] !== '\n') s--;
  let e = idx; while (e < code.length && code[e] !== '\n') e++;
  return code.slice(s, e).trim();
}

// ── Detectores (sobre o fonte JÁ sem comentários) ─────────────────────────────────────────
const rendersModal = (code) => /<Modal\b/.test(code);
const hasViewIsModal = (code) => /\baccessibilityViewIsModal\b/.test(code);
const usesModalHook = (code) => /\buseReaderModalA11y\s*\(/.test(code);
const hasHeaderRole = (code) => /\baccessibilityRole\s*=\s*["']header["']/.test(code);
const hasTitleText = (code) => /<Text\b/.test(code);

/**
 * Achados de LOCK de escala de fonte (`allowFontScaling={false}` ou `: false`) SEM o marker de
 * política. Retorna `[{ line, snippet }]`. Um lock COM o marker `a11y-allow-fontscale-lock` na
 * MESMA linha (do fonte ORIGINAL, onde o comentário ainda existe) é isento.
 */
function fontScaleLocks(codeStripped, rawSrc) {
  const out = [];
  const re = /allowFontScaling\s*(?:=\s*\{\s*false\s*\}|:\s*false\b)/g;
  let m;
  while ((m = re.exec(codeStripped)) !== null) {
    const line = lineOfIndex(codeStripped, m.index);
    const rawLine = rawSrc.split('\n')[line - 1] ?? '';
    if (rawLine.includes(FONTSCALE_LOCK_ALLOW)) continue; // escape documentado
    out.push({ line, snippet: lineTextAt(codeStripped, m.index).slice(0, 80) });
  }
  return out;
}

/** Violações de modal-a11y de UM painel (fonte já sem comentários). `kind` ∈ {modal,focus,label}. */
function scanPanel(code) {
  const v = [];
  if (!hasViewIsModal(code)) v.push({ kind: 'modal', detail: 'View-folha do painel sem accessibilityViewIsModal (foco não fica preso ao modal)' });
  if (!usesModalHook(code)) v.push({ kind: 'focus', detail: 'painel não usa useReaderModalA11y (sem foco inicial/anúncio de abertura)' });
  if (!hasHeaderRole(code)) v.push({ kind: 'focus', detail: 'título sem accessibilityRole="header" (ordem de foco/anúncio)' });
  if (!hasTitleText(code)) v.push({ kind: 'label', detail: 'painel sem <Text> de título (âncora de nome acessível da dialog)' });
  return v;
}

async function main() {
  // ══ (1) SELF-TEST — o detector REPROVA violações e NÃO gera falso-positivo ══════════════
  const S = (jsx) => stripComments(jsx);

  const COMPLETE = `
    <Modal visible={visible}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text ref={titleRef} accessibilityRole="header" style={styles.title}>{t('x.title')}</Text>
        </View>
      </View>
    </Modal>`;
  const HOOK = 'const titleRef = useReaderModalA11y(visible);';

  assert.deepEqual(
    scanPanel(S(COMPLETE + HOOK)).map((x) => x.kind).sort(),
    [],
    'SELF-TEST: painel COMPLETO (viewIsModal + hook + header + título) NÃO é reprovado',
  );
  assert.deepEqual(
    scanPanel(S(`<Modal><View style={styles.sheet}><Text accessibilityRole="header">{t('x')}</Text></View></Modal>` + HOOK))
      .map((x) => x.kind),
    ['modal'],
    'SELF-TEST: Modal SEM accessibilityViewIsModal é REPROVADO (modal)',
  );
  assert.deepEqual(
    scanPanel(S(`<Modal><View accessibilityViewIsModal><Text accessibilityRole="header">{t('x')}</Text></View></Modal>`))
      .map((x) => x.kind),
    ['focus'],
    'SELF-TEST: painel SEM o hook useReaderModalA11y é REPROVADO (focus)',
  );
  assert.deepEqual(
    scanPanel(S(`<Modal><View accessibilityViewIsModal><Text>{t('x')}</Text></View></Modal>` + HOOK))
      .map((x) => x.kind),
    ['focus'],
    'SELF-TEST: título SEM accessibilityRole="header" é REPROVADO (focus)',
  );

  // Dynamic type: lock de escala de fonte.
  const lockNoMarker = 'const T = () => <Text allowFontScaling={false}>{verse.text}</Text>;';
  assert.equal(
    fontScaleLocks(S(lockNoMarker), lockNoMarker).length,
    1,
    'SELF-TEST: allowFontScaling={false} SEM marker é REPROVADO (trava dynamic type)',
  );
  const lockObj = 'const s = { allowFontScaling: false };';
  assert.equal(
    fontScaleLocks(S(lockObj), lockObj).length,
    1,
    'SELF-TEST: allowFontScaling: false (objeto) SEM marker é REPROVADO',
  );
  const lockWithMarker = 'const T = () => <Text allowFontScaling={false}>{icon}</Text>; // a11y-allow-fontscale-lock: ícone glyph';
  assert.equal(
    fontScaleLocks(S(lockWithMarker), lockWithMarker).length,
    0,
    'SELF-TEST: lock COM marker a11y-allow-fontscale-lock NÃO é reprovado (escape documentado)',
  );
  const noLock = 'const T = () => <Text>{verse.text}</Text>;';
  assert.equal(
    fontScaleLocks(S(noLock), noLock).length,
    0,
    'SELF-TEST: SEM allowFontScaling (escala default = respeitada) NÃO é reprovado',
  );

  // ══ (2) VARREDURA REAL ═════════════════════════════════════════════════════════════════
  const componentFiles = await listTsx(COMPONENTS_DIR);
  const readingPanels = componentFiles.filter((f) => READING_PANEL_RE.test(basename(f))).sort();
  assert.ok(readingPanels.length >= 6, `GUARDA: encontrou os painéis de leitura esperados (${readingPanels.length} de >=6)`);

  const modalPanels = [];
  const findings = [];
  for (const file of readingPanels) {
    const rel = relative(APP_ROOT, file);
    const code = stripComments(await readFile(file, 'utf8'));
    if (!rendersModal(code)) continue; // painel não-modal (nenhum atual) — fora do check de modal
    modalPanels.push(rel);
    for (const v of scanPanel(code)) findings.push({ rel, ...v });
  }
  assert.ok(modalPanels.length >= 6, `GUARDA: os 6 painéis de leitura renderizam <Modal> (${modalPanels.length})`);

  // Dynamic type: nenhum lock de escala fora do escape documentado (components + app).
  const appFiles = await listTsx(APP_DIR);
  const scaleScope = [...componentFiles, ...appFiles].sort();
  const lockFindings = [];
  for (const file of scaleScope) {
    const rel = relative(APP_ROOT, file);
    const raw = await readFile(file, 'utf8');
    for (const l of fontScaleLocks(stripComments(raw), raw)) lockFindings.push({ rel, ...l });
  }

  if (findings.length > 0 || lockFindings.length > 0) {
    const rep1 = findings.map((v) => `  ${v.rel} [${v.kind}] ${v.detail}`).join('\n');
    const rep2 = lockFindings.map((v) => `  ${v.rel}:${v.line} [scale] ${v.snippet}`).join('\n');
    assert.fail(
      'GUARDA reader-modal-a11y: violação(ões):\n' +
        [rep1, rep2].filter(Boolean).join('\n') +
        '\nModal de leitura → accessibilityViewIsModal na folha + useReaderModalA11y(visible) + título com accessibilityRole="header". ' +
        'NÃO trave allowFontScaling={false} no texto de leitura/cromo (respeite dynamic type); se for afordância minúscula legítima, marque a linha com "a11y-allow-fontscale-lock".',
    );
  }

  console.log('PASS — GUARDA de a11y de MODAIS de leitura + dynamic type (lint-like determinístico, sem device/rede):');
  console.log(`  (1) modal: ${modalPanels.length} painéis de leitura declaram accessibilityViewIsModal (foco preso ao modal)`);
  console.log('  (2) focus: cada painel usa useReaderModalA11y (foco inicial no título ao abrir) + título com role="header" (ordem lógica/anúncio)');
  console.log(`  (3) scale: ${scaleScope.length} arquivos sem allowFontScaling={false} travando o texto de leitura/cromo (dynamic type respeitado)`);
  console.log('  (4) self-test: detector REPROVA sem-viewIsModal / sem-hook / sem-header / lock-sem-marker; NÃO reprova painel completo / lock-com-marker');
  console.log(`  painéis: ${modalPanels.map((p) => basename(p)).join(', ')}`);
  // Marcador grep-ável (molde TLA_*): o run-ios-selftest.sh o assevera SEM regredir os TLA_ de fronteira.
  console.log(`TLA_A11Y modal=true labels=ok scale=ok focus=ok panels=${modalPanels.length} locks=${lockFindings.length}`);
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
