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
import { Stack, router } from 'expo-router';
import { View } from 'react-native';

import { DevotionalNudge } from '../components/DevotionalNudge';
import { LanguageToggleButton } from '../components/LanguageToggleButton';
import { ReadingDbBanner } from '../components/ReadingDbBanner';
import { ThemeModeSelector } from '../components/ThemeModeSelector';
import { IconButton } from '../components/ui';
import { I18nProvider, useI18n } from '../lib/i18n';
import { ThemeProvider, useTheme } from '../lib/theme';
import { useDevotionalNudgeController } from '../lib/useDevotionalNudgeController';
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

// VOLTAR AO MENU PRINCIPAL — controle de header EXPLÍCITO nas telas empilhadas (livros, capítulos,
// busca, planos, etc.). O botão nativo do Stack só aparece quando há HISTÓRICO in-app (`canGoBack`),
// então uma entrada A FRIO (PWA reaberto na rota, deep-link, refresh, ou o fallback `replace('/read')`
// do leitor) deixava o usuário PRESO sem volta. Este `headerLeft` está SEMPRE presente: usa o back
// natural quando há pilha, senão cai na HOME — nunca preso. Mesma filosofia do voltar do leitor.
function HeaderBackHome() {
  const { t } = useI18n();
  return (
    <IconButton
      name="back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      accessibilityLabel={t('a11y.back')}
      testID="header-back-home"
    />
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
  // Rodada 5: orquestra o NUDGE devocional (lembrete in-app de orar & ler). A cada abertura/
  // volta ao primeiro plano, decide (puro) e aciona o card <DevotionalNudge/> abaixo. Opt-in
  // (LIGADO por padrão; desligável em Ajustes); no-op enquanto desligado. Sem notificação/servidor.
  useDevotionalNudgeController();
  // Opções comuns a todas as telas: header e fundo seguindo os tokens de tema, com os
  // toggles (idioma + tema) visíveis no header.
  const screenChrome = {
    headerStyle: { backgroundColor: colors.headerBackground },
    headerTintColor: colors.text,
    headerRight: () => <HeaderControls />,
    contentStyle: { backgroundColor: colors.background },
  } as const;
  // Telas EMPILHADAS (tudo menos a HOME e o leitor imersivo) ganham o VOLTAR-AO-MENU sempre-presente
  // no `headerLeft` — some o "preso sem volta" na entrada a frio. A HOME é a raiz (nada atrás) e o
  // leitor tem header próprio (headerShown:false) com seu próprio voltar.
  const backChrome = { ...screenChrome, headerLeft: () => <HeaderBackHome /> } as const;

  return (
    // Wrapper flex p/ hospedar o aviso GLOBAL do 1º download da Bíblia no web (overlay
    // pinado embaixo, sobre qualquer tela). No nativo o hook é sempre `idle` → não renderiza.
    <View style={{ flex: 1 }}>
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
        <Stack.Screen name="read/index" options={{ title: t('nav.read'), ...backChrome }} />
        <Stack.Screen name="read/[book]/index" options={{ title: t('nav.chapters'), ...backChrome }} />
        {/* Leitura imersiva: o header NATIVO é desligado SÓ nesta rota (estático, sem flash no
            mount). O topo (voltar + título + versão + Aa + idioma + tema + controles) vira UMA
            barra-overlay in-screen que desliza junto ao rolar — ver read/[book]/[chapter].tsx. */}
        <Stack.Screen name="read/[book]/[chapter]" options={{ ...screenChrome, headerShown: false }} />
        {/* Fase 7: tela DEDICADA de passagem (lookup grande/múltiplo da home). O título é
            re-setado p/ a consulta digitada em `navigation.setOptions` na própria tela. */}
        <Stack.Screen name="passage" options={{ title: t('nav.passage'), ...backChrome }} />
        {/* F1.6: busca nativa (campo + resultados com referência clicável). Lê pela
            fronteira `search` (F1.5 → JSI → core); header temático + toggles. */}
        <Stack.Screen name="search/index" options={{ title: t('nav.search'), ...backChrome }} />
        {/* F5.7: PLANOS de leitura nativos (lista → iniciar → dia de hoje → marcar).
            Orquestra a geração (F5.1) + o progresso (F5.4) via a fronteira nativa; no
            web degrada com aviso (paridade = F5.10). Header temático + toggles. */}
        <Stack.Screen name="plans/index" options={{ title: t('nav.plans'), ...backChrome }} />
        {/* F5.35: tela SOBRE / créditos / licenças (KJV/Almeida domínio público; OpenBible CC-BY;
            STEP/Tyndale CC BY 4.0) + princípios (offline-first/BYOK/anti-alucinação) + atalho de
            backup (reusa SyncSettings). 100% CROMO, sem rede/segredo. Header temático + toggles. */}
        <Stack.Screen name="about" options={{ title: t('nav.about'), ...backChrome }} />
        {/* F6.6: tela de AJUSTES / chaves BYOK — hub canônico de configuração de chave dos
            provedores de IA (Claude/GPT/Gemini/Ollama). É onde os 4 CTAs "configurar provedor"
            (AiProviderNotice) aterrissam. Status só-nomes (`listProviders`), inputs secure, nada
            vaza/persiste chave web além da sessão (ADR-0025). Header temático + toggles. */}
        <Stack.Screen name="settings" options={{ title: t('nav.settings'), ...backChrome }} />
      </Stack>
      {/* Aviso GLOBAL do 1º download da Bíblia no web (~64 MB, uso offline). No nativo → null. */}
      <ReadingDbBanner />
      {/* NUDGE devocional (lembrete in-app de orar & ler + versículo do dia). Opt-in; oculto até
          o controlador acima decidir mostrar. Card não-bloqueante pinado embaixo. */}
      <DevotionalNudge />
    </View>
  );
}
