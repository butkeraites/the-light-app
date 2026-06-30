// app/app/read/[book]/[chapter].tsx — F1.3 · lado a lado + tema F1.4 (ADR-0015)
//
// Tela 3 do fluxo de leitura: TEXTO DO CAPÍTULO (versículos numerados, VERBATIM
// do store via `get_chapter`) + SELETOR DE VERSÃO (`listTranslations(db)` —
// KJV ⇄ Almeida 1911). Duas capacidades novas (F1.4):
//   1) LADO A LADO: um toggle ativa o modo paralelo; carregamos `get_chapter`
//      para AS DUAS traduções (uma chamada cada) e alinhamos por número de
//      versículo no `ReaderParallelView` (apresentação sobre o retorno da
//      fronteira — SEM SQL/leitura/texto em TS).
//   2) TEMA claro/escuro: cores via tokens (`useTheme`), não mais hex hardcoded.
// Anti-alucinação: o texto vem sempre do Rust/store, nunca gerado na UI.
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReaderChapterView } from '../../../components/ReaderChapterView';
import { ReaderParallelView } from '../../../components/ReaderParallelView';
import { ReaderVersionPicker } from '../../../components/ReaderVersionPicker';
import { ensureReadingDb } from '../../../lib/db';
import { useTheme, type ThemeColors } from '../../../lib/theme';
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { book, chapter } = useLocalSearchParams<{ book: string; chapter: string }>();
  const bookNumber = Number(book);
  const chapterNumber = Number(chapter);

  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // F1.4: modo lado a lado + 2ª tradução (sempre diferente da primária).
  const [parallel, setParallel] = useState(false);
  const [secondTranslation, setSecondTranslation] = useState<string | null>(null);
  const [secondaryPassage, setSecondaryPassage] = useState<Passage | null>(null);

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

  // Mantém a 2ª tradução válida e SEMPRE diferente da primária.
  useEffect(() => {
    if (translations.length === 0) {
      return;
    }
    setSecondTranslation((prev) => {
      if (prev && prev !== translation && translations.some((t) => t.id === prev)) {
        return prev;
      }
      return translations.find((t) => t.id !== translation)?.id ?? null;
    });
  }, [translations, translation]);

  // Carrega o texto do capítulo na tradução PRIMÁRIA (recarrega ao trocar versão).
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

  // F1.4: no modo paralelo, carrega o MESMO capítulo na 2ª tradução (2ª chamada
  // de get_chapter). O alinhamento por número de versículo é feito na view.
  useEffect(() => {
    if (!parallel || !secondTranslation) {
      setSecondaryPassage(null);
      return;
    }
    let alive = true;
    setSecondaryPassage(null);
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const p = await getChapter(dbPath, secondTranslation, bookNumber, chapterNumber);
        if (alive) setSecondaryPassage(p);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [parallel, secondTranslation, bookNumber, chapterNumber]);

  // 2ª tradução só oferece versões DIFERENTES da primária.
  const secondaryOptions = translations.filter((t) => t.id !== translation);
  const canParallel = secondaryOptions.length > 0;

  return (
    <View style={styles.container}>
      {translations.length > 0 ? (
        <ReaderVersionPicker
          translations={translations}
          current={translation}
          onChange={setTranslation}
        />
      ) : null}

      {canParallel ? (
        <View style={styles.controls}>
          <Pressable
            style={[styles.toggle, parallel ? styles.toggleActive : null]}
            onPress={() => setParallel((v) => !v)}
            testID="parallel-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: parallel }}
          >
            <Text style={[styles.toggleText, parallel ? styles.toggleTextActive : null]}>
              Lado a lado
            </Text>
          </Pressable>
        </View>
      ) : null}

      {parallel && canParallel && secondTranslation ? (
        <ReaderVersionPicker
          translations={secondaryOptions}
          current={secondTranslation}
          onChange={setSecondTranslation}
          testIDPrefix="version2"
        />
      ) : null}

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : passage == null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : parallel && canParallel ? (
        secondaryPassage == null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : (
          <ReaderParallelView primary={passage} secondary={secondaryPassage} />
        )
      ) : (
        <ReaderChapterView passage={passage} />
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    toggle: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toggleActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    toggleText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
    toggleTextActive: { color: colors.chipActiveText },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { fontSize: 14, color: colors.error, textAlign: 'center' },
  });
}
