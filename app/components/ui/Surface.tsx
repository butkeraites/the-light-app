// app/components/ui/Surface.tsx — ADR-0066 (component kit "Vigil")
//
// Cartão de superfície (fundo `surface` + borda + raio). Base de listas, resultados, painéis.
// `padded` liga o padding padrão; `elevated` usa a superfície mais alta. Só apresentação.
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';

export function Surface({
  children,
  padded = false,
  elevated = false,
  style,
  testID,
}: {
  children: ReactNode;
  padded?: boolean;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View
      testID={testID}
      style={[styles.card, elevated ? styles.elevated : null, padded ? styles.padded : null, style]}
    >
      {children}
    </View>
  );
}

function makeStyles({ colors, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    elevated: { backgroundColor: colors.surfaceElevated },
    padded: { padding: space.lg },
  });
}
