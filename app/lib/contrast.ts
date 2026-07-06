// app/lib/contrast.ts — F5.18 (ADR-0046)
//
// Matemática de contraste WCAG 2.x PURA + a ESPECIFICAÇÃO dos pares de token auditados das
// paletas de tema (claro/escuro). Sem `react-native`, sem device, sem rede — determinístico —
// para que `contrast.test.mjs` (a GUARDA) bundle e assevere HEADLESS que todo par texto/UI
// significativo atinge AA (4.5:1 texto normal / 3:1 texto grande + componentes de UI).
//
// Isto é CROMO de UI puro (cor de token). NÃO toca texto bíblico (anti-alucinação): o
// versículo é renderizado com o token `verseText`, cujo CONTRASTE é o que auditamos aqui —
// nunca o conteúdo. Fórmula: WCAG relative luminance + contrast ratio (nenhuma lib externa).
import type { ThemeColors } from './themePalettes';
import { PALETTES } from './themePalettes';
import type { ThemeMode } from './themePrefs';

/** Alvos WCAG 2.1 AA. */
export const AA_NORMAL_TEXT = 4.5;
/** Texto grande (≥18pt, ou ≥14pt bold) e componentes de UI / gráficos (1.4.3 / 1.4.11). */
export const AA_LARGE_OR_UI = 3;

export type ContrastLevel = 'normal' | 'large';

/**
 * Nome de uma paleta auditada. Superset do `ThemeMode` do app (claro/escuro) que inclui a
 * paleta de LEITURA `sepia` (ADR-0063) — auditada, mas não é um modo do app.
 */
export type PaletteName = ThemeMode | 'sepia';

/** Alvo numérico para um nível de contraste. */
export function targetFor(level: ContrastLevel): number {
  return level === 'normal' ? AA_NORMAL_TEXT : AA_LARGE_OR_UI;
}

/** Converte `#rgb`/`#rrggbb` em [r,g,b] 0–255. Lança em hex inválido (guarda de higiene). */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    throw new Error(`hex inválido: ${hex}`);
  }
  let h = m[1];
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Linearização sRGB de UM canal (0–255) → luminância linear (WCAG). */
function channelLuminance(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminância relativa WCAG de uma cor hex (0 = preto … 1 = branco). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Razão de contraste WCAG 2.x entre duas cores hex (1:1 … 21:1). Simétrica. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Um par de tokens auditado: primeiro-plano (texto/UI) sobre um fundo, com um alvo AA. */
export type AuditedPair = {
  /** Token de primeiro-plano (texto ou elemento). */
  readonly fg: keyof ThemeColors;
  /** Token de fundo sobre o qual `fg` é renderizado. */
  readonly bg: keyof ThemeColors;
  /** Nível → alvo (normal 4.5 / grande+UI 3). */
  readonly level: ContrastLevel;
  /** Papel legível (para o relatório). */
  readonly role: string;
};

// ── Pares BLOQUEANTES ────────────────────────────────────────────────────────────────────
// Texto/UI SIGNIFICATIVO renderizado sobre seu fundo. Se algum reprovar AA, a guarda FALHA.
// (Todos são texto legível → alvo NORMAL 4.5:1; conservador. O número do versículo `accent`
// é rótulo pequeno → tratado como normal, não como "grande".)
export const AUDITED_PAIRS: readonly AuditedPair[] = [
  { fg: 'text', bg: 'background', level: 'normal', role: 'texto primário sobre o fundo' },
  { fg: 'text', bg: 'headerBackground', level: 'normal', role: 'título do header' },
  { fg: 'verseText', bg: 'background', level: 'normal', role: 'corpo do versículo' },
  { fg: 'muted', bg: 'background', level: 'normal', role: 'texto secundário/atenuado' },
  { fg: 'accent', bg: 'background', level: 'normal', role: 'número do versículo (destaque)' },
  { fg: 'error', bg: 'background', level: 'normal', role: 'mensagem de erro' },
  { fg: 'chipActiveText', bg: 'chipActiveBg', level: 'normal', role: 'rótulo do chip ativo' },
  { fg: 'chipText', bg: 'background', level: 'normal', role: 'rótulo do chip inativo' },
  { fg: 'chipLang', bg: 'background', level: 'normal', role: 'rótulo de idioma do chip' },
  // ── Tokens do ADR-0063 (Vigil): superfícies, seleção, ouro-como-fundo, sucesso ──
  { fg: 'text', bg: 'surface', level: 'normal', role: 'texto primário sobre superfície (folha/cartão)' },
  { fg: 'verseText', bg: 'surface', level: 'normal', role: 'corpo do versículo sobre superfície' },
  { fg: 'verseText', bg: 'selectionBg', level: 'normal', role: 'versículo selecionado (banho de ouro)' },
  { fg: 'onAccent', bg: 'accent', level: 'normal', role: 'texto/ícone sobre o ouro (ação/badge)' },
  { fg: 'success', bg: 'background', level: 'large', role: 'indicador de sucesso (provedor com chave)' },
];

// ── Pares DECORATIVOS ────────────────────────────────────────────────────────────────────
// Hairlines/afordâncias SUTIS: separadores, bordas cosméticas, chevron redundante (a linha
// inteira é clicável e rotulada). WCAG 1.4.11 isenta o "puramente decorativo". REPORTADOS
// (contra 3:1) para transparência, mas NÃO bloqueiam a guarda.
export const DECORATIVE_PAIRS: readonly AuditedPair[] = [
  { fg: 'faint', bg: 'background', level: 'large', role: 'chevron sutil (afordância redundante)' },
  { fg: 'divider', bg: 'background', level: 'large', role: 'divisória hairline' },
  { fg: 'border', bg: 'background', level: 'large', role: 'borda de chip/célula' },
];

/** Resultado da auditoria de UM par numa paleta. */
export type PairResult = {
  readonly mode: PaletteName;
  readonly fg: keyof ThemeColors;
  readonly bg: keyof ThemeColors;
  readonly level: ContrastLevel;
  readonly role: string;
  readonly ratio: number;
  readonly target: number;
  readonly pass: boolean;
};

/** Audita um par sobre uma paleta concreta. */
export function auditPair(mode: PaletteName, colors: ThemeColors, pair: AuditedPair): PairResult {
  const ratio = contrastRatio(colors[pair.fg], colors[pair.bg]);
  const target = targetFor(pair.level);
  return {
    mode,
    fg: pair.fg,
    bg: pair.bg,
    level: pair.level,
    role: pair.role,
    ratio,
    target,
    // Arredonda a 2 casas ANTES de comparar (paridade com o que se REPORTA — evita
    // "4.50 mas reprova" por ruído de ponto flutuante na 3ª casa).
    pass: Math.round(ratio * 100) / 100 >= target,
  };
}

/**
 * Audita `pairs` sobre TODAS as paletas do mapa (default = as paletas do tema claro/escuro).
 * Aceita qualquer mapa `nome → ThemeColors` — inclui a paleta de leitura `sepia` (ADR-0063).
 */
export function auditPalettes(
  pairs: readonly AuditedPair[],
  palettes: Record<string, ThemeColors> = PALETTES,
): PairResult[] {
  const out: PairResult[] = [];
  for (const name of Object.keys(palettes)) {
    for (const pair of pairs) {
      out.push(auditPair(name as PaletteName, palettes[name], pair));
    }
  }
  return out;
}
