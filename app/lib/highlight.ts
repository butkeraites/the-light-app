// app/lib/highlight.ts — F1.6 (ADR-0015)
//
// Marcadores de DESTAQUE da busca + utilitário de split. A fronteira `search`
// (F1.5) devolve `SearchHit.highlighted` com o termo casado envolvido por
// marcadores de CONTROLE do core (`the_light_core::search::HL_START`/`HL_END`):
//   HL_START = U+0002 (STX) · HL_END = U+0003 (ETX).
// A UI (F1.6) converte esses marcadores em ESTILO (negrito/realce) — os caracteres
// de controle NUNCA são exibidos como texto cru (são consumidos no split). Isto é
// PRESENTAÇÃO pura: nenhum SQL/FTS/highlight é reimplementado aqui (o destaque vem
// do core; só interpretamos os marcadores que ele já inseriu).
//
// `String.fromCharCode` (em vez de literais de controle no fonte) deixa os
// marcadores EXPLÍCITOS e imunes a editores que removeriam bytes de controle.

/** Marcador de início do termo casado (do core). U+0002 (STX). */
export const HL_START = String.fromCharCode(0x02);
/** Marcador de fim do termo casado (do core). U+0003 (ETX). */
export const HL_END = String.fromCharCode(0x03);

/** Um trecho do snippet: `matched` indica o termo casado (a ser realçado). */
export type HighlightRun = {
  /** Texto do trecho (sem nenhum marcador de controle). */
  text: string;
  /** `true` se este trecho estava entre HL_START/HL_END (termo casado). */
  matched: boolean;
};

/**
 * Divide `highlighted` (de `SearchHit.highlighted`) em runs alternados de texto
 * normal e texto casado, CONSUMINDO os marcadores de controle (que nunca aparecem
 * na UI). Robusto a marcadores aninhados/sobrando: o estado `matched` alterna em
 * cada HL_START/HL_END e os marcadores são removidos de cada run. Runs vazios são
 * descartados.
 */
export function splitHighlighted(highlighted: string): HighlightRun[] {
  const runs: HighlightRun[] = [];
  let matched = false;
  let buffer = '';

  const flush = () => {
    if (buffer.length > 0) {
      runs.push({ text: buffer, matched });
      buffer = '';
    }
  };

  for (const ch of highlighted) {
    if (ch === HL_START) {
      flush();
      matched = true;
    } else if (ch === HL_END) {
      flush();
      matched = false;
    } else {
      buffer += ch;
    }
  }
  flush();
  return runs;
}

/** Remove quaisquer marcadores de controle de uma string (texto sempre limpo). */
export function stripMarkers(text: string): string {
  return text.split(HL_START).join('').split(HL_END).join('');
}
