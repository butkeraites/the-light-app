// app/components/ReaderParallelView.tsx — F1.4 (ADR-0015)
//
// Apresentacional: renderiza DUAS traduções do MESMO capítulo LADO A LADO, com os
// versículos ALINHADOS pelo número. Recebe duas `Passage` (primária + secundária)
// já lidas do store via `get_chapter` (uma chamada por tradução) — o alinhamento
// aqui é PRESENTAÇÃO sobre o retorno da fronteira, NÃO um SELECT/parser em TS.
// O texto é VERBATIM do store (anti-alucinação): a UI nunca gera/edita versículo.
//
// Alinhamento: monta a UNIÃO ORDENADA dos números de versículo (`Single`) das
// duas passagens. Se um número existir só em uma tradução (o cânon Almeida 1911
// tem 1 versículo a menos em alguns capítulos), a outra coluna mostra um
// placeholder atenuado. Cores via TOKENS de tema (`useTheme`), nunca hex literal.
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeColors } from '../lib/theme';
import type { Passage } from '../web/reading';

/** Mapa número-do-versículo → texto (verbatim do store) para uma passagem. */
function verseMap(passage: Passage): Map<number, string> {
  const m = new Map<number, string>();
  for (const v of passage.verses) {
    const r = v.reference.verses;
    if (r.tag === 'Single') {
      m.set(r.inner.verse, v.text);
    }
  }
  return m;
}

/** Rótulo curto da coluna a partir do slug da tradução no retorno do store. */
function passageLabel(passage: Passage, fallback: string): string {
  const slug = passage.verses[0]?.translation;
  return (slug ?? fallback).toUpperCase();
}

export function ReaderParallelView({
  primary,
  secondary,
}: {
  primary: Passage;
  secondary: Passage;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const primaryMap = useMemo(() => verseMap(primary), [primary]);
  const secondaryMap = useMemo(() => verseMap(secondary), [secondary]);

  // União ordenada dos números de versículo das duas traduções.
  const numbers = useMemo(() => {
    const set = new Set<number>([...primaryMap.keys(), ...secondaryMap.keys()]);
    return Array.from(set).sort((a, b) => a - b);
  }, [primaryMap, secondaryMap]);

  if (numbers.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.empty}>Capítulo não encontrado no banco de leitura.</Text>
      </ScrollView>
    );
  }

  const primaryLabel = passageLabel(primary, 'A');
  const secondaryLabel = passageLabel(secondary, 'B');

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.numberCol} />
        <Text style={styles.colHeader} testID="parallel-header-primary">
          {primaryLabel}
        </Text>
        <Text style={styles.colHeader} testID="parallel-header-secondary">
          {secondaryLabel}
        </Text>
      </View>
      {numbers.map((n) => {
        const primaryText = primaryMap.get(n);
        const secondaryText = secondaryMap.get(n);
        return (
          <View key={n} style={styles.row} testID={`parallel-verse-${n}`}>
            <Text style={styles.verseNumber}>{n}</Text>
            <Text style={[styles.col, primaryText == null ? styles.missing : null]}>
              {primaryText ?? '—'}
            </Text>
            <Text style={[styles.col, secondaryText == null ? styles.missing : null]}>
              {secondaryText ?? '—'}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { padding: 16, paddingBottom: 32 },
    headerRow: {
      flexDirection: 'row',
      gap: 12,
      paddingBottom: 8,
      marginBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    numberCol: { width: 24 },
    colHeader: {
      flex: 1,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: colors.muted,
      textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row',
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    verseNumber: {
      width: 24,
      textAlign: 'right',
      fontSize: 12,
      fontWeight: '700',
      color: colors.accent,
      fontVariant: ['tabular-nums'],
    },
    col: { flex: 1, fontSize: 15, lineHeight: 22, color: colors.verseText },
    missing: { color: colors.faint, fontStyle: 'italic' },
    empty: { fontSize: 14, color: colors.muted },
  });
}
