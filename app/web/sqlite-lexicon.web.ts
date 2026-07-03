// app/web/sqlite-lexicon.web.ts — F3.12a (ADR-0031; par de sqlite-xref.web.ts)
//
// GLUE web do STORE de LÉXICO VERIFICADO (hand-written, VERSIONADO). Camada de
// INFRAESTRUTURA que roda a consulta de léxico sobre um `wa-sqlite` aberto no
// `lexicon-sample.sqlite` (F5.15/ADR-0044: o DADO do léxico, ~9 MB, carregado ON-DEMAND
// e SEPARADO do subset de leitura — antes era o combinado `reading-sample.sqlite`, F1.13/
// F3.5). O arquivo propaga `original_tokens`/`lexicon`/`scholarly_sources`
// desde a F3.5/ADR-0027 (João 3:16: 26 tokens Strong; STEP CC-BY) — ESPELHANDO o
// retrieval do core (`the_light_core::ai::lexicon::verified_lexicon`, rev pinado
// 04b9b24), que é `embedded`-only (rusqlite) e NÃO entra no wasm:
//   - SELECT `original_tokens` + LEFT JOIN `lexicon` (COALESCE da glosa) por
//     book/chapter[/verse];
//   - agregação por Strong BASE (remove letras de desambiguação à direita:
//     "H7225G"→"H7225"), contando ocorrências, "primeiro não-nulo vence" p/
//     lemma/translit/gloss/testament (na ordem das linhas, como o core);
//   - ordenação por ocorrências DESC (desempate estável por Strong ASC), truncada ao
//     `limit`;
//   - atribuições (STEP CC-BY) via `scholarly_sources.attribution` por `source_id`
//     usado (ordem por `source_id` ASC, deduplicada — espelha o `BTreeSet` do core).
//
// ADR-0011 (precedente passage/xref/search web): SELECT + shaping É infra TS
// sancionada; o que NUNCA vira TS é prompt/verify/citação/aparato do estudo (isso vem
// do Rust `ai-pure`, ADR-0029/ADR-0031). Anti-alucinação: glosas/lemas/Strong são
// VERBATIM do store local (STEP Bible / TBESH–TBESG, CC-BY), nunca gerados por LLM.
//
// VFS-agnóstica (par exato de `sqlite-xref.web.ts`): OPFS no browser
// (`openLexiconDbWeb`, ON-DEMAND — só ao abrir estudo/léxico); a prova headless em node
// usa um VFS de memória sobre os bytes de `assets/data/lexicon-sample.sqlite`.
import * as SQLite from 'wa-sqlite';

import type { LexEntry, VerifiedLexiconOut } from './generated/the_light_app_core';
import type { ReadingDb } from './sqlite-reading.web';

/** Limite padrão de entradas (espelha `DEFAULT_LEXICON_LIMIT = 32` do core). */
export const DEFAULT_LEXICON_LIMIT = 32;

/**
 * SELECT espelhado de `ai::lexicon::verified_lexicon`/`collect` (lexicon.rs, rev
 * 04b9b24):
 *   "SELECT t.strongs, t.lemma, t.translit, t.testament,
 *           COALESCE(l.gloss_pt, l.gloss, t.gloss) AS gloss, t.source_id, l.source_id
 *    FROM original_tokens t
 *    LEFT JOIN lexicon l ON l.strongs = t.strongs
 *    WHERE t.book_number = ?1 AND t.chapter = ?2
 *    AND t.strongs IS NOT NULL AND t.strongs <> ''"
 * (+ "AND t.verse = ?3" quando há versículo). É a ÚNICA SQL de léxico no web — infra,
 * não domínio. NENHUM ORDER BY: a ordem das linhas é a do SQLite (rowid), como no core
 * (o "primeiro não-nulo vence" da agregação depende dessa ordem).
 */
const LEXICON_SELECT_BASE =
  'SELECT t.strongs, t.lemma, t.translit, t.testament, ' +
  'COALESCE(l.gloss_pt, l.gloss, t.gloss) AS gloss, t.source_id, l.source_id ' +
  'FROM original_tokens t ' +
  'LEFT JOIN lexicon l ON l.strongs = t.strongs ' +
  "WHERE t.book_number = ? AND t.chapter = ? AND t.strongs IS NOT NULL AND t.strongs <> ''";

/**
 * SELECT espelhado de `attributions_for` (lexicon.rs): a atribuição verbatim (CC-BY)
 * de um `source_id` usado. `scholarly_sources.attribution` é a string exigida (STEP).
 */
const ATTRIBUTION_SELECT = 'SELECT attribution FROM scholarly_sources WHERE id = ?';

/** Uma linha bruta do SELECT de léxico (apenas infra; o domínio é agregado adiante). */
interface TokenRow {
  strongs: string;
  lemma?: string;
  translit?: string;
  testament: string;
  gloss?: string;
  tokenSource?: string;
  lexSource?: string;
}

/** Agregador por Strong base (espelha `Agg` do core). */
interface Agg {
  lemma?: string;
  translit?: string;
  gloss?: string;
  testament: string;
  occ: number;
}

/**
 * Strong BASE: remove as letras de desambiguação à DIREITA — espelha `base_strong`
 * do core (`s.trim().trim_end_matches(|c| c.is_ascii_alphabetic())`). Ex.: "H7225G"
 * → "H7225"; "G2316" → "G2316" (termina em dígito, nada a remover).
 */
export function baseStrong(s: string): string {
  return s.trim().replace(/[A-Za-z]+$/, '');
}

/** Lê a coluna de texto opcional (`column_text` devolve "" p/ NULL → normaliza a undefined). */
function textOrUndef(sqlite3: ReadingDb['sqlite3'], stmt: number, i: number): string | undefined {
  const t = sqlite3.column_text(stmt, i);
  return t == null || t.length === 0 ? undefined : t;
}

/**
 * Resolve os versículos abrangidos por uma referência numérica (espelha
 * `resolve_verses` do core): versículo único → `[v]`; capítulo inteiro (`verse`
 * ausente) → `undefined` (sem filtro de versículo).
 */
function resolveVerses(verse: number | undefined): number[] | undefined {
  return verse == null ? undefined : [verse];
}

/**
 * Roda o SELECT de léxico (uma vez por versículo, ou uma vez sem filtro p/ o capítulo
 * inteiro) e agrega os tokens por Strong base — ESPELHANDO `verified_lexicon`/`collect`
 * do core. ISOLADA do VFS (browser OPFS / prova node em memória). NENHUMA lógica de
 * anti-alucinação aqui: só o SELECT + a agregação (infra, ADR-0011).
 */
export async function queryVerifiedLexicon(
  handle: ReadingDb,
  book: number,
  chapter: number,
  verse: number | undefined,
  limit: number = DEFAULT_LEXICON_LIMIT,
): Promise<VerifiedLexiconOut> {
  const { sqlite3, db } = handle;
  // Map preserva a ordem de INSERÇÃO; a ordenação final é por ocorrências (o core usa
  // BTreeMap só p/ estabilidade — a ordem só afeta o tie-break, resolvido no sort).
  const byBase = new Map<string, Agg>();
  const sourceIds = new Set<string>();

  const collectRow = (row: TokenRow): void => {
    const key = baseStrong(row.strongs);
    const agg = byBase.get(key) ?? { testament: '', occ: 0 };
    agg.occ += 1;
    if (agg.lemma == null) agg.lemma = row.lemma;
    if (agg.translit == null) agg.translit = row.translit;
    if (agg.gloss == null) agg.gloss = row.gloss;
    if (agg.testament.length === 0) agg.testament = row.testament;
    byBase.set(key, agg);
    if (row.tokenSource != null) sourceIds.add(row.tokenSource);
    if (row.lexSource != null) sourceIds.add(row.lexSource);
  };

  const runFor = async (v: number | undefined): Promise<void> => {
    const sql = v == null ? LEXICON_SELECT_BASE : `${LEXICON_SELECT_BASE} AND t.verse = ?`;
    for await (const stmt of sqlite3.statements(db, sql)) {
      let i = 1;
      sqlite3.bind(stmt, i++, book);
      sqlite3.bind(stmt, i++, chapter);
      if (v != null) sqlite3.bind(stmt, i++, v);
      while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
        collectRow({
          strongs: sqlite3.column_text(stmt, 0),
          lemma: textOrUndef(sqlite3, stmt, 1),
          translit: textOrUndef(sqlite3, stmt, 2),
          testament: sqlite3.column_text(stmt, 3),
          gloss: textOrUndef(sqlite3, stmt, 4),
          tokenSource: textOrUndef(sqlite3, stmt, 5),
          lexSource: textOrUndef(sqlite3, stmt, 6),
        });
      }
    }
  };

  const verses = resolveVerses(verse);
  if (verses == null) {
    await runFor(undefined);
  } else {
    for (const v of verses) {
      await runFor(v);
    }
  }

  // Ordena por ocorrências DESC; desempate estável por Strong ASC (espelha o core).
  const entries: LexEntry[] = Array.from(byBase.entries())
    .map(([strongs, a]) => ({
      strongs,
      lemma: a.lemma,
      translit: a.translit,
      gloss: a.gloss,
      occurrences: a.occ,
      testament: a.testament,
    }))
    .sort((x, y) => y.occurrences - x.occurrences || (x.strongs < y.strongs ? -1 : x.strongs > y.strongs ? 1 : 0))
    .slice(0, Math.max(0, Math.trunc(limit)));

  // Atribuições (STEP CC-BY) dos `source_id` usados, ordenadas por id ASC (espelha o
  // `BTreeSet` do core) e deduplicadas preservando a ordem.
  const sources = await queryAttributions(handle, Array.from(sourceIds).sort());
  return { entries, sources };
}

/**
 * Busca as atribuições (verbatim) das fontes usadas — espelha `attributions_for` do
 * core (`SELECT attribution FROM scholarly_sources WHERE id = ?`, dedup preservando a
 * ordem). `ids` deve chegar já ordenado (BTreeSet do core = ordem ASC).
 */
export async function queryAttributions(handle: ReadingDb, ids: string[]): Promise<string[]> {
  const { sqlite3, db } = handle;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for await (const stmt of sqlite3.statements(db, ATTRIBUTION_SELECT)) {
      sqlite3.bind(stmt, 1, id);
      while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
        const attr = sqlite3.column_text(stmt, 0);
        if (attr != null && attr.length > 0 && !seen.has(attr)) {
          seen.add(attr);
          out.push(attr);
        }
      }
    }
  }
  return out;
}
