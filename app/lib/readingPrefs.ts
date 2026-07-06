// app/lib/readingPrefs.ts — ADR-0063 (design language "Vigil"; molde `themePrefs.ts`)
//
// LÓGICA PURA (offline, dependency-free) das PREFERÊNCIAS DE LEITURA — tamanho do texto,
// entrelinha, tema de leitura, família e justificação — persistidas no MESMO KV de prefs da
// F5.2 (`prefs.ts`), sob chaves namespaceadas. Mantida SEPARADA de `react-native`/`react` de
// propósito (como `themePrefs.ts`), para que a prova headless bundle SÓ estas funções puras.
//
// ESCOPO: aqui moram só os TIPOS, GUARDAS, CHAVES, DEFAULTS e as tabelas de escala (fatores de
// tamanho/entrelinha). O CONSUMO (folha de "Ajustes de leitura" + aplicação no leitor) é etapa
// seguinte do redesign — mas a base é pura e provável agora, sem device.
//
// DISTINÇÃO IMPORTANTE: `ReadingTheme` (claro/sépia/escuro) é o TEMA DA SUPERFÍCIE DE LEITURA,
// selecionável no leitor; é DIFERENTE do `ThemeMode` do app (claro/escuro, `themePrefs.ts`).
// AUSÊNCIA de `reading.theme` = seguir o modo do app (paridade com o padrão do `themePrefs`).
// Nenhuma preferência é logada; um valor inválido/corrompido no storage é ignorado (offline-first).

// ── TEMA DE LEITURA (claro/sépia/escuro) ─────────────────────────────────────────────────
/** Tema da SUPERFÍCIE de leitura. Ausência = seguir o `ThemeMode` do app. */
export type ReadingTheme = 'light' | 'sepia' | 'dark';

/** Temas de leitura válidos, em ordem canônica. */
export const READING_THEMES: readonly ReadingTheme[] = ['light', 'sepia', 'dark'] as const;

/** Chave da preferência (namespaceada por `prefIdFor` → `tla.pref.reading.theme`). */
export const READING_THEME_KEY = 'reading.theme';

/** True se `value` é um `ReadingTheme` válido. PURA, case-sensitive. */
export function isReadingTheme(value: string | null | undefined): value is ReadingTheme {
  return value != null && (READING_THEMES as readonly string[]).includes(value);
}

// ── ENTRELINHA (compacto/confortável/amplo) ──────────────────────────────────────────────
/** Densidade da entrelinha do corpo de leitura. */
export type LineSpacing = 'compact' | 'comfortable' | 'relaxed';

export const LINE_SPACINGS: readonly LineSpacing[] = ['compact', 'comfortable', 'relaxed'] as const;

/** Fator multiplicador de `lineHeight` sobre `fontSize` por densidade. */
export const LINE_HEIGHT_FACTOR: Record<LineSpacing, number> = {
  compact: 1.4,
  comfortable: 1.58,
  relaxed: 1.78,
};

export const READING_SPACING_KEY = 'reading.spacing';
export const DEFAULT_LINE_SPACING: LineSpacing = 'comfortable';

export function isLineSpacing(value: string | null | undefined): value is LineSpacing {
  return value != null && (LINE_SPACINGS as readonly string[]).includes(value);
}

// ── FAMÍLIA (serifa/sem serifa) ──────────────────────────────────────────────────────────
/** Família do corpo de leitura: serifa (leitura) ou sem serifa (sistema). */
export type ReadingFont = 'serif' | 'sans';

export const READING_FONTS: readonly ReadingFont[] = ['serif', 'sans'] as const;
export const READING_FONT_KEY = 'reading.font';
export const DEFAULT_READING_FONT: ReadingFont = 'serif';

export function isReadingFont(value: string | null | undefined): value is ReadingFont {
  return value != null && (READING_FONTS as readonly string[]).includes(value);
}

// ── TAMANHO DO TEXTO (passos discretos) ──────────────────────────────────────────────────
// Passos de escala do corpo do versículo (índices em `FONT_SCALE_STEPS`). O leitor multiplica
// `type.verse.fontSize`/`lineHeight` pelo fator do passo escolhido (e ainda respeita o Dynamic
// Type do SO — `allowFontScaling` permanece ligado; ADR-0049/useReaderModalA11y).
export const FONT_SCALE_STEPS: readonly number[] = [0.88, 0.94, 1, 1.08, 1.18, 1.32] as const;

/** Passo default (índice) → fator 1.0 (sem escala). */
export const DEFAULT_FONT_STEP = 2;
export const READING_FONT_STEP_KEY = 'reading.fontStep';

/** True se `n` é um índice de passo válido em `FONT_SCALE_STEPS`. */
export function isFontStep(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < FONT_SCALE_STEPS.length;
}

/** Limita `n` à faixa de passos válida (offline-first: valor fora vira o mais próximo). */
export function clampFontStep(n: number): number {
  if (!Number.isFinite(n)) {
    return DEFAULT_FONT_STEP;
  }
  return Math.max(0, Math.min(FONT_SCALE_STEPS.length - 1, Math.round(n)));
}

/** Fator de escala de um passo (com clamp defensivo). */
export function fontScaleForStep(step: number): number {
  return FONT_SCALE_STEPS[clampFontStep(step)];
}

/** Serializa/parseia o passo p/ o KV (que guarda `string`). Valor inválido → default. */
export function fontStepToString(step: number): string {
  return String(clampFontStep(step));
}
export function parseFontStep(value: string | null | undefined): number {
  if (value == null) {
    return DEFAULT_FONT_STEP;
  }
  const n = Number(value);
  return isFontStep(n) ? n : DEFAULT_FONT_STEP;
}

// ── JUSTIFICAÇÃO (liga/desliga) ──────────────────────────────────────────────────────────
export const READING_JUSTIFY_KEY = 'reading.justify';
export const DEFAULT_JUSTIFY = false;

/** Serializa/parseia o booleano de justificação p/ o KV (`'1'`/`'0'`). */
export function justifyToString(on: boolean): string {
  return on ? '1' : '0';
}
export function parseJustify(value: string | null | undefined): boolean {
  return value === '1';
}
