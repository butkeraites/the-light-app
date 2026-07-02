// app/web/study-selftest.web.ts — F3.12a (ADR-0031; par de study-selftest.ts)
//
// Self-test HEADLESS de ESTUDO PROFUNDO + LÉXICO no WEB. Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts) no browser: delega ao glue web
// (`reading.web.ts` → `deepStudy`/`lexicalEntries` → wasm `ai-pure` + store OPFS + léxico
// do subset) com o provedor determinístico `"mock"` (SEM chave, SEM rede — offline). Emite
// o MESMO marcador estável que o nativo (`TLA_STUDY`), COMPOSTO DO RETORNO REAL — sem
// hardcode de texto bíblico, interpretação, léxico ou atribuição.
//
// Paridade nativo↔web (ZERO drift): `passage_prefix` vem do `StudyResultOut.passageText`
// (João 3:16 KJV VERBATIM do store), separado da `interpretation` (mock). O `lexicon` conta
// as `VerifiedLexiconOut.entries` (Strong do léxico STEP CC-BY do subset). O
// `attribution_ok` confirma a atribuição STEP CC-BY (`sources`). Nenhuma chave é usada nem
// logada (provider "mock", offline).
//
// Resolução por extensão do Metro: no NATIVO vale `study-selftest.ts`; no web vale ESTE.
import { deepStudy, lexicalEntries, StudyDepth, StudyLens, StudyMode } from './reading';

// Marcador grep-ável (prefixo estável "TLA_"), IDÊNTICO ao nativo.
const MARK = 'TLA_STUDY';
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
 * ("{n} {texto}") e corta os primeiros ~60 chars — do RETORNO real (store), não hardcoded.
 */
function passagePrefix(passageText: string): string {
  return passageText.replace(/^\s*\d+\s+/, '').slice(0, 60);
}

/**
 * Prova de estudo profundo + léxico no WEB. Emite (tudo do RETORNO de `deepStudy`/
 * `lexicalEntries`, não hardcoded):
 *   TLA_STUDY ref="John 3:16" provider="mock" passage_prefix="For God so loved..." lexicon=<n> attribution_ok=true
 */
export async function runStudySelfTest(): Promise<void> {
  try {
    // Estudo REAL pelo glue web. Provedor "mock" → sem chave (undefined), sem rede (offline);
    // modelo undefined → default do core. `lang="en"` p/ casar o texto KJV do store.
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
    // Léxico verificado (independente de tradução — sem `translation`).
    const lex = await lexicalEntries(WEB_DB, BOOK, CHAPTER, VERSE, 'en', undefined);

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
