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
//   TLA_READ     (F1.3) — 66 livros, João 3:16 KJV verbatim, chapter_count(kjv,43).
//   TLA_PARALLEL (F1.4) — João 3:16 em DUAS traduções (kjv E alm1911), AMBAS
//                lidas via `get_chapter` (2 chamadas) — prova a leitura paralela
//                no device. Os textos vêm do retorno do store, NUNCA hardcoded.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `reading-selftest.web.ts` (stub — leitura web = F1.13), o que mantém o
// `expo-file-system` e o asset do banco FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { listBooks, getChapter, chapterCount, type Passage } from './reading';

// Marcadores grep-áveis (prefixo estável "TLA_"). console.error garante nível
// alto no log; console.log o complementa.
const MARK = 'TLA_READ';
const PARALLEL = 'TLA_PARALLEL';

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
 * Prova de leitura. Emite (ambos do RETORNO de `get_chapter`, não hardcoded):
 *   TLA_READ books=66 john3_v16="For God so loved..." john_chapters=21
 *   TLA_PARALLEL kjv_john3_16="For God so loved..." alm_john3_16="Porque Deus amou..."
 */
export async function runReadingSelfTest(): Promise<void> {
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
