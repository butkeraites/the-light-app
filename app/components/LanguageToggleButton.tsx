// app/components/LanguageToggleButton.tsx — F5.2 (ADR-0038)
//
// Apresentacional: botão de alternância de IDIOMA da UI (PT⇄EN) p/ o header, ao lado
// do `ThemeModeSelector`. Lê/escreve o idioma via `useI18n()` (a escolha PERSISTE
// offline via prefs) e usa os TOKENS de tema (`useTheme`) para a cor — zero hex.
//
// Mostra o CÓDIGO do idioma ATUAL (o que o usuário está LENDO): lendo em português → "PT".
// Um código de 2 letras é ambíguo demais para exibir o ALVO (ao contrário do sol/lua do tema):
// "EN" enquanto se lê em português parece dizer "está em inglês". O rótulo de a11y descreve a
// AÇÃO ("Mudar para Inglês"/"Switch to Portuguese"), então o leitor de tela anuncia p/ onde vai.
// Acessível: `accessibilityRole='switch'`, `accessibilityState.checked` = inglês ativo.
// Não faz I/O de domínio nem toca texto bíblico.
import { Pressable, StyleSheet, Text } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';

export function LanguageToggleButton() {
  const { locale, setLocale, t } = useI18n();
  const { colors } = useTheme();
  // Idioma-ALVO ao tocar (p/ `setLocale`); o VISÍVEL é o idioma ATUAL (o que se lê agora).
  const target = locale === 'pt' ? 'en' : 'pt';
  const currentCode = locale.toUpperCase(); // 'PT' | 'EN' — idioma atual da UI
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
      <Text style={[styles.code, { color: colors.text }]}>{currentCode}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 12, paddingVertical: 4 },
  code: { fontSize: 14, fontWeight: '700' },
});
