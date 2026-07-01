// app/web/study-selftest.ts — F3.5 (molde ask-selftest.ts F2.5)
//
// Self-test HEADLESS de ESTUDO PROFUNDO + LÉXICO no NATIVO. Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco bundled (db.ts) e
// exercita a fronteira nativa (reading.ts → `deepStudy`/`lexicalEntries` → JSI →
// the_light_core::ai) com o provedor determinístico `"mock"` (SEM chave, SEM rede).
// Emite um marcador estável COMPOSTO DO RETORNO REAL — sem hardcode de texto bíblico,
// interpretação, léxico ou atribuição.
//
// Anti-alucinação: o `passage_prefix` vem do `StudyResultOut.passageText` (João 3:16 KJV
// VERBATIM do store), separado da `interpretation` (saída do mock). O `lexicon` conta as
// `VerifiedLexiconOut.entries` (Strong verificado do banco, STEP Bible CC-BY). O
// `attribution_ok` confirma a presença da atribuição STEP CC-BY (`sources`). Nenhuma
// chave é usada (mock) e NENHUMA chave é logada (não há chave neste caminho).
//
// Marcador:
//   TLA_STUDY ref="John 3:16" provider="mock" passage_prefix="For God so loved..." lexicon=<n> attribution_ok=true
//     - `provider`        = `StudyResultOut.provider` (via `LlmProvider::name()` → "mock").
//     - `passage_prefix`  = prefixo do `StudyResultOut.passageText` (store, verbatim) sem o
//                           número de versículo do formato numerado ("{n} {texto}").
//     - `lexicon`         = `VerifiedLexiconOut.entries.length` (>=1 no subset com léxico).
//     - `attribution_ok`  = `sources.length>=1 && sources.some(s => s.includes("STEP Bible"))`.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `study-selftest.web.ts` (SKIP — estudo/léxico web = F3.12), mantendo `expo-file-system`/o
// banco e a camada `ai`/store FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { deepStudy, lexicalEntries, StudyDepth, StudyLens, StudyMode } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_STUDY';
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
 * ("{n} {texto}", ex.: "16 For God so loved...") e corta os primeiros ~60 chars — do
 * RETORNO real (store), não hardcoded.
 */
function passagePrefix(passageText: string): string {
  return passageText.replace(/^\s*\d+\s+/, '').slice(0, 60);
}

/**
 * Prova de estudo profundo + léxico. Emite (tudo do RETORNO de `deepStudy`/
 * `lexicalEntries`, não hardcoded):
 *   TLA_STUDY ref="John 3:16" provider="mock" passage_prefix="For God so loved..." lexicon=<n> attribution_ok=true
 */
export async function runStudySelfTest(): Promise<void> {
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
    // Passagem NUMÉRICA (43,3,16); ordem REAL dos argumentos (lang ANTES de provider).
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
    // Léxico verificado (independente de tradução — sem `translation`).
    const lex = await lexicalEntries(dbPath, BOOK, CHAPTER, VERSE, 'en', undefined);

    const attributionOk =
      lex.sources.length >= 1 && lex.sources.some((s) => s.includes('STEP Bible'));

    emit(
      `${MARK} ref=${JSON.stringify(SOURCE)} provider=${JSON.stringify(study.provider)} passage_prefix=${JSON.stringify(passagePrefix(study.passageText))} lexicon=${lex.entries.length} attribution_ok=${attributionOk}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
