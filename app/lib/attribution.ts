// app/lib/attribution.ts — ADR-0074 (deepening): atribuição STEP CC-BY numa fonte só
//
// ADR-0026: a atribuição STEP/Tyndale CC BY 4.0 é OBRIGATÓRIA sempre que léxico/interlinear aparece. A
// constante canônica + o fallback (usar as `sources` REAIS do retorno; senão a canônica) eram
// duplicados em `ReaderStudyPanel` e `ReaderInterlinearPanel` — e a constante era EXPORTADA de um
// painel e IMPORTADA pelo painel irmão (acoplamento painel→painel). Concentrados aqui; o render vive em
// `components/ui/AttributionBlock`. Anti-alucinação/licença: o requisito nunca cai (fallback à canônica).

/**
 * Atribuição STEP CC-BY CANÔNICA (ADR-0026) — string verbatim de `scholarly_sources.attribution`. A UI
 * exibe as `sources` REAIS do retorno; esta é o fallback textual do requisito de licença E a fonte do
 * grep de verificação (`about-attributions`). NÃO alterar/omitir "STEP Bible".
 */
export const STEP_ATTRIBUTION =
  "Credit it to 'STEP Bible' linked to www.STEPBible.org (data based on work at Tyndale House, Cambridge; CC BY 4.0)";

/** Linhas de atribuição a exibir: as `sources` reais do retorno; se vazias, a canônica (nunca cai). */
export function attributionLinesFrom(sources: readonly string[]): string[] {
  return sources.length > 0 ? [...sources] : [STEP_ATTRIBUTION];
}
