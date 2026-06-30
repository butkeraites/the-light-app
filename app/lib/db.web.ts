// app/lib/db.web.ts — F1.3 (ADR-0014)
//
// STUB web do serviço de banco de leitura. A leitura nativa usa o the-light-core
// (rusqlite) sobre um arquivo copiado p/ um caminho gravável (db.ts). No web, a
// leitura do store é a F1.13 (wa-sqlite/OPFS) — não construída aqui. Este stub
// mantém `tsc`/Metro web verdes E evita arrastar `expo-file-system` + o asset
// (~1.8 MB) do banco para o bundle web (o Metro escolhe este `.web.ts` no web).
export async function ensureReadingDb(): Promise<string> {
  throw new Error('Banco de leitura nativo indisponível no web (leitura web = F1.13).');
}
