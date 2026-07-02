// app/lib/studyExport.ts — F3.8 (molde app/lib/notesExport.ts F1.11/ADR-0017)
//
// EXPORT ACADÊMICO de um estudo profundo (F3.3/F3.5), montado APENAS a partir do que
// `deep_study` já retornou (`StudyResultOut`): o **Markdown acadêmico (SBL)** vem
// INTEIRO do core (`StudyResultOut.academicMarkdown`, produzido por
// `StudyResult::to_academic_markdown` — fonte única, ZERO DRIFT), e o **sidecar de
// citações** é só a AGREGAÇÃO dos Records `StudyCitation` + metadados/atribuições. Como
// em `buildNotesExport`, NÃO reimplementa nenhuma serialização do core (nada de reescrever
// SBL/proveniência/notas de rodapé aqui — isso vive no Rust).
//
// É uma função PURA (sem I/O, sem rede, sem chave) → segura nos dois alvos. A UI passa o
// resultado ao Share sheet (`react-native` `Share`, molde F1.11); o self-test confere,
// headless, que o exportável BATE com o RETORNO real de `deep_study`.
//
// Anti-alucinação: o texto bíblico e as citações vêm do STORE (verbatim, via o core); a
// interpretação é ROTULADA como gerada por IA (o rodapé de procedência do core já o faz —
// aqui o `disclaimer` do sidecar reforça). As ATRIBUIÇÕES (STEP CC-BY, ADR-0026) vêm das
// `sources` REAIS do léxico + das `attribution` das citações retornadas — nunca inventadas.
import type { StudyCitation, StudyResultOut } from '../web/reading';

/**
 * Disclaimer de IA CANÔNICO do sidecar (reforça o `provenance_footer` do core, que já
 * separa o verificável do gerado por IA). Não substitui a proveniência do Markdown — é
 * o campo legível do JSON de metadados.
 */
export const STUDY_AI_DISCLAIMER =
  'A análise e a interpretação são geradas por IA e podem conter erros — confira sempre as fontes primárias. O texto bíblico e as citações vêm do acervo local (verbatim).';

/** Sidecar de citações (metadados/atribuições/proveniência) — JSON round-trippável. */
export type StudySidecar = {
  /** Referência legível estudada (ex.: "John 3:16"). */
  reference: string;
  /** Provedor usado (ex.: "mock"), ecoado do retorno. */
  provider: string;
  /** Modelo usado (ex.: "mock-1"), ecoado do retorno. */
  model: string;
  /** Disclaimer de IA (anti-alucinação) — texto legível. */
  generated_by_ai_disclaimer: string;
  /** Atribuições verbatim (STEP CC-BY, …) das fontes usadas — do banco, deduplicadas. */
  attributions: string[];
  /** Citações verificáveis retornadas por `deep_study` (do banco — nunca do modelo). */
  citations: StudyCitation[];
};

/** Pacote exportável: Markdown acadêmico (do core) + sidecar + a mensagem p/ o Share. */
export type StudyExport = {
  /** Markdown acadêmico (SBL) — VERBATIM do core (`StudyResultOut.academicMarkdown`). */
  markdown: string;
  /** Sidecar de citações (objeto). */
  sidecar: StudySidecar;
  /** Sidecar serializado (JSON identado) — o `.citations.json` round-trippável. */
  sidecarJson: string;
  /** Mensagem única p/ o Share nativo: Markdown + sidecar anexado (molde F1.11). */
  message: string;
};

/**
 * Agrega as atribuições (STEP CC-BY, …) do RETORNO real, deduplicadas e preservando a
 * ordem: primeiro as `sources` verbatim do léxico (obrigatórias, ADR-0026), depois as
 * `attribution` das citações. Nada é inventado — só o que veio do banco.
 */
function collectAttributions(
  lexiconSources: readonly string[],
  citations: readonly StudyCitation[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string | undefined | null): void => {
    const v = (s ?? '').trim();
    if (v.length > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  for (const s of lexiconSources) {
    add(s);
  }
  for (const c of citations) {
    add(c.attribution);
  }
  return out;
}

/**
 * Monta o pacote exportável de um estudo a partir do RETORNO real de `deep_study`
 * (`StudyResultOut`) + as `sources` do léxico (`lexicalEntries(...).sources`, atribuição
 * STEP CC-BY). Reaproveita `academicMarkdown` (do core) e agrega `citations` — não
 * reescreve o formato do core. PURA (sem I/O). A UI passa `message` ao Share.
 */
export function buildStudyExport(
  result: StudyResultOut,
  referenceLabel: string,
  lexiconSources: readonly string[],
): StudyExport {
  const sidecar: StudySidecar = {
    reference: referenceLabel,
    provider: result.provider,
    model: result.model,
    generated_by_ai_disclaimer: STUDY_AI_DISCLAIMER,
    attributions: collectAttributions(lexiconSources, result.citations),
    citations: result.citations,
  };
  const sidecarJson = JSON.stringify(sidecar, null, 2);
  // Mensagem única (molde F1.11): o Markdown acadêmico + o sidecar anexado como bloco
  // de código JSON (o Share nativo transporta um texto só; ambos seguem juntos).
  const message = `${result.academicMarkdown}\n\n---\n\n## Citações (sidecar)\n\n\`\`\`json\n${sidecarJson}\n\`\`\`\n`;
  return { markdown: result.academicMarkdown, sidecar, sidecarJson, message };
}
