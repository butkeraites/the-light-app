import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'The Light' }} />
      {/* F1.3: fluxo de leitura nativo (livro → capítulo → texto). Os títulos
          dinâmicos (nome do livro / capítulo) são definidos por cada tela via
          navigation.setOptions; aqui só registramos as rotas e o back. */}
      <Stack.Screen name="read/index" options={{ title: 'Ler a Bíblia' }} />
      <Stack.Screen name="read/[book]/index" options={{ title: 'Capítulos' }} />
      <Stack.Screen name="read/[book]/[chapter]" options={{ title: 'Leitura' }} />
    </Stack>
  );
}
