// app/lib/shareVerseMessage.ts — Rodada 4 (engajamento): monta o texto de compartilhar um versículo
//
// PURO e sem plataforma (nem react-native nem web): a MESMA string vale no nativo (Share) e no web
// (navigator.share / clipboard). O TEXTO do versículo vem VERBATIM do store (anti-alucinação) — aqui
// só o formatamos com a referência + a versão. Testável headless.

/** Resultado do compartilhamento: nativo/web-share = 'shared'; fallback web = 'copied'; sem meio = 'unavailable'. */
export type ShareVerseResult = 'shared' | 'copied' | 'unavailable';

/**
 * Texto compartilhável de um versículo: a Escritura entre aspas + a referência e a versão. Ex.:
 *   "No princípio criou Deus…"
 *   — Gênesis 1:1 · Almeida 1911
 * `text` é VERBATIM do store; `reference`/`translationLabel` são rótulos legíveis (não texto bíblico).
 */
export function buildShareMessage(text: string, reference: string, translationLabel: string): string {
  const ref = translationLabel ? `${reference} · ${translationLabel}` : reference;
  return `"${text}"\n\n— ${ref}`;
}
