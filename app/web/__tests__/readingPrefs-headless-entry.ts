// readingPrefs-headless-entry.ts — ADR-0063 (molde theme-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da prova headless das PREFERÊNCIAS DE LEITURA. Empacotado
// (esbuild) por `readingPrefs.test.mjs` num único `.mjs` e executado em node SEM device/rede.
// Reexporta SÓ a superfície PURA exercitada: `readingPrefs` (tipos/guardas/chaves/escala) +
// `prefs` (`createPrefs` com backend injetável + `prefIdFor`). NÃO importa `theme.ts` (react-native).
import {
  READING_THEMES,
  READING_THEME_KEY,
  isReadingTheme,
  LINE_SPACINGS,
  LINE_HEIGHT_FACTOR,
  READING_SPACING_KEY,
  DEFAULT_LINE_SPACING,
  isLineSpacing,
  READING_FONTS,
  READING_FONT_KEY,
  DEFAULT_READING_FONT,
  isReadingFont,
  FONT_SCALE_STEPS,
  DEFAULT_FONT_STEP,
  READING_FONT_STEP_KEY,
  isFontStep,
  clampFontStep,
  fontScaleForStep,
  fontStepToString,
  parseFontStep,
  READING_JUSTIFY_KEY,
  DEFAULT_JUSTIFY,
  justifyToString,
  parseJustify,
} from '../../lib/readingPrefs';
import { createPrefs, prefIdFor } from '../../lib/prefs';
import type { PrefsBackend } from '../../lib/prefs';

export {
  READING_THEMES,
  READING_THEME_KEY,
  isReadingTheme,
  LINE_SPACINGS,
  LINE_HEIGHT_FACTOR,
  READING_SPACING_KEY,
  DEFAULT_LINE_SPACING,
  isLineSpacing,
  READING_FONTS,
  READING_FONT_KEY,
  DEFAULT_READING_FONT,
  isReadingFont,
  FONT_SCALE_STEPS,
  DEFAULT_FONT_STEP,
  READING_FONT_STEP_KEY,
  isFontStep,
  clampFontStep,
  fontScaleForStep,
  fontStepToString,
  parseFontStep,
  READING_JUSTIFY_KEY,
  DEFAULT_JUSTIFY,
  justifyToString,
  parseJustify,
  createPrefs,
  prefIdFor,
};
export type { PrefsBackend };
