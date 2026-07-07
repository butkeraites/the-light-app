// app/lib/useHideOnScroll.ts — hook do leitor imersivo (esconder cromo ao rolar)
//
// Envolve a lógica PURA de `hideOnScroll.ts` num hook React: mantém o estado do detector num ref
// (não re-renderiza a cada evento de scroll) e só chama `setHidden` quando o booleano MUDA. Devolve
// `{ hidden, onScroll, reset }` — `onScroll` vai direto no `<ScrollView onScroll>` (throttle no
// componente). Anti-jank: o estado do detector vive fora do ciclo de render.
import { useCallback, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import {
  DEFAULT_HIDE_SCROLL_OPTS,
  initialHideScroll,
  reduceHideScroll,
  type HideScrollOpts,
  type HideScrollState,
} from './hideOnScroll';

export function useHideOnScroll(opts: Partial<HideScrollOpts> = {}): {
  hidden: boolean;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  reset: () => void;
} {
  const resolved: HideScrollOpts = { ...DEFAULT_HIDE_SCROLL_OPTS, ...opts };
  const stateRef = useRef<HideScrollState>(initialHideScroll);
  const [hidden, setHidden] = useState(false);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const next = reduceHideScroll(stateRef.current, y, resolved);
      stateRef.current = next;
      setHidden((prev) => (prev === next.hidden ? prev : next.hidden));
    },
    // `resolved` é recriado por render, mas seus campos são primitivos estáveis.
    [resolved.threshold, resolved.topGuard, resolved.hideThreshold, resolved.showThreshold],
  );

  const reset = useCallback(() => {
    stateRef.current = initialHideScroll;
    setHidden(false);
  }, []);

  return { hidden, onScroll, reset };
}
