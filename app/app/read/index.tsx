// app/app/read/index.tsx — F1.3 (ADR-0014) · perf F5.3
//
// Tela 1 do fluxo de leitura: LISTA DE LIVROS (66, de `listBooks()` — PURO, pela
// fronteira nativa). Selecionar um livro navega para a lista de capítulos.
//
// F5.3: `listBooks()` é SÍNCRONO e exige o wasm da fronteira já pronto (no web). Como
// o `_layout.tsx` não bloqueia mais o 1º paint no wasm, esta rota se auto-gateia com
// `<WasmGate>` — o conteúdo (que chama `listBooks()`) só MONTA quando o wasm está
// pronto. No nativo o gate é transparente (pronto de imediato).
import { useEffect, useMemo, useState } from 'react';
import { router, useNavigation } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ReaderBookList } from '../../components/ReaderBookList';
import { WasmGate } from '../../components/WasmGate';
import { useI18n } from '../../lib/i18n';
import { useTheme, type ThemeColors } from '../../lib/theme';
import { listBooks, type Book } from '../../web/reading';

export default function BooksScreen() {
  return (
    <WasmGate>
      <BooksContent />
    </WasmGate>
  );
}

function BooksContent() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Título reativo ao idioma: `t` muda de referência quando o locale troca, então o
  // efeito re-roda e reescreve o título via setOptions (sem reiniciar).
  useEffect(() => {
    navigation.setOptions({ title: t('nav.read') });
  }, [navigation, t]);

  useEffect(() => {
    try {
      setBooks(listBooks());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return (
    <ReaderBookList books={books} onSelect={(b) => router.push(`/read/${b.number}`)} />
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: colors.background,
    },
    error: { fontSize: 14, color: colors.error, textAlign: 'center' },
  });
}
