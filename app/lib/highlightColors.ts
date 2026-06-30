// app/lib/highlightColors.ts — F1.11 (ADR-0017)
//
// Paleta NOMEADA de cores de HIGHLIGHT do usuário. Estas cores são DADO DO USUÁRIO
// (a cor escolhida vira `Highlight.color`, ex.: `"yellow"`), NÃO tokens de tema da
// app — por isso vivem aqui, fora de `theme.ts`. Cada cor tem uma amostra de fundo
// p/ o modo claro e o escuro (legibilidade sobre o `verseText`).
//
// IMPORTANTE: NÃO confundir com `app/lib/highlight.ts`, que trata dos marcadores de
// controle `HL_START`/`HL_END` do realce de BUSCA (FTS) — sem relação com estes
// highlights de usuário. Aqui só guardamos a paleta de apresentação; a fonte da
// verdade do dado é a fronteira `userdata` (o nome da cor é persistido pelo core).

export type HighlightColor = {
  /** Nome livre persistido como `Highlight.color` (ex.: `"yellow"`). */
  name: string;
  /** Rótulo amigável p/ a UI. */
  label: string;
  /** Cor de fundo no tema claro. */
  light: string;
  /** Cor de fundo no tema escuro. */
  dark: string;
};

/** Pequena paleta nomeada (4 cores) oferecida na UI de marcação. */
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { name: 'yellow', label: 'Amarelo', light: '#fff1a8', dark: '#5c4d00' },
  { name: 'green', label: 'Verde', light: '#bdf0c0', dark: '#1f4d22' },
  { name: 'blue', label: 'Azul', light: '#bcdcff', dark: '#1d3a5c' },
  { name: 'pink', label: 'Rosa', light: '#ffc9de', dark: '#5c2438' },
];

/**
 * Resolve o nome de cor persistido (`Highlight.color`) p/ a amostra de fundo do tema
 * corrente. Cor desconhecida (dado livre) → fallback neutro do próprio nome (deixa o
 * RN interpretar) ou amarelo do tema, garantindo um realce visível.
 */
export function resolveHighlightColor(name: string, isDark: boolean): string {
  const found = HIGHLIGHT_COLORS.find((c) => c.name === name);
  if (found) {
    return isDark ? found.dark : found.light;
  }
  return name;
}
