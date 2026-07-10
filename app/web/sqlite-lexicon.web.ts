// app/web/sqlite-lexicon.web.ts — F3.12a (ADR-0031; par de sqlite-xref.web.ts)
//
// GLUE web do STORE de LÉXICO VERIFICADO (hand-written, VERSIONADO). Camada de
// INFRAESTRUTURA que EXECUTA os planos de léxico do core sobre um `wa-sqlite` aberto no
// `lexicon-sample.sqlite` (F5.15/ADR-0044: o DADO do léxico, ~9 MB, carregado ON-DEMAND
// e SEPARADO do subset de leitura). O arquivo propaga `original_tokens`/`lexicon`/
// `scholarly_sources` desde a F3.5/ADR-0027 (João 3:16: 26 tokens Strong; STEP CC-BY).
//
// ADR-0062 (fatia LEXICON — última fatia SQL): o SELECT e os params NÃO são mais
// espelhados aqui — vêm da FRONTEIRA do core (`lexiconCollectQuery`/`interlinearQuery`/
// `attributionsQuery`, planos `the_light_core::query`), executados via `bindPlanParams`
// (posicional). O que PERMANECE em TS é só o SHAPER (não é SQL): a agregação por Strong
// BASE — "primeiro não-nulo vence" (na ordem das linhas, como o core), ocorrências,
// ordenação por ocorrências DESC (desempate estável por Strong ASC) e o corte no `limit`;
// a chave de agregação (`baseStrong`) também vem do core. Assim há UMA fonte da verdade
// (SQL/params/base_strong no Rust); o web só EXECUTA e AGREGA.
//
// ADR-0011 (precedente passage/xref/search web): executar plano + shaping É infra TS
// sancionada; o que NUNCA vira TS é prompt/verify/citação/aparato do estudo (isso vem
// do Rust `ai-pure`, ADR-0029/ADR-0031). Anti-alucinação: glosas/lemas/Strong são
// VERBATIM do store local (STEP Bible / TBESH–TBESG, CC-BY), nunca gerados por LLM.
//
// VFS-agnóstica (par exato de `sqlite-xref.web.ts`): OPFS no browser
// (`openLexiconDbWeb`, ON-DEMAND — só ao abrir estudo/léxico); a prova headless em node
// usa um VFS de memória sobre os bytes de `assets/data/lexicon-sample.sqlite`.
import * as SQLite from 'wa-sqlite';

import {
  attributionsQuery,
  baseStrong,
  interlinearQuery,
  lexiconCollectQuery,
  type InterlinearTokenOut,
  type InterlinearVerseOut,
  type LexEntry,
  type VerifiedLexiconOut,
} from './generated/the_light_app_core';
import { bindPlanParams, type ReadingDb } from './sqlite-reading.web';

/** Limite padrão de entradas (espelha `DEFAULT_LEXICON_LIMIT = 32` do core). App-owned. */
export const DEFAULT_LEXICON_LIMIT = 32;

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

/** Lê a coluna de texto opcional (`column_text` devolve "" p/ NULL → normaliza a undefined). */
function textOrUndef(sqlite3: ReadingDb['sqlite3'], stmt: number, i: number): string | undefined {
  const t = sqlite3.column_text(stmt, i);
  return t == null || t.length === 0 ? undefined : t;
}

/**
 * Roda o plano de léxico (`lexiconCollectQuery` do core — uma passagem: um versículo, ou o
 * capítulo inteiro quando `verse` é ausente, decidido PELO PLANO) e agrega os tokens por
 * Strong base — ESPELHANDO `verified_lexicon`/`collect` do core. ISOLADA do VFS (browser
 * OPFS / prova node em memória). NENHUMA lógica de anti-alucinação aqui: só a execução do
 * plano + a agregação (infra, ADR-0011/ADR-0062). A chave de agregação vem do core
 * (`baseStrong`).
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

  // Plano do core: SELECT + params (com o filtro de versículo quando `verse` está presente;
  // ausente = capítulo inteiro). O web só EXECUTA — sem SQL/params re-derivados (ADR-0062).
  const { sql, params } = lexiconCollectQuery(book, chapter, verse);
  for await (const stmt of sqlite3.statements(db, sql)) {
    bindPlanParams(sqlite3, stmt, params);
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
 * Busca as atribuições (verbatim) das fontes usadas — EXECUTA o plano `attributionsQuery`
 * do core (`SELECT attribution FROM scholarly_sources WHERE id = ?1`) por `id` e deduplica
 * preservando a ordem (espelha `attributions_for`). `ids` deve chegar já ordenado (BTreeSet
 * do core = ordem ASC).
 */
export async function queryAttributions(handle: ReadingDb, ids: string[]): Promise<string[]> {
  const { sqlite3, db } = handle;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const { sql, params } = attributionsQuery(id);
    for await (const stmt of sqlite3.statements(db, sql)) {
      bindPlanParams(sqlite3, stmt, params);
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

/**
 * Roda o plano INTERLINEAR do core (`interlinearQuery` — um versículo, `ORDER BY word_index`)
 * e devolve os tokens na ordem de leitura + as atribuições CC-BY — ESPELHANDO
 * `interlinear_tokens` do core. SEM agregação (uma linha por palavra). ISOLADA do VFS (OPFS no
 * browser / memória na prova node). Anti-alucinação: campos verbatim do store.
 */
export async function queryInterlinearVerse(
  handle: ReadingDb,
  book: number,
  chapter: number,
  verse: number,
): Promise<InterlinearVerseOut> {
  const { sqlite3, db } = handle;
  const tokens: InterlinearTokenOut[] = [];
  const sourceIds = new Set<string>();
  const { sql, params } = interlinearQuery(book, chapter, verse);
  for await (const stmt of sqlite3.statements(db, sql)) {
    bindPlanParams(sqlite3, stmt, params);
    while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
      const src = textOrUndef(sqlite3, stmt, 8);
      if (src != null) sourceIds.add(src);
      tokens.push({
        surface: sqlite3.column_text(stmt, 0),
        translit: textOrUndef(sqlite3, stmt, 1),
        lemma: textOrUndef(sqlite3, stmt, 2),
        strongs: textOrUndef(sqlite3, stmt, 3),
        morphCode: textOrUndef(sqlite3, stmt, 4),
        gloss: textOrUndef(sqlite3, stmt, 5),
        wordIndex: sqlite3.column_int(stmt, 6),
        testament: sqlite3.column_text(stmt, 7),
      });
    }
  }
  const sources = await queryAttributions(handle, Array.from(sourceIds).sort());
  return { tokens, sources };
}
