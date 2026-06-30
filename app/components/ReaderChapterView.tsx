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

export function ReaderChapterView({
  passage,
  onVersePress,
  selectedVerse,
}: {
  passage: Passage;
  /**
   * F1.9: torna os versículos SELECIONÁVEIS (Pressable) p/ abrir o painel de
   * referências cruzadas. OPCIONAL — sem o prop, o comportamento é o de F1.3 (texto
   * estático), preservando a retrocompatibilidade.
   */
  onVersePress?: (verse: number) => void;
  /** Versículo selecionado (realce por token); só usado com `onVersePress`. */
  selectedVerse?: number | null;
}) {
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
        const selectable = onVersePress != null && n != null;
        const isSelected = selectable && selectedVerse === n;
        return (
          <Text
            key={n ?? i}
            style={[styles.verse, isSelected ? styles.verseSelected : null]}
            testID={n != null ? `verse-${n}` : undefined}
            onPress={selectable ? () => onVersePress!(n!) : undefined}
            accessibilityRole={selectable ? 'button' : undefined}
          >
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
    verseSelected: { backgroundColor: colors.chipActiveBg, color: colors.chipActiveText },
    verseNumber: { fontSize: 12, color: colors.accent, fontWeight: '700' },
    verseText: { color: colors.verseText },
    empty: { fontSize: 14, color: colors.muted },
  });
}
