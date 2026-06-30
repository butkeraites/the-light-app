// app/lib/userdata.web.ts — F1.11 (ADR-0017) · F1.16 (ADR-0022)
//
// SENTINELA web do serviço de userdata. As notas/highlights NATIVAS usam o
// the-light-core (via a fronteira `userdata`) sobre um diretório gravável
// (userdata.ts). No WEB, o userdata é a F1.16 (I/O em TS sobre OPFS, ESPELHANDO o
// formato do core — `reading.web.ts` + `userdata-opfs.web.ts`): o store web abre o
// OPFS internamente, então a UI compartilhada só precisa de um VALOR não-nulo para
// `dataDir` (molde `db.web.ts::ensureReadingDb` → `'web:reading-sample'`).
//
// Este sentinela mantém `tsc`/Metro web verdes E evita arrastar `expo-file-system`
// para o bundle web (o Metro escolhe este `.web.ts` no web). O `dataDir` é IGNORADO
// pelas 7 funções de `reading.web.ts` (paridade de assinatura com o nativo).
export async function ensureUserDataDir(): Promise<string> {
  return 'web:userdata';
}
