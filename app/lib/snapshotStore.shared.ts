// app/lib/snapshotStore.shared.ts — F5.26 (ADR-0054, sobre F5.23/ADR-0051 e ADR-0036)
//
// ADAPTADOR PURO que liga a interface injetável `SnapshotStore` da F5.23
// (`userdataSnapshot.ts`) ao STORE REAL do usuário (notas + marcações + progresso de
// plano). É a peça que faltava para o export/import da F5.23/F5.25 rodar de ponta a
// ponta contra os dados REAIS: os dois alvos (nativo via JSI/fs, web via OPFS)
// injetam suas fns de fronteira já ligadas ao `dataDir` e este módulo devolve o
// `SnapshotStore` que o motor consome.
//
// PURO / INJEÇÃO DE DEPENDÊNCIAS (molde `planReminders.shared.ts` / `driveAuth.ts`):
// nada de I/O, glue nativo, wasm ou rede embutidos. `snapshotStore.ts` (nativo) e
// `snapshotStore.web.ts` (web) ligam as fns de PRODUÇÃO; a prova headless injeta as
// MESMAS fns `*Fs`/`*PlanFs` da F5.23 sobre um `UserDataDir` em memória. Assim o
// adaptador é exercitado SEM device e sem drift.
//
// ANTI-ALUCINAÇÃO (LEI): a `reference` canônica é formatada pelo CORE (o mesmo
// `format_reference(_, En)` que a F5.23/F1.16 usam — espelhado aqui em
// `formatReferenceEnPure`, casado com o nome EN do livro do CORE via `bookNameEn`) e
// TODA referência importada é validada como REAL pelo CORE (`assertValidReference` →
// `parse_reference`) ANTES de tocar o store. O snapshot carrega SÓ a referência (nunca
// texto bíblico), o corpo/cor/tag do usuário e o progresso de plano. Nada é logado.
import type { SnapshotStore } from './userdataSnapshot';
import type { Note, Highlight, ReadingPlanProgress } from '../web/reading';

/** `Reference` estruturada, derivada do Record (molde `userdataSnapshot.ts`). */
type Reference = Note['reference'];

/**
 * Espelho PURO de `reference::format_reference(reference, Lang::En)` (rev pinado do
 * core; IDÊNTICO a `userdata-fs.web.ts::formatReferenceEn`, verificado por drift na
 * prova headless). Produz a STRING canônica EN usada como CHAVE no snapshot:
 *   - Single(v)    → `"{nameEn} {chapter}:{v}"`
 *   - Range{a,b}   → `"{nameEn} {chapter}:{a}-{b}"`
 *   - WholeChapter → `"{nameEn} {chapter}"`
 * `nameEn` vem SEMPRE do core (`listBooks().nameEn`), nunca inventado em TS.
 */
export function formatReferenceEnPure(reference: Reference, nameEn: string): string {
  const { chapter, verses } = reference;
  switch (verses.tag) {
    case 'Single':
      return `${nameEn} ${chapter}:${verses.inner.verse}`;
    case 'Range':
      return `${nameEn} ${chapter}:${verses.inner.start}-${verses.inner.end}`;
    default:
      // WholeChapter
      return `${nameEn} ${chapter}`;
  }
}

/**
 * Dependências de BAIXO NÍVEL do adaptador, INJETADAS pelo alvo (todas já ligadas ao
 * `dataDir` do usuário). São exatamente as fns de fronteira reais de userdata/planos +
 * o resolvedor de nome de livro e o validador de referência do CORE.
 */
export interface SnapshotStoreDeps {
  /** Nome EN do livro (de `listBooks().nameEn` — CORE) p/ formatar a referência. */
  bookNameEn(book: number): string;
  /** Valida que a string é uma referência REAL/canônica (CORE `parse_reference`); lança se não. */
  assertValidReference(reference: string): void;
  listNotes(): Promise<Note[]>;
  listHighlights(): Promise<Highlight[]>;
  readingPlanProgress(): Promise<ReadingPlanProgress | undefined>;
  putNote(reference: string, body: string): Promise<void>;
  addHighlight(reference: string, color: string, tag?: string): Promise<void>;
  startReadingPlan(planId: string, startDate: string): Promise<void>;
  setReadingPlanCompleted(completed: number): Promise<void>;
}

/**
 * Constrói o `SnapshotStore` (interface da F5.23) sobre as fns de fronteira REAIS
 * injetadas. `formatReference` casa o nome EN do livro (CORE) com o espelho puro;
 * `assertValidReference` delega ao validador do CORE; o resto encaminha 1:1. Este é o
 * store que `exportSnapshot`/`importSnapshotIntoStore` (F5.23) e `pushSnapshot`/
 * `pullSnapshot` (F5.25) consomem.
 */
export function createSnapshotStore(deps: SnapshotStoreDeps): SnapshotStore {
  return {
    formatReference: (reference) => formatReferenceEnPure(reference, deps.bookNameEn(reference.book)),
    assertValidReference: (reference) => deps.assertValidReference(reference),
    listNotes: () => deps.listNotes(),
    listHighlights: () => deps.listHighlights(),
    readingPlanProgress: () => deps.readingPlanProgress(),
    putNote: (reference, body) => deps.putNote(reference, body),
    addHighlight: (reference, color, tag) => deps.addHighlight(reference, color, tag),
    startReadingPlan: (planId, startDate) => deps.startReadingPlan(planId, startDate),
    setReadingPlanCompleted: (completed) => deps.setReadingPlanCompleted(completed),
  };
}
