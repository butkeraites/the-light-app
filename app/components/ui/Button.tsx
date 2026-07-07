// app/components/ui/Button.tsx — ADR-0066 (component kit "Vigil")
//
// Botão único do app (substitui o `btnPrimary`/`btnGhost`/`btnAsk`/`btnDisabled` copiado por ~5
// arquivos). Variantes: primary (ouro), secondary (superfície), ghost (borda), danger (erro).
// a11y embutida: role="button", rótulo (prop ou texto), alvo ≥44. Tokens Vigil (zero magic number).
import { useMemo } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme, type ThemeContextValue } from '../../lib/theme';
import { Icon, type IconName } from './Icon';
import { usePressScale } from './usePressScale';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  testID,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const inert = disabled || loading;
  const v = styles.variants[variant];
  const fg = inert ? theme.colors.muted : v.fg;
  // Fase 6: feedback tátil (encolhe ao pressionar), gated em reduce-motion.
  const press = usePressScale();

  return (
    <AnimatedPressable
      onPress={inert ? undefined : onPress}
      onPressIn={inert ? undefined : press.onPressIn}
      onPressOut={inert ? undefined : press.onPressOut}
      disabled={inert}
      style={[styles.base, v.container, inert ? styles.disabled : null, { transform: [{ scale: press.scale }] }, style]}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={16} color={fg} /> : null}
          <Text style={[styles.label, { color: fg }]}>{title}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  const styles = StyleSheet.create({
    base: {
      minHeight: 44,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    label: { ...type.button },
    disabled: { opacity: 0.55 },
  });
  return {
    ...styles,
    variants: {
      primary: { container: { backgroundColor: colors.accent }, fg: colors.onAccent },
      secondary: {
        container: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
        fg: colors.text,
      },
      ghost: { container: { borderWidth: 1, borderColor: colors.border }, fg: colors.accent },
      danger: { container: { borderWidth: 1, borderColor: colors.error }, fg: colors.error },
    },
  };
}
