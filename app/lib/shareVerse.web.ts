// app/lib/shareVerse.web.ts — Rodada 4: compartilhar versículo (WEB). Resolução por extensão do Metro.
//
// Web Share API (`navigator.share`, quando disponível — mobile/PWA) com FALLBACK para copiar ao
// clipboard (`navigator.clipboard`). Se nenhum existir (contexto não-seguro / navegador antigo),
// devolve 'unavailable' SEM lançar — a UI trata graciosamente. Nada é logado; nada sai sem ação do
// usuário. Mesmo texto do nativo (`buildShareMessage`, puro).
import { buildShareMessage, type ShareVerseResult } from './shareVerseMessage';

export { buildShareMessage, type ShareVerseResult };

export async function shareVerse(text: string, reference: string, translationLabel: string): Promise<ShareVerseResult> {
  const message = buildShareMessage(text, reference, translationLabel);
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text: message });
    } catch {
      /* usuário cancelou ou a folha falhou — tratamos como concluído (não é erro de app) */
    }
    return 'shared';
  }
  if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(message);
      return 'copied';
    } catch {
      return 'unavailable';
    }
  }
  return 'unavailable';
}
