// app/web/search-selftest.web.ts — F1.6 (ADR-0014)
//
// STUB web do self-test de BUSCA. A busca no web (FTS5 sobre wa-sqlite/OPFS) é a
// F1.14 (pós-gate F1.12); aqui apenas emitimos um marcador de SKIP (sem tocar
// `expo-file-system`/o banco bundled), mantendo `tsc`/Metro web verdes. O par
// nativo (`search-selftest.ts`) faz a prova real no device (TLA_SEARCH).
const MARK = 'TLA_SEARCH';

export async function runSearchSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (busca = F1.14)`);
}
