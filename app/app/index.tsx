import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

// F0.5 — tela mínima, puramente local (estado React).
// Sem ligação ao core/bindings: digitar aqui NÃO interpreta nada ainda.
// A ligação real chega em F0.6 (web/WASM), F0.7 (iOS) e F0.8 (Android).
const PLACEHOLDER = 'O resultado aparecerá aqui.';

export default function HomeScreen() {
  const [query, setQuery] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>The Light</Text>

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Digite uma passagem (ex.: João 3:16)"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text testID="result" style={styles.result}>
        {query.trim().length > 0 ? query : PLACEHOLDER}
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
  result: {
    fontSize: 16,
    color: '#333333',
  },
});
