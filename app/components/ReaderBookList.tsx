// app/components/ReaderBookList.tsx — F1.3 · tokens de tema F1.4 (ADR-0015)
//
// Apresentacional: lista os 66 livros canônicos (vindos de `listBooks()` — PURO,
// pela fronteira nativa). Cores via TOKENS de tema (`useTheme`), não mais hex
// hardcoded. Não faz leitura de store nem lógica de domínio.
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import type { Book } from '../web/reading';
import { Icon } from './ui';

export function ReaderBookList({
  books,
  onSelect,
}: {
  books: Book[];
  onSelect: (book: Book) => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  // F5.8: `locale` só ESCOLHE o campo do nome do livro (namePt/nameEn) para o rótulo de
  // acessibilidade — o nome vem do STORE, NUNCA de `t()` (anti-alucinação). A linha exibe
  // ambos os nomes; o `t('a11y.openBook')` é apenas o CROMO do rótulo do gesto.
  const { locale, t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <FlatList
      data={books}
      keyExtractor={(b) => String(b.number)}
      style={styles.container}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => onSelect(item)}
          testID={`book-${item.number}`}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.openBook', {
            name: locale === 'en' ? item.nameEn : item.namePt,
          })}
        >
          <Text style={styles.number}>{item.number}</Text>
          <View style={styles.names}>
            <Text style={styles.namePt}>{item.namePt}</Text>
            <Text style={styles.nameEn}>{item.nameEn}</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.faint} />
        </Pressable>
      )}
    />
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    container: { backgroundColor: colors.background },
    list: { paddingVertical: space.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      gap: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    number: {
      width: 28,
      textAlign: 'right',
      ...type.caption,
      color: colors.muted,
      fontVariant: ['tabular-nums'],
    },
    names: { flex: 1 },
    namePt: { ...type.body, color: colors.text },
    nameEn: { ...type.caption, color: colors.muted },
  });
}
