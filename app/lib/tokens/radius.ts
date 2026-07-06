// app/lib/tokens/radius.ts — ADR-0063 (design language "Vigil")
//
// Escala de RAIO de canto, PURA. Substitui os raios ad-hoc (8/10/14/16/17) escolhidos
// por componente — uma geometria consistente em toda a UI. Consumida via `useTheme().radius`.

/** Raios de canto (px). `pill` é o pílula/círculo (clampeado pelo layout). */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export type RadiusScale = typeof radius;
export type RadiusToken = keyof RadiusScale;
