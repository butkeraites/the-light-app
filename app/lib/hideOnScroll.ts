// app/lib/hideOnScroll.ts — leitura imersiva: esconder o cromo do topo ao rolar
//
// LÓGICA PURA da direção de scroll → esconder/mostrar o cromo do leitor (header + versão +
// controles). Rolar PRA FRENTE (dedo pra cima, `contentOffset.y` cresce) → ESCONDE (texto
// fullscreen); rolar PRA TRÁS (dedo pra baixo) → MOSTRA; perto do TOPO sempre mostra. Acumula o
// deslocamento até um LIMIAR (histerese) p/ não piscar em micro-movimentos. Sem `react`/rede —
// testável headless (`test:web:hide-on-scroll`).

/** Estado do detector: se está escondido, o último offset visto e o acumulador de direção. */
export type HideScrollState = { hidden: boolean; lastY: number; acc: number };

/** Estado inicial (visível, no topo). */
export const initialHideScroll: HideScrollState = { hidden: false, lastY: 0, acc: 0 };

export type HideScrollOpts = {
  /** Deslocamento acumulado (px) numa direção p/ alternar. Maior = menos sensível. */
  threshold: number;
  /** Enquanto `y <= topGuard`, força VISÍVEL (o topo do texto está à vista). */
  topGuard: number;
};

export const DEFAULT_HIDE_SCROLL_OPTS: HideScrollOpts = { threshold: 12, topGuard: 24 };

/**
 * Avança o detector com um novo `contentOffset.y`. PURO (sem efeitos): devolve o próximo estado.
 * - `y <= topGuard` → visível (e zera o acumulador);
 * - senão acumula `dy`; ao trocar de sinal, reinicia o acumulador (histerese limpa);
 * - acumulado ≥ +threshold → ESCONDE; ≤ −threshold → MOSTRA (e zera, p/ não re-alternar na hora).
 */
export function reduceHideScroll(
  state: HideScrollState,
  y: number,
  opts: HideScrollOpts = DEFAULT_HIDE_SCROLL_OPTS,
): HideScrollState {
  if (y <= opts.topGuard) {
    return { hidden: false, lastY: y, acc: 0 };
  }
  const dy = y - state.lastY;
  // Troca de direção → reinicia o acumulador (não arrasta momento da direção anterior).
  let acc = (state.acc > 0 && dy < 0) || (state.acc < 0 && dy > 0) ? 0 : state.acc;
  acc += dy;
  let hidden = state.hidden;
  if (acc >= opts.threshold) {
    hidden = true;
    acc = 0;
  } else if (acc <= -opts.threshold) {
    hidden = false;
    acc = 0;
  }
  return { hidden, lastY: y, acc };
}
