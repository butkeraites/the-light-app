// app/lib/userdataSnapshot.ts — F5.23 (ADR-0036 / ADR-0051)
//
// SNAPSHOT JSON round-trippável dos dados do PRÓPRIO usuário (notas + marcações +
// progresso de plano) — a FUNDAÇÃO da trilha de sync (ADR-0036). É o motor PURO
// (sem I/O, sem rede, sem `expo-file-system`, sem wasm/JSI direto) que:
//   1. MONTA o snapshot a partir dos RECORDS `Note`/`Highlight`/`ReadingPlanProgress`
//      (o que `list_notes`/`list_highlights`/`reading_plan_progress` já retornam) — NÃO
//      reimplementa a serialização do store (o core é dono do formato em disco);
//   2. faz o MERGE determinístico de um snapshot importado sobre o estado local; e
//   3. APLICA o merge via as fns de ESCRITA do core (injetadas em `SnapshotStore`),
//      nunca reescrevendo o store à mão.
//
// Molde: `notesExport.ts` (F1.11) — função pura sobre os Records + resolvers INJETADOS
// (`formatReference`), segura nos dois alvos. O Markdown da F1.11 é p/ leitura humana
// (Share); ESTE snapshot é máquina-legível e round-trippável (o payload que o Google
// Drive da F5.24–25 vai mover). O transporte (Share/file-picker/Drive) é a UI (F5.26).
//
// ANTI-ALUCINAÇÃO: o snapshot carrega SÓ os Records do usuário + a `reference` CANÔNICA
// (string produzida pelo core via o `formatReference` injetado; validada no import pelo
// `assertValidReference` do core). NENHUM texto bíblico (só a referência), NENHUMA
// sessão de IA, NENHUM banco, NENHUMA chave/token. Nada é logado aqui.
//
// PRIVACIDADE/ESCOPO: notas + marcações + progresso de plano — e MAIS NADA.
import type { Note, Highlight, ReadingPlanProgress } from '../web/reading';

/** `Reference` estruturada, derivada do Record (evita depender de um export extra). */
type Reference = Note['reference'];

// ── Formato do snapshot (versionado) ─────────────────────────────────────────
/** Discriminador de app — rejeita no import qualquer JSON que não seja nosso snapshot. */
export const SNAPSHOT_APP = 'the-light-app' as const;
/** Versão do ESQUEMA do snapshot (bump quando o formato mudar de forma incompatível). */
export const SNAPSHOT_VERSION = 1 as const;

/** Nota no snapshot: `reference` é a STRING canônica do core (não a estrutura interna). */
export interface SnapshotNote {
  reference: string;
  body: string;
}

/** Marcação no snapshot: `reference` canônica (string), cor e tag opcional. */
export interface SnapshotHighlight {
  reference: string;
  color: string;
  tag?: string;
}

/** Progresso de plano no snapshot (espelha o Record de fronteira `ReadingPlanProgress`). */
export interface SnapshotPlanProgress {
  planId: string;
  startDate: string;
  completed: number;
}

/**
 * Snapshot completo dos dados do usuário. `exportedAt` é INFORMATIVO (ISO) e NÃO
 * participa do merge nem da igualdade de estado (sem timestamp nos Records, não há
 * como usá-lo p/ desempate — ver `mergeSnapshots`). `planProgress` é `null` quando não
 * há plano ativo (um único plano ativo, como o core).
 */
export interface UserdataSnapshot {
  app: typeof SNAPSHOT_APP;
  version: typeof SNAPSHOT_VERSION;
  exportedAt?: string;
  notes: SnapshotNote[];
  highlights: SnapshotHighlight[];
  planProgress: SnapshotPlanProgress | null;
}

// ── Ordenação canônica ESTÁVEL (determinismo, não apresentação) ───────────────
// O snapshot é ordenado por STRING de referência p/ que `serializeSnapshot` seja
// determinístico (mesmos dados → mesmos bytes) e o round-trip/idempotência sejam
// comparáveis. Não é a ordem de apresentação (as notas na UI usam a ordem canônica do
// core; as marcações, a ordem de inserção) — é só a forma canônica do snapshot.
function byReference<T extends { reference: string }>(a: T, b: T): number {
  return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
}

function sortNotes(notes: SnapshotNote[]): SnapshotNote[] {
  return [...notes].sort(byReference);
}

function sortHighlights(highlights: SnapshotHighlight[]): SnapshotHighlight[] {
  return [...highlights].sort(byReference);
}

/** União por `reference`: o `incoming` SOBRESCREVE o `base` na colisão (import vence). */
function unionByReference<T extends { reference: string }>(base: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of base) {
    map.set(item.reference, item);
  }
  for (const item of incoming) {
    map.set(item.reference, item); // colisão → o importado vence (Records SEM timestamp)
  }
  return [...map.values()];
}

// ── MONTAGEM do snapshot a partir dos Records ────────────────────────────────
/**
 * Monta o snapshot a partir dos RECORDS do usuário. `formatReference` é INJETADO (a
 * string canônica vem do core — anti-alucinação; no web é `formatReferenceEn`, no nativo
 * o equivalente do frontier). `exportedAt` é opcional e informativo. Ordena por referência
 * (determinístico). NÃO toca I/O — o chamador lê os Records (`list_notes`/…) e passa aqui.
 */
export function buildSnapshot(
  notes: Note[],
  highlights: Highlight[],
  planProgress: ReadingPlanProgress | null | undefined,
  formatReference: (reference: Reference) => string,
  exportedAt?: string,
): UserdataSnapshot {
  const snapNotes: SnapshotNote[] = notes.map((n) => ({
    reference: formatReference(n.reference),
    body: n.body,
  }));
  const snapHighlights: SnapshotHighlight[] = highlights.map((h) =>
    h.tag != null
      ? { reference: formatReference(h.reference), color: h.color, tag: h.tag }
      : { reference: formatReference(h.reference), color: h.color },
  );
  return {
    app: SNAPSHOT_APP,
    version: SNAPSHOT_VERSION,
    ...(exportedAt != null ? { exportedAt } : {}),
    notes: sortNotes(snapNotes),
    highlights: sortHighlights(snapHighlights),
    planProgress:
      planProgress != null
        ? {
            planId: planProgress.planId,
            startDate: planProgress.startDate,
            completed: planProgress.completed,
          }
        : null,
  };
}

/** Serializa o snapshot em JSON pretty (2 espaços), molde dos DTOs do store. */
export function serializeSnapshot(snapshot: UserdataSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

// ── VALIDAÇÃO (rejeita import inválido/corrompido ANTES de tocar o store) ─────
function fail(reason: string): never {
  throw new Error(`snapshot inválido: ${reason}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateNote(raw: unknown, i: number): SnapshotNote {
  if (!isObject(raw)) {
    fail(`notes[${i}] não é objeto`);
  }
  if (typeof raw.reference !== 'string') {
    fail(`notes[${i}].reference não é string`);
  }
  if (typeof raw.body !== 'string') {
    fail(`notes[${i}].body não é string`);
  }
  return { reference: raw.reference, body: raw.body };
}

function validateHighlight(raw: unknown, i: number): SnapshotHighlight {
  if (!isObject(raw)) {
    fail(`highlights[${i}] não é objeto`);
  }
  if (typeof raw.reference !== 'string') {
    fail(`highlights[${i}].reference não é string`);
  }
  if (typeof raw.color !== 'string') {
    fail(`highlights[${i}].color não é string`);
  }
  if (raw.tag !== undefined && typeof raw.tag !== 'string') {
    fail(`highlights[${i}].tag não é string`);
  }
  return raw.tag != null
    ? { reference: raw.reference, color: raw.color, tag: raw.tag }
    : { reference: raw.reference, color: raw.color };
}

function validatePlanProgress(raw: unknown): SnapshotPlanProgress | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isObject(raw)) {
    fail('planProgress não é objeto nem null');
  }
  if (typeof raw.planId !== 'string') {
    fail('planProgress.planId não é string');
  }
  if (typeof raw.startDate !== 'string') {
    fail('planProgress.startDate não é string');
  }
  if (typeof raw.completed !== 'number' || !Number.isInteger(raw.completed) || raw.completed < 0) {
    fail('planProgress.completed não é inteiro >= 0');
  }
  return { planId: raw.planId, startDate: raw.startDate, completed: raw.completed };
}

/**
 * Valida uma estrutura já desserializada em um `UserdataSnapshot` (versão, tipos). Lança
 * `Error('snapshot inválido: …')` em qualquer desvio — SEM efeito colateral (o chamador o
 * roda antes de tocar o store). NÃO valida se a `reference` é uma referência REAL (isso é
 * do core, via `assertValidReference` no import) — aqui só o esqueleto/tipos.
 */
export function validateSnapshot(raw: unknown): UserdataSnapshot {
  if (!isObject(raw)) {
    fail('não é objeto JSON');
  }
  if (raw.app !== SNAPSHOT_APP) {
    fail(`app desconhecido (${String(raw.app)})`);
  }
  if (raw.version !== SNAPSHOT_VERSION) {
    fail(`versão não suportada (${String(raw.version)})`);
  }
  if (!Array.isArray(raw.notes)) {
    fail('notes não é array');
  }
  if (!Array.isArray(raw.highlights)) {
    fail('highlights não é array');
  }
  const notes = raw.notes.map(validateNote);
  const highlights = raw.highlights.map(validateHighlight);
  const planProgress = validatePlanProgress(raw.planProgress);
  const exportedAt = typeof raw.exportedAt === 'string' ? raw.exportedAt : undefined;
  return {
    app: SNAPSHOT_APP,
    version: SNAPSHOT_VERSION,
    ...(exportedAt != null ? { exportedAt } : {}),
    notes,
    highlights,
    planProgress,
  };
}

/** Parseia + valida um JSON de snapshot. Lança em JSON malformado OU estrutura inválida. */
export function parseSnapshot(json: string): UserdataSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    fail('JSON malformado');
  }
  return validateSnapshot(raw);
}

// ── MERGE determinístico (documentado no ADR-0051) ───────────────────────────
/** Igualdade de progresso (p/ decidir se há diff a aplicar; trata `null`). */
function planProgressEquals(
  a: SnapshotPlanProgress | null,
  b: SnapshotPlanProgress | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.planId === b.planId && a.startDate === b.startDate && a.completed === b.completed;
}

/**
 * Merge do progresso de plano (LWW documentado):
 *   - `incoming` ausente → mantém o `base` (import vazio não apaga plano local);
 *   - `base` ausente → adota o `incoming`;
 *   - MESMO plano (mesmo `planId`+`startDate`) → `max(completed)` (progresso NUNCA regride);
 *   - plano DIFERENTE → o `incoming` (importado) vence (LWW determinístico).
 */
function mergePlanProgress(
  base: SnapshotPlanProgress | null,
  incoming: SnapshotPlanProgress | null,
): SnapshotPlanProgress | null {
  if (incoming === null) {
    return base;
  }
  if (base === null) {
    return incoming;
  }
  if (base.planId === incoming.planId && base.startDate === incoming.startDate) {
    return {
      planId: base.planId,
      startDate: base.startDate,
      completed: Math.max(base.completed, incoming.completed),
    };
  }
  return incoming; // plano diferente → o importado vence (LWW)
}

/**
 * Merge DETERMINÍSTICO de `incoming` sobre `base` (ver ADR-0051):
 *   - notas/marcações = UNIÃO por `reference`; colisão → o `incoming` (importado) vence
 *     (os Records NÃO carregam timestamp → não há "mais recente"; o import é a autoridade);
 *   - progresso = LWW / `max(completed)` no mesmo plano (ver `mergePlanProgress`).
 * Idempotente: `merge(s, s) === s`. Não é simétrico (import = aplicar sobre o local, por
 * design). Resultado ordenado (determinístico); `exportedAt` é descartado (informativo).
 */
export function mergeSnapshots(
  base: UserdataSnapshot,
  incoming: UserdataSnapshot,
): UserdataSnapshot {
  return {
    app: SNAPSHOT_APP,
    version: SNAPSHOT_VERSION,
    notes: sortNotes(unionByReference(base.notes, incoming.notes)),
    highlights: sortHighlights(unionByReference(base.highlights, incoming.highlights)),
    planProgress: mergePlanProgress(base.planProgress, incoming.planProgress),
  };
}

// ── EXPORT/IMPORT sobre o store (fns de escrita do core INJETADAS) ────────────
/**
 * Contrato mínimo do store, INJETADO pelo alvo (web = `reading.web.ts`; nativo =
 * `reading.ts`). O motor NUNCA importa o glue diretamente (pureza cross-target, molde
 * `notesExport`): o chamador liga estas fns às de PRODUÇÃO. `formatReference`/
 * `assertValidReference` vêm do CORE (anti-alucinação: a referência canônica e a
 * validação de referência REAL vivem no core, não em TS).
 */
export interface SnapshotStore {
  /** Referência estruturada → string canônica do core (`format_reference`). */
  formatReference(reference: Reference): string;
  /** Lança se a string NÃO for uma referência canônica/real (core `parse_reference`). */
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
 * Lê o estado atual do store e monta o snapshot (a UI da F5.26 fará o Share/save do
 * `serializeSnapshot(...)`). `exportedAt` opcional (informativo).
 */
export async function exportSnapshot(
  store: SnapshotStore,
  exportedAt?: string,
): Promise<UserdataSnapshot> {
  const [notes, highlights, progress] = await Promise.all([
    store.listNotes(),
    store.listHighlights(),
    store.readingPlanProgress(),
  ]);
  return buildSnapshot(notes, highlights, progress ?? null, (r) => store.formatReference(r), exportedAt);
}

/** Contagem do que o import EFETIVAMENTE gravou (0/0/false = no-op → idempotente). */
export interface ImportResult {
  merged: UserdataSnapshot;
  applied: { notes: number; highlights: number; planProgress: boolean };
}

/**
 * IMPORTA um snapshot JSON, fazendo MERGE determinístico sobre o estado atual e aplicando
 * o DIFF via as fns de ESCRITA do store. Passos (ordem importa p/ NÃO corromper o estado):
 *   1. `parseSnapshot` — JSON malformado / estrutura inválida → LANÇA antes de qualquer I/O;
 *   2. `assertValidReference` em TODA referência do snapshot (core) — referência irreal →
 *      LANÇA antes de qualquer escrita (nada é gravado; anti-alucinação);
 *   3. monta o snapshot-base do estado atual e faz `mergeSnapshots`;
 *   4. aplica SÓ o diff: nota nova/alterada (`putNote` = upsert), marcação nova/alterada
 *      (`addHighlight` = substitui por referência), progresso alterado (`startReadingPlan`
 *      reinicia em 0 → `setReadingPlanCompleted`).
 * IDEMPOTENTE: reimportar o MESMO snapshot resulta em diff vazio (`applied` 0/0/false) e
 * estado idêntico. `merge` nunca zera um plano local (não há apagar plano no import).
 */
export async function importSnapshotIntoStore(
  json: string,
  store: SnapshotStore,
): Promise<ImportResult> {
  // (1) valida a ESTRUTURA (lança sem tocar o store).
  const incoming = parseSnapshot(json);
  // (2) valida que toda referência é REAL/canônica (core) — lança ANTES de escrever.
  for (const n of incoming.notes) {
    store.assertValidReference(n.reference);
  }
  for (const h of incoming.highlights) {
    store.assertValidReference(h.reference);
  }
  // (3) estado atual → snapshot-base → merge determinístico.
  const base = await exportSnapshot(store);
  const merged = mergeSnapshots(base, incoming);

  // (4) aplica só o DIFF (upserts idempotentes).
  const baseNotes = new Map(base.notes.map((n) => [n.reference, n.body]));
  let notesApplied = 0;
  for (const n of merged.notes) {
    if (baseNotes.get(n.reference) !== n.body) {
      await store.putNote(n.reference, n.body);
      notesApplied += 1;
    }
  }

  const baseHighlights = new Map(base.highlights.map((h) => [h.reference, h]));
  let highlightsApplied = 0;
  for (const h of merged.highlights) {
    const prev = baseHighlights.get(h.reference);
    if (!prev || prev.color !== h.color || prev.tag !== h.tag) {
      await store.addHighlight(h.reference, h.color, h.tag);
      highlightsApplied += 1;
    }
  }

  let planProgressApplied = false;
  if (merged.planProgress !== null && !planProgressEquals(merged.planProgress, base.planProgress)) {
    // `startReadingPlan` valida o `planId` (CATALOG do core) e a `startDate` (ISO) e
    // reinicia `completed` em 0; o `setReadingPlanCompleted` ajusta p/ o valor merged.
    await store.startReadingPlan(merged.planProgress.planId, merged.planProgress.startDate);
    if (merged.planProgress.completed !== 0) {
      await store.setReadingPlanCompleted(merged.planProgress.completed);
    }
    planProgressApplied = true;
  }

  return {
    merged,
    applied: { notes: notesApplied, highlights: highlightsApplied, planProgress: planProgressApplied },
  };
}
