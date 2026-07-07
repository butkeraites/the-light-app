// app/components/ScopeStudySheet.tsx — Fase 2 (Escopo de Estudo multi-seleção)
//
// Folha que ABRE a partir da barra-escopo: resolve o ESCOPO inteiro (vários trechos, possivelmente
// de capítulos/livros diferentes) para o TEXTO VERBATIM do store e o exibe — a âncora anti-alucinação
// tornada VISÍVEL antes de qualquer IA: "é exatamente este o texto que será citado". Reusa a lógica
// PURA `resolvePassageQuery` (que já expande ranges/listas/capítulos em segmentos verbatim) e o
// `PassageResultView`. Monta a consulta juntando as referências canônicas (EN) dos trechos com "; ".
// (As ações de IA sobre o escopo entram na próxima fatia — Fase 1/3.)
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { resolvePassageQuery, type PassageResult } from '../lib/passageResolve';
import { chunkToReference, type ScopeChunk } from '../lib/studyScope';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { parseReference } from '../web/reference';
import { PassageResultView } from './PassageResultView';
import { BottomSheet } from './ui';

export function ScopeStudySheet({
  visible,
  chunks,
  translation,
  onClose,
}: {
  visible: boolean;
  chunks: ScopeChunk[];
  /** Tradução corrente — de onde o texto verbatim é lido. */
  translation: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [result, setResult] = useState<PassageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || chunks.length === 0) {
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [{ ensureReadingDb }, { getChapter, listBooks }] = await Promise.all([
          import('../lib/db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const books = listBooks();
        const nameEn = (b: number) => books.find((x) => x.number === b)?.nameEn ?? `Book ${b}`;
        // Consulta = referências canônicas EN dos trechos juntadas por "; " → resolvePassageQuery
        // expande cada uma em segmentos verbatim (o mesmo caminho da tela de passagem).
        const query = chunks.map((c) => chunkToReference(c, nameEn(c.book))).join('; ');
        const res = await resolvePassageQuery(query, {
          parseReference,
          getChapter: (b, c) => getChapter(dbPath, translation, b, c),
          chapterCountOf: (b) => books.find((x) => x.number === b)?.chapterCount ?? 1,
          bookLabel: (b) => {
            const bk = books.find((x) => x.number === b);
            return bk ? bk.namePt : `Livro ${b}`;
          },
          maxVerses: 2000,
          maxChapters: 150,
        });
        if (!alive) return;
        setLoading(false);
        setResult(res.segments.length > 0 ? res : null);
      } catch (err) {
        if (!alive) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, chunks, translation]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('scope.title')} testIDPrefix="scope-sheet" maxHeightPercent={88}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : error != null ? (
        <Text style={styles.error} testID="scope-sheet-error">
          {error}
        </Text>
      ) : result != null ? (
        <PassageResultView result={result} full />
      ) : null}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    centered: { paddingVertical: space.xl, alignItems: 'center' },
    error: { ...type.body, color: colors.error, textAlign: 'center', paddingVertical: space.lg },
  });
}
