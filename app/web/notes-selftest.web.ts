// app/web/notes-selftest.web.ts — F1.11 (ADR-0017)
//
// STUB web do self-test de NOTAS/HIGHLIGHTS. As notas/highlights no web (userdata
// sobre wa-sqlite/OPFS) são a F1.16 (pós-gate F1.12); aqui apenas emitimos um
// marcador de SKIP (sem tocar `expo-file-system`/userdata), mantendo `tsc`/Metro web
// verdes. O par nativo (`notes-selftest.ts`) faz a prova real no device (TLA_NOTES).
const MARK = 'TLA_NOTES';

export async function runNotesSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (notas/highlights = F1.16)`);
}
