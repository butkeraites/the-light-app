// app/components/ThemeModeSelector.tsx — F5.33 (surface do setMode tri-estado; ADR-0043)
//
// Apresentacional: SELETOR TRI-ESTADO de tema (claro / escuro / seguir o sistema) p/ o header
// da UI. A ADR-0043 (F5.14) já entregou a PERSISTÊNCIA do modo e o `ThemeProvider` expõe
// `setMode('light'|'dark'|null)` (null → `removePref` → volta a seguir `useColorScheme`) mais
// o flag `isSystem` — mas o antigo `ThemeToggleButton` binário só alcançava claro⇄escuro, então
// "seguir o sistema" era INALCANÇÁVEL pelo usuário. Este controle expõe as TRÊS opções, reflete
// o estado corrente via `isSystem`/`mode`, e REUSA `setMode` (a MESMA persistência offline da
// F5.2 — sem 2º mecanismo). Cores via TOKENS de tema (`useTheme`), rótulos via `t()` (paridade
// pt/en), a11y por chip (role button + estado selected). Não faz I/O nem lógica de domínio.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n, type MessageKey } from '../lib/i18n';
import { useTheme, type ThemeColors, type ThemeMode } from '../lib/theme';

// As TRÊS opções, em ordem canônica. `value` = argumento p/ `setMode` (null = seguir o sistema).
// O glyph é DECORATIVO (BMP monocromático); o rótulo REAL (a11y) vem sempre de `t(labelKey)`.
const OPTIONS: { value: ThemeMode | null; glyph: string; labelKey: MessageKey; testID: string }[] = [
  { value: 'light', glyph: '☀', labelKey: 'theme.light', testID: 'theme-mode-light' },
  { value: 'dark', glyph: '☾', labelKey: 'theme.dark', testID: 'theme-mode-dark' },
  { value: null, glyph: '◐', labelKey: 'theme.system', testID: 'theme-mode-system' },
];

export function ThemeModeSelector() {
  const { mode, isSystem, setMode, colors } = useTheme();
  // F5.5/F5.33: rótulo de a11y via `t()` (reativo ao idioma), espelhando o LanguageToggleButton.
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.bar}>
      {OPTIONS.map((option) => {
        // `null` (sistema) fica ativo quando NÃO há override; senão o modo efetivo casa a opção.
        const active = option.value === null ? isSystem : !isSystem && mode === option.value;
        return (
          <Pressable
            key={option.testID}
            style={[styles.chip, active ? styles.chipActive : null]}
            onPress={() => setMode(option.value)}
            testID={option.testID}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(option.labelKey)}
            hitSlop={{ top: 8, bottom: 8 }}
          >
            <Text style={[styles.glyph, active ? styles.glyphActive : null]}>{option.glyph}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    glyph: { fontSize: 15, color: colors.chipText },
    glyphActive: { color: colors.chipActiveText },
  });
}
