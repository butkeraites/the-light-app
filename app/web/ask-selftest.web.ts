// app/web/ask-selftest.web.ts — F2.5 (ADR-0014)
//
// STUB web do self-test de ESTUDO ASSISTIDO (ask/streaming). A IA no web é a F2.7;
// aqui apenas emitimos um marcador de SKIP (sem tocar `expo-file-system`/o banco nem a
// camada `ai`), mantendo `tsc`/Metro web verdes. O par nativo (`ask-selftest.ts`) faz
// a prova real no device (TLA_ASK, provider="mock", streaming).
const MARK = 'TLA_ASK';

export async function runAskSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (IA = F2.7)`);
}
