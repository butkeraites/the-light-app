// app/web/export-selftest.web.ts — F3.8
//
// STUB web do self-test de EXPORTAÇÃO ACADÊMICA. O export/estudo no web é a F3.12; aqui
// apenas emitimos um marcador de SKIP (sem tocar `expo-file-system`/o banco nem a camada
// `ai`/store), mantendo `tsc`/Metro web verdes. O par nativo (`export-selftest.ts`) faz a
// prova real no device (TLA_EXPORT, provider="mock", Markdown SBL do core + sidecar).
const MARK = 'TLA_EXPORT';

export async function runExportSelfTest(): Promise<void> {
  console.log(`${MARK} SKIP web (export/estudo = F3.12)`);
}
