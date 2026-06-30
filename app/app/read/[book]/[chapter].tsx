// app/app/read/[book]/[chapter].tsx — F1.3 (ADR-0014)
//
// Tela 3 do fluxo de leitura: TEXTO DO CAPÍTULO (versículos numerados, VERBATIM
// do store via `get_chapter`) + SELETOR DE VERSÃO (`listTranslations(db)` —
// KJV ⇄ Almeida 1911). Trocar a versão recarrega o MESMO capítulo na outra
// tradução. Anti-alucinação: o texto vem do Rust/store, nunca gerado na UI.
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ReaderChapterView } from '../../../components/ReaderChapterView';
import { ReaderVersionPicker } from '../../../components/ReaderVersionPicker';
import { ensureReadingDb } from '../../../lib/db';
import {
  getChapter,
  listBooks,
  listTranslations,
  type Passage,
  type Translation,
} from '../../../web/reading';

const DEFAULT_TRANSLATION = 'kjv';

export default function ChapterScreen() {
  const navigation = useNavigation();
  const { book, chapter } = useLocalSearchParams<{ book: string; chapter: string }>();
  const bookNumber = Number(book);
  const chapterNumber = Number(chapter);

  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const name = listBooks().find((b) => b.number === bookNumber)?.namePt ?? `Livro ${bookNumber}`;
    navigation.setOptions({ title: `${name} ${chapterNumber}` });
  }, [navigation, bookNumber, chapterNumber]);

  // Carrega as traduções disponíveis (seletor de versão) uma vez.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const ts = await listTranslations(dbPath);
        if (alive) setTranslations(ts);
      } catch {
        // Sem traduções → o seletor some; a leitura ainda tenta a default.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Carrega o texto do capítulo na tradução atual (recarrega ao trocar a versão).
  useEffect(() => {
    let alive = true;
    setPassage(null);
    setError(null);
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const p = await getChapter(dbPath, translation, bookNumber, chapterNumber);
        if (alive) setPassage(p);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [translation, bookNumber, chapterNumber]);

  return (
    <View style={styles.container}>
      {translations.length > 0 ? (
        <ReaderVersionPicker
          translations={translations}
          current={translation}
          onChange={setTranslation}
        />
      ) : null}
      {error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : passage == null ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : (
        <ReaderChapterView passage={passage} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { fontSize: 14, color: '#b00020', textAlign: 'center' },
});
