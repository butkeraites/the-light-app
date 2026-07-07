// app/components/ui/usePressScale.ts — ADR-0068 Fase 6 (motion pass)
//
// Micro-interação COMPARTILHADA: encolhe levemente o controle ao pressionar (mola dos tokens Vigil),
// dando feedback TÁTIL a Button/Chip. Respeita `useReducedMotion` (não anima quando o usuário pediu
// menos movimento) e usa o driver nativo fora do web. Devolve o `scale` (Animated.Value) + handlers.
import { useRef } from 'react';
import { Animated, Platform } from 'react-native';

import { useReducedMotion } from '../../lib/useReducedMotion';
import { useTheme } from '../../lib/theme';

export function usePressScale(to = 0.96) {
  const { motion } = useTheme();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const springTo = (v: number) =>
    Animated.spring(scale, {
      toValue: v,
      damping: motion.spring.damping,
      stiffness: motion.spring.stiffness,
      mass: motion.spring.mass,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  return {
    scale,
    onPressIn: () => {
      if (!reduced) springTo(to);
    },
    onPressOut: () => {
      if (!reduced) springTo(1);
    },
  };
}
