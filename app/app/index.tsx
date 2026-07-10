import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { HomeStreak } from '../components/HomeStreak';
import { HomeVerseOfDay } from '../components/HomeVerseOfDay';
import { PassageResultView } from '../components/PassageResultView';
import { ReaderVersionPicker } from '../components/ReaderVersionPicker';
import { Button } from '../components/ui/Button';
import { ListRow } from '../components/ui/ListRow';
import { isLargePassage, resolvePassageQuery, type PassageResult } from '../lib/passageResolve';
import { runReferenceSelfTest } from '../web/selftest';
import { useI18n } from '../lib/i18n';
import { useVersionSelection } from '../lib/useVersionSelection';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { parseReference } from '../web/reference';
// PERF (F5.12): a leitura de store (`reading`/`db`) é a parte PESADA (glue + sqlite-mirror), importada
// SOB DEMANDA (chunk async, FORA do 1º paint eager) — aqui no lookup de passagem, e para as traduções
// dentro de `useVersionSelection`/`useTranslations`. `parseReference` (leve, wasm) segue eager.

// F0.6b/F0.10 · ADR-0063 (Vigil) · ADR-0065 (lookup de passagem: seletor de versão + ranges/listas)
//
// A referência é SEMPRE resolvida PELO RUST (`parseReference`, the-light-core via UniFFI) e o
// TEXTO vem VERBATIM do store via `getChapter` na TRADUÇÃO escolhida (anti-alucinação) — nas DUAS
// plataformas (antes: web só KJV via `getPassage`; nativo não lia texto). ADR-0065 aceita RANGES
// (hífen: versos→capítulos→livros) e LISTAS (`;`/`,`) — expandidos APP-SIDE em leituras atômicas de
// capítulo (`resolvePassageQuery`), SEM tocar o core. Seletor de versão reusa o padrão da busca
// (pt→Almeida / en→KJV, reativo). Cromo via `t()`; texto do verso nunca traduzido.

// Tradução default do lookup por idioma da UI (o texto casa o idioma do usuário) — fonte única em
// `lib/translationDefault` (a MESMA usada pela busca e pela leitura). Cai no KJV fora de pt.

export default function HomeScreen() {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [passageResult, setPassageResult] = useState<PassageResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // ADR-0070/0065: seletor de versão (traduções + escolha + resolução) numa costura só
  // (`useVersionSelection`, instância LOCAL). Reativo ao idioma até o usuário escolher — mesmo
  // comportamento, sem a escada/efeito de carregamento duplicados.
  const { translations, setPicked: setPickedTranslation, effective: effectiveTranslation } =
    useVersionSelection(locale);

  // F5.26: SEÇÃO de SINCRONIZAÇÃO OPT-IN + backup. Carregada SOB DEMANDA (chunk async), fora do
  // entry eager do 1º paint. Opt-in é OFF por padrão (`syncPrefs`).
  const [syncOpen, setSyncOpen] = useState(false);
  const [SyncPanel, setSyncPanel] = useState<ComponentType<{ onClose?: () => void }> | null>(null);
  const openSync = useCallback(async () => {
    if (!SyncPanel) {
      const mod = await import('../components/SyncSettings');
      setSyncPanel(() => mod.SyncSettings);
    }
    setSyncOpen(true);
  }, [SyncPanel]);

  // F0.7 — prova HEADLESS nativa sob EXPO_PUBLIC_TLA_SELFTEST=1 (não muda a UI normal).
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_TLA_SELFTEST === '1') {
      void runReferenceSelfTest();
    }
  }, []);

  // Resolve a consulta (ranges + listas) na tradução escolhida. Re-resolve ao trocar a versão ou o
  // idioma. `seq` descarta respostas obsoletas. Anti-alucinação: o texto vem de `getChapter`.
  const seqRef = useRef(0);
  useEffect(() => {
    const input = submittedQuery.trim();
    if (input.length === 0) {
      setPassageResult(null);
      setResolveError(null);
      setResolving(false);
      return;
    }
    let alive = true;
    const mySeq = ++seqRef.current;
    setResolving(true);
    setResolveError(null);
    (async () => {
      try {
        const [{ ensureReadingDb }, { getChapter, listBooks }] = await Promise.all([
          import('../lib/db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const books = listBooks(); // cânon (síncrono, exige wasm — já aquecido no boot)
        const result = await resolvePassageQuery(input, {
          parseReference,
          getChapter: (b, c) => getChapter(dbPath, effectiveTranslation, b, c),
          chapterCountOf: (b) => books.find((x) => x.number === b)?.chapterCount ?? 1,
          bookLabel: (b) => {
            const bk = books.find((x) => x.number === b);
            return bk ? (locale === 'en' ? bk.nameEn : bk.namePt) : t('read.bookFallback', { number: b });
          },
        });
        if (!alive || mySeq !== seqRef.current) return;
        setResolving(false);
        if (result.segments.length === 0) {
          setPassageResult(null);
          setResolveError(t('home.passageNotFound', { input }));
        } else {
          setPassageResult(result);
          setResolveError(null);
        }
      } catch (err) {
        if (!alive || mySeq !== seqRef.current) return;
        setResolving(false);
        setPassageResult(null);
        setResolveError(t('home.resolveError', { message: err instanceof Error ? err.message : String(err) }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [submittedQuery, effectiveTranslation, locale]);

  function handleSubmit() {
    setSubmittedQuery(query.trim());
  }

  // Painel de sync aberto → substitui a home (com voltar). O painel vive num chunk async.
  if (syncOpen && SyncPanel) {
    return <SyncPanel onClose={() => setSyncOpen(false)} />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* MARCA — título em serifa (type.display) + régua dourada. */}
      <View style={styles.brand}>
        <Text style={styles.title} accessibilityRole="header">
          {t('home.title')}
        </Text>
        <View style={styles.rule} />
      </View>

      {/* SEQUÊNCIA DE LEITURA (Rodada 4) — hábito diário local; some se ainda não há sequência. */}
      <HomeStreak />

      {/* LOOKUP — passagem, intervalo ou lista (ex.: "João 3:16-18; Salmos 23"). */}
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={handleSubmit}
        returnKeyType="search"
        placeholder={t('home.inputPlaceholder')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        testID="passage-input"
        accessibilityLabel={t('a11y.searchInput')}
      />
      {Platform.OS === 'web' ? <Text style={styles.hint}>{t('home.hint')}</Text> : null}

      {/* ADR-0065: seletor de VERSÃO (KJV / Almeida 1911). Trocar re-resolve a mesma consulta. */}
      {translations.length > 0 ? (
        <View style={styles.pickerRow}>
          <Text style={styles.pickerLabel}>{t('search.translationLabel')}</Text>
          <ReaderVersionPicker
            translations={translations}
            current={effectiveTranslation}
            onChange={setPickedTranslation}
            testIDPrefix="home-version"
          />
        </View>
      ) : null}

      {/* RESULTADO — spinner / erro / trechos (cartão rolável) / placeholder. testID="result"
          está SEMPRE no elemento mostrado (menos durante o carregamento), p/ testes/a11y. */}
      {resolving ? (
        <View style={styles.resultLoading}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : resolveError ? (
        <Text testID="result" style={[styles.result, styles.resultError]} accessibilityRole="text">
          {resolveError}
        </Text>
      ) : passageResult ? (
        <>
          <PassageResultView result={passageResult} />
          {/* Fase 7: lookups GRANDES/MÚLTIPLOS (capítulo, intervalo longo, lista, truncado) abrem
              numa tela de leitura DEDICADA; os pequenos ficam só no cartão inline acima. */}
          {isLargePassage(passageResult) ? (
            <Button
              title={t('home.openFullPassage')}
              icon="book"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/passage',
                  params: { q: submittedQuery, v: effectiveTranslation },
                })
              }
              testID="open-full-passage"
              style={styles.openFullBtn}
            />
          ) : null}
        </>
      ) : (
        <Text testID="result" style={[styles.result, styles.resultIdle]} accessibilityRole="text">
          {t('home.resultPlaceholder')}
        </Text>
      )}

      {/* AÇÃO PRIMÁRIA — Ler a Bíblia (ouro). UM só elemento interativo (role/label/alvo ≥44). */}
      <Pressable
        onPress={() => router.push('/read')}
        style={styles.cta}
        testID="open-reader"
        accessibilityRole="link"
        accessibilityLabel={t('home.readBible')}
      >
        <Text style={styles.ctaTitle}>{t('home.readBible')}</Text>
        <Text style={styles.ctaChevron}>›</Text>
      </Pressable>

      {/* VERSÍCULO DO DIA (Rodada 4) — devocional determinístico/local; texto verbatim do store.
          Some sozinho se o store não carregar (offline-first), sem quebrar a Home. */}
      <HomeVerseOfDay translation={effectiveTranslation} translations={translations} />

      {/* NAVEGAÇÃO SECUNDÁRIA — cartão com divisórias, cada linha via o kit <ListRow>. */}
      <View style={styles.rowsCard}>
        <ListRow
          label={t('home.searchBible')}
          leading="search"
          onPress={() => router.push('/search')}
          testID="open-search"
          accessibilityRole="link"
        />
        <View style={styles.rowDivider} />
        <ListRow
          label={t('home.readingPlans')}
          leading="plans"
          onPress={() => router.push('/plans')}
          testID="open-plans"
          accessibilityRole="link"
        />
        <View style={styles.rowDivider} />
        <ListRow
          label={t('home.syncBackup')}
          leading="cloud"
          onPress={openSync}
          testID="open-sync"
          accessibilityRole="button"
          accessibilityLabel={t('a11y.openSync')}
        />
        <View style={styles.rowDivider} />
        <ListRow
          label={t('home.about')}
          leading="info"
          onPress={() => router.push('/about')}
          testID="open-about"
          accessibilityRole="link"
          accessibilityLabel={t('a11y.openAbout')}
        />
        <View style={styles.rowDivider} />
        <ListRow
          label={t('home.settings')}
          leading="settings"
          onPress={() => router.push('/settings')}
          testID="open-settings"
          accessibilityRole="link"
          accessibilityLabel={t('a11y.openSettings')}
        />
      </View>
    </ScrollView>
  );
}

// Estilos derivados dos TOKENS (cor + tipografia + espaço + raio) — zero magic number.
function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    container: { padding: space.xl, paddingTop: space.xxl, gap: space.lg },
    brand: { gap: space.sm, marginBottom: space.xs },
    title: { ...type.display, color: colors.text },
    rule: { width: 44, height: 3, borderRadius: 3, backgroundColor: colors.accent },
    input: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    hint: { ...type.caption, color: colors.muted, marginLeft: space.sm, marginTop: -space.sm },
    pickerRow: { gap: space.xs },
    pickerLabel: { ...type.label, color: colors.muted },
    result: { ...type.body },
    resultIdle: { color: colors.muted },
    resultError: { color: colors.error },
    resultLoading: { paddingVertical: space.lg, alignItems: 'flex-start' },
    openFullBtn: { marginTop: space.sm, alignSelf: 'flex-start' },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: radius.lg,
      paddingHorizontal: space.lg,
      paddingVertical: space.lg,
      minHeight: 56,
    },
    ctaTitle: { ...type.heading, color: colors.onAccent, flex: 1 },
    ctaChevron: { fontSize: 24, color: colors.onAccent },
    rowsCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: space.lg },
  });
}
