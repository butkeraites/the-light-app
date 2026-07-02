// app/web/chat-selftest.web.ts — F3.6 (ADR-0027)
//
// STUB web do self-test de CONVERSA/FOLLOW-UP ANCORADO. A conversa no web é a F3.12;
// aqui apenas emitimos um marcador de SKIP (sem tocar `expo-file-system`/o banco nem a
// camada `ai`/store), mantendo `tsc`/Metro web verdes. O par nativo (`chat-selftest.ts`)
// faz a prova real no device (TLA_CHAT, provider="mock", conversa multi-turno ancorada).
const MARK = 'TLA_CHAT';

export async function runChatSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (conversa = F3.12)`);
}
