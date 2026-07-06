// app/lib/tokens/elevation.ts — ADR-0063 (design language "Vigil")
//
// Tokens de ELEVAÇÃO (sombra/profundidade), PUROS. No tema escuro (o herói do Vigil) a
// profundidade vem mais do DEGRAU de superfície (`surface`/`surfaceElevated`) + hairline do
// que de sombras pesadas; estas sombras são discretas. Consumido via `useTheme().elevation`.
//
// Forma cross-plataforma: os campos `shadow*` valem no iOS e no web (react-native-web); o
// `elevation` (número) vale no Android. Os componentes espalham o nível desejado no estilo.

export type ElevationLevel = 0 | 1 | 2 | 3;

/** Estilo de sombra pronto para espalhar num `View` (iOS/web via `shadow*`; Android via `elevation`). */
export type ShadowStyle = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

const LEVELS: Record<ElevationLevel, ShadowStyle> = {
  0: { shadowColor: '#000000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  1: { shadowColor: '#000000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 3, elevation: 1 },
  2: { shadowColor: '#000000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 16, elevation: 6 },
  3: { shadowColor: '#000000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.4, shadowRadius: 34, elevation: 14 },
};

/** Mapa nível → estilo de sombra (fonte única de profundidade). */
export const elevation = LEVELS;

/** Estilo de sombra de um nível (`0`..`3`). */
export function elevationStyle(level: ElevationLevel): ShadowStyle {
  return LEVELS[level];
}

export type ElevationScale = typeof elevation;
