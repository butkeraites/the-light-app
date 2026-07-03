// app/components/ReaderVersionPicker.tsx — F1.3 · tokens de tema F1.4 (ADR-0015)
//
// Apresentacional: seletor de versão (traduções vindas de `listTranslations(db)`
// — ex.: KJV en ⇄ Almeida 1911 pt). Trocar dispara `onChange(id)`; a tela
// recarrega o mesmo capítulo na outra tradução. Cores via TOKENS de tema
// (`useTheme`), não mais hex hardcoded. Não faz I/O nem lógica de domínio.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeColors } from '../lib/theme';
import type { Translation } from '../web/reading';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.bar}>
      {translations.map((t) => {
        const active = t.id === current;
        return (
          <Pressable
            key={t.id}
            style={[styles.chip, active ? styles.chipActive : null]}
            onPress={() => onChange(t.id)}
            testID={`${testIDPrefix}-${t.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${t.abbrev} ${t.language}`}
            hitSlop={{ top: 8, bottom: 8 }}
          >
            <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
              {t.abbrev}
            </Text>
            <Text style={[styles.chipLang, active ? styles.chipTextActive : null]}>
              {t.language}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    chipText: { fontSize: 14, color: colors.chipText, fontWeight: '600' },
    chipLang: { fontSize: 11, color: colors.chipLang, textTransform: 'uppercase' },
    chipTextActive: { color: colors.chipActiveText },
  });
}
