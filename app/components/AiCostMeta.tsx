// app/components/AiCostMeta.tsx — linha de META de custo BYOK das respostas de IA (Rodada 1).
//
// Encapsula o cálculo assíncrono (fronteira wasm no web) + a apresentação, p/ cada painel de IA ser
// um one-liner. Estados: computando → nada; sem preço tabelado → contagem de tokens (fallback antigo);
// local/grátis → aviso; com preço → "~US$ x (estimado)". Anti-alucinação irrelevante (só custo/meta).
import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { approxTokens, estimateAnswerCostUsd, formatUsd } from '../lib/aiCost';
import { useI18n } from '../lib/i18n';

export function AiCostMeta({
  model,
  promptText,
  interpretation,
  style,
  testID,
}: {
  model: string;
  /** Prompt aproximado p/ o input (ex.: pergunta + texto citado). */
  promptText: string;
  /** Saída do modelo (a interpretação) — o output. */
  interpretation: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const { t } = useI18n();
  // `null` = ainda computando; `undefined` = sem preço tabelado; número = US$ (0 = local/grátis).
  const [usd, setUsd] = useState<number | null | undefined>(null);

  useEffect(() => {
    let alive = true;
    setUsd(null);
    estimateAnswerCostUsd(model, promptText, interpretation)
      .then((c) => {
        if (alive) setUsd(c);
      })
      .catch(() => {
        if (alive) setUsd(undefined);
      });
    return () => {
      alive = false;
    };
  }, [model, promptText, interpretation]);

  if (usd === null) {
    return null; // computando
  }
  const label =
    usd == null
      ? t('ask.estimate', { tokens: approxTokens(interpretation) }) // sem preço → tokens (fallback)
      : usd === 0
        ? t('ai.costLocal')
        : t('ai.costEstimate', { usd: formatUsd(usd) });
  return (
    <Text style={style} testID={testID}>
      {label}
    </Text>
  );
}
