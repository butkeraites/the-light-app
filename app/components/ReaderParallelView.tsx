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
import { useMemo, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useI18n } from '../lib/i18n';
import { READING_COLUMN_MAX_PARALLEL } from '../lib/readingLayout';
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
  onScroll,
  topInset = 0,
  footer,
}: {
  primary: Passage;
  secondary: Passage;
  /** Leitura imersiva: repassado ao `<ScrollView onScroll>` (esconder o cromo também no paralelo). */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Leitura imersiva: altura da barra-overlay a limpar no topo. */
  topInset?: number;
  /** Rodapé opcional ao fim da rolagem (navegação de capítulo) — paridade com o modo normal. */
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  // F5.16: só o CROMO (estado-vazio) passa por `t()`. O TEXTO dos versículos e os rótulos
  // de coluna (slug da tradução) vêm VERBATIM do store — nunca via `t()` (anti-alucinação).
  const { t } = useI18n();
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
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: 16 + topInset }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
      >
        <Text style={styles.empty}>{t('read.chapterNotFound')}</Text>
      </ScrollView>
    );
  }

  const primaryLabel = passageLabel(primary, 'A');
  const secondaryLabel = passageLabel(secondary, 'B');

  return (
    <ScrollView
      testID="reader-body"
      contentContainerStyle={[styles.content, { paddingTop: 16 + topInset }]}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="never"
    >
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
      {/* Rodapé (navegação de capítulo) ao fim — paridade com o modo normal. */}
      {footer}
    </ScrollView>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // Coluna centralizada (mais larga que o modo simples — são 2 colunas lado a lado). Margens
    // vazias em telas largas = zona de clique-lateral. Ver `lib/readingLayout.ts`.
    content: {
      padding: 16,
      paddingBottom: 32,
      maxWidth: READING_COLUMN_MAX_PARALLEL,
      width: '100%',
      alignSelf: 'center',
    },
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
    // F5.20 (ADR-0048): o "—" de versículo AUSENTE CONVEY informação (a passagem não
    // existe nesta tradução) → NÃO é decorativo → promovido de `faint` (1.61:1 ✗) para
    // `muted` (AA ≥4.5:1 em claro/escuro). `faint` fica só no chevron redundante (decorativo).
    missing: { color: colors.muted, fontStyle: 'italic' },
    empty: { fontSize: 14, color: colors.muted },
  });
}
