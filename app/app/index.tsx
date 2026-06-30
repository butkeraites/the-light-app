import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseReference, type Reference } from '../web/reference';
import { runReferenceSelfTest } from '../web/selftest';

// F0.6b — tela ligada à fronteira Rust no WEB (wasm). Ao submeter, a referência
// digitada é resolvida PELO RUST (the-light-core via UniFFI→wasm), não por eco
// nem parsing em TS. O glue (../web/reference) inicializa o wasm e delega a
// `parseReference`. Em nativo o glue é um stub (F0.7/F0.8 ligam iOS/Android).
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
      const ref = await parseReference(input);
      setResult(formatReference(ref));
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
});
