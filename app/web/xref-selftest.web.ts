// app/web/xref-selftest.web.ts — F1.9 (ADR-0014)
//
// STUB web do self-test de XREF. A xref no web (cross_refs sobre wa-sqlite/OPFS) é a
// F1.15 (pós-gate F1.12); aqui apenas emitimos um marcador de SKIP (sem tocar
// `expo-file-system`/o banco bundled), mantendo `tsc`/Metro web verdes. O par nativo
// (`xref-selftest.ts`) faz a prova real no device (TLA_XREF).
const MARK = 'TLA_XREF';

export async function runXrefSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (xref = F1.15)`);
}
