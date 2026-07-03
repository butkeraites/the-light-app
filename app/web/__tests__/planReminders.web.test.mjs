// planReminders.web.test.mjs — F5.13 (ADR-0042; molde keystore.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser, SEM rede) dos LEMBRETES LOCAIS do plano de
// leitura (`app/lib/planReminders*.ts`). `expo-notifications` é nativo (não roda em node),
// então injetamos um `NotificationsBackend` FAKE que REGISTRA as chamadas + um KV de prefs
// FAKE em memória, e exercitamos a LÓGICA de forma determinística — NENHUMA notificação real:
//   1) OPT-IN OFF por padrão: sem pref salva, `getReminder()` = null; nada foi agendado nem
//      nenhuma permissão pedida ao só ler.
//   2) LIGAR agenda EXATAMENTE UMA notificação DIÁRIA no horário escolhido (hora/minuto
//      corretos); a pref (enabled+time+id) persiste no KV sob a chave NAMESPACEADA da F5.2.
//   3) DESLIGAR cancela a notificação agendada (pelo id salvo) e remove a pref.
//   4) TROCAR HORÁRIO com o lembrete ligado cancela o agendamento anterior e agenda UM novo
//      (sem duplicar) no novo horário.
//   5) PERMISSÃO NEGADA: pede permissão SÓ no opt-in; se negada, NÃO agenda e deixa OFF.
//   6) PERSISTÊNCIA: a pref SOBREVIVE a uma nova instância do serviço sobre o MESMO storage
//      (reabrir o app) e re-hidrata enabled+time.
//   7) OFFLINE-FIRST ESTRUTURAL: o backend fake NÃO tem método de push token/rede; e um grep
//      do fonte de planReminders(.shared/.web) garante que NÃO há `getExpoPushTokenAsync`/
//      `getDevicePushTokenAsync`/`fetch(`/`http` — estritamente LOCAL, sem servidor/conta.
//   8) parseHHMM: valida `HH:MM` e rejeita malformado/fora de faixa; formatHHMM zero-pad.
//   9) HIGIENE: nenhum `console.*` nos fontes (nada logado; privacidade).
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'planReminders-headless-entry.ts');
const SHARED_TS = join(__dirname, '..', '..', 'lib', 'planReminders.shared.ts');
const NATIVE_TS = join(__dirname, '..', '..', 'lib', 'planReminders.ts');
const WEB_TS = join(__dirname, '..', '..', 'lib', 'planReminders.web.ts');

async function loadBundle() {
  const outfile = join(tmpdir(), `planReminders-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    // Os backends padrão importam módulos nativos de forma lazy; a prova injeta fakes e
    // nunca os aciona — mantê-los EXTERNAL evita puxar o módulo nativo p/ node.
    external: ['expo-notifications', 'expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

// KV de prefs FAKE em memória (subconjunto get/set/remove). Espelha o storage local.
function makeMemPrefsBackend() {
  const store = new Map();
  return {
    store,
    async getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
  };
}

// NotificationsBackend FAKE que REGISTRA as chamadas (sem device, sem notificação real).
// Modela permissão realista: `initialGranted` = status ao CHECAR (fresh install =
// 'undetermined' → false); `requestGranted` = resultado do PROMPT (opt-in). Default: fresh
// opt-in (checa "ainda não", pede e concede). Emite ids determinísticos `notif-<n>`.
function makeFakeNotifications({ initialGranted = false, requestGranted = true } = {}) {
  const calls = {
    getPermission: 0,
    requestPermission: 0,
    scheduled: [], // { id, hour, minute, title, body, channelName }
    canceled: [], // ids
  };
  let seq = 0;
  return {
    calls,
    async getPermissionGranted() {
      calls.getPermission += 1;
      return initialGranted;
    },
    async requestPermission() {
      calls.requestPermission += 1;
      return requestGranted;
    },
    async scheduleDailyReminder(input) {
      const id = `notif-${(seq += 1)}`;
      calls.scheduled.push({ id, ...input });
      return id;
    },
    async cancelReminder(id) {
      calls.canceled.push(id);
    },
  };
}

async function main() {
  const { REMINDER_PREF_KEY, createPlanReminders, formatHHMM, parseHHMM, createPrefs, prefIdFor } =
    await loadBundle();

  // ══ (8) parseHHMM / formatHHMM (puros) ═════════════════════════════════════════════════
  assert.deepEqual(parseHHMM('08:30'), { hour: 8, minute: 30 }, "parseHHMM('08:30')");
  assert.deepEqual(parseHHMM('6:05'), { hour: 6, minute: 5 }, "parseHHMM('6:05')");
  assert.deepEqual(parseHHMM('23:59'), { hour: 23, minute: 59 }, "parseHHMM('23:59')");
  assert.deepEqual(parseHHMM('00:00'), { hour: 0, minute: 0 }, "parseHHMM('00:00')");
  assert.equal(parseHHMM('24:00'), null, "parseHHMM rejeita hora 24");
  assert.equal(parseHHMM('12:60'), null, 'parseHHMM rejeita minuto 60');
  assert.equal(parseHHMM('8h30'), null, 'parseHHMM rejeita formato inválido');
  assert.equal(parseHHMM('abc'), null, 'parseHHMM rejeita não-numérico');
  assert.equal(parseHHMM(''), null, 'parseHHMM rejeita vazio');
  assert.equal(formatHHMM(8, 5), '08:05', 'formatHHMM zero-pad');
  assert.equal(formatHHMM(21, 0), '21:00', 'formatHHMM 21:00');

  // ══ (1) OPT-IN OFF por padrão ══════════════════════════════════════════════════════════
  const prefsBackend = makeMemPrefsBackend();
  const prefs = createPrefs(prefsBackend);
  const notif = makeFakeNotifications(); // fresh opt-in: checa "ainda não" → pede → concede
  const reminders = createPlanReminders(notif, prefs);

  assert.equal(await reminders.getReminder(), null, 'sem pref salva → getReminder() = null');
  assert.equal(notif.calls.scheduled.length, 0, 'nada agendado ao só ler');
  assert.equal(notif.calls.getPermission, 0, 'nenhuma permissão checada ao só ler (opt-in)');
  assert.equal(notif.calls.requestPermission, 0, 'nenhuma permissão SOLICITADA no boot/leitura');

  // ══ (2) LIGAR agenda EXATAMENTE UMA notificação diária no horário escolhido ═════════════
  const res = await reminders.enableReminder({
    time: '07:15',
    title: 'Hora da leitura',
    body: 'Continue seu plano: Nome do Plano',
    channelName: 'Lembretes de leitura',
  });
  assert.equal(res.status, 'scheduled', 'enable → status scheduled');
  assert.equal(notif.calls.scheduled.length, 1, 'EXATAMENTE uma notificação agendada');
  assert.equal(notif.calls.scheduled[0].hour, 7, 'agendada às 07h');
  assert.equal(notif.calls.scheduled[0].minute, 15, 'agendada aos 15min');
  assert.equal(
    notif.calls.scheduled[0].body,
    'Continue seu plano: Nome do Plano',
    'corpo = cromo i18n + NOME do plano (verbatim do core)',
  );
  assert.equal(notif.calls.requestPermission, 1, 'permissão pedida SÓ no opt-in (1x)');
  assert.equal(notif.calls.canceled.length, 0, 'nada cancelado na 1ª ativação');

  // Pref persiste (enabled+time+id) sob a chave NAMESPACEADA da F5.2, NÃO a chave crua.
  const saved = await reminders.getReminder();
  assert.ok(saved, 'pref de lembrete presente após ligar');
  assert.equal(saved.enabled, true, 'pref.enabled = true');
  assert.equal(saved.time, '07:15', 'pref.time = 07:15');
  assert.equal(saved.id, 'notif-1', 'pref.id = id do agendamento (p/ cancelar)');
  assert.equal(prefIdFor(REMINDER_PREF_KEY), 'tla.pref.plans.reminder', 'chave namespaceada');
  assert.ok(prefsBackend.store.has('tla.pref.plans.reminder'), 'gravado sob a chave namespaceada');
  assert.ok(!prefsBackend.store.has(REMINDER_PREF_KEY), 'a chave CRUA não é usada no storage');

  // ══ (6) PERSISTÊNCIA: sobrevive a nova instância (reabrir o app) ════════════════════════
  const remindersReopened = createPlanReminders(makeFakeNotifications(), createPrefs(prefsBackend));
  const reopened = await remindersReopened.getReminder();
  assert.ok(reopened, 'pref SOBREVIVE a uma nova instância (reabrir o app)');
  assert.equal(reopened.enabled, true, 're-hidrata enabled=true');
  assert.equal(reopened.time, '07:15', 're-hidrata time=07:15');

  // ══ (4) TROCAR HORÁRIO com o lembrete ligado: cancela o anterior + agenda UM novo ═══════
  const res2 = await reminders.enableReminder({
    time: '21:00',
    title: 'Hora da leitura',
    body: 'Continue seu plano: Nome do Plano',
    channelName: 'Lembretes de leitura',
  });
  assert.equal(res2.status, 'scheduled', 'reagendar → scheduled');
  assert.deepEqual(notif.calls.canceled, ['notif-1'], 'cancelou o agendamento ANTERIOR (notif-1)');
  assert.equal(notif.calls.scheduled.length, 2, 'agendou de novo (total 2 chamadas)');
  assert.equal(notif.calls.scheduled[1].hour, 21, 'novo agendamento às 21h');
  assert.equal(notif.calls.scheduled[1].minute, 0, 'novo agendamento aos 0min');
  const afterReschedule = await reminders.getReminder();
  assert.equal(afterReschedule.time, '21:00', 'pref atualizada p/ 21:00');
  assert.equal(afterReschedule.id, 'notif-2', 'pref aponta p/ o NOVO id (notif-2)');

  // ══ (3) DESLIGAR cancela a notificação agendada (id salvo) e remove a pref ══════════════
  await reminders.disableReminder();
  assert.deepEqual(
    notif.calls.canceled,
    ['notif-1', 'notif-2'],
    'desligar cancelou o agendamento corrente (notif-2)',
  );
  assert.equal(await reminders.getReminder(), null, 'pref removida após desligar');
  assert.ok(!prefsBackend.store.has('tla.pref.plans.reminder'), 'storage sem a entrada após desligar');

  // ══ (5) PERMISSÃO NEGADA: pede SÓ no opt-in; se negada, NÃO agenda e deixa OFF ══════════
  const denyPrefsBackend = makeMemPrefsBackend();
  const denyNotif = makeFakeNotifications({ requestGranted: false });
  const denyReminders = createPlanReminders(denyNotif, createPrefs(denyPrefsBackend));
  const denied = await denyReminders.enableReminder({
    time: '08:00',
    title: 'Hora da leitura',
    body: 'Continue seu plano: X',
    channelName: 'Lembretes de leitura',
  });
  assert.equal(denied.status, 'permission-denied', 'permissão negada → status permission-denied');
  assert.equal(denyNotif.calls.requestPermission, 1, 'permissão FOI solicitada (opt-in)');
  assert.equal(denyNotif.calls.scheduled.length, 0, 'NADA agendado sem permissão');
  assert.equal(await denyReminders.getReminder(), null, 'lembrete permanece OFF (sem pref)');

  // ══ (5b) PERMISSÃO JÁ CONCEDIDA: não re-pergunta (checa e agenda direto) ═════════════════
  const grantedNotif = makeFakeNotifications({ initialGranted: true });
  const grantedReminders = createPlanReminders(grantedNotif, createPrefs(makeMemPrefsBackend()));
  const already = await grantedReminders.enableReminder({
    time: '08:00',
    title: 'Hora da leitura',
    body: 'Continue seu plano: Y',
    channelName: 'Lembretes de leitura',
  });
  assert.equal(already.status, 'scheduled', 'já concedida → agenda direto');
  assert.equal(grantedNotif.calls.getPermission, 1, 'checa o status uma vez');
  assert.equal(grantedNotif.calls.requestPermission, 0, 'NÃO re-pergunta quando já concedida');
  assert.equal(grantedNotif.calls.scheduled.length, 1, 'agenda exatamente uma vez');

  // ══ (7) OFFLINE-FIRST ESTRUTURAL: sem push token / rede em NENHUM fonte ════════════════
  const sharedSrc = await readFile(SHARED_TS, 'utf8');
  const nativeSrc = await readFile(NATIVE_TS, 'utf8');
  const webSrc = await readFile(WEB_TS, 'utf8');
  for (const [label, src] of [
    ['planReminders.shared.ts', sharedSrc],
    ['planReminders.ts', nativeSrc],
    ['planReminders.web.ts', webSrc],
  ]) {
    // Comentários citam esses nomes p/ NEGÁ-los; asseguramos que não são CHAMADOS.
    assert.ok(
      !/\bgetExpoPushTokenAsync\s*\(/.test(src),
      `${label}: nunca CHAMA getExpoPushTokenAsync (sem push token)`,
    );
    assert.ok(
      !/\bgetDevicePushTokenAsync\s*\(/.test(src),
      `${label}: nunca CHAMA getDevicePushTokenAsync (sem push token)`,
    );
    assert.ok(!/\bfetch\s*\(/.test(src), `${label}: nunca chama fetch (sem rede)`);
    assert.ok(!/https?:\/\//.test(src), `${label}: nenhuma URL http(s) (sem servidor)`);
    assert.ok(!/console\./.test(src), `${label}: sem console.* (nada logado — privacidade)`);
  }
  // O backend fake NÃO expõe método de push token/rede (superfície LOCAL por construção).
  assert.equal(
    typeof notif.getExpoPushTokenAsync,
    'undefined',
    'o NotificationsBackend não tem superfície de push token',
  );

  console.log('PASS — lembretes LOCAIS do plano (backend fake, sem device/rede, nenhuma notificação real):');
  console.log('  opt-in OFF por padrão: getReminder()=null; nenhuma permissão pedida ao ler');
  console.log('  ligar: EXATAMENTE 1 agendamento DIÁRIO às 07:15; pref (enabled+time+id) sob tla.pref.plans.reminder');
  console.log('  trocar horário: cancela notif-1 e agenda notif-2 às 21:00 (sem duplicar)');
  console.log('  desligar: cancela notif-2 e remove a pref');
  console.log('  permissão negada: pede SÓ no opt-in; sem permissão → nada agendado, fica OFF');
  console.log('  persistência: sobrevive a nova instância (reabrir); re-hidrata enabled+time');
  console.log('  offline-first: sem getExpoPushTokenAsync/getDevicePushTokenAsync/fetch/URL em shared/native/web; sem console.*');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
