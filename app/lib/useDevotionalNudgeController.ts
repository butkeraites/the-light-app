// app/lib/useDevotionalNudgeController.ts — Rodada 5 (engajamento): ORQUESTRADOR do nudge (efeito).
//
// Mora no `_layout` (raiz). A cada "voltar ao primeiro plano" (mount + foreground, via
// `useAppForeground`), lê a PREFERÊNCIA + o ESTADO do KV offline, DECIDE (lógica PURA de
// `engagementNudge.shared`) e, se sim, registra "mostrado" e aciona o bus. A regra de QUANDO é
// pura/testável; aqui só o encanamento (KV local, relógio). Offline-first: qualquer falha é engolida.
import { useCallback } from 'react';

import { getDevotionalNudge, showNudge } from './devotionalNudge';
import { loadNudgeState, recordNudgeShown } from './devotionalNudgeState';
import { decideNudge, NUDGE_PREF_KEY, parseNudgePref } from './engagementNudge.shared';
import { getPref } from './prefs';
import { localDayIndex } from './readingStreak';
import { useAppForeground } from './useAppForeground';

export function useDevotionalNudgeController(): void {
  const onForeground = useCallback(async (awayMs: number) => {
    // Não re-mostra por cima de um card já aberto.
    if (getDevotionalNudge().visible) {
      return;
    }
    try {
      const [prefRaw, state] = await Promise.all([getPref(NUDGE_PREF_KEY), loadNudgeState()]);
      const pref = parseNudgePref(prefRaw);
      if (!pref.enabled) {
        return;
      }
      const now = new Date();
      const result = decideNudge({
        nowMs: now.getTime(),
        localHour: now.getHours(),
        localDay: localDayIndex(now),
        pref,
        state,
        awayMs,
      });
      if (result.show && result.kind && !getDevotionalNudge().visible) {
        await recordNudgeShown(result.kind);
        showNudge(result.kind);
      }
    } catch {
      /* offline-first: falha de KV/relógio não quebra a navegação */
    }
  }, []);

  useAppForeground((awayMs) => {
    void onForeground(awayMs);
  });
}
