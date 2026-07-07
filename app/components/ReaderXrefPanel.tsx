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
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import type { CrossRef } from '../web/reading';
import { BottomSheet, ListRow } from './ui';

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
  const theme = useTheme();
  const { colors } = theme;
  // F5.16: só o CROMO (título, fechar, estado-vazio, rótulo "votos") passa por `t()`. O
  // `{sourceLabel}` (nome do livro do store + cap:versículo) e os nomes de livro de destino
  // (`bookNameOf`) vêm do STORE — nunca via `t()` (anti-alucinação); a atribuição CC-BY é
  // VERBATIM (constante `XREF_ATTRIBUTION`, requisito de licença — não traduzida).
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('xref.title', { source: sourceLabel })}
      testIDPrefix="xref"
      maxHeightPercent={70}
    >
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
          <Text style={styles.empty}>{t('xref.empty')}</Text>
        </View>
      ) : (
        <>
          {/* Cada xref → uma ListRow do kit (um só interativo, chevron = navega). O nome do
              livro de destino vem do STORE (`bookNameOf`), NUNCA via t() (anti-alucinação). */}
          {refs.map((cr) => {
            const verseLabel = formatVerses(cr.reference.verses);
            const reference = `${bookNameOf(cr.reference.book)} ${cr.reference.chapter}${
              verseLabel ? `:${verseLabel}` : ''
            }`;
            return (
              <ListRow
                key={keyOf(cr.reference)}
                label={reference}
                // `votes` é i64 → bigint no binding: String(...) é robusto a ambos.
                value={t('xref.votes', { count: String(cr.votes) })}
                onPress={() => onSelect(cr.reference)}
                testID={`xref-${keyOf(cr.reference)}`}
                accessibilityLabel={reference}
              />
            );
          })}

          {/* Atribuição CC-BY OBRIGATÓRIA (ADR-0016): exibida sempre que o painel
              mostra xrefs. Requisito de licença — não omitir/alterar a string. */}
          <Pressable
            onPress={() => {
              Linking.openURL(XREF_SOURCE_URL).catch(() => {
                /* sem rede/navegador: a atribuição já está visível no texto. */
              });
            }}
            testID="xref-attribution"
            accessibilityRole="link"
            accessibilityLabel={XREF_ATTRIBUTION}
            hitSlop={12}
          >
            <Text style={styles.attribution}>{XREF_ATTRIBUTION}</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    // Folha/cabeçalho agora no <BottomSheet>; linhas de xref na <ListRow> do kit. Aqui só
    // os estados centrados (loading/erro/vazio) e a atribuição CC-BY.
    centered: { paddingVertical: space.xl, alignItems: 'center', justifyContent: 'center' },
    empty: { ...type.body, color: colors.muted, textAlign: 'center' },
    error: { ...type.body, color: colors.error, textAlign: 'center' },
    attribution: {
      ...type.caption,
      color: colors.muted,
      textAlign: 'center',
      paddingTop: space.md,
    },
  });
}
