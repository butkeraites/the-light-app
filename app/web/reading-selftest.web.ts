// app/web/reading-selftest.web.ts — F1.3 (ADR-0014)
//
// STUB web do self-test de leitura. A leitura no web é a F1.13; aqui apenas
// emitimos um marcador de SKIP (sem tocar `expo-file-system`/o banco bundled), o
// que mantém `tsc`/Metro web verdes. O self-test de PARSE (PT/EN) segue valendo
// nos dois alvos via `selftest.ts` (sem regressão F0.x).
const MARK = 'TLA_READ';

export async function runReadingSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (leitura = F1.13)`);
}
