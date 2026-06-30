import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseReference, type Reference } from '../web/reference';
import { getPassage, type Passage } from '../web/passage';
import { runReferenceSelfTest } from '../web/selftest';

// F0.6b/F0.10 — tela ligada à fronteira Rust. A referência é SEMPRE resolvida
// PELO RUST (the-light-core via UniFFI), não por eco/parsing em TS.
//   - WEB (F0.10): `getPassage` resolve a referência (wasm) E lê o TEXTO do
//     versículo do store local (`wa-sqlite`/OPFS) — anti-alucinação: verbatim do
//     store, nunca hardcoded.
//   - NATIVO (F0.7/F0.8): `parseReference` via Turbo Module; a leitura de store
//     nativa (F0.9) não está ligada nesta tela.
const PLACEHOLDER = 'O resultado aparecerá aqui.';

// Apresentação (NÃO parsing): formata o intervalo de versículos resolvido pelo Rust.
function formatVerses(verses: Reference['verses']): string {
  switch (verses.tag) {
    case 'Single':
      return `v. ${verses.inner.verse}`;
    case 'Range':
      return `vv. ${verses.inner.start}-${verses.inner.end}`;
    case 'WholeChapter':
      return 'capítulo inteiro';
    default:
      return '';
  }
}

function formatReference(ref: Reference): string {
  return `livro ${ref.book} · cap. ${ref.chapter} · ${formatVerses(ref.verses)}`;
}

// Apresentação (NÃO parsing): mostra o TEXTO verbatim lido do store local.
function formatPassage(passage: Passage): string {
  if (passage.verses.length === 0) {
    return 'Versículo não encontrado no store local.';
  }
  const header = formatReference(passage.reference);
  const body = passage.verses.map((v) => v.text).join('\n');
  return `${header}\n\n${body}`;
}

export default function HomeScreen() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(PLACEHOLDER);

  // F0.7 — prova HEADLESS: sob EXPO_PUBLIC_TLA_SELFTEST=1, resolve "Jo 3.16" e
  // "John 3:16" pelo Turbo Module nativo e loga marcadores estáveis (capturados
  // pelo simulador). Não muda a UI normal (só dispara sob o env de teste).
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_TLA_SELFTEST === '1') {
      void runReferenceSelfTest();
    }
  }, []);

  async function handleSubmit() {
    const input = query.trim();
    if (input.length === 0) {
      setResult(PLACEHOLDER);
      return;
    }
    try {
      if (Platform.OS === 'web') {
        // WEB: resolve (Rust/wasm) + lê o texto do store local (wa-sqlite/OPFS).
        const passage = await getPassage(input);
        setResult(formatPassage(passage));
      } else {
        // NATIVO: resolve a referência pelo Turbo Module (store nativo = F0.9).
        const ref = await parseReference(input);
        setResult(formatReference(ref));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult(`Não foi possível resolver: ${message}`);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>The Light</Text>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={handleSubmit}
        returnKeyType="search"
        placeholder="Digite uma passagem (ex.: João 3:16)"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {Platform.OS === 'web' ? (
        <Text style={styles.hint}>Pressione Enter para interpretar (via Rust/wasm).</Text>
      ) : null}

      <Text testID="result" style={styles.result}>
        {result}
      </Text>

      {/* F1.3: entrada para a UI de leitura nativa (livro → capítulo → texto +
          seletor de versão). Lê do store local no device pela fronteira nativa. */}
      {Platform.OS === 'web' ? null : (
        <Link href="/read" style={styles.readLink} testID="open-reader">
          Ler a Bíblia →
        </Link>
      )}

      {/* F1.6: entrada para a BUSCA nativa (campo + resultados clicáveis). A busca
          lê pela fronteira `search` (F1.5 → JSI → core); web = stub (F1.14). */}
      {Platform.OS === 'web' ? null : (
        <Link href="/search" style={styles.readLink} testID="open-search">
          Buscar na Bíblia →
        </Link>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111111',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111111',
  },
  hint: {
    fontSize: 12,
    color: '#888888',
  },
  result: {
    fontSize: 16,
    color: '#333333',
  },
  readLink: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '600',
    color: '#0a5bd3',
  },
});
