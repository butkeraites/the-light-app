// app/app/plans/index.tsx — F5.7 (ADR-0039)
//
// Tela NATIVA de PLANOS DE LEITURA. Orquestra as fns de fronteira já expostas por
// F5.1 (geração: `listReadingPlans`/`readingPlanDay`/`readingPlanDayIndex`) e F5.4
// (progresso: `readingPlanProgress`/`startReadingPlan`/`setReadingPlanCompleted`/
// `clearReadingPlan`) — todas em `web/reading.ts` → binding gerado → JSI → o módulo
// `the_light_core::userdata::plans`. NÃO reimplementa geração/progresso em TS: os
// NOMES de plano (CATALOG), os RÓTULOS de dia e as REFERÊNCIAS (capítulos inteiros)
// vêm SEMPRE do core (uma fonte da verdade; anti-alucinação — a UI não sintetiza
// texto/refs). O texto do versículo é lido pelo Reader (`/read/[book]/[chapter]`),
// que o traz VERBATIM do store.
//
// Estados: (1) sem plano ativo → lista os 3 planos (nome + nº de dias) com "Começar";
// (2) plano ativo → cabeçalho (nome + barra de progresso + sequência), lista de dias
// com HOJE destacado (índice de `readingPlanDayIndex`), tocar um dia abre o Reader no
// 1º capítulo daquele dia, "Marcar dia como lido" avança `completed` (persiste) e
// "Trocar/encerrar plano" limpa o progresso.
//
// OFFLINE-FIRST/BYOK: 100% local; nada exige rede/conta. i18n/a11y: cromo via `t()`, cores
// por TOKENS de tema, interativos com role+label. PARIDADE WEB (F5.10): a MESMA tela roda no
// web — a GERAÇÃO é cfg-free/wasm (ADR-0037, idêntica ao nativo) e o PROGRESSO persiste em
// OPFS (`web/plans-fs.web.ts`, mesmo formato do core). Só o LEMBRETE diário (F5.13) é
// nativo-only (`expo-notifications`): o controle é gateado por `REMINDERS_SUPPORTED` (false no
// web, sem `expo-notifications` no bundle). Sem "native-only": a tela funciona nas duas.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useNavigation } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { WasmGate } from '../../components/WasmGate';
import { Button, Chip, Surface } from '../../components/ui';
import { ensureUserDataDir } from '../../lib/userdata';
import { useI18n, type TranslateFn } from '../../lib/i18n';
import { useTheme, type ThemeColors, type ThemeContextValue } from '../../lib/theme';
import {
  REMINDERS_SUPPORTED,
  disableReminder,
  enableReminder,
  getReminder,
  type ReminderPref,
} from '../../lib/planReminders';
import {
  clearReadingPlan,
  listReadingPlans,
  readingPlanDay,
  readingPlanDayIndex,
  readingPlanProgress,
  setReadingPlanCompleted,
  startReadingPlan,
  type ReadingPlanProgress,
  type ReadingPlanSummary,
} from '../../web/reading';

// Horários-preset do lembrete diário (24h, calendário LOCAL do device). Sem date-picker
// nativo (evita dep nova); o usuário escolhe entre presets — 100% offline/opt-in.
const REMINDER_TIME_PRESETS = ['06:00', '07:00', '08:00', '12:00', '18:00', '21:00'] as const;

/**
 * Data de HOJE em ISO `YYYY-MM-DD` no fuso LOCAL. Os planos são locais/offline; usamos
 * o calendário do device (NÃO `toISOString()`, que converte p/ UTC e poderia pular um
 * dia). O core parseia essa string p/ `NaiveDate` (mesma convenção de F5.1/F5.4).
 */
function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function PlansScreen() {
  // F5.10: a MESMA tela vale no nativo E no web. No web a geração é wasm (síncrona, exige o
  // wasm pronto) e o progresso é OPFS — o `WasmGate` garante o wasm inicializado antes de
  // `listReadingPlans()`; no nativo a fronteira é síncrona/pronta e o gate é transparente.
  return (
    <WasmGate>
      <PlansContent />
    </WasmGate>
  );
}

function PlansContent() {
  const navigation = useNavigation();
  const theme = useTheme();
  const { colors } = theme;
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Título de header reativo ao idioma (molde read/index).
  useEffect(() => {
    navigation.setOptions({ title: t('nav.plans') });
  }, [navigation, t]);

  const [dataDir, setDataDir] = useState<string | null>(null);
  const [plans, setPlans] = useState<ReadingPlanSummary[]>([]);
  // `undefined` = carregando · `null` = sem plano ativo · valor = plano ativo.
  const [progress, setProgress] = useState<ReadingPlanProgress | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Boot: resolve o dir de userdata (mesmo das notas/highlights), lista os planos do
  // core (CATALOG, síncrono/wasm) e lê o progresso ativo (fs nativo / OPFS web, async).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const dir = await ensureUserDataDir();
        const catalog = listReadingPlans();
        const prog = await readingPlanProgress(dir);
        if (!alive) {
          return;
        }
        setDataDir(dir);
        setPlans(catalog);
        setProgress(prog ?? null);
        setError(null);
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
          setProgress(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Inicia um plano (grava progress=0) e passa a exibir o plano ativo.
  const startPlan = useCallback(
    async (planId: string) => {
      if (!dataDir || busy) {
        return;
      }
      setBusy(true);
      try {
        const prog = await startReadingPlan(dataDir, planId, todayISO());
        setProgress(prog);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [dataDir, busy],
  );

  // Avança um dia concluído (persiste). Satura em `len` (não passa do fim do plano).
  const markDayDone = useCallback(
    async (len: number) => {
      if (!dataDir || busy || !progress) {
        return;
      }
      const next = Math.min(progress.completed + 1, len);
      if (next === progress.completed) {
        return;
      }
      setBusy(true);
      try {
        const prog = await setReadingPlanCompleted(dataDir, next);
        setProgress(prog);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [dataDir, busy, progress],
  );

  // Encerra/troca o plano (remove o progresso ativo) → volta à lista. Cancela também o
  // lembrete LOCAL do plano (F5.13): sem plano ativo, não faz sentido notificar. Tolerante
  // (offline-first: falha ao cancelar não impede encerrar o plano).
  const clearPlan = useCallback(async () => {
    if (!dataDir || busy) {
      return;
    }
    setBusy(true);
    try {
      await disableReminder().catch(() => undefined);
      await clearReadingPlan(dataDir);
      setProgress(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [dataDir, busy]);

  // Abre o Reader no 1º capítulo (inteiro) do dia. As refs vêm do core; a UI só
  // navega — o texto do versículo é lido pelo Reader (verbatim do store).
  const openDay = useCallback((planId: string, dayIndex: number) => {
    const day = readingPlanDay(planId, dayIndex);
    const ref = day.references[0];
    if (ref) {
      router.push(`/read/${ref.book}/${ref.chapter}`);
    }
  }, []);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error} accessibilityRole="text">
          {error}
        </Text>
      </View>
    );
  }

  if (progress === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  // Sem plano ativo → lista de escolha.
  if (progress === null) {
    return (
      <PlanChooser plans={plans} busy={busy} onStart={startPlan} styles={styles} t={t} />
    );
  }

  // Plano ativo → cabeçalho + lista de dias (com HOJE destacado).
  const summary = plans.find((p) => p.id === progress.planId);
  if (!summary) {
    // Plano ativo desconhecido no CATALOG (não deve ocorrer) → permite encerrar.
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>{progress.planId}</Text>
        <Button
          title={t('plans.change')}
          variant="secondary"
          onPress={clearPlan}
          accessibilityLabel={t('a11y.changePlan')}
        />
      </View>
    );
  }

  return (
    <ActivePlanView
      planId={progress.planId}
      planName={summary.name}
      len={summary.days}
      completed={progress.completed}
      startDate={progress.startDate}
      busy={busy}
      onOpenDay={openDay}
      onMarkDone={markDayDone}
      onClear={clearPlan}
      styles={styles}
      colors={colors}
      t={t}
    />
  );
}

// ── Estado 1: escolha de plano ───────────────────────────────────────────────
function PlanChooser(props: {
  plans: ReadingPlanSummary[];
  busy: boolean;
  onStart: (planId: string) => void;
  styles: Styles;
  t: TranslateFn;
}) {
  const { plans, busy, onStart, styles, t } = props;
  if (plans.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>{t('plans.empty')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {t('plans.chooseTitle')}
      </Text>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Surface padded style={styles.planCard}>
            <View style={styles.planCardInfo}>
              {/* Nome do plano VERBATIM do CATALOG do core (PT) — nunca via t(). */}
              <Text style={styles.planName}>{item.name}</Text>
              <Text style={styles.planDays}>{t('plans.dayCount', { days: item.days })}</Text>
            </View>
            <Button
              title={t('plans.start')}
              onPress={() => onStart(item.id)}
              loading={busy}
              disabled={busy}
              accessibilityLabel={t('a11y.startPlan', { name: item.name })}
              testID={`start-plan-${item.id}`}
            />
          </Surface>
        )}
      />
    </View>
  );
}

// ── Estado 2: plano ativo ────────────────────────────────────────────────────
function ActivePlanView(props: {
  planId: string;
  planName: string;
  len: number;
  completed: number;
  startDate: string;
  busy: boolean;
  onOpenDay: (planId: string, dayIndex: number) => void;
  onMarkDone: (len: number) => void;
  onClear: () => void;
  styles: Styles;
  colors: ThemeColors;
  t: TranslateFn;
}) {
  const { planId, planName, len, completed, startDate, busy, onOpenDay, onMarkDone, onClear, styles, colors, t } =
    props;

  // Índice (0-based) do dia de HOJE, calculado PELO CORE (satura em [0, len-1]). Data
  // inválida (não deve ocorrer — start_date é ISO) → cai no dia 0 sem quebrar a tela.
  const todayIndex = useMemo(() => {
    try {
      return readingPlanDayIndex(startDate, todayISO(), len);
    } catch {
      return 0;
    }
  }, [startDate, len]);

  const allDone = completed >= len;
  const fraction = len > 0 ? Math.min(completed / len, 1) : 0;
  const dayIndexes = useMemo(() => Array.from({ length: len }, (_, i) => i), [len]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {/* Nome do plano VERBATIM do CATALOG do core — nunca via t(). */}
        <Text style={styles.title} accessibilityRole="header">
          {planName}
        </Text>
        <Text style={styles.progressLabel}>
          {t('plans.progress', { completed, total: len })}
          {'  ·  '}
          {t('plans.streak', { streak: completed })}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${fraction * 100}%` }]} />
        </View>
        {allDone ? <Text style={styles.completedAll}>{t('plans.completedAll')}</Text> : null}
      </View>

      <FlatList
        data={dayIndexes}
        keyExtractor={(i) => String(i)}
        initialScrollIndex={Math.min(todayIndex, Math.max(len - 1, 0))}
        getItemLayout={(_, index) => ({ length: DAY_ROW_HEIGHT, offset: DAY_ROW_HEIGHT * index, index })}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: i }) => {
          // Rótulo do dia VERBATIM do core (`reading_plan_day`) — nunca sintetizado.
          const day = readingPlanDay(planId, i);
          const isToday = i === todayIndex;
          const isDone = i < completed;
          return (
            <Pressable
              onPress={() => onOpenDay(planId, i)}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.openDay', { day: i + 1, label: day.label })}
              testID={`plan-day-${i}`}
              style={[styles.dayRow, isToday && styles.dayRowToday]}
            >
              <View style={styles.dayRowMain}>
                <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>
                  {t('plans.dayLabel', { day: i + 1 })}
                  {isToday ? ` · ${t('plans.today')}` : ''}
                </Text>
                <Text style={styles.dayLabel} numberOfLines={2}>
                  {day.label}
                </Text>
              </View>
              {isDone ? (
                <View style={styles.doneBadge}>
                  <Text style={styles.doneBadgeText}>{t('plans.doneBadge')}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      {/* Lembrete diário (F5.13) só onde há agendamento LOCAL confiável (nativo). No web
          `REMINDERS_SUPPORTED` é false → o controle nem renderiza (sem `expo-notifications`). */}
      {REMINDERS_SUPPORTED ? (
        <ReminderControls planName={planName} styles={styles} colors={colors} t={t} />
      ) : null}

      <View style={styles.actions}>
        {!allDone ? (
          <Button
            title={t('plans.markDone')}
            onPress={() => onMarkDone(len)}
            loading={busy}
            disabled={busy}
            accessibilityLabel={t('a11y.markDone')}
            testID="mark-day-done"
            style={styles.actionButton}
          />
        ) : null}
        <Button
          title={t('plans.change')}
          variant="secondary"
          onPress={onClear}
          disabled={busy}
          accessibilityLabel={t('a11y.changePlan')}
          testID="change-plan"
          style={styles.actionButton}
        />
      </View>
    </View>
  );
}

// ── Lembrete LOCAL diário do plano (F5.13) ───────────────────────────────────
// Toggle OPT-IN (OFF por padrão) + escolha de horário. Liga = pede permissão LOCAL (SÓ
// aqui, nunca no boot) e agenda UMA notificação diária via `expo-notifications` (nativo);
// desliga = cancela. A pref (on/off + horário) persiste no KV OFFLINE da F5.2 (app-side,
// separado do progresso do core). Corpo da notificação = cromo i18n + NOME do plano do
// core (anti-alucinação). ESTRITAMENTE LOCAL: sem servidor/conta/push token. No web este
// componente nem renderiza (a tela de planos degrada — F5.10 — antes de chegar aqui).
function ReminderControls(props: {
  planName: string;
  styles: Styles;
  colors: ThemeColors;
  t: TranslateFn;
}) {
  const { planName, styles, colors, t } = props;
  // `undefined` = carregando · `null` = sem lembrete · valor = lembrete salvo.
  const [reminder, setReminder] = useState<ReminderPref | null | undefined>(undefined);
  const [time, setTime] = useState<string>(REMINDER_TIME_PRESETS[2]); // default 08:00
  const [busy, setBusy] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Boot: lê a pref de lembrete persistida (offline). Falha → trata como sem lembrete.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await getReminder();
        if (!alive) {
          return;
        }
        setReminder(saved);
        if (saved) {
          setTime(saved.time);
        }
      } catch {
        if (alive) {
          setReminder(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enabled = reminder?.enabled === true;

  // Agenda (ou reagenda) o lembrete no horário dado. Título/corpo já traduzidos + NOME do
  // plano VERBATIM do core (nunca texto bíblico). Permissão pedida DENTRO de enableReminder.
  const schedule = useCallback(
    async (nextTime: string) => {
      setBusy(true);
      setPermissionDenied(false);
      try {
        const res = await enableReminder({
          time: nextTime,
          title: t('plans.reminderTitle'),
          body: t('plans.reminderBody', { plan: planName }),
          channelName: t('plans.reminderChannel'),
        });
        if (res.status === 'scheduled') {
          setReminder(res.pref);
        } else if (res.status === 'permission-denied') {
          setPermissionDenied(true);
          setReminder(null);
        }
      } catch {
        /* offline-first: falha de agendamento não quebra a tela */
      } finally {
        setBusy(false);
      }
    },
    [planName, t],
  );

  const onToggle = useCallback(
    async (value: boolean) => {
      if (busy) {
        return;
      }
      if (value) {
        await schedule(time);
        return;
      }
      setBusy(true);
      try {
        await disableReminder();
        setReminder(null);
        setPermissionDenied(false);
      } catch {
        /* tolerante (offline-first) */
      } finally {
        setBusy(false);
      }
    },
    [busy, schedule, time],
  );

  const onPickTime = useCallback(
    async (nextTime: string) => {
      setTime(nextTime);
      if (enabled) {
        await schedule(nextTime); // reagenda no novo horário
      }
    },
    [enabled, schedule],
  );

  // Ainda carregando a pref → não pisca controles (offline-first: sem flicker).
  if (reminder === undefined) {
    return null;
  }

  return (
    <View style={styles.reminderSection}>
      <View style={styles.reminderHeaderRow}>
        <Text style={styles.reminderTitle}>{t('plans.reminderSection')}</Text>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityLabel={t('a11y.reminderToggle')}
          trackColor={{ true: colors.accent, false: colors.divider }}
          testID="reminder-toggle"
        />
      </View>
      {enabled ? (
        <View style={styles.reminderTimesRow}>
          <Text style={styles.reminderTimeLabel}>{t('plans.reminderTimeLabel')}</Text>
          {REMINDER_TIME_PRESETS.map((preset) => (
            <Chip
              key={preset}
              label={preset}
              active={preset === time}
              onPress={() => onPickTime(preset)}
              disabled={busy}
              accessibilityLabel={t('a11y.reminderTime', { time: preset })}
              testID={`reminder-time-${preset}`}
            />
          ))}
        </View>
      ) : null}
      {permissionDenied ? (
        <Text style={styles.reminderHint} accessibilityRole="text">
          {t('plans.reminderPermissionHint')}
        </Text>
      ) : null}
    </View>
  );
}

const DAY_ROW_HEIGHT = 64;

type Styles = ReturnType<typeof makeStyles>;

// Botões via <Button>, chips de horário via <Chip>, cartões de plano via <Surface> (kit).
function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xl,
      gap: space.lg,
      backgroundColor: colors.background,
    },
    listContent: { paddingHorizontal: space.lg, paddingBottom: space.lg },
    title: { ...type.title, color: colors.text },
    hint: { ...type.body, color: colors.muted, textAlign: 'center' },
    error: { ...type.body, color: colors.error, textAlign: 'center' },
    header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, gap: space.sm },
    progressLabel: { ...type.caption, color: colors.muted },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
    progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    completedAll: { ...type.body, fontWeight: '600', color: colors.accent },
    // Cartão de plano (estado de escolha): <Surface> traz fundo/borda/raio/padding; aqui só o layout.
    planCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: space.md,
      gap: space.md,
    },
    planCardInfo: { flex: 1, gap: space.xs },
    planName: { ...type.body, fontWeight: '600', color: colors.text },
    planDays: { ...type.caption, color: colors.muted },
    // Linha de dia (estado ativo).
    dayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: DAY_ROW_HEIGHT,
      paddingHorizontal: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      gap: space.md,
    },
    dayRowToday: { backgroundColor: colors.chipActiveBg, borderRadius: radius.md, borderBottomWidth: 0 },
    dayRowMain: { flex: 1, gap: 2 },
    dayNumber: { ...type.caption, fontWeight: '600', color: colors.accent },
    dayNumberToday: { color: colors.chipActiveText },
    dayLabel: { ...type.body, color: colors.text },
    doneBadge: {
      paddingHorizontal: space.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    doneBadgeText: { ...type.label, fontSize: 11, color: colors.chipActiveText },
    // Lembrete diário (F5.13).
    reminderSection: {
      paddingHorizontal: space.lg,
      paddingTop: space.md,
      paddingBottom: space.xs,
      gap: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    reminderHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reminderTitle: { ...type.body, fontWeight: '600', color: colors.text },
    reminderTimesRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
    reminderTimeLabel: { ...type.caption, color: colors.muted, marginRight: space.xs },
    reminderHint: { ...type.caption, color: colors.muted },
    // Botões (via <Button>): aqui só o layout do contêiner de ações.
    actions: {
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      gap: space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    actionButton: { alignSelf: 'stretch' },
  });
}
