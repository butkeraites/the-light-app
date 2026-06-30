// app/lib/db.web.ts — F1.13 (ADR-0018/ADR-0019)
//
// Serviço web do banco de LEITURA. No nativo, `ensureReadingDb()` copia o subset
// para um caminho gravável e devolve esse caminho (db.ts). No web, o store é o
// `reading-sample.sqlite` aberto INTERNAMENTE pelo glue (`reading.web.ts` →
// `sqlite-reading-opfs.web.ts`, via wa-sqlite/OPFS); aqui devolvemos apenas um
// SENTINELA lógico para as telas (`app/app/read/**`) seguirem o mesmo contrato:
// chamar `ensureReadingDb()` e passar o valor às funções web (que ignoram o path e
// abrem o subset). NÃO arrasta `expo-file-system`/`expo-asset` nem o asset do banco
// para o bundle web (o Metro escolhe este `.web.ts` no web). Offline-first.
const WEB_READING_DB_SENTINEL = 'web:reading-sample';

export async function ensureReadingDb(): Promise<string> {
  return WEB_READING_DB_SENTINEL;
}
