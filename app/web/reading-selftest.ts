// app/web/reading-selftest.ts — F1.3 (ADR-0014)
//
// Self-test HEADLESS de LEITURA no NATIVO (molde F0.7). Disparado SÓ sob
// `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts): copia/abre o banco bundled
// (db.ts) e exercita a leitura REAL pela fronteira nativa (reading.ts → JSI →
// the-light-core), emitindo um marcador estável COMPOSTO DO RETORNO REAL do Rust
// — sem hardcode do texto bíblico (anti-alucinação: o `john3_v16` provém do
// retorno de `get_chapter`). Capturado por `simctl log` (iOS) / `adb logcat`.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `reading-selftest.web.ts` (stub — leitura web = F1.13), o que mantém o
// `expo-file-system` e o asset do banco FORA do bundle web.
import { ensureReadingDb } from '../lib/db';
import { listBooks, getChapter, chapterCount } from './reading';

// Marcador grep-ável (prefixo estável). console.error garante nível alto no log.
const MARK = 'TLA_READ';

/**
 * Prova de leitura: 66 livros (puro), João 3:16 KJV verbatim (store) e
 * `chapter_count(kjv,43)` (DB-backed). Emite:
 *   TLA_READ books=66 john3_v16="For God so loved..." john_chapters=21
 */
export async function runReadingSelfTest(): Promise<void> {
  try {
    const dbPath = await ensureReadingDb();
    const books = listBooks(); // PURO: cânon de 66 (independe do banco)
    const john3 = await getChapter(dbPath, 'kjv', 43, 3); // texto do store
    const johnChapters = await chapterCount(dbPath, 'kjv', 43); // DB-backed

    // O texto vem do RETORNO de get_chapter (não hardcoded). JSON.stringify gera
    // aspas → casa o formato `john3_v16="..."`.
    const v16 = john3.verses.find((v) => {
      const r = v.reference.verses;
      return r.tag === 'Single' && r.inner.verse === 16;
    });
    const text = v16 ? v16.text : '';

    const line = `${MARK} books=${books.length} john3_v16=${JSON.stringify(text)} john_chapters=${johnChapters}`;
    console.log(line);
    console.error(line);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = `${MARK} ERROR ${msg}`;
    console.log(line);
    console.error(line);
  }
}
