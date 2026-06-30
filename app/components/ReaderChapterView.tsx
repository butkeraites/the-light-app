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
  highlightedVerses,
  notedVerses,
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
  /**
   * F1.11: indicador de HIGHLIGHT do usuário — mapa `versículo → cor de fundo`
   * (hex já resolvido p/ o tema, a partir de `list_highlights`). OPCIONAL
   * (retrocompat). A cor do usuário é distinta da seleção (`verseSelected`).
   */
  highlightedVerses?: Map<number, string>;
  /**
   * F1.11: indicador de NOTA do usuário — conjunto de versículos com nota (de
   * `list_notes`). OPCIONAL (retrocompat); mostra um realce/marcador discreto.
   */
  notedVerses?: Set<number>;
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
        // F1.11: realce de highlight do usuário (cor escolhida) + marcador de nota.
        // A seleção (`verseSelected`) tem precedência visual sobre o highlight.
        const highlightColor = n != null ? highlightedVerses?.get(n) : undefined;
        const isNoted = n != null && notedVerses?.has(n) === true;
        return (
          <Text
            key={n ?? i}
            style={[
              styles.verse,
              highlightColor ? { backgroundColor: highlightColor } : null,
              isSelected ? styles.verseSelected : null,
            ]}
            testID={n != null ? `verse-${n}` : undefined}
            onPress={selectable ? () => onVersePress!(n!) : undefined}
            accessibilityRole={selectable ? 'button' : undefined}
          >
            {n != null ? <Text style={styles.verseNumber}>{n} </Text> : null}
            {isNoted ? <Text style={styles.noteMark}>✎ </Text> : null}
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
    noteMark: { fontSize: 12, color: colors.accent, fontWeight: '700' },
    verseText: { color: colors.verseText },
    empty: { fontSize: 14, color: colors.muted },
  });
}
