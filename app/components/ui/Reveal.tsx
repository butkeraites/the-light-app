// app/components/ui/Reveal.tsx — ADR-0068 Fase 6 (motion pass)
//
// Revela o conteúdo com um FADE + leve SUBIDA ao MONTAR — para seções que APARECEM (a resposta de
// IA citada/interpretada, um resultado). Respeita `useReducedMotion` (aparece instantâneo, sem
// animação). Puramente decorativo: envolve os filhos numa Animated.View e repassa `style`.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedMotion } from '../../lib/useReducedMotion';
import { useTheme } from '../../lib/theme';

export function Reveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { motion } = useTheme();
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    // `decelerate` dos tokens (cubic-bezier(0,0,0,1)) — entrada que desacelera.
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.duration.base,
      easing: Easing.bezier(0, 0, 0, 1),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [reduced, progress, motion.duration.base]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View style={[{ opacity: progress, transform: [{ translateY }] }, style]}>{children}</Animated.View>
  );
}
