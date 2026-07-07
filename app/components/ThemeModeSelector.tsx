// app/components/ThemeModeSelector.tsx — F5.33 (surface do setMode tri-estado; ADR-0043) · kit ADR-0068
//
// Apresentacional: SELETOR TRI-ESTADO de tema (claro / escuro / seguir o sistema) p/ o header
// da UI. A ADR-0043 (F5.14) já entregou a PERSISTÊNCIA do modo e o `ThemeProvider` expõe
// `setMode('light'|'dark'|null)` (null → `removePref` → volta a seguir `useColorScheme`) mais
// o flag `isSystem` — mas o antigo `ThemeToggleButton` binário só alcançava claro⇄escuro, então
// "seguir o sistema" era INALCANÇÁVEL pelo usuário. Este controle expõe as TRÊS opções (cada
// uma uma <Chip> do kit com o glifo), reflete o estado corrente via `isSystem`/`mode`, e REUSA
// `setMode` (a MESMA persistência offline da F5.2). Cores via TOKENS (`useTheme`), rótulos via
// `t()` (paridade pt/en), a11y por chip (role button + estado selected). Sem I/O de domínio.
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useI18n, type MessageKey } from '../lib/i18n';
import { useTheme, type ThemeContextValue, type ThemeMode } from '../lib/theme';
import { Chip } from './ui';

// As TRÊS opções, em ordem canônica. `value` = argumento p/ `setMode` (null = seguir o sistema).
// O glyph é DECORATIVO (o rótulo REAL/a11y vem de `t(labelKey)`). O SELETOR DE VARIAÇÃO DE TEXTO
// `︎` força apresentação MONOCROMÁTICA no iOS — sem ele, o iOS promove ☀/☾ a emoji COLORIDO
// (o sol amarelo destoava do resto do chrome). ◐ (BMP não-emoji) já é monocromático.
const OPTIONS: { value: ThemeMode | null; glyph: string; labelKey: MessageKey; testID: string }[] = [
  { value: 'light', glyph: '☀︎', labelKey: 'theme.light', testID: 'theme-mode-light' },
  { value: 'dark', glyph: '☾︎', labelKey: 'theme.dark', testID: 'theme-mode-dark' },
  { value: null, glyph: '◐', labelKey: 'theme.system', testID: 'theme-mode-system' },
];

export function ThemeModeSelector() {
  const theme = useTheme();
  const { mode, isSystem, setMode } = theme;
  // F5.5/F5.33: rótulo de a11y via `t()` (reativo ao idioma), espelhando o LanguageToggleButton.
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={styles.bar}>
      {OPTIONS.map((option) => {
        // `null` (sistema) fica ativo quando NÃO há override; senão o modo efetivo casa a opção.
        const active = option.value === null ? isSystem : !isSystem && mode === option.value;
        return (
          <Chip
            key={option.testID}
            label={option.glyph}
            active={active}
            onPress={() => setMode(option.value)}
            testID={option.testID}
            accessibilityLabel={t(option.labelKey)}
          />
        );
      })}
    </View>
  );
}

function makeStyles({ space }: ThemeContextValue) {
  return StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  });
}
