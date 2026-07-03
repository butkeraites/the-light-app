// app/web/plans-fs.web.ts — F5.10 (molde userdata-fs.web.ts F1.16)
//
// GLUE web do PROGRESSO de PLANOS DE LEITURA — hand-written, VERSIONADO. Camada de
// INFRAESTRUTURA que persiste o progresso em TS no web, ESPELHANDO o FORMATO EM DISCO
// do core (`the_light_core::userdata::plans::{PlanStore,PlanProgress}`, rev pinado
// `225b8c9`) — NÃO a lógica de domínio. O `PlanStore` (fs) é `#[cfg(feature="embedded")]`
// (nativo-only) → NÃO entra no grafo wasm → o web NÃO pode delegar a PERSISTÊNCIA;
// reimplementa o I/O (precedente das notas/highlights, F1.16/ADR-0022). Já a GERAÇÃO
// (list/day/day_index) é cfg-free/wasm (F5.10) e vem SEMPRE do core (zero-drift) — aqui
// NADA de chunking/índice-de-dia/CATALOG é reimplementado.
//
// É infra de ARMAZENAMENTO, não domínio:
//   - O FORMATO em disco é `reading-plans/active.json` com o record serde do core
//     `{ plan_id, start_date, completed }` (snake_case, `start_date` ISO `YYYY-MM-DD`),
//     pretty 2-espaços (espelha `serde_json::to_string_pretty`). Único plano ativo (o
//     core guarda um só `active.json`) — iniciar SOBRESCREVE.
//   - O `plan_id` é validado contra o CATALOG do core (`listReadingPlans()` — wasm, agora
//     cfg-free) ANTES de gravar (anti-alucinação: só slugs REAIS são persistidos, igual
//     ao `start_reading_plan` nativo, que valida via `plan_by_id`). A `start_date` ISO é
//     validada pelo CORE (`readingPlanDayIndex`, que parseia como `NaiveDate` e lança em
//     data inválida) — SEM parsing de data em TS (zero-drift com o nativo).
//
// VFS-agnóstica (par de userdata-fs.web.ts): opera sobre a MESMA `UserDataDir` mínima que
// o backend OPFS do browser (`userdata-opfs.web.ts`) e o mock em memória da prova headless
// implementam. A prova node exercita EXATAMENTE estas funções.
import { listReadingPlans, readingPlanDayIndex } from './generated/the_light_app_core';
import type { ReadingPlanProgress } from './generated/the_light_app_core';
import type { UserDataDir } from './userdata-fs.web';

/** Subdiretório do progresso — espelha `reading_plans_dir()` do core (`reading-plans/`). */
const READING_PLANS_DIR = 'reading-plans';
/** Arquivo único do plano ativo — espelha `active.json` do core. */
const ACTIVE_FILE = 'active.json';
/** Caminho relativo do progresso ativo, EXATO como o layout nativo. */
const ACTIVE_PATH = `${READING_PLANS_DIR}/${ACTIVE_FILE}`;

/**
 * Forma serializada em disco (espelha o record serde `PlanProgress` do core): chaves
 * `plan_id`, `start_date` (ISO), `completed`, nessa ordem (snake_case). Distinta do Record
 * de fronteira `ReadingPlanProgress` (camelCase) que a UI consome.
 */
interface PlanProgressDto {
  plan_id: string;
  start_date: string;
  completed: number;
}

/** DTO (disco, snake_case) → Record de fronteira (camelCase), o que a UI consome. */
function toProgress(dto: PlanProgressDto): ReadingPlanProgress {
  return { planId: dto.plan_id, startDate: dto.start_date, completed: dto.completed };
}

/** Record de fronteira → DTO de disco, na ORDEM de chaves do core (plan_id, start_date, completed). */
function toDto(progress: ReadingPlanProgress): PlanProgressDto {
  return {
    plan_id: progress.planId,
    start_date: progress.startDate,
    completed: progress.completed,
  };
}

/**
 * Lê o PROGRESSO do plano ativo (se houver). Espelha `PlanStore::load`: arquivo ausente →
 * `undefined` (NÃO erro); JSON corrompido/estrutura inválida → LANÇA (espelha o core, que
 * propaga o erro de desserialização — NÃO silencia como "sem plano"). NÃO valida o `plan_id`
 * contra o CATALOG na leitura (paridade com o core: só o WRITE valida; a UI de planos degrada
 * graciosamente se o plano ativo sumir do CATALOG).
 */
export async function readActivePlanFs(dir: UserDataDir): Promise<ReadingPlanProgress | undefined> {
  const raw = await dir.readFile(ACTIVE_PATH);
  if (raw === null) {
    return undefined;
  }
  // JSON.parse lança em conteúdo corrompido (espelha `serde_json::from_str` → Err).
  const dto = JSON.parse(raw) as Partial<PlanProgressDto>;
  if (
    typeof dto.plan_id !== 'string' ||
    typeof dto.start_date !== 'string' ||
    typeof dto.completed !== 'number'
  ) {
    throw new Error(`progresso de plano inválido em ${ACTIVE_PATH}`);
  }
  return toProgress(dto as PlanProgressDto);
}

/**
 * Grava o DTO de progresso VERBATIM em `reading-plans/active.json`, pretty 2-espaços
 * (espelha `to_string_pretty`). Infra pura de escrita (sem validação — quem valida é
 * `startPlanFs`/`setCompletedFs`).
 */
async function writeActivePlanFs(dir: UserDataDir, progress: ReadingPlanProgress): Promise<void> {
  await dir.writeFile(ACTIVE_PATH, JSON.stringify(toDto(progress), null, 2));
}

/**
 * INICIA um plano (grava `completed = 0`). Espelha `start_reading_plan` do core:
 *   1) valida o `planId` contra o CATALOG do core (`listReadingPlans()` — wasm; desconhecido
 *      → LANÇA a MESMA mensagem do core "plano de leitura desconhecido: {id}", SEM gravar);
 *   2) valida a `startDate` ISO delegando ao CORE (`readingPlanDayIndex`, que parseia como
 *      `NaiveDate` — data inválida → LANÇA CoreError, SEM gravar); ZERO parsing de data em TS;
 *   3) grava `{ plan_id, start_date, completed: 0 }` (SOBRESCREVE o plano ativo).
 * Anti-alucinação: só slugs REAIS do CATALOG são persistidos. Devolve o Record de fronteira.
 */
export async function startPlanFs(
  dir: UserDataDir,
  planId: string,
  startDate: string,
): Promise<ReadingPlanProgress> {
  // (1) Slug REAL do CATALOG do core — a fonte da verdade dos planos (wasm), nunca hardcoded.
  if (!listReadingPlans().some((p) => p.id === planId)) {
    throw new Error(`plano de leitura desconhecido: ${planId}`);
  }
  // (2) Validação da data ISO PELO CORE (parse `NaiveDate`); lança em data inválida, sem I/O.
  //     Reusa a geração cfg-free (index do dia p/ um plano de 1 dia = 0) só p/ o parse ISO.
  readingPlanDayIndex(startDate, startDate, 1);
  // (3) Escrita (único plano ativo — sobrescreve).
  const progress: ReadingPlanProgress = { planId, startDate, completed: 0 };
  await writeActivePlanFs(dir, progress);
  return progress;
}

/**
 * ATUALIZA os dias concluídos do plano ativo. Espelha `set_reading_plan_completed`: sem plano
 * ativo → LANÇA a MESMA mensagem do core ("nenhum plano de leitura ativo"); senão regrava com
 * o novo `completed` e devolve o Record. Idempotente no valor.
 */
export async function setCompletedFs(
  dir: UserDataDir,
  completed: number,
): Promise<ReadingPlanProgress> {
  const current = await readActivePlanFs(dir);
  if (!current) {
    throw new Error('nenhum plano de leitura ativo');
  }
  const updated: ReadingPlanProgress = { ...current, completed };
  await writeActivePlanFs(dir, updated);
  return updated;
}

/**
 * REMOVE o plano ativo. Espelha `PlanStore::clear`: `true` se existia, `false` caso contrário
 * (idempotente, NÃO erro).
 */
export async function clearActivePlanFs(dir: UserDataDir): Promise<boolean> {
  return dir.deleteFile(ACTIVE_PATH);
}
