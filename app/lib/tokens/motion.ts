// app/lib/tokens/motion.ts — ADR-0063 (design language "Vigil")
//
// Tokens de MOVIMENTO, PUROS (só dados). Durações (ms), easings (curvas bezier) e um preset
// de mola para as folhas (bottom sheets). Consumidos via `useTheme().motion`.
//
// A11y: o movimento é OPCIONAL. Os componentes que animam devem consultar
// `AccessibilityInfo.isReduceMotionEnabled()` e encurtar/desligar (respeitando
// `prefers-reduced-motion` no web) — este módulo só EXPÕE os valores, nunca os aplica.

/** Durações (ms). `fast` micro-interações · `base` transições · `slow` folhas/entradas. */
export const duration = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

/** Curvas de easing (bezier) — `standard` para a maioria; `decelerate` para entradas. */
export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  decelerate: 'cubic-bezier(0, 0, 0, 1)',
  accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
} as const;

/** Preset de mola para as folhas deslizantes (bottom sheets). */
export const spring = {
  damping: 22,
  stiffness: 260,
  mass: 1,
} as const;

export const motion = { duration, easing, spring } as const;

export type Motion = typeof motion;
