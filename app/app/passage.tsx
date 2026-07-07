// app/app/passage.tsx — Fase 7 (follow-up): TELA DEDICADA de PASSAGEM.
//
// Lookups GRANDES/MÚLTIPLOS da home (capítulo inteiro, intervalo longo, lista de trechos, ou
// resultado truncado) abrem AQUI, numa tela de leitura cheia — enquanto os pequenos seguem inline
// no cartão da home. Recebe a CONSULTA (`q`) e a VERSÃO (`v`) por parâmetro e RE-RESOLVE com limites
// folgados (a home fica no cap pequeno). Reusa a lógica PURA `resolvePassageQuery` (ranges + listas)
// e o `PassageResultView` (modo `full`). NÃO toca o core: o texto vem verbatim do store (anti-
// alucinação); só o rótulo do trecho é cromo. O nome do livro segue o IDIOMA DA VERSÃO (como o
// header do leitor, Fase 7). WasmGate garante o wasm pronto antes de `resolvePassageQuery` no web.
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PassageResultView } from '../components/PassageResultView';
import { WasmGate } from '../components/WasmGate';
import { useI18n } from '../lib/i18n';
import { resolvePassageQuery, type PassageResult } from '../lib/passageResolve';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { parseReference } from '../web/reference';

export default function PassageScreen() {
  return (
    <WasmGate>
      <PassageContent />
    </WasmGate>
  );
}

function PassageContent() {
  const params = useLocalSearchParams<{ q?: string; v?: string }>();
  const query = (typeof params.q === 'string' ? params.q : '').trim();
  const version = typeof params.v === 'string' ? params.v : '';
  const navigation = useNavigation();
  const { t } = useI18n();
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [result, setResult] = useState<PassageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Título do header = a consulta digitada (ex.: "João 3" / "Salmos 23; João 3"). É entrada do
  // usuário ecoada, não cromo traduzível — não passa por t().
  useEffect(() => {
    navigation.setOptions({ title: query });
  }, [navigation, query]);

  useEffect(() => {
    if (query.length === 0) {
      setLoading(false);
      setError(t('home.passageNotFound', { input: query }));
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [{ ensureReadingDb }, { getChapter, listBooks, listTranslations }] = await Promise.all([
          import('../lib/db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const books = listBooks();
        const ts = await listTranslations(dbPath).catch(() => []);
        const translation = ts.some((x) => x.id === version) ? version : ts[0]?.id ?? 'kjv';
        // Nome do livro no IDIOMA DA VERSÃO (consistente com o header do leitor, Fase 7).
        const useEn = ts.find((x) => x.id === translation)?.language === 'en';
        const res = await resolvePassageQuery(query, {
          parseReference,
          getChapter: (b, c) => getChapter(dbPath, translation, b, c),
          chapterCountOf: (b) => books.find((x) => x.number === b)?.chapterCount ?? 1,
          bookLabel: (b) => {
            const bk = books.find((x) => x.number === b);
            return bk ? (useEn ? bk.nameEn : bk.namePt) : t('read.bookFallback', { number: b });
          },
          // Tela cheia: limites folgados (a home mantém o cap pequeno do cartão inline).
          maxVerses: 2000,
          maxChapters: 150,
        });
        if (!alive) return;
        setLoading(false);
        if (res.segments.length === 0) {
          setError(t('home.passageNotFound', { input: query }));
        } else {
          setResult(res);
        }
      } catch (err) {
        if (!alive) return;
        setLoading(false);
        setError(t('home.resolveError', { message: err instanceof Error ? err.message : String(err) }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [query, version, t]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  if (error != null || result == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error} testID="passage-error" accessibilityRole="text">
          {error ?? t('home.passageNotFound', { input: query })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.screen} testID="passage-screen">
      <PassageResultView result={result} full />
    </View>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.background },
    error: { ...type.body, color: colors.error, textAlign: 'center' },
  });
}
