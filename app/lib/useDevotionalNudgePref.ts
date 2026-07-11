// app/lib/useDevotionalNudgePref.ts — Rodada 5 (engajamento): hook da PREFERÊNCIA do nudge devocional
//
// LÊ/PERSISTE a preferência do lembrete diário in-app (ligado + hora da manhã) no KV de prefs OFFLINE
// (F5.2), reusando a lógica PURA de `engagementNudge.shared.ts` (parse/chave/default). Molde de
// `useReadingPrefs.ts`: no boot re-hidrata o salvo; os setters gravam fire-and-forget. É o ponto com
// `react`/estado da preferência; a decisão do nudge fica pura/testável. Opt-in (OFF por padrão).
import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_NUDGE_PREF,
  NUDGE_PREF_KEY,
  parseNudgePref,
  type NudgePref,
} from './engagementNudge.shared';
import { getPref, setPref } from './prefs';

export type DevotionalNudgePrefs = {
  /** `true` quando o estado persistido já re-hidratou (evita flash do default). */
  loaded: boolean;
  enabled: boolean;
  hour: number;
  setEnabled: (b: boolean) => void;
  setHour: (h: number) => void;
};

// Persistência fire-and-forget (offline-first: falha tolerada).
function persist(pref: NudgePref) {
  void (async () => {
    try {
      await setPref(NUDGE_PREF_KEY, JSON.stringify(pref));
    } catch {
      /* tolerado */
    }
  })();
}

export function useDevotionalNudgePref(): DevotionalNudgePrefs {
  const [loaded, setLoaded] = useState(false);
  const [pref, setPrefState] = useState<NudgePref>(DEFAULT_NUDGE_PREF);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = parseNudgePref(await getPref(NUDGE_PREF_KEY));
        if (alive) {
          setPrefState(p);
        }
      } catch {
        /* prefs indisponível → mantém o default (offline-first) */
      } finally {
        if (alive) {
          setLoaded(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<NudgePref>) => {
    setPrefState((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  return {
    loaded,
    enabled: pref.enabled,
    hour: pref.hour,
    setEnabled: (b: boolean) => update({ enabled: b }),
    setHour: (h: number) => update({ hour: h }),
  };
}
