// app/lib/useChapterTurnGestures.ts — ADR-0071 (deepening): atalhos de virar-capítulo (web)
//
// Três efeitos de `window` (teclado ←/→, clique-lateral, swipe de toque) viviam inline na tela do
// capítulo, compartilhando um guard de seleção TRIPLICADO e decisões alcançáveis só simulando eventos
// de janela. Concentrados atrás desta costura: o hook possui os listeners + o ciclo de vida + os guards
// (navBlocked, campo de texto focado, seleção ativa, alvo interativo); as DECISÕES puras
// (`swipeIntent`/`sideNavZone`) vivem em `gestureNav` (testável headless). Listeners PASSIVOS, SEM
// preventDefault → scroll/roda/seleção/toque no versículo 100% intactos. No nativo é no-op (web-only).
import { useEffect } from 'react';
import { Platform } from 'react-native';

import type { ChapterAdjacency, ChapterRef } from './chapterNav';
import { sideNavZone, swipeIntent, type TurnDir } from './gestureNav';

/** Há seleção de texto ativa? Não virar capítulo terminando uma seleção (web-only). */
function hasTextSelection(): boolean {
  return typeof window !== 'undefined' && !!window.getSelection && String(window.getSelection() ?? '').length > 0;
}

export interface ChapterTurnGesturesInput {
  adj: ChapterAdjacency;
  goToChapter: (target: ChapterRef) => void;
  /** Suprime os gestos quando um painel/folha está aberto ou há seleção multi-trecho. */
  navBlocked: boolean;
  /** Largura da coluna de leitura renderizada (simples vs. paralelo) — define a margem de clique. */
  readingColumnMax: number;
}

export function useChapterTurnGestures({ adj, goToChapter, navBlocked, readingColumnMax }: ChapterTurnGesturesInput): void {
  const targetFor = (dir: TurnDir): ChapterRef | null =>
    dir === 'prev' ? adj.prev : dir === 'next' ? adj.next : null;

  // (1) TECLADO: ← anterior, → próximo. ↑↓/PageUp/Down seguem rolando (return sem preventDefault).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // Shift+←/→ é EXTENSÃO DE SELEÇÃO de texto (caret-browsing), não navegação — deixa o browser tratar.
      if (navBlocked || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (hasTextSelection()) return;
      const target = e.key === 'ArrowLeft' ? adj.prev : adj.next;
      e.preventDefault();
      if (target) goToChapter(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adj, goToChapter, navBlocked]);

  // (2) CLIQUE-NAS-LATERAIS (Kindle): margem esquerda vazia = anterior; direita = próximo. Só DENTRO da
  // leitura (`reader-body`), em espaço não-interativo, e sem seleção ativa. `sideNavZone` decide a zona.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || navBlocked || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as Element | null;
      if (!t || !t.closest('[data-testid="reader-body"]')) return; // fora da superfície de leitura
      if (t.closest('[data-testid^="verse-"], a, button, input, textarea, [role="button"], [role="switch"], [role="link"]')) {
        return; // versículo / elemento interativo → deixa o comportamento normal (abre painel)
      }
      if (hasTextSelection()) return; // terminando uma seleção
      const target = targetFor(sideNavZone(e.clientX, window.innerWidth, readingColumnMax));
      if (target) goToChapter(target);
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [adj, goToChapter, navBlocked, readingColumnMax]);

  // (3) SWIPE horizontal (toque): esquerda → próximo, direita → anterior. Passivo (touchstart/touchend),
  // SEM preventDefault. `swipeIntent` decide a partir de dx/dy/dt; só age no FIM de um gesto horizontal.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let sx = 0;
    let sy = 0;
    let st = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (navBlocked || e.touches.length !== 1) return; // multi-toque (pinça) não é swipe
      const t = e.target as Element | null;
      if (!t || !t.closest('[data-testid="reader-body"]')) return; // fora da superfície de leitura
      if (t.closest('input, textarea, [role="switch"]')) return; // não competir com controles
      const touch = e.touches[0];
      sx = touch.clientX;
      sy = touch.clientY;
      st = e.timeStamp;
      tracking = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (navBlocked) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      if (hasTextSelection()) return; // selecionando
      const target = targetFor(swipeIntent(touch.clientX - sx, touch.clientY - sy, e.timeStamp - st));
      if (target) goToChapter(target);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [adj, goToChapter, navBlocked]);
}
