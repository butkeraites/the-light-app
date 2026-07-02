// app/web/chat-selftest.ts — F3.6 (molde study-selftest.ts F3.5)
//
// Self-test HEADLESS de CONVERSA/FOLLOW-UP ANCORADO no NATIVO. Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): abre o banco bundled (db.ts) e
// exercita a fronteira nativa (reading.ts → `askSessionAnchored` → JSI →
// the_light_core::ai) com o provedor determinístico `"mock"` (SEM chave, SEM rede).
// Faz uma CONVERSA de 2 turnos (1ª pergunta → follow-up com o histórico User→Assistant→
// User), provando o multi-turno ancorado. Emite um marcador estável COMPOSTO DO RETORNO
// REAL — sem hardcode de texto bíblico nem de interpretação.
//
// Anti-alucinação: o `cited_prefix` vem do `AiAnswer.citedText` (João 3:16 KJV VERBATIM
// do store, a âncora), separado da `interpretation` (saída do mock). Nenhuma chave é usada
// (mock) e NENHUMA chave é logada (não há chave neste caminho).
//
// Marcador:
//   TLA_CHAT ref="John 3:16" provider="mock" turns=<n> cited_prefix="For God so loved..." interp_len=<n>
//     - `provider`     = `AiAnswer.provider` (via `LlmProvider::name()` → "mock").
//     - `turns`        = tamanho do HISTÓRICO ENVIADO no follow-up (a conversa que o app
//                        montou) — o `AiAnswer` NÃO tem campo `turns`.
//     - `cited_prefix` = prefixo do `AiAnswer.citedText` (store, verbatim) sem o número de
//                        versículo do formato numerado ("{n} {texto}").
//     - `interp_len`   = `AiAnswer.interpretation.length` (comprimento da saída do mock).
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `chat-selftest.web.ts` (SKIP — conversa web = F3.12), mantendo `expo-file-system`/o
// banco e a camada `ai`/store FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { askSessionAnchored, ChatRole, type ChatTurn } from './reading';

// Marcador grep-ável (prefixo estável "TLA_").
const MARK = 'TLA_CHAT';
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
 * Prefixo legível do texto citado: remove o número de versículo do formato numerado
 * ("{n} {texto}", ex.: "16 For God so loved...") e corta os primeiros ~60 chars — do
 * RETORNO real (store), não hardcoded.
 */
function citedPrefix(citedText: string): string {
  return citedText.replace(/^\s*\d+\s+/, '').slice(0, 60);
}

/**
 * Prova de conversa/follow-up ancorado. Faz 2 turnos (a 2ª chamada carrega o histórico
 * User→Assistant→User, provando o follow-up ancorado na MESMA passagem). Emite (tudo do
 * RETORNO de `askSessionAnchored` + o tamanho do histórico ENVIADO, não hardcoded):
 *   TLA_CHAT ref="John 3:16" provider="mock" turns=<n> cited_prefix="For God so loved..." interp_len=<n>
 */
export async function runChatSelfTest(): Promise<void> {
  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  try {
    // 1º turno: só a pergunta do usuário. Provedor "mock" → sem chave (undefined), sem
    // rede; modelo undefined → default do core. `lang="en"` p/ casar o texto KJV do store.
    // Passagem NUMÉRICA (43,3,16); ordem REAL (lang ANTES de turns; studyMode/studyLens
    // undefined DEPOIS de turns e ANTES do provider). A âncora é montada pelo core, do store.
    const firstTurns: ChatTurn[] = [
      { role: ChatRole.User, content: 'What is the main message of this verse?' },
    ];
    const first = await askSessionAnchored(
      dbPath,
      'kjv',
      BOOK,
      CHAPTER,
      VERSE,
      'en',
      firstTurns,
      undefined,
      undefined,
      PROVIDER,
      undefined,
      undefined,
    );

    // 2º turno (FOLLOW-UP): reenvia o histórico User→Assistant→User com o MESMO
    // book/chapter/verse (âncora preservada). O `interpretation` do 1º turno vira o turno
    // do assistente; o app acrescenta o novo follow-up do usuário.
    const followTurns: ChatTurn[] = [
      ...firstTurns,
      { role: ChatRole.Assistant, content: first.interpretation },
      { role: ChatRole.User, content: 'Can you say more about that?' },
    ];
    const second = await askSessionAnchored(
      dbPath,
      'kjv',
      BOOK,
      CHAPTER,
      VERSE,
      'en',
      followTurns,
      undefined,
      undefined,
      PROVIDER,
      undefined,
      undefined,
    );

    // `turns` = tamanho do HISTÓRICO ENVIADO no follow-up (o AiAnswer não tem esse campo).
    emit(
      `${MARK} ref=${JSON.stringify(SOURCE)} provider=${JSON.stringify(second.provider)} turns=${followTurns.length} cited_prefix=${JSON.stringify(citedPrefix(second.citedText))} interp_len=${second.interpretation.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }
}
