// app/components/ReaderVersionPicker.tsx — F1.3 · tokens de tema F1.4 (ADR-0015) · kit ADR-0068
//
// Apresentacional: seletor de versão (traduções vindas de `listTranslations(db)`
// — ex.: KJV en ⇄ Almeida 1911 pt). Trocar dispara `onChange(id)`; a tela
// recarrega o mesmo capítulo na outra tradução. Cada versão é uma <Chip> do kit
// (abreviação + badge de idioma). Cores/tipografia via TOKENS de tema (`useTheme`),
// nunca hex. Não faz I/O nem lógica de domínio.
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme, type ThemeContextValue } from '../lib/theme';
import type { Translation } from '../web/reading';
import { Chip } from './ui';

export function ReaderVersionPicker({
  translations,
  current,
  onChange,
  testIDPrefix = 'version',
}: {
  translations: Translation[];
  current: string;
  onChange: (id: string) => void;
  testIDPrefix?: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.bar}>
      {translations.map((tr) => (
        <Chip
          key={tr.id}
          label={tr.abbrev}
          // Idioma como badge menor (ex.: "EN"/"PT"); o nome do idioma vem do store.
          badge={tr.language.toUpperCase()}
          active={tr.id === current}
          onPress={() => onChange(tr.id)}
          testID={`${testIDPrefix}-${tr.id}`}
          accessibilityLabel={`${tr.abbrev} ${tr.language}`}
        />
      ))}
    </View>
  );
}

function makeStyles({ colors, space }: ThemeContextValue) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
  });
}
