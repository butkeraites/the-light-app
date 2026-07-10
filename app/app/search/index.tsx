// app/app/search/index.tsx — F1.6 (ADR-0014/0015) · busca inteligente ADR-0064
//
// Tela de BUSCA: um campo (`TextInput`) com debounce que, a cada termo estável, chama a
// fronteira `search` (FTS5/BM25) e renderiza a LISTA de resultados. A busca EXATA do core é
// INALTERADA (uma fonte da verdade / anti-alucinação: nenhum SQL/FTS/MATCH em TS; texto verbatim
// do store). ADR-0064 adiciona, 100% APP-SIDE e por CIMA da fronteira intocada:
//   • AUTOCOMPLETE: sugestões de REFERÊNCIA (cânon `listBooks` + `parseReference`) e BUSCAS
//     RECENTES (KV offline) — atalhos para abrir a leitura / repetir uma busca.
//   • DID-YOU-MEAN: quando a busca (AND palavra-a-palavra) dá ZERO, propõe termos alternativos
//     que DE FATO retornam resultados (termos significativos + equivalências curadas), provados
//     contra o store — ex.: "armadura do espírito" → "armadura de Deus" → Efésios 6:11.
// Cores/tipografia via TOKENS Vigil (ADR-0063).
import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ReaderSearchResultItem } from '../../components/ReaderSearchResultItem';
import { ReaderVersionPicker } from '../../components/ReaderVersionPicker';
import { ReaderScopeBar } from '../../components/ReaderScopeBar';
import { ScopeStudySheet } from '../../components/ScopeStudySheet';
import { WasmGate } from '../../components/WasmGate';
import { Chip, ListRow, Surface } from '../../components/ui';
import { studyScope, useStudyScope } from '../../lib/useStudyScope';
import { versesForChapter } from '../../lib/studyScope';
import { useI18n } from '../../lib/i18n';
import { getRecentSearches, pushRecentSearch } from '../../lib/recentSearches';
import { langForTranslation } from '../../lib/translationDefault';
import { readingBookHref, readingChapterHref } from '../../lib/readingNav';
import { useSearchIntent } from '../../lib/useSearchIntent';
import { useVersionSelection } from '../../lib/useVersionSelection';
import { useTheme, type ThemeContextValue } from '../../lib/theme';
import { type Reference } from '../../web/reference';
import { listBooks, type Book, type SearchHit } from '../../web/reading';

// ADR-0064/0080: a busca (default por IDIOMA da UI, os 4 produtores assíncronos e o estado) vive na
// costura `useSearchIntent`; esta tela injeta `term/translation/lang/locale/books` e só RENDERIZA.

/** Número do versículo de um hit (sempre `Single` num resultado de busca). */
function verseOf(hit: SearchHit): number | null {
  const v = hit.reference.verses;
  return v.tag === 'Single' ? v.inner.verse : null;
}

/** Verso inicial de uma referência parseada (Single/Range) p/ ancorar a navegação. */
function refVerse(ref: Reference): number | null {
  const v = ref.verses;
  return v.tag === 'Single' ? v.inner.verse : v.tag === 'Range' ? v.inner.start : null;
}

/** Chave estável de um hit (livro/cap/verso/tradução). */
function keyOf(hit: SearchHit): string {
  return `${hit.translation}-${hit.reference.book}-${hit.reference.chapter}-${verseOf(hit) ?? 'x'}`;
}

export default function SearchScreen() {
  return (
    <WasmGate>
      <SearchContent />
    </WasmGate>
  );
}

function SearchContent() {
  const theme = useTheme();
  const { colors } = theme;
  const { locale, t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Fase 4: Escopo de Estudo por TEMA — os resultados da busca ganham "+ Escopo"; a barra do
  // escopo aparece aqui também (o store é global, persiste entre telas).
  const scope = useStudyScope();
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);

  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<Book[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  // ADR-0070/0064: seletor de versão numa costura só (instância LOCAL → a busca segue o idioma da UI
  // independentemente). `effectiveTranslation` = versão resolvida; `setPickedTranslation` = a escolha.
  const { translations, setPicked: setPickedTranslation, effective: effectiveTranslation } =
    useVersionSelection(locale);

  useEffect(() => {
    try {
      setBooks(listBooks());
    } catch {
      /* sem cânon → item cai no fallback; não bloqueia a busca */
    }
  }, []);

  // ADR-0064: carrega as buscas recentes (KV offline) no mount + um refresh sob demanda.
  const refreshRecent = useMemo(
    () => () => {
      void getRecentSearches().then(setRecent).catch(() => setRecent([]));
    },
    [],
  );
  useEffect(refreshRecent, [refreshRecent]);

  const bookNameOf = useMemo(() => {
    const map = new Map(books.map((b) => [b.number, locale === 'en' ? b.nameEn : b.namePt]));
    return (n: number) => map.get(n) ?? t('read.bookFallback', { number: n });
  }, [books, locale, t]);

  // ADR-0064 Fase B: idioma do dicionário de autocomplete = idioma da tradução buscada (costura pura).
  const searchLang: 'pt' | 'en' = useMemo(
    () => langForTranslation(effectiveTranslation, translations, locale),
    [translations, effectiveTranslation, locale],
  );

  const term = query.trim();

  // ADR-0080: os 4 produtores de busca (autocomplete de termo, sugestão de livro, detecção de referência,
  // e a busca principal + "você quis dizer?") + o estado (results/loading/error/…) vivem na costura
  // `useSearchIntent` — cada produtor mantém o SEU debounce/deps (timing inalterado). A tela só RENDERIZA.
  const { results, loading, error, didYouMean: suggestions, wordSuggestions, parsedRef, bookSuggestions } =
    useSearchIntent(term, effectiveTranslation, searchLang, locale, books);

  function openHit(hit: SearchHit) {
    void pushRecentSearch(term).then(refreshRecent);
    // A versão EXATA do resultado (`hit.translation`) — o leitor abre na tradução buscada. A costura
    // `readingChapterHref` EXIGE `version`, então nenhum salto pode esquecê-la (era o bug reportado).
    router.push(
      readingChapterHref({
        book: hit.reference.book,
        chapter: hit.reference.chapter,
        verse: verseOf(hit),
        version: hit.translation,
      }),
    );
  }

  function openBook(book: number) {
    // Abre o livro na versão corrente da busca (o leitor a herda ao descer para um capítulo).
    router.push(readingBookHref({ book, version: effectiveTranslation }));
  }

  function openRef(ref: Reference) {
    void pushRecentSearch(term).then(refreshRecent);
    // Uma referência parseada não traz versão própria → usa a corrente da busca.
    router.push(
      readingChapterHref({ book: ref.book, chapter: ref.chapter, verse: refVerse(ref), version: effectiveTranslation }),
    );
  }

  function runTerm(next: string) {
    setQuery(next);
  }

  const refLabel = parsedRef ? `${bookNameOf(parsedRef.book)} ${parsedRef.chapter}` : '';

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={() => term.length > 0 && void pushRecentSearch(term).then(refreshRecent)}
        placeholder={t('search.inputPlaceholder')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        testID="search-input"
        accessibilityLabel={t('a11y.searchTextInput')}
      />

      {translations.length > 0 ? (
        <View style={styles.pickerRow}>
          <Text style={styles.pickerLabel}>{t('search.translationLabel')}</Text>
          <ReaderVersionPicker
            translations={translations}
            current={effectiveTranslation}
            onChange={setPickedTranslation}
            testIDPrefix="search-version"
          />
        </View>
      ) : null}

      {/* ADR-0064: AUTOCOMPLETE — referência (abrir livro/capítulo) + palavras do corpus. */}
      {term.length > 0 && (parsedRef || bookSuggestions.length > 0 || wordSuggestions.length > 0) ? (
        <Surface style={styles.suggestBlock}>
          {parsedRef ? (
            <ListRow
              label={t('search.openReference', { ref: refLabel })}
              onPress={() => openRef(parsedRef)}
              testID="search-open-ref"
              accessibilityRole="link"
            />
          ) : null}
          {bookSuggestions.map((b) => (
            <ListRow
              key={b.book}
              label={t('search.openBook', { book: b.label })}
              onPress={() => openBook(b.book)}
              testID={`search-book-${b.book}`}
              accessibilityRole="link"
            />
          ))}
          {wordSuggestions.length > 0 ? (
            <View style={styles.wordChips}>
              {wordSuggestions.map((w) => (
                <Chip
                  key={w}
                  label={w}
                  onPress={() => runTerm(w)}
                  testID={`search-word-${w}`}
                  accessibilityLabel={t('search.didYouMeanItem', { term: w })}
                />
              ))}
            </View>
          ) : null}
        </Surface>
      ) : null}

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : term.length === 0 ? (
        // ADR-0064: vazio → BUSCAS RECENTES (se houver), senão a dica.
        recent.length > 0 ? (
          <View style={styles.recentBlock}>
            <Text style={styles.sectionLabel}>{t('search.recent')}</Text>
            {recent.map((r) => (
              <Pressable
                key={r}
                style={styles.recentRow}
                onPress={() => runTerm(r)}
                testID={`search-recent-${r}`}
                accessibilityRole="button"
                accessibilityLabel={t('search.recentItem', { term: r })}
              >
                <Text style={styles.recentText}>{r}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.centered}>
            <Text style={styles.hint}>{t('search.hintEmpty')}</Text>
          </View>
        )
      ) : results.length === 0 ? (
        // ADR-0064: sem resultados → "você quis dizer?" (só termos que RETORNAM resultados).
        <View style={styles.noResults}>
          <Text style={styles.hint}>{t('search.noResults', { term })}</Text>
          {suggestions.length > 0 ? (
            <View style={styles.dymBlock}>
              <Text style={styles.sectionLabel}>{t('search.didYouMean')}</Text>
              <View style={styles.chipWrap}>
                {suggestions.map((s) => (
                  <Chip
                    key={s.term}
                    label={s.term}
                    onPress={() => runTerm(s.term)}
                    testID={`search-dym-${s.term}`}
                    accessibilityLabel={t('search.didYouMeanItem', { term: s.term })}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={keyOf}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const v = verseOf(item);
            const inScope =
              v != null &&
              (() => {
                const s = versesForChapter(scope.chunks, item.reference.book, item.reference.chapter);
                return s.whole || s.verses.has(v);
              })();
            return (
              <ReaderSearchResultItem
                hit={item}
                bookName={bookNameOf(item.reference.book)}
                onPress={() => openHit(item)}
                onAddToScope={
                  v != null ? () => studyScope.toggleVerse(item.reference.book, item.reference.chapter, v) : undefined
                }
                inScope={inScope}
                testID={`hit-${keyOf(item)}`}
              />
            );
          }}
        />
      )}

      {/* Fase 4: barra-escopo + folha de estudo — o escopo montado por TEMA (aqui) ou por seleção
          (no leitor) é o MESMO store global. Perguntar sobre a seleção funciona das duas telas. */}
      {scope.chunks.length > 0 ? (
        <ReaderScopeBar
          chunks={scope.chunks}
          bookLabelOf={bookNameOf}
          onRemove={(key) => studyScope.removeChunk(key)}
          onClear={() => studyScope.clear()}
          onStudy={() => setScopeSheetOpen(true)}
        />
      ) : null}
      <ScopeStudySheet
        visible={scopeSheetOpen}
        chunks={scope.chunks}
        translation={effectiveTranslation}
        lang={locale}
        bookLabelOf={bookNameOf}
        onClose={() => setScopeSheetOpen(false)}
      />
    </View>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    input: {
      ...type.body,
      margin: space.lg,
      marginBottom: space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    pickerRow: { gap: space.xs, paddingBottom: space.sm },
    pickerLabel: { ...type.label, color: colors.muted, paddingHorizontal: space.lg },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
    hint: { ...type.body, color: colors.muted, textAlign: 'center' },
    error: { ...type.body, color: colors.error, textAlign: 'center' },

    // Autocomplete de referência: contêiner via <Surface>; aqui só as margens externas.
    suggestBlock: { marginHorizontal: space.lg, marginBottom: space.sm },

    // Buscas recentes.
    recentBlock: { paddingHorizontal: space.lg, paddingTop: space.sm },
    sectionLabel: { ...type.label, color: colors.muted, marginBottom: space.sm },
    recentRow: {
      minHeight: 48,
      justifyContent: 'center',
      paddingVertical: space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    recentText: { ...type.body, color: colors.text },

    // "Você quis dizer?" — chips via <Chip> do kit; aqui só o layout.
    noResults: { flex: 1, alignItems: 'center', paddingTop: space.xxl, paddingHorizontal: space.xl },
    dymBlock: { marginTop: space.xl, alignSelf: 'stretch', alignItems: 'center' },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },

    // Autocomplete de TERMO do corpus (Fase B) — chips discretos abaixo das referências.
    wordChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
  });
}
