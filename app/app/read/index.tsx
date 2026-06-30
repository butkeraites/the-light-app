// app/app/read/index.tsx — F1.3 (ADR-0014)
//
// Tela 1 do fluxo de leitura: LISTA DE LIVROS (66, de `listBooks()` — PURO, pela
// fronteira nativa). Selecionar um livro navega para a lista de capítulos.
import { useEffect, useState } from 'react';
import { router, useNavigation } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ReaderBookList } from '../../components/ReaderBookList';
import { listBooks, type Book } from '../../web/reading';

export default function BooksScreen() {
  const navigation = useNavigation();
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: 'Ler a Bíblia' });
    try {
      setBooks(listBooks());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [navigation]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!books) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <ReaderBookList books={books} onSelect={(b) => router.push(`/read/${b.number}`)} />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { fontSize: 14, color: '#b00020', textAlign: 'center' },
});
