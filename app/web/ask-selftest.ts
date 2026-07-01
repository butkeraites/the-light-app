// app/web/ask-selftest.ts — F2.5 (D3/D4; molde F1.3/F1.9)
//
// Self-test HEADLESS de ESTUDO ASSISTIDO ANCORADO (ask + streaming) no NATIVO.
// Disparado SÓ sob `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco
// bundled (db.ts) e exercita a IA REAL pela fronteira nativa (reading.ts →
// `askAnchoredStream` → JSI → the_light_core::ai) com o provedor determinístico
// `"mock"` (SEM chave, SEM rede). Emite um marcador estável COMPOSTO DO RETORNO/
// CALLBACK REAIS — sem hardcode de texto bíblico nem de interpretação.
//
// Anti-alucinação: o `cited_prefix` vem do `AiAnswer.citedText` (João 3:16 KJV
// VERBATIM do store), separado da `interpretation` (saída do mock). `streamed=true`
// só se o callback recebeu >=1 token. Nenhuma chave é usada (mock) e NENHUMA chave é
// logada (não há chave neste caminho).
//
// Marcador:
//   TLA_ASK ref="John 3:16" provider="mock" streamed=true cited_prefix="For God so loved..." interp_len=<n>
//     - `provider`     = `AiAnswer.provider` (via `LlmProvider::name()` → "mock").
//     - `streamed`     = o callback de streaming recebeu >=1 token.
//     - `cited_prefix` = prefixo do `AiAnswer.citedText` (store, verbatim) sem o número
//                        de versículo do formato numerado ("{n} {texto}").
//     - `interp_len`   = `AiAnswer.interpretation.length` (comprimento da saída do mock).
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `ask-selftest.web.ts` (SKIP — IA web = F2.7), mantendo `expo-file-system`/o banco e a
// camada `ai` FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { askAnchoredStream } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_ASK';
// Referência de ORIGEM (entrada ancorada) — não texto bíblico.
const SOURCE = 'John 3:16';
// Provedor determinístico OFFLINE da prova (sem chave, sem rede).
const PROVIDER = 'mock';

/** Emite uma linha nos dois canais (log + error) p/ robustez de captura. */
function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/**
 * Prefixo legível do texto citado: remove o número de versículo do formato numerado
 * ("{n} {texto}", ex.: "16 For God so loved...") e corta os primeiros ~60 chars — do
 * RETORNO real (store), não hardcoded.
 */
function citedPrefix(citedText: string): string {
  return citedText.replace(/^\s*\d+\s+/, '').slice(0, 60);
}

/**
 * Prova de estudo assistido ancorado. Emite (tudo do RETORNO/CALLBACK de
 * `askAnchoredStream`, não hardcoded):
 *   TLA_ASK ref="John 3:16" provider="mock" streamed=true cited_prefix="For God so loved..." interp_len=<n>
 */
export async function runAskSelfTest(): Promise<void> {
  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  try {
    // Streaming REAL pela fronteira. Provedor "mock" → sem chave (undefined), sem rede;
    // modelo undefined → default do core. `lang="en"` p/ casar o texto KJV do store. O
    // callback acumula os tokens da INTERPRETAÇÃO (nunca do texto bíblico).
    let tokenCount = 0;
    let acc = '';
    const answer = await askAnchoredStream(
      dbPath,
      'kjv',
      SOURCE,
      'What is the main message of this verse?',
      PROVIDER,
      undefined,
      undefined,
      'en',
      (token) => {
        tokenCount += 1;
        acc += token;
      },
    );

    // `streamed` = o callback recebeu >=1 token (streaming exercitado de fato). O
    // `acc` (tokens acumulados) deve coincidir com a `interpretation` final do mock;
    // reportamos o comprimento da INTERPRETAÇÃO do AiAnswer (fonte da verdade).
    const streamed = tokenCount >= 1;
    void acc;
    emit(
      `${MARK} ref=${JSON.stringify(SOURCE)} provider=${JSON.stringify(answer.provider)} streamed=${streamed} cited_prefix=${JSON.stringify(citedPrefix(answer.citedText))} interp_len=${answer.interpretation.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
