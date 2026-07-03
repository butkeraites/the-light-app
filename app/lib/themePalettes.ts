// app/lib/themePalettes.ts — F1.4 (ADR-0015) · contraste WCAG AA F5.18 (ADR-0046)
//
// TOKENS de cor PUROS das paletas de leitura (claro/escuro). Extraídos de `theme.ts`
// para um módulo SEM `react-native` — exatamente como `themePrefs.ts` isolou a lógica de
// persistência — de modo que a AUDITORIA de contraste (`contrast.ts` + `contrast.test.mjs`)
// possa bundlar as paletas HEADLESS (node, sem device). `theme.ts` re-exporta `ThemeColors`
// e `PALETTES`, então os componentes seguem importando de `lib/theme` sem mudança.
//
// CONTRASTE (F5.18/ADR-0046): a guarda WCAG AA (`contrast.test.mjs`) computa a razão de
// contraste de cada par texto/fundo significativo e FALHA se algum reprovar (4.5:1 texto
// normal / 3:1 grande+UI). As razões finais (sobre `background`, salvo indicado) são:
//
//   LIGHT (fundo #ffffff)                     DARK (fundo #101012)
//   ─ text        #111111  18.88:1  ✓         ─ text        #f2f2f2  16.98:1  ✓
//   ─ verseText   #1a1a1a  17.40:1  ✓         ─ verseText   #e6e6e6  15.23:1  ✓
//   ─ muted       #6b6b6b   5.33:1  ✓ (era    ─ muted       #9a9a9a   6.75:1  ✓
//                          #888888 3.54 ✗)
//   ─ accent      #916c00   4.83:1  ✓ (era    ─ accent      #e0b84d  10.08:1  ✓
//                          #b08400 3.42 ✗)
//   ─ error       #b00020   7.33:1  ✓         ─ error       #ff6b6b   6.85:1  ✓
//   ─ chipText    #333333  12.63:1  ✓         ─ chipText    #cfcfcf  12.20:1  ✓
//   ─ chipLang    #737373   4.74:1  ✓ (era    ─ chipLang    #8a8a8a   5.51:1  ✓
//                          #999999 2.85 ✗)
//   ─ chipActiveText/chipActiveBg 18.88:1 ✓   ─ chipActiveText/chipActiveBg 16.87:1 ✓
//   ─ text/headerBackground       18.88:1 ✓   ─ text/headerBackground       16.12:1 ✓
//
// SÓ os 3 tokens LIGHT que reprovavam (muted/accent/chipLang) foram ajustados, minimamente
// e mantendo o MATIZ (cinza neutro escurecido; ouro `accent` escurecido no mesmo hue),
// preservando a identidade visual. DARK já passava — inalterado. `faint`/`divider`/`border`
// são hairlines/afordâncias DECORATIVAS (WCAG 1.4.11 decorativo) — reportados, não bloqueiam.
// Nenhum hex de conteúdo bíblico aqui: isto é CROMO de UI (o versículo usa `verseText`).

/** Tokens de cor consumidos pela UI de leitura (uma fonte de verdade visual). */
export type ThemeColors = {
  /** Fundo das telas/listas. */
  background: string;
  /** Fundo do header de navegação. */
  headerBackground: string;
  /** Texto primário (nomes de livro, números de capítulo, títulos). */
  text: string;
  /** Texto do versículo (corpo da leitura). */
  verseText: string;
  /** Texto secundário/atenuado (subtítulos, vazios). */
  muted: string;
  /** Elementos muito sutis (chevron). */
  faint: string;
  /** Divisórias finas (hairline) entre linhas. */
  divider: string;
  /** Bordas de chips/células. */
  border: string;
  /** Destaque do número do versículo. */
  accent: string;
  /** Chip/seleção ativa: fundo. */
  chipActiveBg: string;
  /** Chip/seleção ativa: texto. */
  chipActiveText: string;
  /** Chip inativo: texto. */
  chipText: string;
  /** Chip: rótulo de idioma. */
  chipLang: string;
  /** Mensagens de erro. */
  error: string;
};

export const LIGHT: ThemeColors = {
  background: '#ffffff',
  headerBackground: '#ffffff',
  text: '#111111',
  verseText: '#1a1a1a',
  // F5.18: #888888 (3.54:1) → #6b6b6b (5.33:1) — cinza neutro, escurecido p/ atingir AA.
  muted: '#6b6b6b',
  faint: '#cccccc',
  divider: '#e2e2e2',
  border: '#dddddd',
  // F5.18: #b08400 (3.42:1) → #916c00 (4.83:1) — MESMO ouro, escurecido no mesmo hue.
  accent: '#916c00',
  chipActiveBg: '#111111',
  chipActiveText: '#ffffff',
  chipText: '#333333',
  // F5.18: #999999 (2.85:1) → #737373 (4.74:1) — cinza neutro; segue mais claro que `muted`.
  chipLang: '#737373',
  error: '#b00020',
};

export const DARK: ThemeColors = {
  background: '#101012',
  headerBackground: '#16161a',
  text: '#f2f2f2',
  verseText: '#e6e6e6',
  muted: '#9a9a9a',
  faint: '#555555',
  divider: '#2a2a2e',
  border: '#3a3a40',
  accent: '#e0b84d',
  chipActiveBg: '#f2f2f2',
  chipActiveText: '#111111',
  chipText: '#cfcfcf',
  chipLang: '#8a8a8a',
  error: '#ff6b6b',
};

/** Paletas por modo — exportadas para auditoria de contraste (F5.18) e uso pelo Provider. */
export const PALETTES: Record<'light' | 'dark', ThemeColors> = { light: LIGHT, dark: DARK };
