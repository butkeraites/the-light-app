// app/components/LanguageToggleButton.tsx — F5.2 (ADR-0038)
//
// Apresentacional: botão de alternância de IDIOMA da UI (PT⇄EN) p/ o header, ao lado
// do `ThemeToggleButton`. Lê/escreve o idioma via `useI18n()` (a escolha PERSISTE
// offline via prefs) e usa os TOKENS de tema (`useTheme`) para a cor — zero hex.
// Mostra o CÓDIGO do idioma-ALVO (para onde vai ao tocar), espelhando o padrão do
// toggle de tema (que mostra o modo-alvo). Acessível: `accessibilityRole='switch'`,
// `accessibilityState.checked` = idioma inglês ativo, `accessibilityLabel` via `t()`.
// Não faz I/O de domínio nem toca texto bíblico.
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';

export function LanguageToggleButton() {
  const { locale, setLocale, t } = useI18n();
  const { colors } = useTheme();
  // Idioma-ALVO ao tocar (mostra p/ onde vai, como o toggle de tema mostra o modo-alvo).
  const target = locale === 'pt' ? 'en' : 'pt';
  const targetCode = target.toUpperCase(); // 'EN' | 'PT'
  return (
    <Pressable
      onPress={() => setLocale(target)}
      hitSlop={8}
      testID="language-toggle"
      accessibilityRole="switch"
      accessibilityState={{ checked: locale === 'en' }}
      accessibilityLabel={t('language.switchToOther')}
      style={styles.button}
    >
      <Text style={[styles.code, { color: colors.text }]}>{targetCode}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 12, paddingVertical: 4 },
  code: { fontSize: 14, fontWeight: '700' },
});
