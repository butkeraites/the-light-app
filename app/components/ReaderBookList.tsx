// app/components/ReaderBookList.tsx — F1.3
//
// Apresentacional: lista os 66 livros canônicos (vindos de `listBooks()` — PURO,
// pela fronteira nativa). Não faz leitura de store nem lógica de domínio.
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Book } from '../web/reading';

export function ReaderBookList({
  books,
  onSelect,
}: {
  books: Book[];
  onSelect: (book: Book) => void;
}) {
  return (
    <FlatList
      data={books}
      keyExtractor={(b) => String(b.number)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() => onSelect(item)}
          testID={`book-${item.number}`}
        >
          <Text style={styles.number}>{item.number}</Text>
          <View style={styles.names}>
            <Text style={styles.namePt}>{item.namePt}</Text>
            <Text style={styles.nameEn}>{item.nameEn}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e2',
  },
  number: {
    width: 28,
    textAlign: 'right',
    fontSize: 13,
    color: '#999999',
    fontVariant: ['tabular-nums'],
  },
  names: { flex: 1 },
  namePt: { fontSize: 16, color: '#111111' },
  nameEn: { fontSize: 12, color: '#888888' },
  chevron: { fontSize: 20, color: '#cccccc' },
});
