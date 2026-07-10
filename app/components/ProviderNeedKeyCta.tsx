// app/components/ProviderNeedKeyCta.tsx — ADR-0079 (deepening): CTA "provedor real sem chave"
//
// Quando um provedor REAL está selecionado mas não há chave BYOK (`needsKey`), os painéis de IA mostram
// um erro claro + botão p/ Ajustes (não travam; o envio é desabilitado à parte). O bloco (View + erro +
// Button) era duplicado em Study/Chat/Scope, variando SÓ no `testID` e na margem do botão. Concentrado
// aqui. Ask (sem CTA — usa save-de-chave inline) e Compare (multi-select, chrome próprio) são exceções
// documentadas (ADR-0059). O painel decide QUANDO renderizar (`{needsKey ? <ProviderNeedKeyCta/> : null}`).
import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { Button } from './ui';

export function ProviderNeedKeyCta({
  provider,
  onConfigure,
  testIDPrefix,
  buttonStyle,
}: {
  provider: string;
  onConfigure: () => void;
  testIDPrefix: 'study' | 'chat' | 'scope';
  /** Margem do botão — Study usa `space.md`, Chat/Scope `space.sm`; passada pelo painel p/ paridade exata. */
  buttonStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.block} testID={`${testIDPrefix}-provider-needkey`}>
      <Text style={styles.error}>{t('ask.needKeyError', { provider })}</Text>
      <Button
        title={t('ai.noProviderCta')}
        variant="secondary"
        onPress={onConfigure}
        testID={`${testIDPrefix}-provider-configure`}
        accessibilityLabel={t('a11y.aiConfigure')}
        style={buttonStyle}
      />
    </View>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    block: { marginTop: space.sm, gap: space.xs },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
  });
}
