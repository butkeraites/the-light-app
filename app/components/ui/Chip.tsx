// app/components/ui/Chip.tsx — ADR-0066 (component kit "Vigil")
//
// Chip/pílula selecionável (version picker, provedores, toggles). Ativo = ouro; inativo = borda.
// a11y: role="button" + state.selected; alvo confortável via padding (sem altura fixa <44).
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';

export function Chip({
  label,
  badge,
  active = false,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
}: {
  label: string;
  /** Legenda menor após o rótulo (ex.: idioma da versão, "BYOK"/"offline" do provedor). */
  badge?: string;
  active?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const fg = active ? theme.colors.onAccent : theme.colors.chipText;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[styles.chip, active ? styles.active : styles.inactive, disabled ? styles.disabled : null]}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
      {badge ? (
        <Text style={[styles.badge, { color: active ? theme.colors.onAccent : theme.colors.muted }]}>{badge}</Text>
      ) : null}
    </Pressable>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    active: { backgroundColor: colors.accent, borderColor: colors.accent },
    inactive: { backgroundColor: colors.surface, borderColor: colors.border },
    disabled: { opacity: 0.5 },
    label: { ...type.caption, fontWeight: '600' },
    badge: { ...type.caption, fontSize: 11, opacity: 0.8 },
  });
}
