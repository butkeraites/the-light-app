// app/lib/userdata.web.ts — F1.11 (ADR-0017)
//
// STUB web do serviço de userdata. As notas/highlights nativas usam o
// the-light-core (via a fronteira `userdata`) sobre um diretório gravável
// (userdata.ts). No web, o userdata é a F1.16 (wa-sqlite/OPFS, pós-gate F1.12) —
// não construído aqui. Este stub mantém `tsc`/Metro web verdes E evita arrastar
// `expo-file-system` para o bundle web (o Metro escolhe este `.web.ts` no web).
export async function ensureUserDataDir(): Promise<string> {
  throw new Error('userdata nativo indisponível no web (notas/highlights web = F1.16).');
}
