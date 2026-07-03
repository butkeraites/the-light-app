// app/web/plans-selftest.web.ts — F5.7 (ADR-0039)
//
// STUB web do self-test de PLANOS DE LEITURA. O módulo `userdata::plans` (geração +
// progresso) é nativo-only (`#[cfg(feature="embedded")]`) e NÃO entra no wasm — a
// paridade web REAL (F5.10) exige a PR `ai-pure` de planos ao core (gate à parte).
// Aqui apenas emitimos um marcador de SKIP (sem tocar `expo-file-system`/a fronteira
// de planos), mantendo `tsc`/Metro web verdes. O par nativo (`plans-selftest.ts`) faz
// a prova real no device (TLA_PLANS).
const MARK = 'TLA_PLANS';

export async function runPlansSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (planos = F5.10)`);
}
