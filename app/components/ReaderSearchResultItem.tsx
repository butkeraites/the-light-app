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
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { splitHighlighted } from '../lib/highlight';
import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import type { SearchHit } from '../web/reading';
import { IconButton } from './ui';

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
  onAddToScope,
  inScope = false,
  testID,
}: {
  hit: SearchHit;
  bookName: string;
  onPress: () => void;
  /** Fase 4: adiciona/remove este versículo do Escopo de Estudo (entrada por TEMA). */
  onAddToScope?: () => void;
  /** Este versículo já está no Escopo (botão vira "✓"). */
  inScope?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const verseLabel = formatVerses(hit.reference.verses);
  const reference = `${bookName} ${hit.reference.chapter}${verseLabel ? `:${verseLabel}` : ''}`;

  // Divide o snippet do core em runs alternados (normal / casado). Os marcadores de
  // controle são CONSUMIDOS aqui — nunca chegam a um <Text>.
  const runs = useMemo(() => splitHighlighted(hit.highlighted), [hit.highlighted]);

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.main}
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
      {onAddToScope ? (
        <IconButton
          name={inScope ? 'check' : 'plus'}
          onPress={onAddToScope}
          active={inScope}
          accessibilityLabel={t(inScope ? 'a11y.scopeRemove' : 'a11y.scopeAdd', { ref: reference })}
          testID={testID ? `${testID}-scope` : undefined}
        />
      ) : null}
    </View>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      gap: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    main: { flex: 1, gap: space.xs, paddingVertical: space.xs },
    reference: { ...type.caption, fontWeight: '700', color: colors.accent },
    // Snippet em SERIFA (mesma família do texto de leitura) — o versículo respira como Escritura.
    snippet: { ...type.verse, fontSize: 16, lineHeight: 24 },
    normal: { color: colors.verseText },
    // Termo casado: negrito + cor de destaque (token de tema, sem paleta nova).
    matched: { color: colors.accent, fontWeight: '700' },
  });
}
