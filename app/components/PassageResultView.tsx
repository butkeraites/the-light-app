// app/components/PassageResultView.tsx — ADR-0065 (lookup de passagem: ranges + listas)
//
// Apresentacional: renderiza os TRECHOS resolvidos (`PassageResult`) num cartão ROLÁVEL e
// limitado — cada trecho com um cabeçalho de referência (chrome, locale-aware) + versos
// NUMERADOS em SERIFA de leitura (tokens Vigil). O texto do verso é VERBATIM do store
// (anti-alucinação); só o rótulo/aviso é cromo. Sem I/O, sem lógica de domínio.
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import type { PassageResult, Segment } from '../lib/passageResolve';

/** Número do verso (sempre Single num trecho). */
function verseNum(v: Segment['verses'][number]): number | null {
  const r = v.reference.verses;
  return r.tag === 'Single' ? r.inner.verse : null;
}

export function PassageResultView({ result, full = false }: { result: PassageResult; full?: boolean }) {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // `full` (tela dedicada de passagem, Fase 7): sem borda/altura-máxima do cartão inline — o
  // trecho ocupa a tela inteira e rola no scroll da própria tela.
  return (
    <View style={[styles.card, full ? styles.cardFull : null]} testID="result" accessibilityRole="summary">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {result.segments.map((seg, i) => (
          <View key={`${seg.label}-${i}`} style={styles.segment} testID={`passage-seg-${i}`}>
            <Text style={styles.segHeader} accessibilityRole="header">
              {seg.label}
            </Text>
            {seg.verses.map((v, j) => {
              const n = verseNum(v);
              return (
                <Text key={n ?? j} style={styles.verse}>
                  {n != null ? <Text style={styles.num}>{n} </Text> : null}
                  <Text style={styles.verseText}>{v.text}</Text>
                </Text>
              );
            })}
          </View>
        ))}
        {result.truncated ? (
          <Text style={styles.notice}>{t('home.passageTruncated', { count: result.verseCount })}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    card: {
      maxHeight: 380,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    // Tela dedicada: ocupa tudo, sem borda/raio/altura-máxima do cartão inline.
    cardFull: { flex: 1, maxHeight: undefined, borderWidth: 0, borderRadius: 0, backgroundColor: colors.background },
    scroll: {},
    content: { padding: space.lg, gap: space.lg },
    segment: { gap: space.xs },
    segHeader: { ...type.label, color: colors.accent, marginBottom: space.xs },
    verse: { ...type.verse },
    num: { ...type.verseNumber, color: colors.accent },
    verseText: { color: colors.verseText },
    notice: {
      ...type.caption,
      color: colors.muted,
      fontStyle: 'italic',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      paddingTop: space.md,
    },
  });
}
