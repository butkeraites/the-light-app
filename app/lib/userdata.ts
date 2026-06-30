// app/lib/userdata.ts — F1.11 (ADR-0017)
//
// Serviço do DIRETÓRIO DE USERDATA gravável no app NATIVO. As notas/highlights do
// usuário são persistidas pela fronteira `userdata` (F1.10) sob um `data_dir`
// gravável; este serviço garante esse diretório e devolve o caminho REAL.
//
// DISTINTO do banco de leitura (`app/lib/db.ts`): o `reading-sample.sqlite` é
// conteúdo público SÓ-LEITURA (copiado de um asset); o userdata é GRAVÁVEL, NÃO vem
// de asset, e é onde o core escreve `notes/<slug>.md` + `highlights.json`. Os dois
// caminhos são SEPARADOS — `ensureReadingDb()` (db.ts) vs `ensureUserDataDir()`.
//
// Offline-first: I/O 100% local no device (sem rede). Resolução por extensão do
// Metro: este `.ts` vale no NATIVO; no web vale `userdata.web.ts` (stub — notas web
// = F1.16), o que mantém o `expo-file-system` FORA do bundle web.
import * as FileSystem from 'expo-file-system/legacy';

// Subdiretório dedicado sob o documentDirectory do app. O core cria, sob este
// `data_dir`, `notes/` (1 `.md` por referência) e `highlights.json`.
const USERDATA_DIRNAME = 'userdata';

// Memoiza o caminho resolvido (a criação idempotente só ocorre uma vez por sessão).
let cachedPath: string | null = null;

/**
 * Garante o diretório de userdata GRAVÁVEL no device e devolve o caminho de
 * ARQUIVO (sem o esquema `file://`, que o `std::fs` do core espera).
 *
 * 1) compõe `${documentDirectory}userdata/`;
 * 2) cria o diretório se ausente (`makeDirectoryAsync`, `intermediates:true`,
 *    idempotente);
 * 3) retorna o caminho real p/ passar como `data_dir` às 7 funções da fronteira
 *    (`putNote`/`getNote`/`deleteNote`/`listNotes`/`addHighlight`/`removeHighlight`/
 *    `listHighlights`).
 *
 * NUNCA devolve o caminho do banco de leitura — userdata é um diretório SEPARADO.
 */
export async function ensureUserDataDir(): Promise<string> {
  if (cachedPath) {
    return cachedPath;
  }
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('FileSystem.documentDirectory indisponível neste alvo.');
  }
  const dirUri = `${docDir}${USERDATA_DIRNAME}/`;

  const info = await FileSystem.getInfoAsync(dirUri);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  }

  // O core (NoteStore/HighlightStore via std::fs) abre um CAMINHO de arquivo, não
  // uma URI `file://`.
  cachedPath = dirUri.replace(/^file:\/\//, '');
  return cachedPath;
}
