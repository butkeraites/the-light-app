// app/components/ui/CitedText.tsx — ADR-0066 (component kit "Vigil")
//
// PRIMITIVA ANTI-ALUCINAÇÃO: o texto CITADO (Escritura VERBATIM do store) atrás de uma RÉGUA de
// vela dourada, rotulado como Escritura — visualmente DISTINTO da interpretação do modelo. Usado
// por todos os painéis de IA (Ask/Study/Chat/Compare). O `text` vem SEMPRE do retorno da fronteira
// (store), NUNCA do LLM; esta primitiva só o apresenta com a marca de "verbatim".
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';
import { Icon } from './Icon';
import { Reveal } from './Reveal';

export function CitedText({ text, label, testID }: { text: string; label: string; testID?: string }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Fase 6: a Escritura citada REVELA (fade+subida) ao aparecer — gated em reduce-motion.
  return (
    <Reveal style={styles.block}>
      <View style={styles.tag}>
        <Icon name="book" size={12} color={theme.colors.accent} />
        <Text style={styles.tagText}>{label}</Text>
      </View>
      <Text style={styles.text} testID={testID}>
        {text}
      </Text>
    </Reveal>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    block: {
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingLeft: space.md,
      marginTop: space.md,
    },
    tag: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    tagText: { ...type.label, color: colors.accent },
    text: { ...type.verse, fontSize: 16, lineHeight: 24, color: colors.verseText, marginTop: space.xs },
  });
}
