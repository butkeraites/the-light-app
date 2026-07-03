// contrast-headless-entry.ts — F5.18 (ADR-0046; molde theme-headless-entry.ts)
//
// Ponto de entrada VERSIONADO da GUARDA de contraste WCAG AA. É empacotado (esbuild) por
// `contrast.test.mjs` num único `.mjs` e executado em node SEM device/browser/rede. Reexporta
// APENAS a superfície PURA que a guarda exercita:
//   - themePalettes: `PALETTES`/`LIGHT`/`DARK` (tokens de cor, SEM `react-native`);
//   - contrast: matemática WCAG + spec dos pares + `auditPalettes`.
// NÃO importa `theme.ts` (que puxa `react-native`): tokens e auditoria são puros e isolados.
import { PALETTES, LIGHT, DARK } from '../../lib/themePalettes';
import type { ThemeColors } from '../../lib/themePalettes';
import {
  AA_NORMAL_TEXT,
  AA_LARGE_OR_UI,
  AUDITED_PAIRS,
  DECORATIVE_PAIRS,
  auditPair,
  auditPalettes,
  contrastRatio,
  hexToRgb,
  relativeLuminance,
  targetFor,
} from '../../lib/contrast';
import type { AuditedPair, ContrastLevel, PairResult } from '../../lib/contrast';

export {
  PALETTES,
  LIGHT,
  DARK,
  AA_NORMAL_TEXT,
  AA_LARGE_OR_UI,
  AUDITED_PAIRS,
  DECORATIVE_PAIRS,
  auditPair,
  auditPalettes,
  contrastRatio,
  hexToRgb,
  relativeLuminance,
  targetFor,
};
export type { ThemeColors, AuditedPair, ContrastLevel, PairResult };
