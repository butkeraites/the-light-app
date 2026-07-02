// app/web/export-selftest.ts — F3.8 (molde app/web/study-selftest.ts F3.5)
//
// Self-test HEADLESS de EXPORTAÇÃO ACADÊMICA no NATIVO. Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco bundled (db.ts) e exercita
// a fronteira nativa (reading.ts → `deepStudy`/`lexicalEntries` → JSI → the_light_core::ai)
// com o provedor determinístico `"mock"` (SEM chave, SEM rede), depois monta o export
// app-side (`buildStudyExport`, função PURA) e emite um marcador estável COMPOSTO DO
// RETORNO REAL — sem hardcode de texto bíblico, atribuição ou Markdown.
//
// Regra de ouro: o Markdown acadêmico (SBL) NÃO é montado no app — vem INTEIRO do core
// (`StudyResultOut.academicMarkdown`, produzido por `StudyResult::to_academic_markdown`).
// O sidecar só AGREGA os `StudyCitation` retornados + as `sources` do léxico (molde F1.11).
//
// Marcador:
//   TLA_EXPORT ref="John 3:16" provider="mock" md_len=<n> has_passage=true has_attribution=true
//     - `provider`         = `StudyResultOut.provider` (via `LlmProvider::name()` → "mock").
//     - `md_len`           = tamanho do `academicMarkdown` (do core) — >0 prova que veio.
//     - `has_passage`      = o Markdown contém `passagePrefix(study.passageText)` (texto do
//                            store, VERBATIM) → texto citado do acervo local presente.
//     - `has_attribution`  = o Markdown contém um token DERIVADO da atribuição STEP das
//                            `sources` do léxico (ex.: "STEP Bible") — NÃO hardcoded.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `export-selftest.web.ts` (SKIP — export web = F3.12).
import { ensureReadingDb } from '../lib/db';
import { buildStudyExport } from '../lib/studyExport';
import { deepStudy, lexicalEntries, StudyDepth, StudyLens, StudyMode } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_EXPORT';
// Passagem de ancoragem (João 3:16) — NUMÉRICA na fronteira; a string é só p/ o marcador.
const SOURCE = 'John 3:16';
const BOOK = 43;
const CHAPTER = 3;
const VERSE = 16;
// Provedor determinístico OFFLINE da prova (sem chave, sem rede).
const PROVIDER = 'mock';

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
 * "STEP Bible" quando ela REALMENTE aparece numa das fontes do banco; senão a 1ª fonte
 * (ou `null` se não há fontes). Assim `has_attribution` reflete o dado real.
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
 * Prova de exportação acadêmica. Emite (tudo do RETORNO de `deepStudy`/`lexicalEntries` e
 * do `buildStudyExport`, não hardcoded):
 *   TLA_EXPORT ref="John 3:16" provider="mock" md_len=<n> has_passage=true has_attribution=true
 */
export async function runExportSelfTest(): Promise<void> {
  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  try {
    // Estudo REAL pela fronteira. Provedor "mock" → sem chave (undefined), sem rede;
    // modelo undefined → default do core. `lang="en"` p/ casar o texto KJV do store.
    const study = await deepStudy(
      dbPath,
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
    // Léxico verificado (independente de tradução) — as `sources` trazem a atribuição STEP.
    const lex = await lexicalEntries(dbPath, BOOK, CHAPTER, VERSE, 'en', undefined);

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
