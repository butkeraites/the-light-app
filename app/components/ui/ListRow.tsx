// app/components/ui/ListRow.tsx — ADR-0066 (component kit "Vigil")
//
// Linha de lista pressionável (nav da home, ajustes, referências cruzadas). UM só interativo
// (role/label/alvo ≥44) — lição do a11y-scan. Ícone à esquerda opcional, valor/chevron à direita.
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';
import { Icon, type IconName } from './Icon';

export function ListRow({
  label,
  onPress,
  testID,
  accessibilityRole = 'button',
  accessibilityLabel,
  leading,
  value,
  showChevron = true,
}: {
  label: string;
  onPress?: () => void;
  testID?: string;
  accessibilityRole?: 'button' | 'link';
  accessibilityLabel?: string;
  leading?: IconName;
  value?: string;
  showChevron?: boolean;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      style={styles.row}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {leading ? <Icon name={leading} size={20} color={theme.colors.accent} style={styles.leading} /> : null}
      <Text style={styles.label}>{label}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {showChevron ? <Icon name="chevron" size={18} color={theme.colors.muted} /> : null}
    </Pressable>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      gap: space.md,
    },
    leading: { width: 22, textAlign: 'center' },
    label: { ...type.body, color: colors.text, flex: 1 },
    value: { ...type.caption, color: colors.muted },
  });
}
