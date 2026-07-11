// app/lib/useAppForeground.web.ts — WEB. Par de `useAppForeground.ts` (nativo, AppState).
//
// Detecta o app VOLTANDO AO PRIMEIRO PLANO no web via `visibilitychange`: quando a aba fica oculta
// guarda o instante; quando volta a ficar visível chama `onForeground(awayMs)` com quanto tempo
// ficou fora. Dispara também UMA vez no mount (abertura da sessão, `awayMs = Infinity`). É o gatilho
// do NUDGE devocional no web (o único honesto sem servidor — ADR-0042). Puro DOM, sem rede.
import { useEffect, useRef } from 'react';

export function useAppForeground(onForeground: (awayMs: number) => void): void {
  // Ref p/ o callback mais recente sem re-assinar o listener a cada render.
  const cbRef = useRef(onForeground);
  cbRef.current = onForeground;
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    // Abertura fresca da sessão conta como um "voltar ao primeiro plano" (ausência desconhecida).
    cbRef.current(Number.POSITIVE_INFINITY);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const awayMs = hiddenAtRef.current == null ? 0 : Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        cbRef.current(awayMs);
      } else if (hiddenAtRef.current == null) {
        hiddenAtRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
