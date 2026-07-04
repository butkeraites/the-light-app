// app/web/reading-selftest.ts — F1.3 · leitura paralela F1.4 (ADR-0015)
//
// Self-test HEADLESS de LEITURA no NATIVO (molde F0.7). Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): copia/abre o banco bundled
// (db.ts) e exercita a leitura REAL pela fronteira nativa (reading.ts → JSI →
// the-light-core), emitindo marcadores estáveis COMPOSTOS DO RETORNO REAL do Rust
// — sem hardcode do texto bíblico (anti-alucinação). Capturado por `simctl log`
// (iOS) / `adb logcat`.
//
// Marcadores:
//   TLA_DBUP     (F6.4) — GUARD DE UPGRADE: pré-semeia um DB stale + sidecar de versão
//                velho (simula um device que atualizou o app mas guardou a cópia ANTIGA)
//                e prova que `ensureReadingDb` RE-COPIA o asset novo — Mateus (livro 40, o
//                livro-sintoma "Mateus 404 p/ quem atualiza") passa a ser consultável.
//   TLA_READ     (F1.3) — 66 livros, João 3:16 KJV verbatim, chapter_count(kjv,43).
//   TLA_PARALLEL (F1.4) — João 3:16 em DUAS traduções (kjv E alm1911), AMBAS
//                lidas via `get_chapter` (2 chamadas) — prova a leitura paralela
//                no device. Os textos vêm do retorno do store, NUNCA hardcoded.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `reading-selftest.web.ts` (stub — leitura web = F1.13), o que mantém o
// `expo-file-system` e o asset do banco FORA do bundle web.
import * as FileSystem from 'expo-file-system/legacy';
import { ensureReadingDb, __resetReadingDbCacheForTest } from '../lib/db';
import { listBooks, getChapter, chapterCount, type Passage } from './reading';

// Marcadores grep-áveis (prefixo estável "TLA_"). console.error garante nível
// alto no log; console.log o complementa.
const MARK = 'TLA_READ';
const PARALLEL = 'TLA_PARALLEL';
const DBUP = 'TLA_DBUP';

/** Texto do versículo 16 de um capítulo (do retorno do store; '' se ausente). */
function verse16Text(passage: Passage): string {
  const v = passage.verses.find((x) => {
    const r = x.reference.verses;
    return r.tag === 'Single' && r.inner.verse === 16;
  });
  return v ? v.text : '';
}

/** Emite uma linha nos dois canais (log + error) p/ robustez de captura. */
function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/**
 * Prova do GUARD DE STALENESS NO UPGRADE (F6.4). Simula o bug real: um device que
 * ATUALIZOU o app (DB novo, ex.: F5.36 → 66 livros) mas ainda tem a cópia ANTIGA no
 * documentDirectory. Passos:
 *   1) reseta a memoização + PRÉ-SEMEIA um DB STALE (bytes inválidos) e um sidecar de
 *      versão VELHO em `documentDirectory + reading-sample.sqlite(.version)`;
 *   2) chama `ensureReadingDb()` — o gate deve DETECTAR o mismatch (sidecar != hash do
 *      asset) e RE-COPIAR o asset empacotado (sobrescrevendo o stale);
 *   3) consulta Mateus (livro 40 — o "Mateus 404 p/ quem atualiza"): se o gate NÃO
 *      tivesse re-copiado, o DB stale (SQLite inválido) faria `get_chapter` LANÇAR e
 *      adopted não seria true. A contagem/tamanho vêm do RETORNO real (anti-alucinação).
 * Emite: TLA_DBUP adopted=<bool> matt1_verses=<N> matt1_v1_len=<M>.
 *
 * DEVE rodar ANTES do teste de leitura normal (o 1º `ensureReadingDb` da sessão), para
 * que a cópia RE-COPIADA fique memoizada e seja reusada pelas provas seguintes.
 */
async function runReadingDbUpgradeSelfTest(): Promise<void> {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    emit(`${DBUP} ERROR no-documentDirectory`);
    return;
  }
  const destUri = docDir + 'reading-sample.sqlite';
  const sidecarUri = destUri + '.version';
  try {
    __resetReadingDbCacheForTest();
    // Pré-semeia a cópia ANTIGA/inválida + a versão velha (o estado de quem atualizou).
    await FileSystem.writeAsStringAsync(destUri, 'STALE-READING-DB-FROM-OLD-APP-VERSION');
    await FileSystem.writeAsStringAsync(sidecarUri, 'tla-stale-version-0');

    // O gate deve RE-COPIAR o asset novo (mismatch de versão), não reusar o stale.
    const dbPath = await ensureReadingDb();

    // Mateus (livro 40) consultável ⇒ o DB novo foi ADOTADO.
    const matt1 = await getChapter(dbPath, 'kjv', 40, 1);
    const adopted = matt1.verses.length > 0;
    const v1Len = matt1.verses[0]?.text.length ?? 0;
    emit(`${DBUP} adopted=${adopted} matt1_verses=${matt1.verses.length} matt1_v1_len=${v1Len}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${DBUP} adopted=false ERROR ${msg}`);
  }
}

/**
 * Prova de leitura. Emite (ambos do RETORNO de `get_chapter`, não hardcoded):
 *   TLA_READ books=66 john3_v16="For God so loved..." john_chapters=21
 *   TLA_PARALLEL kjv_john3_16="For God so loved..." alm_john3_16="Porque Deus amou..."
 */
export async function runReadingSelfTest(): Promise<void> {
  // F6.4: prova do GUARD DE UPGRADE ANTES de tudo (pré-semeia um DB stale e verifica a
  // re-cópia). Roda 1º para memoizar a cópia atualizada p/ as provas de leitura abaixo.
  await runReadingDbUpgradeSelfTest();

  let dbPath: string;
  try {
    dbPath = await ensureReadingDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
    return;
  }

  // ── TLA_READ (F1.3) ────────────────────────────────────────────────────────
  try {
    const books = listBooks(); // PURO: cânon de 66 (independe do banco)
    const john3 = await getChapter(dbPath, 'kjv', 43, 3); // texto do store
    const johnChapters = await chapterCount(dbPath, 'kjv', 43); // DB-backed
    // JSON.stringify gera as aspas → casa o formato `john3_v16="..."`.
    emit(`${MARK} books=${books.length} john3_v16=${JSON.stringify(verse16Text(john3))} john_chapters=${johnChapters}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${MARK} ERROR ${msg}`);
  }

  // ── TLA_PARALLEL (F1.4) ──────────────────────────────────────────────────────
  // Lê o MESMO capítulo em DUAS traduções (uma chamada de get_chapter cada) — é a
  // base do lado a lado. Ambos os textos vêm do store (anti-alucinação).
  try {
    const kjv = await getChapter(dbPath, 'kjv', 43, 3);
    const alm = await getChapter(dbPath, 'alm1911', 43, 3);
    emit(`${PARALLEL} kjv_john3_16=${JSON.stringify(verse16Text(kjv))} alm_john3_16=${JSON.stringify(verse16Text(alm))}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(`${PARALLEL} ERROR ${msg}`);
  }
}
