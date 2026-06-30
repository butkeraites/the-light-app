// app/components/ReaderSearchResultItem.tsx — F1.6 (ADR-0015)
//
// Apresentacional: um resultado de busca. Mostra a REFERÊNCIA legível (ex.: "John
// 3:16") e o SNIPPET com o termo destacado, e é CLICÁVEL (Pressable → onPress).
// Cores via TOKENS de tema (`useTheme`), nunca hex hardcoded. Não faz I/O nem
// lógica de domínio: o `hit` (texto verbatim do store + `highlighted` com os
// marcadores do core) vem da fronteira `search` (F1.5); aqui só interpretamos os
// marcadores HL_START/HL_END em ESTILO — eles NUNCA aparecem como texto cru, pois
// `splitHighlighted` os consome. O nome do livro chega resolvido por prop
// (`bookName`, de `listBooks()` na tela) — o item permanece puro/sem native call.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { splitHighlighted } from '../lib/highlight';
import { useTheme, type ThemeColors } from '../lib/theme';
import type { SearchHit } from '../web/reading';

/** Formata o intervalo de versículos do hit (num hit de busca é sempre `Single`). */
function formatVerses(verses: SearchHit['reference']['verses']): string {
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

export function ReaderSearchResultItem({
  hit,
  bookName,
  onPress,
  testID,
}: {
  hit: SearchHit;
  bookName: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const verseLabel = formatVerses(hit.reference.verses);
  const reference = `${bookName} ${hit.reference.chapter}${verseLabel ? `:${verseLabel}` : ''}`;

  // Divide o snippet do core em runs alternados (normal / casado). Os marcadores de
  // controle são CONSUMIDOS aqui — nunca chegam a um <Text>.
  const runs = useMemo(() => splitHighlighted(hit.highlighted), [hit.highlighted]);

  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={reference}
    >
      <Text style={styles.reference}>{reference}</Text>
      <Text style={styles.snippet}>
        {runs.map((run, i) =>
          run.matched ? (
            <Text key={i} style={styles.matched}>
              {run.text}
            </Text>
          ) : (
            <Text key={i} style={styles.normal}>
              {run.text}
            </Text>
          ),
        )}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      gap: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    reference: { fontSize: 13, fontWeight: '700', color: colors.accent },
    snippet: { fontSize: 16, lineHeight: 24 },
    normal: { color: colors.verseText },
    // Termo casado: negrito + cor de destaque (token de tema, sem paleta nova).
    matched: { color: colors.accent, fontWeight: '700' },
  });
}
