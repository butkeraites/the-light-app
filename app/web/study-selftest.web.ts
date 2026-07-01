// app/web/study-selftest.web.ts — F3.5 (ADR-0027)
//
// STUB web do self-test de ESTUDO PROFUNDO + LÉXICO. O estudo/léxico no web é a F3.12;
// aqui apenas emitimos um marcador de SKIP (sem tocar `expo-file-system`/o banco nem a
// camada `ai`/store), mantendo `tsc`/Metro web verdes. O par nativo (`study-selftest.ts`)
// faz a prova real no device (TLA_STUDY, provider="mock", léxico + atribuição STEP CC-BY).
const MARK = 'TLA_STUDY';

export async function runStudySelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (estudo/léxico = F3.12)`);
}
