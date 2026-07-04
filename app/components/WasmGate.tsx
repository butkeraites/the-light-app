// app/components/WasmGate.tsx — F5.3 · F6.3 (erro VISÍVEL + retry, nunca spinner infinito)
//
// Gate POR-ROTA do wasm da fronteira. A F5.3 tirou o pré-aquecimento do wasm do
// caminho render-blocking do `_layout.tsx` (o shell do app pinta na hora e o wasm
// AQUECE em segundo plano). Mas `listBooks()` (cânon de 66, do RUST/wasm) é
// SÍNCRONO no web e exige o wasm já inicializado — então cada TELA DE LEITURA que o
// chama se auto-gateia com este componente:
//   - carregando → spinner temático (como antes);
//   - ERRO de init → mensagem VISÍVEL + botão "Tentar de novo" (F6.3, ver abaixo);
//   - pronto → monta os `children` (que então chamam `listBooks()` com segurança).
// No NATIVO `useWasmReady()` é sempre `{ ready: true }` (o cânon vem do JSI) → os
// `children` montam de imediato, sem regressão.
//
// F6.3 — POR QUE O ESTADO DE ERRO: antes, uma falha no init do wasm era ENGOLIDA e o
// gate ficava `ready=false` para sempre → SPINNER INFINITO sem nenhum erro (o padrão
// de "erro engolido parece carregando" que deixou a leitura web quebrada por 3 ciclos).
// Agora `useWasmReady()` reporta `error` e um `retry`, e este gate os TORNA VISÍVEIS.
//
// Por que envolver os filhos (e não gatear inline)? Assim o componente-conteúdo só
// MONTA quando o wasm está pronto: seus hooks/efeitos que chamam `listBooks()` nunca
// rodam cedo demais, respeitando as regras de hooks sem early-return no meio.
import { useMemo, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeColors } from '../lib/theme';
import { useWasmReady } from '../web/wasm';

/**
 * Só monta `children` quando o wasm da fronteira estiver inicializado. Enquanto carrega,
 * mostra um `ActivityIndicator` temático; se o init FALHAR, mostra uma mensagem de erro
 * VISÍVEL + botão de retry (F6.3 — nunca um spinner infinito silencioso). No nativo é
 * transparente (pronto de imediato).
 */
export function WasmGate({ children }: PropsWithChildren): React.ReactElement {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { ready, error, retry } = useWasmReady();

  if (error) {
    return (
      <View style={styles.center} testID="wasm-error">
        <Text style={styles.message} accessibilityRole="alert">
          {t('wasm.loadError')}
        </Text>
        <Pressable
          style={styles.retry}
          onPress={retry}
          testID="wasm-retry"
          accessibilityRole="button"
          accessibilityLabel={t('wasm.retry')}
        >
          <Text style={styles.retryText}>{t('wasm.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return <>{children}</>;
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      padding: 24,
      gap: 12,
    },
    message: {
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      color: colors.error,
    },
    retry: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.chipActiveBg,
    },
    retryText: { fontSize: 14, fontWeight: '700', color: colors.chipActiveText },
  });
}
