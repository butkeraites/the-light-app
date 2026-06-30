// app/components/ReaderChapterView.tsx — F1.3 · tokens de tema F1.4 (ADR-0015)
//
// Apresentacional: renderiza o capítulo (Passage) com versículos NUMERADOS e
// TEXTO VERBATIM do store (anti-alucinação — o texto vem do `get_chapter` do
// Rust, nunca gerado/hardcodado na UI). Cores via TOKENS de tema (`useTheme`),
// não mais hex hardcoded. Não faz I/O nem lógica de domínio.
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { useTheme, type ThemeColors } from '../lib/theme';
import type { Passage } from '../web/reading';

/** Número do versículo a partir do `VerseRange` (sempre `Single` num capítulo). */
function verseNumber(passageVerseRange: Passage['verses'][number]['reference']['verses']): number | null {
  return passageVerseRange.tag === 'Single' ? passageVerseRange.inner.verse : null;
}

export function ReaderChapterView({ passage }: { passage: Passage }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (passage.verses.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.empty}>Capítulo não encontrado no banco de leitura.</Text>
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {passage.verses.map((v, i) => {
        const n = verseNumber(v.reference.verses);
        return (
          <Text key={n ?? i} style={styles.verse} testID={n != null ? `verse-${n}` : undefined}>
            {n != null ? <Text style={styles.verseNumber}>{n} </Text> : null}
            <Text style={styles.verseText}>{v.text}</Text>
          </Text>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { padding: 20, gap: 10 },
    verse: { fontSize: 17, lineHeight: 26 },
    verseNumber: { fontSize: 12, color: colors.accent, fontWeight: '700' },
    verseText: { color: colors.verseText },
    empty: { fontSize: 14, color: colors.muted },
  });
}
