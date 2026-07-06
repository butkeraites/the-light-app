// app/lib/errMessage.ts — deepening (ADR-0059): coerção de erro compartilhada
//
// Helper PURO que converte um valor lançado (unknown) numa string exibível. Substitui as
// ~24 repetições de `err instanceof Error ? err.message : String(err)` espalhadas pelos
// painéis. Sem React, sem I/O — seguro em ambos os alvos e testável em node headless.
// NÃO loga; só devolve a mensagem para a UI apresentar.

/** Coerce an unknown thrown value to a display string (Error.message or String(err)). */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
