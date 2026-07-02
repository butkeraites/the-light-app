// app/web/compare-selftest.ts — F3.7 (molde chat-selftest.ts F3.6)
//
// Self-test HEADLESS de COMPARAÇÃO MULTI-IA ANCORADA no NATIVO. Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco bundled (db.ts) e
// exercita a fronteira nativa (reading.ts → `askAnchored` → JSI → the_light_core::ai)
// com o provedor determinístico `"mock"` (SEM chave, SEM rede). Faz 2 chamadas
// INDEPENDENTES de `askAnchored` (2 "colunas" mock) sobre a MESMA passagem (João 3:16),
// provando o WIRING de N provedores da comparação. Emite um marcador estável COMPOSTO DO
// RETORNO REAL — sem hardcode de texto bíblico nem de interpretação.
//
// DECISÃO DE DESENHO (F3.7): o `MockLlmProvider` devolve uma resposta FIXA → mock×mock é
// DEGENERADO em conteúdo. Por isso esta prova cobre o WIRING (N chamadas → N AiAnswer,
// TODOS com o MESMO `citedText` do store = mesma âncora — anti-alucinação + invariante de
// comparação `cited_match`), NÃO a diferença de respostas. A comparação de respostas REAIS
// (Claude/GPT/Gemini) é a F3.10 (chave real, gate). Esta prova NÃO finge comparação real.
//
// Anti-alucinação: o `cited_prefix` vem do `AiAnswer.citedText` (João 3:16 KJV VERBATIM do
// store, a âncora), separado da `interpretation` (saída do mock). `cited_match` compara os
// `citedText` das 2 colunas (mesma âncora). Nenhuma chave é usada (mock) e NENHUMA chave é
// logada (não há chave neste caminho).
//
// Marcador:
//   TLA_COMPARE ref="John 3:16" providers=2 cited_match=true first_provider="mock" cited_prefix="For God so loved..."
//     - `providers`      = nº de `AiAnswer` retornados (2 colunas independentes).
//     - `cited_match`    = `results[0].citedText === results[1].citedText && length > 0`
//                          (a MESMA âncora do store em todas — anti-alucinação + wiring).
//     - `first_provider` = `results[0].provider` (via `LlmProvider::name()` → "mock").
//     - `cited_prefix`   = prefixo do `results[0].citedText` (store, verbatim) sem o número
//                          de versículo do formato numerado ("{n} {texto}").
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `compare-selftest.web.ts` (SKIP — comparação web = F3.12), mantendo `expo-file-system`/o
// banco e a camada `ai`/store FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { askAnchored, type AiAnswer } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_COMPARE';
// Passagem de ancoragem (João 3:16) — string canônica p/ a fronteira `ask_anchored`.
const SOURCE = 'John 3:16';
// Provedor determinístico OFFLINE da prova (sem chave, sem rede). As 2 colunas usam mock:
// o conteúdo é degenerado (mock é fixo), mas isso prova o WIRING de N provedores + a âncora
// comum (`cited_match`). A diferença de respostas reais é a F3.10.
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
 * Prova de comparação multi-IA ancorada. Faz 2 chamadas INDEPENDENTES de `askAnchored`
 * (2 colunas "mock") sobre a MESMA passagem, provando o wiring de N provedores. Emite
 * (tudo do RETORNO de `askAnchored`, não hardcoded):
 *   TLA_COMPARE ref="John 3:16" providers=2 cited_match=true first_provider="mock" cited_prefix="For God so loved..."
 */
export async function runCompareSelfTest(): Promise<void> {
  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  try {
    // 2 chamadas INDEPENDENTES à MESMA `reference` (João 3:16), uma por coluna — o mesmo
    // fan-out `Promise.all` que a UI faz. Provedor "mock" → sem chave (undefined), sem
    // rede; modelo undefined → default do core. `lang="en"` p/ casar o texto KJV do store.
    // A âncora (`citedText`) é lida do store pelo core, IDÊNTICA nas 2 colunas.
    const question = 'What is the main message of this verse?';
    const results: AiAnswer[] = await Promise.all([
      askAnchored(dbPath, 'kjv', SOURCE, question, PROVIDER, undefined, undefined, 'en'),
      askAnchored(dbPath, 'kjv', SOURCE, question, PROVIDER, undefined, undefined, 'en'),
    ]);

    // Invariante de comparação (o mesmo que a UI mostra): todos os `citedText` iguais e
    // não-vazios = as N colunas leram a MESMA passagem do store (anti-alucinação + wiring).
    const citedMatch =
      results[0].citedText === results[1].citedText && results[0].citedText.length > 0;

    emit(
      `${MARK} ref=${JSON.stringify(SOURCE)} providers=${results.length} cited_match=${citedMatch} first_provider=${JSON.stringify(results[0].provider)} cited_prefix=${JSON.stringify(citedPrefix(results[0].citedText))}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
