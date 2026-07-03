// app/app/read/[book]/index.tsx — F1.3 (ADR-0014) · perf F5.3
//
// Tela 2 do fluxo de leitura: LISTA DE CAPÍTULOS do livro. A quantidade vem de
// `chapterCount(db, translation, book)` (DB-backed — quantos capítulos do livro
// estão PRESENTES no store). Selecionar um capítulo abre o texto.
//
// F5.3: esta rota chama `listBooks()` (síncrono, exige o wasm da fronteira) para
// resolver o nome do livro. Como o 1º paint não bloqueia mais no wasm, ela se
// auto-gateia com `<WasmGate>` (o conteúdo só monta com o wasm pronto). No nativo o
// gate é transparente.
import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ReaderChapterGrid } from '../../../components/ReaderChapterGrid';
import { WasmGate } from '../../../components/WasmGate';
import { ensureReadingDb } from '../../../lib/db';
import { useTheme, type ThemeColors } from '../../../lib/theme';
import { chapterCount, listBooks } from '../../../web/reading';

// Tradução default p/ a contagem de capítulos (o cânon é igual entre versões;
// o seletor de versão atua na leitura do texto, na tela do capítulo).
const DEFAULT_TRANSLATION = 'kjv';

export default function ChaptersScreen() {
  return (
    <WasmGate>
      <ChaptersContent />
    </WasmGate>
  );
}

function ChaptersContent() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { book } = useLocalSearchParams<{ book: string }>();
  const bookNumber = Number(book);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const name = listBooks().find((b) => b.number === bookNumber)?.namePt ?? `Livro ${bookNumber}`;
    navigation.setOptions({ title: name });
    let alive = true;
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const n = await chapterCount(dbPath, DEFAULT_TRANSLATION, bookNumber);
        if (alive) setCount(n);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigation, bookNumber]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (count == null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return (
    <ReaderChapterGrid
      count={count}
      onSelect={(chapter) => router.push(`/read/${bookNumber}/${chapter}`)}
    />
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
