// app/lib/useReducedMotion.ts — ADR-0068 Fase 6 (motion pass)
//
// Hook de A11Y do MOVIMENTO: `true` quando o usuário pediu MENOS animação — no SO (iOS/Android
// "Reduce Motion") ou no web (`prefers-reduced-motion: reduce`, que o react-native-web mapeia em
// `AccessibilityInfo`). Os componentes que animam consultam este hook e DESLIGAM a animação
// (transição instantânea) quando ele é `true`. Default `false` (anima) até a 1ª leitura async;
// reage a mudanças em runtime. Sem I/O de domínio.
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduced(v);
      })
      .catch(() => {
        /* sem suporte → assume que pode animar (default false) */
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}
