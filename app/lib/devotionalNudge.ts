// app/lib/devotionalNudge.ts — Rodada 5 (engajamento): BUS (pub-sub) do NUDGE devocional visível.
//
// Store externo mínimo (`useSyncExternalStore`, molde de `readingDbLoad`) que diz SE o card do nudge
// está visível e QUAL o tipo (manhã / voltou-depois-de-um-tempo). O controlador (`_layout`) chama
// `showNudge(kind)` quando a decisão pura diz sim; o card e o controlador chamam `hideNudge()` ao
// dispensar/atuar. Sem plataforma-split (é só estado em memória, igual nos dois alvos). Nenhum texto
// bíblico aqui — só a visibilidade do card (o texto vem VERBATIM do store, no componente).
import { useSyncExternalStore } from 'react';

import type { NudgeKind } from './engagementNudge.shared';

export interface DevotionalNudgeVisibility {
  visible: boolean;
  kind: NudgeKind | null;
}

// Referência NOVA a cada mudança (contrato de `useSyncExternalStore`).
let state: DevotionalNudgeVisibility = { visible: false, kind: null };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) {
    l();
  }
}

/** Snapshot não-reativo (o controlador usa p/ evitar re-mostrar por cima de um card aberto). */
export function getDevotionalNudge(): DevotionalNudgeVisibility {
  return state;
}

export function showNudge(kind: NudgeKind): void {
  state = { visible: true, kind };
  emit();
}

export function hideNudge(): void {
  if (!state.visible) {
    return;
  }
  state = { visible: false, kind: null };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hook: re-renderiza o card quando a visibilidade muda. */
export function useDevotionalNudge(): DevotionalNudgeVisibility {
  return useSyncExternalStore(subscribe, getDevotionalNudge, getDevotionalNudge);
}
