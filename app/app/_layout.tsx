// app/app/_layout.tsx — F1.3 · tema F1.4 (ADR-0015)
//
// Raiz do expo-router. Envolve a navegação no `ThemeProvider` (tema claro/escuro
// respeitando `useColorScheme` + override por sessão). As telas de LEITURA ganham
// o header temático e um toggle de tema (`ThemeToggleButton`) no canto direito.
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { ThemeToggleButton } from '../components/ThemeToggleButton';
import { ThemeProvider, useTheme } from '../lib/theme';
import { useWasmReady } from '../web/wasm';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { colors } = useTheme();
  // F1.13: no WEB, `listBooks()` (cânon de 66) vem do wasm e é síncrono — pré-
  // aquecemos o wasm antes de renderizar a stack para que as telas de leitura o
  // chamem sem erro. No NATIVO `useWasmReady()` é sempre `true` (no-op, sem
  // regressão): o cânon vem do JSI e a stack renderiza de imediato.
  const wasmReady = useWasmReady();
  if (!wasmReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  // Opções comuns às telas de leitura: header e fundo seguindo os tokens de tema,
  // com o toggle de tema visível no header.
  const readOptions = {
    headerStyle: { backgroundColor: colors.headerBackground },
    headerTintColor: colors.text,
    headerRight: () => <ThemeToggleButton />,
    contentStyle: { backgroundColor: colors.background },
  } as const;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'The Light' }} />
      {/* F1.3: fluxo de leitura nativo (livro → capítulo → texto). Os títulos
          dinâmicos (nome do livro / capítulo) são definidos por cada tela via
          navigation.setOptions; aqui registramos as rotas, o back e (F1.4) o
          header temático + o toggle de tema. */}
      <Stack.Screen name="read/index" options={{ title: 'Ler a Bíblia', ...readOptions }} />
      <Stack.Screen name="read/[book]/index" options={{ title: 'Capítulos', ...readOptions }} />
      <Stack.Screen name="read/[book]/[chapter]" options={{ title: 'Leitura', ...readOptions }} />
      {/* F1.6: busca nativa (campo + resultados com referência clicável). Lê pela
          fronteira `search` (F1.5 → JSI → core); header temático + toggle de tema. */}
      <Stack.Screen name="search/index" options={{ title: 'Buscar', ...readOptions }} />
    </Stack>
  );
}
