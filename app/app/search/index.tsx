// app/app/search/index.tsx — F1.6 (ADR-0014/0015)
//
// Tela de BUSCA nativa: um campo (`TextInput`) com debounce que, a cada termo
// estável, abre o banco bundled (`ensureReadingDb`) e chama a fronteira `search`
// (F1.5 → binding gerado → JSI → the_light_core::search, FTS5/BM25) e renderiza a
// LISTA de resultados (`FlatList`). Cada item mostra a referência + o snippet com o
// termo destacado e, ao tocar, navega para o capítulo no Reader (rota F1.3).
//
// Uma fonte da verdade / anti-alucinação: NENHUM SQL/FTS/MATCH/bm25/highlight é
// reimplementado aqui — a tela só embrulha o retorno de `search` (texto verbatim do
// store). Cores via TOKENS de tema. PARIDADE WEB (F1.14 DESTUBADO): no web o glue
// `search` (`reading.web.ts`) roda FTS5 REAL sobre o subset local (`reading-lite.sqlite`,
// wa-sqlite/OPFS), então esta MESMA tela funciona nas duas plataformas e É alcançável
// no web — o link é renderizado na home (F5.30), não só via URL digitada.
import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { ReaderSearchResultItem } from '../../components/ReaderSearchResultItem';
import { ReaderVersionPicker } from '../../components/ReaderVersionPicker';
import { WasmGate } from '../../components/WasmGate';
import { ensureReadingDb } from '../../lib/db';
import { useI18n } from '../../lib/i18n';
import { useTheme, type ThemeColors } from '../../lib/theme';
import {
  listBooks,
  listTranslations,
  search,
  type Book,
  type SearchHit,
  type Translation,
} from '../../web/reading';

// F5.31: KJV é a tradução PADRÃO da busca. O seletor (reusa o `ReaderVersionPicker` da
// leitura) lista as traduções REALMENTE presentes no store (via `listTranslations` — ex.:
// KJV + Almeida 1911), nunca hardcoded; trocar re-executa a query na tradução escolhida
// pelo parâmetro EXISTENTE `search(dbPath, term, translation)`. Anti-alucinação: os nomes
// de versão vêm do store e o texto/ref de resultado seguem VERBATIM do store (nunca `t()`).
const DEFAULT_TRANSLATION = 'kjv';
const DEBOUNCE_MS = 300;

/** Número do versículo de um hit (sempre `Single` num resultado de busca). */
function verseOf(hit: SearchHit): number | null {
  const v = hit.reference.verses;
  return v.tag === 'Single' ? v.inner.verse : null;
}

/** Chave estável de um hit (livro/cap/verso/tradução). */
function keyOf(hit: SearchHit): string {
  return `${hit.translation}-${hit.reference.book}-${hit.reference.chapter}-${verseOf(hit) ?? 'x'}`;
}

export default function SearchScreen() {
  // F5.3: a busca resolve o nome do livro via `listBooks()` (síncrono, exige o wasm da
  // fronteira). Antes o `_layout.tsx` gateava tudo no wasm; agora, com o 1º paint
  // liberado, esta rota se auto-gateia para não montar (e cair no fallback "Book N")
  // antes do wasm pronto. No nativo o gate é transparente.
  return (
    <WasmGate>
      <SearchContent />
    </WasmGate>
  );
}

function SearchContent() {
  const { colors } = useTheme();
  // F5.8: `locale` da UI traduz o CROMO da busca e ESCOLHE o campo de nome do livro no
  // STORE (namePt/nameEn) p/ a referência do item — NUNCA traduz o texto/ref de resultado
  // (que vem VERBATIM da fronteira `search`). O TERMO digitado também é dado do usuário.
  const { locale, t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  // F5.31: tradução ATIVA da busca (padrão KJV) + traduções disponíveis (do store).
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [translations, setTranslations] = useState<Translation[]>([]);

  // Cânon (66 livros, PURO) p/ resolver o nome do livro na referência do item.
  useEffect(() => {
    try {
      setBooks(listBooks());
    } catch {
      // Sem cânon → o item cai no rótulo de fallback (CROMO `read.bookFallback`); não bloqueia a busca.
    }
  }, []);

  // F5.31: carrega uma vez as traduções PRESENTES no store (seletor de versão). A lista
  // vem SEMPRE do store (`listTranslations`) — nunca hardcoded; a default segue KJV.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const ts = await listTranslations(dbPath);
        if (alive) setTranslations(ts);
      } catch {
        // Sem traduções → o seletor some; a busca ainda usa a default (KJV).
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  // Nome do livro p/ a referência do item: vem SEMPRE do STORE (namePt/nameEn) — o `locale`
  // só ESCOLHE o campo, nunca traduz. O fallback (livro ausente do cânon) é CROMO (`t()`).
  const bookNameOf = useMemo(() => {
    const map = new Map(books.map((b) => [b.number, locale === 'en' ? b.nameEn : b.namePt]));
    return (n: number) => map.get(n) ?? t('read.bookFallback', { number: n });
  }, [books, locale, t]);

  // Busca com DEBOUNCE: dispara só quando o termo fica estável por DEBOUNCE_MS.
  // `seq` evita corridas (descarta respostas de buscas obsoletas). F5.31: `translation`
  // também dispara — trocar a versão re-executa a MESMA query na tradução escolhida.
  const seqRef = useRef(0);
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mySeq = ++seqRef.current;
    const handle = setTimeout(async () => {
      try {
        const dbPath = await ensureReadingDb();
        const hits = await search(dbPath, term, translation);
        if (mySeq === seqRef.current) {
          setResults(hits);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (mySeq === seqRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setResults([]);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, translation]);

  function openHit(hit: SearchHit) {
    const verse = verseOf(hit);
    // Navega ao capítulo (rota F1.3). `verse` vai como param OPCIONAL (best-effort:
    // ancoragem/realce é follow-up; a tela do capítulo hoje ignora `verse`).
    router.push({
      pathname: '/read/[book]/[chapter]',
      params: {
        book: String(hit.reference.book),
        chapter: String(hit.reference.chapter),
        ...(verse != null ? { verse: String(verse) } : {}),
      },
    });
  }

  const term = query.trim();

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder={t('search.inputPlaceholder')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        testID="search-input"
        accessibilityLabel={t('a11y.searchTextInput')}
      />

      {/* F5.31: seletor de tradução (reusa o ReaderVersionPicker). Os NOMES das versões vêm
          do store (`listTranslations`); só o rótulo "Tradução" é cromo via t(). Trocar
          re-executa a query na versão escolhida. Some se o store não expõe traduções. */}
      {translations.length > 0 ? (
        <View style={styles.pickerRow}>
          <Text style={styles.pickerLabel}>{t('search.translationLabel')}</Text>
          <ReaderVersionPicker
            translations={translations}
            current={translation}
            onChange={setTranslation}
            testIDPrefix="search-version"
          />
        </View>
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
        <View style={styles.centered}>
          <Text style={styles.hint}>{t('search.hintEmpty')}</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          {/* `{term}` é o TERMO do usuário (dado dele), só interpolado no cromo — não traduzido. */}
          <Text style={styles.hint}>{t('search.noResults', { term })}</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={keyOf}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ReaderSearchResultItem
              hit={item}
              bookName={bookNameOf(item.reference.book)}
              onPress={() => openHit(item)}
              testID={`hit-${keyOf(item)}`}
            />
          )}
        />
      )}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    input: {
      margin: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    hint: { fontSize: 14, color: colors.muted, textAlign: 'center' },
    error: { fontSize: 14, color: colors.error, textAlign: 'center' },
    pickerRow: { gap: 2 },
    pickerLabel: {
      fontSize: 11,
      color: colors.muted,
      textTransform: 'uppercase',
      paddingHorizontal: 16,
    },
  });
}
