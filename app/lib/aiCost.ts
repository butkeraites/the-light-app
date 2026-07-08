// app/lib/aiCost.ts — estimativa de custo BYOK (transparência; Rodada 1)
//
// Reusa a TABELA DE PREÇOS do core (`estimate_cost_usd` na fronteira → `the_light_core::ai`) — fonte
// única, sem duplicar preços no app (evita drift, como manda a disciplina de espelho/paridade). Os
// tokens são APROXIMADOS aqui (a fronteira não devolve uso real do provedor), então é uma ESTIMATIVA.
import { estimateCostUsd } from '../web/reading';

/** ~4 chars/token — mesma heurística que os painéis já usavam p/ a contagem de tokens. */
export const approxTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Estimativa de custo (US$) de uma resposta de IA. `input` = prompt aproximado (pergunta + texto
 * citado); `output` = interpretação. Retorna `undefined` (modelo sem preço tabelado → mostrar só
 * tokens), `0` (local/grátis: ollama/mock) ou `>0` (estimado). Nunca lança pro chamador tratar.
 */
export async function estimateAnswerCostUsd(
  model: string,
  promptText: string,
  interpretation: string,
): Promise<number | undefined> {
  return await estimateCostUsd(model, approxTokens(promptText), approxTokens(interpretation));
}

/** US$ com casas úteis: 4 p/ frações de centavo, 2 acima. */
export function formatUsd(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(2);
}
