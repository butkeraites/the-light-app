// app/web/compare-selftest.web.ts — F3.7 (molde chat-selftest.web.ts F3.6)
//
// STUB web do self-test de COMPARAÇÃO MULTI-IA ANCORADA. A comparação no web é a F3.12;
// aqui apenas emitimos um marcador de SKIP (sem tocar `expo-file-system`/o banco nem a
// camada `ai`/store), mantendo `tsc`/Metro web verdes. O par nativo
// (`compare-selftest.ts`) faz a prova real no device (TLA_COMPARE, provider="mock", 2
// colunas independentes sobre a mesma âncora — wiring de N provedores).
const MARK = 'TLA_COMPARE';

export async function runCompareSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (comparação = F3.12)`);
}
