// app/components/ReaderChapterGrid.tsx — F1.3 · tokens de tema F1.4 (ADR-0015)
//
// Apresentacional: grade numerada de capítulos (1..count). `count` vem de
// `chapterCount(db, translation, book)` (DB-backed) — quantos capítulos do livro
// estão PRESENTES no store. Cores via TOKENS de tema (`useTheme`), não mais hex
// hardcoded. Não faz I/O nem lógica de domínio.
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';

export function ReaderChapterGrid({
  count,
  onSelect,
}: {
  count: number;
  onSelect: (chapter: number) => void;
}) {
  const theme = useTheme();
  // F5.8: cromo do estado-vazio + rótulo de acessibilidade da célula. O NÚMERO do capítulo
  // é DADO; só o cromo ("Nenhum capítulo…"/"Abrir o capítulo N") passa por `t()`.
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (count <= 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('read.emptyChapters')}</Text>
      </View>
    );
  }
  const chapters = Array.from({ length: count }, (_, i) => i + 1);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.grid}>
      {chapters.map((c) => (
        <Pressable
          key={c}
          style={styles.cell}
          onPress={() => onSelect(c)}
          testID={`chapter-${c}`}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.openChapter', { chapter: c })}
        >
          <Text style={styles.cellText}>{c}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    container: { backgroundColor: colors.background },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      padding: space.lg,
    },
    cell: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellText: { ...type.body, color: colors.text, fontVariant: ['tabular-nums'] },
    empty: { padding: space.xl },
    emptyText: { ...type.body, color: colors.muted },
  });
}
