// app/web/export-selftest.web.ts — F3.12a (ADR-0031; par de export-selftest.ts)
//
// Self-test HEADLESS de EXPORTAÇÃO ACADÊMICA no WEB. Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts) no browser: delega ao glue web
// (`reading.web.ts` → `deepStudy`/`lexicalEntries` → wasm `ai-pure` + store OPFS) com o
// provedor determinístico `"mock"` (SEM chave, SEM rede — offline), depois monta o export
// app-side (`buildStudyExport`, PURA) e emite o MESMO marcador que o nativo (`TLA_EXPORT`),
// COMPOSTO DO RETORNO REAL — sem hardcode de Markdown/atribuição.
//
// Regra de ouro: o Markdown acadêmico (SBL) vem INTEIRO do core
// (`StudyResultOut.academicMarkdown`, `to_academic_markdown` — ZERO drift nativo↔web); o
// sidecar só AGREGA os `StudyCitation` + as `sources` do léxico.
//
// Resolução por extensão do Metro: no NATIVO vale `export-selftest.ts`; no web vale ESTE.
import { buildStudyExport } from '../lib/studyExport';
import { deepStudy, lexicalEntries, StudyDepth, StudyLens, StudyMode } from './reading';

// Marcador grep-ável (prefixo estável "TLA_"), IDÊNTICO ao nativo.
const MARK = 'TLA_EXPORT';
// Passagem de ancoragem (João 3:16) — NUMÉRICA na fronteira; a string é só p/ o marcador.
const SOURCE = 'John 3:16';
const BOOK = 43;
const CHAPTER = 3;
const VERSE = 16;
// Provedor determinístico OFFLINE da prova (sem chave, sem rede).
const PROVIDER = 'mock';
// O glue web abre o store (OPFS) internamente; o dbPath é ignorado (paridade de assinatura).
const WEB_DB = '';

/** Emite uma linha nos dois canais (log + error) p/ robustez de captura. */
function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/**
 * Prefixo legível da passagem: remove o número de versículo do formato numerado
 * ("{n} {texto}") e corta os primeiros ~40 chars — do RETORNO real (store), não hardcoded.
 */
function passagePrefix(passageText: string): string {
  return passageText.replace(/^\s*\d+\s+/, '').slice(0, 40);
}

/**
 * Token DERIVADO da atribuição STEP das `sources` (não hardcoded): retorna a substring
 * "STEP Bible" quando ela REALMENTE aparece numa das fontes; senão a 1ª fonte (ou `null`).
 */
function attributionToken(sources: readonly string[]): string | null {
  for (const s of sources) {
    const idx = s.indexOf('STEP Bible');
    if (idx >= 0) {
      return s.slice(idx, idx + 'STEP Bible'.length);
    }
  }
  return sources.length > 0 ? sources[0] : null;
}

/**
 * Prova de exportação acadêmica no WEB. Emite (tudo do RETORNO real, não hardcoded):
 *   TLA_EXPORT ref="John 3:16" provider="mock" md_len=<n> has_passage=true has_attribution=true
 */
export async function runExportSelfTest(): Promise<void> {
  try {
    // Estudo REAL pelo glue web. Provedor "mock" → sem chave, sem rede (offline).
    const study = await deepStudy(
      WEB_DB,
      'kjv',
      BOOK,
      CHAPTER,
      VERSE,
      StudyMode.Academic,
      StudyLens.Presbyterian,
      StudyDepth.Exegetical,
      'en',
      PROVIDER,
      undefined,
      undefined,
    );
    const lex = await lexicalEntries(WEB_DB, BOOK, CHAPTER, VERSE, 'en', undefined);

    // Export app-side (PURO): Markdown do core + sidecar agregado. Nada reimplementado.
    const exp = buildStudyExport(study, SOURCE, lex.sources);
    const md = exp.markdown; // = study.academicMarkdown (VERBATIM do core)

    const hasPassage = md.includes(passagePrefix(study.passageText));
    const token = attributionToken(lex.sources);
    const hasAttribution = token != null && md.includes(token);

    emit(
      `${MARK} ref=${JSON.stringify(SOURCE)} provider=${JSON.stringify(study.provider)} md_len=${md.length} has_passage=${hasPassage} has_attribution=${hasAttribution}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
