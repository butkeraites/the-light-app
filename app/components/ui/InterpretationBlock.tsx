// app/components/ui/InterpretationBlock.tsx — ADR-0066 (component kit "Vigil")
//
// PRIMITIVA ANTI-ALUCINAÇÃO: o bloco da INTERPRETAÇÃO do modelo (LLM), num cartão bordado e
// ROTULADO DISTINTO da Escritura (pareado com `CitedText`). O `label` nomeia a fonte (ex.:
// "Interpretação · Claude"); `children` é o corpo (texto acumulado do streaming + cursor). Esta
// primitiva NUNCA contém texto bíblico — só a saída interpretativa do provedor.
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';
import { Reveal } from './Reveal';

export function InterpretationBlock({
  label,
  children,
  testID,
}: {
  label: string;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Fase 6: a interpretação da IA REVELA (fade+subida) ao aparecer — gated em reduce-motion.
  return (
    <Reveal style={styles.block}>
      <View testID={testID}>
        <Text style={styles.tag}>{label}</Text>
        <View style={styles.body}>{children}</View>
      </View>
    </Reveal>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    block: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceElevated,
      padding: space.md,
      marginTop: space.md,
    },
    tag: { ...type.label, color: colors.muted },
    body: { marginTop: space.xs },
  });
}
