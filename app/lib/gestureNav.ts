// app/lib/gestureNav.ts — ADR-0071 (deepening): decisões PURAS de virar-capítulo (swipe + clique-lateral)
//
// A cinemática do swipe e a zona de clique-lateral viviam inline em 3 efeitos de `window` na tela do
// capítulo, sem interface — logo, sem teste. Isoladas aqui como funções PURAS (só as constantes de
// `readingLayout`), o hook `useChapterTurnGestures` fica com o wiring dos listeners e estas decidem a
// direção. Molde: `hideOnScroll.ts` (puro) + `useHideOnScroll.ts` (hook).
import {
  SIDE_NAV_MIN_MARGIN,
  sideMarginWidth,
  SWIPE_H_DOMINANCE,
  SWIPE_MAX_DURATION_MS,
  SWIPE_MIN_DISTANCE,
} from './readingLayout';

/** Direção de virada de capítulo (ou `null` = não virar). */
export type TurnDir = 'prev' | 'next' | null;

/**
 * Intenção de SWIPE a partir do deslocamento/duração de um gesto de toque. `dx<0` (deslizar p/ a
 * ESQUERDA) → 'next'; `dx>0` (p/ a DIREITA) → 'prev'. `null` se lento demais, curto demais, ou não
 * CLARAMENTE horizontal — molde de e-reader: só age num gesto rápido, longo e dominante em x.
 */
export function swipeIntent(dx: number, dy: number, dtMs: number): TurnDir {
  if (dtMs > SWIPE_MAX_DURATION_MS) return null; // lento demais → arrastar/rolar, não swipe
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null; // curto demais → tap/rolagem
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_H_DOMINANCE) return null; // não é claramente horizontal
  return dx < 0 ? 'next' : 'prev';
}

/**
 * Zona de CLIQUE-LATERAL (molde Kindle): clicar dentro da MARGEM esquerda vazia → 'prev', da direita →
 * 'next'; `null` no meio (a coluna de leitura) ou quando a margem é menor que o mínimo útil (tela
 * estreita → clique-lateral inativo, o celular usa botões). A margem é o espaço fora da coluna centrada.
 */
export function sideNavZone(clientX: number, viewportWidth: number, columnMax: number): TurnDir {
  const margin = sideMarginWidth(viewportWidth, columnMax);
  if (margin < SIDE_NAV_MIN_MARGIN) return null;
  if (clientX <= margin) return 'prev';
  if (clientX >= viewportWidth - margin) return 'next';
  return null;
}
