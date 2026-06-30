// app/components/ReaderChapterGrid.tsx — F1.3 · tokens de tema F1.4 (ADR-0015)
//
// Apresentacional: grade numerada de capítulos (1..count). `count` vem de
// `chapterCount(db, translation, book)` (DB-backed) — quantos capítulos do livro
// estão PRESENTES no store. Cores via TOKENS de tema (`useTheme`), não mais hex
// hardcoded. Não faz I/O nem lógica de domínio.
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeColors } from '../lib/theme';

export function ReaderChapterGrid({
  count,
  onSelect,
}: {
  count: number;
  onSelect: (chapter: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (count <= 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Nenhum capítulo disponível nesta versão do banco de leitura.
        </Text>
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
        >
          <Text style={styles.cellText}>{c}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { backgroundColor: colors.background },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      padding: 16,
    },
    cell: {
      width: 52,
      height: 52,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellText: { fontSize: 16, color: colors.text, fontVariant: ['tabular-nums'] },
    empty: { padding: 24 },
    emptyText: { fontSize: 14, color: colors.muted },
  });
}
