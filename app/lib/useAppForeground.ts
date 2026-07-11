// app/lib/useAppForeground.ts — NATIVO. Par de `useAppForeground.web.ts` (web, visibilitychange).
//
// Detecta o app VOLTANDO AO PRIMEIRO PLANO no nativo via `AppState`: ao ir p/ background guarda o
// instante; ao voltar a `active` chama `onForeground(awayMs)` com o tempo fora. Dispara também UMA
// vez no mount (abertura, `awayMs = Infinity`). Gatilho do NUDGE devocional in-app (mesmo card do
// web; NÃO é notificação de sistema). `AppState` é do core do react-native — sem nova dependência.
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useAppForeground(onForeground: (awayMs: number) => void): void {
  const cbRef = useRef(onForeground);
  cbRef.current = onForeground;
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Abertura fresca (o app já monta 'active') conta como um "voltar ao primeiro plano".
    cbRef.current(Number.POSITIVE_INFINITY);

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        const awayMs = backgroundedAtRef.current == null ? 0 : Date.now() - backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        cbRef.current(awayMs);
      } else if (backgroundedAtRef.current == null) {
        // 'background' | 'inactive' → marca o início da ausência (uma vez).
        backgroundedAtRef.current = Date.now();
      }
    });
    return () => sub.remove();
  }, []);
}
