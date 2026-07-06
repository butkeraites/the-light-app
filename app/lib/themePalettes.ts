// app/lib/themePalettes.ts — F1.4 (ADR-0015) · contraste WCAG AA F5.18 (ADR-0046) · Vigil ADR-0063
//
// TOKENS de cor PUROS das paletas de leitura. Módulo SEM `react-native` — exatamente como
// `themePrefs.ts` isolou a persistência — de modo que a AUDITORIA de contraste (`contrast.ts` +
// `contrast.test.mjs`) bundle as paletas HEADLESS (node, sem device). `theme.ts` re-exporta
// `ThemeColors`, `PALETTES` e `SEPIA`, então os componentes seguem importando de `lib/theme`.
//
// ADR-0063 ("Vigil"): a identidade passa a ser ESCURA-primeiro — ouro de vela sobre tinta
// profunda, texto pergaminho; "a Luz nas trevas". O modo CLARO ("papel quente") é o companheiro
// refinado; a paleta SÉPIA é um TEMA DE LEITURA (aplicado no leitor numa etapa seguinte, distinto
// do `ThemeMode` claro/escuro do app). Como todo componente lê `colors` por TOKEN (zero hex
// literal), trocar estes valores re-tematiza o app inteiro; a guarda de contraste protege o AA.
//
// CONTRASTE (F5.18/ADR-0046 estendido no ADR-0063): a guarda computa a razão de cada par
// texto/UI significativo e FALHA abaixo de AA (4.5:1 normal / 3:1 grande+UI). Todos os pares
// bloqueantes passam nas TRÊS paletas (claro/escuro/sépia) com folga — inclusive os tokens
// novos (`surface`/`selectionBg`/`onAccent`/`success`). `faint`/`divider`/`border` são
// hairlines DECORATIVAS (WCAG 1.4.11) — reportadas, não bloqueiam. Nenhum hex de conteúdo
// bíblico aqui: isto é CROMO de UI (o versículo usa `verseText`).

/** Tokens de cor consumidos pela UI de leitura (uma fonte de verdade visual). */
export type ThemeColors = {
  /** Fundo das telas/listas. */
  background: string;
  /** Fundo do header de navegação. */
  headerBackground: string;
  /** Fundo de superfícies elevadas: folhas, cartões. */
  surface: string;
  /** Superfície mais elevada ainda (cartão sobre folha, chip preenchido). */
  surfaceElevated: string;
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
  /** Destaque (número do versículo, régua da Escritura, ações). Ouro de vela. */
  accent: string;
  /** Texto/ícone sobre `accent` quando o ouro é usado como FUNDO. */
  onAccent: string;
  /** Fundo de seleção do versículo — banho de ouro pré-mesclado (sólido, sobre o fundo). */
  selectionBg: string;
  /** Chip/seleção ativa: fundo (alto contraste neutro). */
  chipActiveBg: string;
  /** Chip/seleção ativa: texto. */
  chipActiveText: string;
  /** Chip inativo: texto. */
  chipText: string;
  /** Chip: rótulo de idioma. */
  chipLang: string;
  /** Erro/estado destrutivo. */
  error: string;
  /** Sucesso (ex.: badge "provedor com chave"). */
  success: string;
};

// ── VIGIL · CLARO (companheiro refinado — "papel quente") ────────────────────────────────
export const LIGHT: ThemeColors = {
  background: '#faf6ec',
  headerBackground: '#faf6ec',
  surface: '#ffffff',
  surfaceElevated: '#f3eddf',
  text: '#1a160f',
  verseText: '#221d14',
  muted: '#6e675a',
  faint: '#c9bfa8',
  divider: '#eae1cd',
  border: '#e0d6c0',
  accent: '#8a6a12', // ouro profundo (mesmo matiz do escuro, escurecido p/ AA sobre papel)
  onAccent: '#faf6ec',
  selectionBg: '#f1e6c8',
  chipActiveBg: '#1a160f',
  chipActiveText: '#faf6ec',
  chipText: '#4a4436',
  chipLang: '#6e675a',
  error: '#b00020',
  success: '#2e7d52',
};

// ── VIGIL · ESCURO (o herói — ouro de vela sobre tinta profunda) ─────────────────────────
export const DARK: ThemeColors = {
  background: '#0b0b0f',
  headerBackground: '#0e0e13',
  surface: '#15151b',
  surfaceElevated: '#1d1d25',
  text: '#ece4d3', // pergaminho
  verseText: '#f3ede0', // corpo de leitura com leve "brilho"
  muted: '#9a9384',
  faint: '#57534a',
  divider: '#23232a',
  border: '#34343d',
  accent: '#e7c24c', // ouro de vela (estende o `#e0b84d` histórico)
  onAccent: '#12100b',
  selectionBg: '#1e1b12', // ouro ~13% pré-mesclado sobre a tinta (sólido)
  chipActiveBg: '#ece4d3',
  chipActiveText: '#12100b',
  chipText: '#c9c2b4',
  chipLang: '#8a8474',
  error: '#ff7a6b',
  success: '#7fcf9a',
};

// ── VIGIL · SÉPIA (tema de LEITURA — conforto; distinto do ThemeMode do app) ──────────────
export const SEPIA: ThemeColors = {
  background: '#efe4ce',
  headerBackground: '#ebdfc7',
  surface: '#f6eedc',
  surfaceElevated: '#eadcc0',
  text: '#33291a',
  verseText: '#2a2113',
  muted: '#726346',
  faint: '#c2b189',
  divider: '#e0d2b4',
  border: '#d8c7a2',
  accent: '#6e520c',
  onAccent: '#efe4ce',
  selectionBg: '#e4d2a8',
  chipActiveBg: '#33291a',
  chipActiveText: '#efe4ce',
  chipText: '#544733',
  chipLang: '#726346',
  error: '#9e1b14',
  success: '#2e7d52',
};

/** Paletas por MODO do app (claro/escuro) — auditadas e usadas pelo `ThemeProvider`. */
export const PALETTES: Record<'light' | 'dark', ThemeColors> = { light: LIGHT, dark: DARK };

/** Nome de uma paleta de LEITURA (superset do ThemeMode: inclui sépia). */
export type ReadingPaletteName = 'light' | 'sepia' | 'dark';

/**
 * Paletas de LEITURA (claro/sépia/escuro) — para a seleção de TEMA DE LEITURA no leitor (etapa
 * seguinte). Também auditadas pela guarda de contraste. Sépia NÃO é um `ThemeMode` do app.
 */
export const READING_PALETTES: Record<ReadingPaletteName, ThemeColors> = {
  light: LIGHT,
  sepia: SEPIA,
  dark: DARK,
};
