// app/components/ReaderChapterGrid.tsx — F1.3
//
// Apresentacional: grade numerada de capítulos (1..count). `count` vem de
// `chapterCount(db, translation, book)` (DB-backed) — quantos capítulos do livro
// estão PRESENTES no store. Não faz I/O nem lógica de domínio.
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ReaderChapterGrid({
  count,
  onSelect,
}: {
  count: number;
  onSelect: (chapter: number) => void;
}) {
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
    <View style={styles.grid}>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderColor: '#dddddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontSize: 16, color: '#111111', fontVariant: ['tabular-nums'] },
  empty: { padding: 24 },
  emptyText: { fontSize: 14, color: '#888888' },
});
