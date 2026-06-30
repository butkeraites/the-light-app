// app/components/ReaderXrefPanel.tsx — F1.9 (ADR-0016 atribuição / ADR-0015 tema)
//
// Apresentacional: o painel de REFERÊNCIAS CRUZADAS (xref) de um versículo. Recebe
// a lista `CrossRef[]` JÁ ORDENADA por votos (DESC) pela fronteira `cross_refs`
// (F1.8) — NÃO ordena/filtra/consulta nada aqui (uma fonte da verdade): a xref é só
// REFERÊNCIA de destino + votos (anti-alucinação — nenhum texto bíblico). Cada item
// é CLICÁVEL (Pressable → onSelect) p/ navegar ao capítulo de destino (a tela faz o
// `router.push`). Cores via TOKENS de tema (`useTheme`), nunca hex hardcoded.
//
// LICENÇA (ADR-0016): a string EXATA `Cross references courtesy of OpenBible.info
// (CC-BY)` é REQUISITO de licença e aparece SEMPRE que xrefs são exibidas (rodapé).
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme, type ThemeColors } from '../lib/theme';
import type { CrossRef } from '../web/reading';

/** Atribuição CC-BY OBRIGATÓRIA (ADR-0016) — string EXATA, não alterar/omitir. */
export const XREF_ATTRIBUTION = 'Cross references courtesy of OpenBible.info (CC-BY)';

/** Link da fonte (OpenBible.info) — informativo; a atribuição é o requisito. */
const XREF_SOURCE_URL = 'https://www.openbible.info/labs/cross-references/';

/** A referência de destino de uma xref (deriva do Record da fronteira). */
type XrefReference = CrossRef['reference'];

/** Formata o(s) versículo(s) de destino (xref pode ser `Single` ou `Range`). */
function formatVerses(verses: XrefReference['verses']): string {
  switch (verses.tag) {
    case 'Single':
      return String(verses.inner.verse);
    case 'Range':
      return `${verses.inner.start}-${verses.inner.end}`;
    case 'WholeChapter':
      return '';
    default:
      return '';
  }
}

/** Chave estável de uma xref de destino. */
function keyOf(ref: XrefReference): string {
  return `${ref.book}-${ref.chapter}-${formatVerses(ref.verses) || 'ch'}`;
}

export function ReaderXrefPanel({
  visible,
  sourceLabel,
  refs,
  loading,
  error,
  bookNameOf,
  onSelect,
  onClose,
}: {
  visible: boolean;
  /** Rótulo do versículo de ORIGEM (ex.: "João 3:16"), só p/ o cabeçalho. */
  sourceLabel: string;
  /** Lista de xrefs (ordenada por votos DESC pela fronteira). */
  refs: CrossRef[];
  loading: boolean;
  error: string | null;
  /** Resolve o nome (EN) do livro de destino — vem de `listBooks()` na tela. */
  bookNameOf: (book: number) => string;
  /** Toca uma xref → a tela navega ao capítulo de destino. */
  onSelect: (ref: XrefReference) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="xref-backdrop" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Referências cruzadas — {sourceLabel}</Text>
          <Pressable onPress={onClose} testID="xref-close" accessibilityRole="button">
            <Text style={styles.close}>Fechar</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : refs.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.empty}>Sem referências cruzadas para este versículo.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {refs.map((cr) => {
              const verseLabel = formatVerses(cr.reference.verses);
              const reference = `${bookNameOf(cr.reference.book)} ${cr.reference.chapter}${
                verseLabel ? `:${verseLabel}` : ''
              }`;
              return (
                <Pressable
                  key={keyOf(cr.reference)}
                  style={styles.row}
                  onPress={() => onSelect(cr.reference)}
                  testID={`xref-${keyOf(cr.reference)}`}
                  accessibilityRole="button"
                  accessibilityLabel={reference}
                >
                  <Text style={styles.reference}>{reference}</Text>
                  {/* `votes` é i64 → bigint no binding: String(...) é robusto a ambos. */}
                  <Text style={styles.votes}>{String(cr.votes)} votos</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* Atribuição CC-BY OBRIGATÓRIA (ADR-0016): exibida sempre que o painel
            mostra xrefs. Requisito de licença — não omitir/alterar a string. */}
        {refs.length > 0 ? (
          <Pressable
            onPress={() => {
              Linking.openURL(XREF_SOURCE_URL).catch(() => {
                /* sem rede/navegador: a atribuição já está visível no texto. */
              });
            }}
            testID="xref-attribution"
            accessibilityRole="link"
          >
            <Text style={styles.attribution}>{XREF_ATTRIBUTION}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
      maxHeight: '60%',
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingBottom: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    title: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
    close: { fontSize: 14, fontWeight: '600', color: colors.accent, paddingLeft: 12 },
    centered: { padding: 24, alignItems: 'center', justifyContent: 'center' },
    list: { paddingVertical: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    reference: { fontSize: 15, fontWeight: '600', color: colors.accent },
    votes: { fontSize: 13, color: colors.muted },
    empty: { fontSize: 14, color: colors.muted, textAlign: 'center' },
    error: { fontSize: 14, color: colors.error, textAlign: 'center' },
    attribution: {
      fontSize: 12,
      color: colors.muted,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingTop: 12,
    },
  });
}
