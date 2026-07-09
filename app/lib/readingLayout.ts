// app/lib/readingLayout.ts — largura da COLUNA DE LEITURA (tipografia + zona de clique-lateral)
//
// Uma coluna de leitura com largura MÁXIMA (centralizada) tem dois papéis:
//   1. TIPOGRAFIA: comprimento de linha confortável (~65-75 caracteres) em telas largas — o texto
//      não estica de ponta a ponta no desktop.
//   2. CLIQUE-NAS-LATERAIS (estilo Kindle): as MARGENS que sobram viram a zona de virar-capítulo.
//      Como o texto fica na coluna central, as margens são espaço VAZIO — clicar nelas navega, sem
//      roubar toque de versículo.
// Em telas mais estreitas que a coluna, ela ocupa 100% (sem margem) — o clique-lateral fica inativo
// (é onde entram os botões/teclado), e a leitura não muda.

/** Largura máxima da coluna de LEITURA simples (1 versão). Serifa ~18-20px → ~68 caracteres. */
export const READING_COLUMN_MAX = 680;

/** Largura máxima do modo PARALELO (2 colunas lado a lado) — precisa de mais espaço. */
export const READING_COLUMN_MAX_PARALLEL = 940;

/**
 * Largura da MARGEM lateral (px) dado o `viewportWidth` e a largura da coluna: metade do que sobra.
 * É a zona de clique-lateral. Retorna 0 quando a coluna preenche a tela (sem margem → sem zona).
 */
export function sideMarginWidth(viewportWidth: number, columnMax: number = READING_COLUMN_MAX): number {
  return Math.max(0, (viewportWidth - columnMax) / 2);
}

/** Margem mínima (px) p/ o clique-lateral valer — abaixo disto a zona é estreita demais (usa botões/teclado). */
export const SIDE_NAV_MIN_MARGIN = 44;

// ── SWIPE de toque (celular na PWA/web) — virar capítulo deslizando o dedo ──
// O gesto só vira capítulo se for CLARAMENTE horizontal, longo o bastante e rápido: assim uma
// rolagem vertical (dy grande) ou um toque no versículo (dx~0) nunca viram página por engano.

/** Distância horizontal mínima (px) p/ um swipe virar capítulo (abaixo disto é tap ou rolagem). */
export const SWIPE_MIN_DISTANCE = 56;

/** Duração máxima (ms) do gesto p/ contar como swipe (mais lento = arrastar/rolar, não swipe). */
export const SWIPE_MAX_DURATION_MS = 600;

/** Dominância horizontal: |dx| tem de superar |dy| por este fator (senão é rolagem diagonal). */
export const SWIPE_H_DOMINANCE = 1.8;
