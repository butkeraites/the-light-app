// app/lib/tokens/index.ts — ADR-0063 (design language "Vigil")
//
// Barril dos tokens NÃO-CROMÁTICOS do design system (espaço, raio, tipografia, elevação,
// movimento). Todos PUROS (sem `react-native`). As cores moram à parte em `themePalettes.ts`
// (auditadas headless pela guarda de contraste). `theme.ts` compõe tudo em `useTheme()`.

export { space, type SpaceScale, type SpaceToken } from './space';
export { radius, type RadiusScale, type RadiusToken } from './radius';
export {
  RAMP,
  serifFamily,
  sansFamily,
  SERIF_STACK_WEB,
  type FontRole,
  type FontFamilyKind,
  type FontWeight,
  type TypeRoleSpec,
  type TypeRamp,
  type PlatformOS,
} from './type';
export { elevation, elevationStyle, type ElevationLevel, type ShadowStyle, type ElevationScale } from './elevation';
export { motion, duration, easing, spring, type Motion } from './motion';
