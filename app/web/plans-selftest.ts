// app/web/plans-selftest.ts — F5.7 (ADR-0039; molde notes-selftest.ts F1.11)
//
// Self-test HEADLESS de PLANOS DE LEITURA (geração F5.1 + progresso F5.4) no NATIVO.
// Disparado SÓ sob `EXPO_PUBLIC_TLA_SELFTEST=1` (via selftest.ts). Exercita a
// fronteira REAL de planos (reading.ts → bindings gerados → JSI → o módulo
// `the_light_core::userdata::plans`) sobre um diretório de teste ISOLADO e LIMPO no
// início (idempotente), SEPARADO do banco só-leitura. Prova o VERTICAL da tela:
//   lista → iniciar → dia de hoje → marcar concluído → RELEITURA independente.
// Emite um marcador COMPOSTO DO RETORNO REAL — sem hardcode (anti-alucinação: os
// planos/dias vêm do core, o `plan_id`/`completed` vêm da persistência real).
// Capturado por `simctl log` (iOS) / `adb logcat`.
//
// Marcador:
//   TLA_PLANS plan_id="gospels" days=30 today_index=<n> completed=<m> persisted=<true|false>
//     - plan_id     = id do plano ativo (do RETORNO de start_reading_plan), casando o
//                     "gospels" do CATALOG do core (list_reading_plans).
//     - days        = nº de dias do plano "gospels" (do CATALOG via list_reading_plans;
//                     30 dias — NÃO hardcoded no marcador, lido do retorno).
//     - today_index = índice (0-based) do dia de hoje (reading_plan_day_index sobre a
//                     start_date REAL do progresso e a data de hoje). Início = hoje →
//                     today_index=0 (determinístico).
//     - completed   = dias concluídos após set_reading_plan_completed (RETORNO real).
//     - persisted   = true sse uma 2ª leitura INDEPENDENTE (novo handle do PlanStore, do
//                     disco) reencontra o MESMO plano ativo com o MESMO completed.
// Se algo falhar (plano "gospels" ausente, dia 0 sem referências, releitura divergente)
// → `TLA_PLANS ERROR <motivo>` (a asserção do script falha visível, sem mascarar).
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `plans-selftest.web.ts` (SKIP — planos web = F5.10), mantendo `expo-file-system` e o
// módulo `userdata::plans` (nativo-only) FORA do bundle web.
import * as FileSystem from 'expo-file-system/legacy';

import {
  listReadingPlans,
  readingPlanDay,
  readingPlanDayIndex,
  readingPlanProgress,
  setReadingPlanCompleted,
  startReadingPlan,
} from './reading';

const MARK = 'TLA_PLANS';
// Plano provado (do CATALOG do core: annual/nt/gospels). "gospels" = 30 dias.
const PLAN_ID = 'gospels';

function emit(line: string): void {
  console.log(line);
  console.error(line);
}

/** Data de hoje ISO `YYYY-MM-DD` no fuso LOCAL (mesma convenção da tela de planos). */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Prova do vertical de planos + persistência. Emite (tudo do RETORNO da fronteira):
 *   TLA_PLANS plan_id="gospels" days=30 today_index=0 completed=1 persisted=true
 */
export async function runPlansSelfTest(): Promise<void> {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    emit(`${MARK} ERROR no-documentDirectory`);
    return;
  }

  // Diretório de teste ISOLADO, LIMPO no início (idempotente entre execuções).
  const dirUri = `${docDir}plans-selftest/`;
  try {
    await FileSystem.deleteAsync(dirUri, { idempotent: true });
    await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  } catch (err) {
    emit(`${MARK} ERROR ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // O core (std::fs) espera um path real, sem o esquema file://.
  const dir = dirUri.replace(/^file:\/\//, '');

  try {
    // 1) LISTA: os 3 planos do CATALOG do core; localiza "gospels" e lê seus dias.
    const plans = listReadingPlans();
    const gospels = plans.find((p) => p.id === PLAN_ID);
    if (!gospels) {
      emit(`${MARK} ERROR plan-not-found:${PLAN_ID}`);
      return;
    }
    const days = gospels.days;

    // 2) DIA 0: prova que a geração devolve referências (capítulos inteiros) reais.
    const day0 = readingPlanDay(PLAN_ID, 0);
    if (day0.references.length === 0 || day0.label.length === 0) {
      emit(`${MARK} ERROR empty-day0`);
      return;
    }

    // 3) INICIAR: grava o progresso (completed=0), começando HOJE.
    const start = todayISO();
    const progress = await startReadingPlan(dir, PLAN_ID, start);

    // 4) DIA DE HOJE: índice 0-based calculado PELO CORE (início = hoje → 0).
    const todayIndex = readingPlanDayIndex(progress.startDate, todayISO(), days);

    // 5) MARCAR CONCLUÍDO: avança 1 dia e persiste (RETORNO real).
    const advanced = await setReadingPlanCompleted(dir, progress.completed + 1);
    const completed = advanced.completed;

    // 6) PERSISTÊNCIA: 2ª leitura INDEPENDENTE (novo handle do PlanStore, do disco).
    const reloaded = await readingPlanProgress(dir);
    const persisted =
      reloaded != null && reloaded.planId === PLAN_ID && reloaded.completed === completed;

    emit(
      `${MARK} plan_id=${JSON.stringify(progress.planId)} days=${days} today_index=${todayIndex} completed=${completed} persisted=${persisted}`,
    );
  } catch (err) {
    emit(`${MARK} ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
}
