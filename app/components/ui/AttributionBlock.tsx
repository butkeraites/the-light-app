// app/components/ui/AttributionBlock.tsx — ADR-0074 (deepening): render único da atribuição CC-BY
//
// Bloco de atribuição de licença (ADR-0026, OBRIGATÓRIO onde léxico/interlinear aparece). Exibe as
// `sources` REAIS do retorno; se vazias, cai na canônica (`attributionLinesFrom`) — o requisito de
// licença nunca cai. UMA interface, dois painéis (estudo + interlinear): o invariante vive num só lugar
// e o import painel→painel de `STEP_ATTRIBUTION` some.
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { attributionLinesFrom } from '../../lib/attribution';
import { useTheme, type ThemeContextValue } from '../../lib/theme';

export function AttributionBlock({ sources, testID }: { sources: readonly string[]; testID?: string }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.block} testID={testID}>
      {attributionLinesFrom(sources).map((s, i) => (
        <Text key={i} style={styles.line}>
          {s}
        </Text>
      ))}
    </View>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    block: { marginTop: space.md },
    line: {
      ...type.caption,
      color: colors.muted,
      textAlign: 'center',
      paddingHorizontal: space.sm,
      paddingTop: space.xs,
    },
  });
}
