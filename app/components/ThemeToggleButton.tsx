// app/components/ThemeToggleButton.tsx — F1.4 (ADR-0015)
//
// Apresentacional: botão de alternância de TEMA (claro⇄escuro) p/ o header da UI
// de leitura. Lê/escreve o tema via `useTheme()` (override por sessão). Mostra um
// glyph simples do modo ALVO (sol = vai p/ claro; lua = vai p/ escuro) e expõe um
// `testID` estável p/ inspeção. Não faz I/O nem lógica de domínio.
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../lib/theme';

export function ThemeToggleButton() {
  const { isDark, toggle, colors } = useTheme();
  // Glyphs BMP (renderizam como texto monocromático): sol (U+2600) / lua (U+263E).
  const glyph = isDark ? '☀' : '☾';
  const label = isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro';
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      testID="theme-toggle"
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={label}
      style={styles.button}
    >
      <Text style={[styles.glyph, { color: colors.text }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 12, paddingVertical: 4 },
  glyph: { fontSize: 18 },
});
