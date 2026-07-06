// app/lib/tokens/space.ts — ADR-0063 (design language "Vigil")
//
// Escala de ESPAÇAMENTO base-4, PURA (sem `react-native`), fonte ÚNICA de ritmo vertical/
// horizontal. Substitui os paddings/margens ad-hoc espalhados por ~25 componentes (valores
// à mão que faziam cada tela respirar de um jeito diferente). Consumida via `useTheme().space`.
// Sem device, sem I/O — só dados, então é bundlável headless como os tokens de cor.

/** Escala de espaço (px), base-4. `xs`..`xxxl`. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export type SpaceScale = typeof space;
export type SpaceToken = keyof SpaceScale;
