// app/web/compare-selftest.web.ts — F3.12b (paridade web; molde compare-selftest.ts F3.7)
//
// Self-test HEADLESS de COMPARAÇÃO MULTI-IA ANCORADA no WEB. DESTUBADO (era SKIP): agora
// PROVA REAL, espelhando o par nativo (`compare-selftest.ts`) mas pela fronteira WEB
// (reading.web.ts → `askAnchored` → wasm `ai-pure` + `fetch`; F2.7b). Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o store web (OPFS, internamente) e
// faz 2 chamadas INDEPENDENTES de `askAnchored` (2 "colunas" mock) sobre a MESMA passagem
// (João 3:16), provando o WIRING de N provedores da comparação. Provedor `"mock"` → SEM
// chave, SEM rede (offline). Emite um marcador estável COMPOSTO DO RETORNO REAL — sem
// hardcode de texto bíblico nem de interpretação.
//
// DECISÃO (F3.7): o `MockLlmProvider` devolve resposta FIXA → mock×mock é DEGENERADO em
// conteúdo. Esta prova cobre o WIRING (N chamadas → N AiAnswer, TODOS com o MESMO `citedText`
// do store = mesma âncora — anti-alucinação + invariante `cited_match`), NÃO a diferença de
// respostas. A comparação de respostas REAIS (Claude/GPT/Gemini) é a F3.10 (chave real, gate).
//
// Anti-alucinação: o `cited_prefix` vem do `AiAnswer.citedText` (João 3:16 KJV VERBATIM do
// store, a âncora), separado da `interpretation` (saída do mock). Nenhuma chave é usada (mock)
// e NENHUMA chave é logada (não há chave neste caminho).
//
// Marcador (idêntico ao nativo):
//   TLA_COMPARE ref="John 3:16" providers=2 cited_match=true first_provider="mock" cited_prefix="For God so loved..."
import { askAnchored, type AiAnswer } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_COMPARE';
// Passagem de ancoragem (João 3:16) — string canônica p/ a fronteira `ask_anchored`.
const SOURCE = 'John 3:16';
// Provedor determinístico OFFLINE (sem chave, sem rede). As 2 colunas usam mock: conteúdo
// degenerado (mock é fixo), mas prova o WIRING de N provedores + a âncora comum (`cited_match`).
const PROVIDER = 'mock';

/** Emite uma linha nos dois canais (log + error) p/ robustez de captura. */
function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/**
 * Prefixo legível do texto citado: remove o número de versículo do formato numerado
 * ("{n} {texto}", ex.: "16 For God so loved...") e corta os primeiros ~60 chars — do RETORNO
 * real (store), não hardcoded.
 */
function citedPrefix(citedText: string): string {
  return citedText.replace(/^\s*\d+\s+/, '').slice(0, 60);
}

/**
 * Prova de comparação multi-IA ancorada no WEB. Faz 2 chamadas INDEPENDENTES de `askAnchored`
 * (2 colunas "mock") sobre a MESMA passagem, provando o wiring de N provedores. O `_dbPath` é
 * ignorado no web (o store OPFS abre internamente). Emite (tudo do RETORNO real):
 *   TLA_COMPARE ref="John 3:16" providers=2 cited_match=true first_provider="mock" cited_prefix="For God so loved..."
 */
export async function runCompareSelfTest(): Promise<void> {
  try {
    // 2 chamadas INDEPENDENTES à MESMA `reference` (João 3:16), uma por coluna — o mesmo
    // fan-out `Promise.all` que a UI faz. Provedor "mock" → sem chave (undefined), sem rede;
    // modelo undefined → default do core. `lang="en"` p/ casar o texto KJV do store. O
    // `_dbPath` ("") é ignorado no web. A âncora (`citedText`) é lida do store, IDÊNTICA nas 2.
    const question = 'What is the main message of this verse?';
    const results: AiAnswer[] = await Promise.all([
      askAnchored('', 'kjv', SOURCE, question, PROVIDER, undefined, undefined, 'en'),
      askAnchored('', 'kjv', SOURCE, question, PROVIDER, undefined, undefined, 'en'),
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
