// app/components/ReaderScopeBar.tsx — Fase 2 (Escopo de Estudo multi-seleção)
//
// BARRA-ESCOPO persistente no rodapé do leitor: mostra os TRECHOS já selecionados (chips
// removíveis), a contagem, um chip "+ Capítulo" (alterna o capítulo atual inteiro), e as ações
// Limpar / Concluir / Estudar. Persiste ao navegar entre capítulos/livros (o estado vive no store
// `useStudyScope`, acima da rota) — é o que permite juntar trechos de lugares diferentes. Só
// apresentação: cores/tipografia por tokens Vigil; rótulos via t(); os nomes de livro vêm do store
// (bookLabelOf), nunca sintetizados (anti-alucinação).
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { chunkKey, chunkLabel, isWholeChapter, type ScopeChunk } from '../lib/studyScope';
import { Button, Chip, Surface } from './ui';

export function ReaderScopeBar({
  chunks,
  bookLabelOf,
  chapterWhole = false,
  onToggleChapter,
  onRemove,
  onClear,
  onDone,
  onStudy,
}: {
  chunks: ScopeChunk[];
  /** Nome de EXIBIÇÃO do livro (idioma da versão/UI) — do store, via listBooks. */
  bookLabelOf: (book: number) => string;
  /** O capítulo ATUAL já está inteiro no escopo (estado do chip "+ Capítulo"). */
  chapterWhole?: boolean;
  /** Alterna o capítulo atual inteiro. Ausente (ex.: tela de busca) → o chip "+ Capítulo" some. */
  onToggleChapter?: () => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  /** Sai do modo seleção (leitor). Ausente (busca) → o botão "Concluir" some. */
  onDone?: () => void;
  onStudy: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <Surface elevated style={styles.bar} testID="scope-bar">
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {t('scope.title')}
          {'  ·  '}
          <Text style={styles.count}>{t('scope.chunkCount', { count: chunks.length })}</Text>
        </Text>
        <View style={styles.headerActions}>
          {chunks.length > 0 ? (
            <Button title={t('scope.clear')} variant="ghost" onPress={onClear} testID="scope-clear" style={styles.smallBtn} />
          ) : null}
          {onDone ? (
            <Button title={t('scope.done')} variant="ghost" onPress={onDone} testID="scope-done" style={styles.smallBtn} />
          ) : null}
        </View>
      </View>

      {/* Tira horizontal de trechos (tocar remove) + chip "+ Capítulo" do capítulo atual. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {chunks.map((c) => {
          const label = chunkLabel(c, bookLabelOf(c.book));
          return (
            <Chip
              key={chunkKey(c)}
              label={label}
              badge="✕"
              active={isWholeChapter(c)}
              onPress={() => onRemove(chunkKey(c))}
              testID={`scope-chunk-${chunkKey(c)}`}
              accessibilityLabel={t('a11y.scopeRemove', { ref: label })}
            />
          );
        })}
        {onToggleChapter ? (
          <Chip
            label={t('scope.addChapter')}
            active={chapterWhole}
            onPress={onToggleChapter}
            testID="scope-add-chapter"
          />
        ) : null}
      </ScrollView>

      <Button
        title={t('scope.study')}
        icon="study"
        onPress={onStudy}
        disabled={chunks.length === 0}
        testID="scope-study"
        style={styles.studyBtn}
      />
    </Surface>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.xl,
      gap: space.sm,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { ...type.label, color: colors.muted, flexShrink: 1 },
    count: { color: colors.accent },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    smallBtn: { minHeight: 36, paddingVertical: space.xs, paddingHorizontal: space.sm },
    chips: { flexDirection: 'row', gap: space.sm, paddingVertical: space.xs },
    studyBtn: { marginTop: space.xs },
    hint: { ...type.caption, color: colors.muted, textAlign: 'center' },
  });
}
