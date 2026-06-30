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
// store). Cores via TOKENS de tema. Só NATIVO: no web, o glue `search` é um stub
// que lança em runtime (busca web = F1.14); por isso o ponto de entrada (home) é
// gateado p/ nativo e esta tela não é alcançada no web.
import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import { ReaderSearchResultItem } from '../../components/ReaderSearchResultItem';
import { ensureReadingDb } from '../../lib/db';
import { useTheme, type ThemeColors } from '../../lib/theme';
import { listBooks, search, type Book, type SearchHit } from '../../web/reading';

// Tradução default da busca (o seletor de versão é a leitura; aqui fixamos KJV —
// a paridade multi-tradução/seletor de busca é evolução futura).
const TRANSLATION = 'kjv';
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [books, setBooks] = useState<Book[]>([]);

  // Cânon (66 livros, PURO) p/ resolver o nome do livro na referência do item.
  useEffect(() => {
    try {
      setBooks(listBooks());
    } catch {
      // Sem cânon → o item cai no rótulo "Book N"; não bloqueia a busca.
    }
  }, []);
  const bookNameOf = useMemo(() => {
    const map = new Map(books.map((b) => [b.number, b.nameEn]));
    return (n: number) => map.get(n) ?? `Book ${n}`;
  }, [books]);

  // Busca com DEBOUNCE: dispara só quando o termo fica estável por DEBOUNCE_MS.
  // `seq` evita corridas (descarta respostas de buscas obsoletas).
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
        const hits = await search(dbPath, term, TRANSLATION);
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
  }, [query]);

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
        placeholder="Buscar na Bíblia (ex.: God, amor, light)"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        testID="search-input"
      />

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
          <Text style={styles.hint}>Digite um termo para buscar no texto bíblico.</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>Nenhum resultado para “{term}”.</Text>
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
  });
}
