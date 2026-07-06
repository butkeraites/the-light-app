// app/lib/tokens/type.ts — ADR-0063 (design language "Vigil")
//
// Escala TIPOGRÁFICA, PURA (sem `react-native`). Fecha a maior lacuna do app: até aqui havia
// ~11 `fontSize` ad-hoc e pesos só 600/700, sem fonte de leitura. Aqui definimos os PAPÉIS de
// texto (tamanho/entrelinha/peso/tracking/família) numa fonte única. `theme.ts` RESOLVE a
// família por plataforma e expõe o ramo pronto via `useTheme().type`.
//
// LEITURA (serifa): a leitura de Escritura é um ato tipográfico. No web (react-native-web) a
// família aceita um STACK CSS; no nativo exige um NOME único — Palatino (iOS, serifa old-style
// quente) / 'serif' = Noto Serif (Android). A fonte de leitura DEFINITIVA (Literata, OFL, via
// expo-font, idêntica nos 3 alvos) entra numa etapa seguinte; já aqui a serifa do SISTEMA eleva
// a leitura em todos os alvos SEM nova dependência. A UI (chrome) segue na fonte do sistema.

/** Papéis de texto da UI. */
export type FontRole =
  | 'display'
  | 'title'
  | 'heading'
  | 'verse'
  | 'verseNumber'
  | 'body'
  | 'label'
  | 'caption'
  | 'button';

/** Família lógica de um papel — resolvida por plataforma em `theme.ts`. */
export type FontFamilyKind = 'serif' | 'sans';

/** Pesos usados (RN aceita string). */
export type FontWeight = '400' | '600' | '700';

/** Especificação PURA (independente de plataforma) de um papel de texto. */
export type TypeRoleSpec = {
  fontSize: number;
  lineHeight: number;
  fontWeight: FontWeight;
  letterSpacing: number;
  family: FontFamilyKind;
  textTransform?: 'uppercase';
};

/**
 * O RAMO tipográfico: papel → especificação. Serifa para display/título/versículo (leitura);
 * sans (sistema) para chrome/rótulos/dados. `verse` é a base ESCALÁVEL pelo usuário (ajustes
 * de leitura, etapa seguinte) — os componentes derivam o tamanho a partir daqui.
 */
export const RAMP: Record<FontRole, TypeRoleSpec> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.5, family: 'serif' },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700', letterSpacing: -0.3, family: 'serif' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: 0, family: 'sans' },
  verse: { fontSize: 19, lineHeight: 30, fontWeight: '400', letterSpacing: 0, family: 'serif' },
  verseNumber: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0, family: 'sans' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0, family: 'sans' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8, family: 'sans', textTransform: 'uppercase' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0, family: 'sans' },
  button: { fontSize: 15, lineHeight: 20, fontWeight: '700', letterSpacing: 0, family: 'sans' },
};

/** Plataformas possíveis (`Platform.OS`). */
export type PlatformOS = 'ios' | 'android' | 'web' | 'windows' | 'macos';

/** Stack de serifa para o web (react-native-web aceita CSS). Serifas old-style quentes. */
export const SERIF_STACK_WEB =
  "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,'Times New Roman',serif";

/**
 * Família de LEITURA (serifa) por plataforma. iOS/macOS → Palatino; Android → 'serif'
 * (Noto Serif); web → o stack CSS. (Literata bundlada substituirá isto numa etapa seguinte.)
 */
export function serifFamily(os: PlatformOS): string {
  if (os === 'ios' || os === 'macos') {
    return 'Palatino';
  }
  if (os === 'android') {
    return 'serif';
  }
  return SERIF_STACK_WEB;
}

/**
 * Família de CHROME (sans). `undefined` = fonte do sistema (San Francisco / Roboto no nativo;
 * `-apple-system`… no web via RNW). Mantida como função por simetria com `serifFamily`.
 */
export function sansFamily(_os: PlatformOS): string | undefined {
  return undefined;
}

export type TypeRamp = typeof RAMP;
