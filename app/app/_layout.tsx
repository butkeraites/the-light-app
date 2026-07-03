// app/app/_layout.tsx — F1.3 · tema F1.4 (ADR-0015) · i18n F5.2 (ADR-0038) · perf F5.3
//
// Raiz do expo-router. Envolve a navegação no `I18nProvider` (idioma da UI PT/EN,
// persistido offline) e no `ThemeProvider` (tema claro/escuro respeitando
// `useColorScheme` + override por sessão). O header de TODAS as telas ganha os dois
// toggles (idioma + tema) e cores dos tokens de tema. A HOME (`index`) passa a ser
// temática e a hospedar o toggle de idioma que re-renderiza suas strings via `t()`.
//
// F5.3 (perf web): o shell do app NÃO bloqueia mais o 1º paint no wasm da fronteira
// (~4 MB). Antes, `_layout.tsx` gateava TODA a renderização em `useWasmReady()` — a
// stack só aparecia depois do fetch+instanciação do wasm. Agora a stack pinta na
// hora e o wasm apenas AQUECE em segundo plano (`ensureWasmReady()`, não-bloqueante).
// As telas de leitura que chamam `listBooks()` (síncrono, exige wasm) se gateiam com
// `<WasmGate>` (spinner por-rota até o wasm ficar pronto). No nativo nada disso pesa:
// `ensureWasmReady()` é no-op e `useWasmReady()` é sempre `true`.
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { View } from 'react-native';

import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { ThemeModeSelector } from '../components/ThemeModeSelector';
import { I18nProvider, useI18n } from '../lib/i18n';
import { ThemeProvider, useTheme } from '../lib/theme';
import { ensureWasmReady } from '../web/wasm';

export default function RootLayout() {
  // I18nProvider por FORA do ThemeProvider: idioma e tema são camadas de UI
  // independentes; ambos disponíveis a toda a árvore (header + telas).
  return (
    <I18nProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </I18nProvider>
  );
}

// Toggles do header (idioma + tema), lado a lado. Ficam DENTRO dos providers, então
// alternar o idioma re-renderiza as strings das telas via `t()` na hora.
function HeaderControls() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <LanguageToggleButton />
      <ThemeModeSelector />
    </View>
  );
}

function RootNavigator() {
  const { colors } = useTheme();
  // F5.5: consumir o i18n AQUI faz o `RootNavigator` RE-RENDERIZAR ao trocar o idioma,
  // então os títulos estáticos das `Stack.Screen` (via `t()`) atualizam na hora — sem
  // reiniciar. As telas de leitura que definem título dinâmico (nome do livro do STORE)
  // via `navigation.setOptions` também reagem: seus efeitos dependem do `locale`.
  const { t } = useI18n();
  // F5.3: AQUECE o wasm da fronteira em SEGUNDO PLANO (não-bloqueante). A stack pinta
  // de imediato; as telas de leitura que chamam `listBooks()` (síncrono, exige wasm)
  // se gateiam com `<WasmGate>`. No NATIVO `ensureWasmReady()` é no-op (o cânon vem do
  // JSI) — este efeito resolve na hora, sem custo. Init idempotente (memoizado em
  // `wasm.web.ts`), então o warm dispara UMA vez mesmo sob hot-reload.
  useEffect(() => {
    void ensureWasmReady();
  }, []);
  // Opções comuns a todas as telas: header e fundo seguindo os tokens de tema, com os
  // toggles (idioma + tema) visíveis no header.
  const screenChrome = {
    headerStyle: { backgroundColor: colors.headerBackground },
    headerTintColor: colors.text,
    headerRight: () => <HeaderControls />,
    contentStyle: { backgroundColor: colors.background },
  } as const;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
      }}
    >
      {/* F5.2: a HOME também ganha header temático + os toggles (idioma + tema). O
          título "The Light" é a MARCA (idêntica em PT/EN, via `t('nav.home')`). */}
      <Stack.Screen name="index" options={{ title: t('nav.home'), ...screenChrome }} />
      {/* F1.3: fluxo de leitura nativo (livro → capítulo → texto). F5.5: os títulos
          estáticos abaixo agora vêm de `t()` (reativos ao idioma). Os títulos
          DINÂMICOS (nome do livro / capítulo) são redefinidos por cada tela via
          navigation.setOptions — reagindo ao `locale` — e o NOME do livro vem do
          STORE (namePt/nameEn), nunca de `t()` (anti-alucinação). */}
      <Stack.Screen name="read/index" options={{ title: t('nav.read'), ...screenChrome }} />
      <Stack.Screen name="read/[book]/index" options={{ title: t('nav.chapters'), ...screenChrome }} />
      <Stack.Screen name="read/[book]/[chapter]" options={{ title: t('nav.reading'), ...screenChrome }} />
      {/* F1.6: busca nativa (campo + resultados com referência clicável). Lê pela
          fronteira `search` (F1.5 → JSI → core); header temático + toggles. */}
      <Stack.Screen name="search/index" options={{ title: t('nav.search'), ...screenChrome }} />
      {/* F5.7: PLANOS de leitura nativos (lista → iniciar → dia de hoje → marcar).
          Orquestra a geração (F5.1) + o progresso (F5.4) via a fronteira nativa; no
          web degrada com aviso (paridade = F5.10). Header temático + toggles. */}
      <Stack.Screen name="plans/index" options={{ title: t('nav.plans'), ...screenChrome }} />
      {/* F5.35: tela SOBRE / créditos / licenças (KJV/Almeida domínio público; OpenBible CC-BY;
          STEP/Tyndale CC BY 4.0) + princípios (offline-first/BYOK/anti-alucinação) + atalho de
          backup (reusa SyncSettings). 100% CROMO, sem rede/segredo. Header temático + toggles. */}
      <Stack.Screen name="about" options={{ title: t('nav.about'), ...screenChrome }} />
    </Stack>
  );
}
