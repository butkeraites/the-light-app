// app/components/ui/IconButton.tsx — ADR-0066 (component kit "Vigil")
//
// Botão de ÍCONE do header/folhas (Aa, fechar, tema, overflow). Alvo ≥44, role="button", rótulo
// OBRIGATÓRIO (o ícone é decorativo). `label` (ex.: "Aa") renderiza texto em vez de glifo.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';
import { Icon, type IconName } from './Icon';

export function IconButton({
  name,
  label,
  onPress,
  accessibilityLabel,
  testID,
  color,
  active = false,
}: {
  name?: IconName;
  /** Texto curto (ex.: "Aa") em vez de um glifo. */
  label?: string;
  onPress?: () => void;
  accessibilityLabel: string;
  testID?: string;
  color?: string;
  active?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const fg = color ?? (active ? theme.colors.accent : theme.colors.text);
  return (
    <Pressable
      onPress={onPress}
      style={styles.btn}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      hitSlop={8}
    >
      {label != null ? (
        <Text style={[styles.label, { color: fg }]}>{label}</Text>
      ) : name != null ? (
        <Icon name={name} size={22} color={fg} />
      ) : null}
    </Pressable>
  );
}

function makeStyles({ type, radius }: ThemeContextValue) {
  return StyleSheet.create({
    btn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    label: { ...type.title, fontSize: 17 },
  });
}
