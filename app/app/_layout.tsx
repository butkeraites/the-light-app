// app/app/_layout.tsx — F1.3 · tema F1.4 (ADR-0015)
//
// Raiz do expo-router. Envolve a navegação no `ThemeProvider` (tema claro/escuro
// respeitando `useColorScheme` + override por sessão). As telas de LEITURA ganham
// o header temático e um toggle de tema (`ThemeToggleButton`) no canto direito.
import { Stack } from 'expo-router';

import { ThemeToggleButton } from '../components/ThemeToggleButton';
import { ThemeProvider, useTheme } from '../lib/theme';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { colors } = useTheme();
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
    </Stack>
  );
}
