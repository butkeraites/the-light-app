// app/components/SyncSettings.tsx — F5.26 (ADR-0054, costura ADR-0036 / F5.23–25)
//
// TELA/SEÇÃO de SINCRONIZAÇÃO OPT-IN + BACKUP. Costura toda a trilha de sync:
//   • F5.23 (`userdataSnapshot`) — export/import manual do snapshot (todos os alvos);
//   • F5.24 (`driveAuth`) — link/unlink do Google Drive (web);
//   • F5.25 (`driveSync`) — "Sincronizar agora" (web);
//   • F5.26 aqui — o adaptador `SnapshotStore`→store REAL (`snapshotStore[.web].ts`) +
//     o flag OPT-IN (OFF por padrão, `syncPrefs`) + a UI (privacidade, offline-first).
//
// OFFLINE-FIRST EXPLÍCITO (regra dura): o interruptor de sync é **OFF por padrão** e a
// tela DIZ, com destaque, que "o app funciona 100% offline sem isto". Enquanto OFF, o
// app NÃO acessa a rede nem uma conta — ZERO rede sem ação explícita. O backup manual
// (export/import) é 100% LOCAL (sem rede) e fica disponível sempre; o Google Drive só
// aparece no WEB e SÓ quando o opt-in está ON.
//
// SEM CHAMADA REAL AO GOOGLE nesta tarefa (a validação com conta real é a F5.27, gate
// humano): o motor da F5.25 está LIGADO, mas sua rede real só é exercida com uma conta
// linkada de verdade + um client-id configurado (BYOK/F5.27). Sem client-id configurado
// (default), o "Conectar" fica gated com aviso e NADA vai à rede. O token do Drive vive
// só em memória de sessão (F5.24 TokenStore) e NUNCA é logado nem gravado no repo.
//
// PERF (F5.19): este componente é carregado SOB DEMANDA (`import()`) pela Home, e seus
// motores pesados (snapshot/driveAuth/driveSync) são `import()` no limite de chamada —
// ficam FORA do entry eager do 1º paint (moduleCount travado).
//
// i18n/a11y/tema: TODO cromo via `t()` (PT/EN), interativos com role+label, cores por
// TOKENS de tema (zero hex). Nenhum texto bíblico/dado do store passa por `t()`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useI18n, type TranslateFn } from '../lib/i18n';
import { useTheme, type ThemeColors } from '../lib/theme';
import { getSyncOptIn, setSyncOptIn } from '../lib/syncPrefs';
import type { StoredToken } from '../lib/driveAuth';

// Client-id PÚBLICO do Google Drive (BYOK/config) — ausente por padrão (offline-first;
// NUNCA há segredo no repo). Sem ele, "Conectar" fica gated (real = F5.27). Lido do env
// público do Expo (não é secreto: client-id de cliente público OAuth, sem client-secret).
const DRIVE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID ?? '';
const DRIVE_CONFIGURED = DRIVE_CLIENT_ID.length > 0;

// Nome do arquivo de backup exportado no web (download). Só infra (não é cromo/dado).
const BACKUP_FILENAME = 'the-light-app-backup.json';

// TokenStore de SESSÃO (só memória, perdido ao recarregar) — molde da F5.24. O token do
// Drive NUNCA é persistido em storage comum nem logado. Vazio por padrão → "não conectado".
let sessionToken: StoredToken | null = null;
const sessionTokenStore = {
  async get(): Promise<StoredToken | null> {
    return sessionToken;
  },
  async set(token: StoredToken): Promise<void> {
    sessionToken = token;
  },
  async clear(): Promise<void> {
    sessionToken = null;
  },
};

// Estado do último resultado como DADO (traduzido no render): contadores/erro são DADOS
// só interpolados — nunca strings de cromo pré-montadas (reativo ao idioma).
type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'exported'; notes: number; highlights: number }
  | { kind: 'imported'; notes: number; highlights: number }
  | { kind: 'error'; message: string };

/** Abre o store REAL do usuário (nativo fs / web OPFS) já ligado ao `dataDir`. */
async function openRealStore() {
  const { ensureUserDataDir } = await import('../lib/userdata');
  const dataDir = await ensureUserDataDir();
  if (Platform.OS === 'web') {
    // O validador/formatador de referência do web é síncrono e exige o wasm pronto.
    const { ensureWasmReady } = await import('../web/wasm');
    await ensureWasmReady();
  }
  const { createRealSnapshotStore } = await import('../lib/snapshotStore');
  return createRealSnapshotStore(dataDir);
}

export function SyncSettings({ onClose }: { onClose?: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // `undefined` = carregando a preferência (sem flicker do interruptor).
  const [optIn, setOptIn] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  const [importText, setImportText] = useState('');
  const [driveLinked, setDriveLinked] = useState(false);

  const isWeb = Platform.OS === 'web';

  // Boot: lê o opt-in persistido (DEFAULT OFF). Falha → trata como OFF (offline-first).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await getSyncOptIn();
        if (alive) {
          setOptIn(saved);
        }
      } catch {
        if (alive) {
          setOptIn(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Ao ligar o opt-in no web, lê o estado de link do Drive (SÓ leitura do TokenStore de
  // sessão — SEM rede). Vazio por padrão → não conectado.
  useEffect(() => {
    if (optIn !== true || !isWeb) {
      setDriveLinked(false);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const auth = await makeDriveAuth();
        const linked = await auth.isLinked();
        if (alive) {
          setDriveLinked(linked);
        }
      } catch {
        if (alive) {
          setDriveLinked(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [optIn, isWeb]);

  const onToggleOptIn = useCallback(async (value: boolean) => {
    setOptIn(value); // otimista (o toggle responde na hora)
    try {
      await setSyncOptIn(value);
    } catch {
      /* falha de persistência tolerada (offline-first) — o default é OFF */
    }
  }, []);

  const setError = useCallback((err: unknown) => {
    // A mensagem de erro NUNCA carrega token/segredo (os motores citam só status HTTP).
    setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }, []);

  // EXPORTAR: monta o snapshot do store REAL (F5.23) e o entrega pelo transporte do alvo
  // (web = download de arquivo; nativo = Share sheet). 100% local, sem rede.
  const onExport = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const store = await openRealStore();
      const { exportSnapshot, serializeSnapshot } = await import('../lib/userdataSnapshot');
      const snapshot = await exportSnapshot(store);
      const json = serializeSnapshot(snapshot);
      if (isWeb) {
        downloadJsonWeb(json, BACKUP_FILENAME);
      } else {
        await Share.share({ message: json, title: t('sync.title') });
      }
      setStatus({ kind: 'exported', notes: snapshot.notes.length, highlights: snapshot.highlights.length });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, isWeb, t, setError]);

  // IMPORTAR (merge determinístico da F5.23 sobre o estado atual): valida app/versão/tipos
  // + toda referência REAL (core) ANTES de tocar o store; aplica só o diff. 100% local.
  const runImport = useCallback(
    async (json: string) => {
      const trimmed = json.trim();
      if (busy || trimmed.length === 0) {
        return;
      }
      setBusy(true);
      try {
        const store = await openRealStore();
        const { importSnapshotIntoStore } = await import('../lib/userdataSnapshot');
        const res = await importSnapshotIntoStore(trimmed, store);
        setStatus({ kind: 'imported', notes: res.applied.notes, highlights: res.applied.highlights });
        setImportText('');
      } catch (err) {
        setError(err);
      } finally {
        setBusy(false);
      }
    },
    [busy, setError],
  );

  const onImportPasted = useCallback(() => {
    void runImport(importText);
  }, [runImport, importText]);

  // Escolher arquivo (web): file picker do navegador → texto → import.
  const onImportFile = useCallback(() => {
    if (!isWeb) {
      return;
    }
    void pickJsonFileWeb().then((text) => {
      if (text != null) {
        void runImport(text);
      }
    });
  }, [isWeb, runImport]);

  // DESCONECTAR: limpa o TokenStore de SESSÃO (idempotente, SEM rede).
  const onDriveUnlink = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const auth = await makeDriveAuth();
      await auth.unlink();
      setDriveLinked(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, setError]);

  // SINCRONIZAR AGORA (motor da F5.25): só habilita com conta linkada de verdade — o que,
  // nesta versão, é a F5.27 (gate humano). Sem link, não faz nada (ZERO rede aqui).
  const onDriveSyncNow = useCallback(async () => {
    if (busy || !driveLinked) {
      return;
    }
    setBusy(true);
    try {
      const auth = await makeDriveAuth();
      const store = await openRealStore();
      const { createDriveSync } = await import('../lib/driveSync');
      const globalFetch = (globalThis as { fetch?: unknown }).fetch as never;
      const sync = createDriveSync({ fetch: globalFetch, getToken: () => auth.currentToken(), store });
      const res = await sync.syncNow();
      setStatus({
        kind: 'imported',
        notes: res.pulled.applied.notes,
        highlights: res.pulled.applied.highlights,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, driveLinked, setError]);

  // Enquanto carrega a preferência: só o cabeçalho + offline-first (sem piscar o toggle).
  const optInReady = optIn !== undefined;

  const statusText = renderStatus(status, t);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title} accessibilityRole="header">
          {t('sync.title')}
        </Text>
        {onClose ? (
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.syncClose')}
            testID="sync-close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>{t('common.close')}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* OFFLINE-FIRST em DESTAQUE (o app funciona 100% offline sem isto). */}
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineText}>{t('sync.offlineFirst')}</Text>
      </View>

      {/* Interruptor OPT-IN — OFF por padrão. */}
      <View style={styles.section}>
        <View style={styles.optInRow}>
          <View style={styles.optInLabelWrap}>
            <Text style={styles.sectionTitle}>{t('sync.optInLabel')}</Text>
            <Text style={styles.hint}>{t('sync.optInHint')}</Text>
          </View>
          <Switch
            value={optIn === true}
            onValueChange={onToggleOptIn}
            disabled={!optInReady || busy}
            accessibilityRole="switch"
            accessibilityLabel={t('a11y.syncOptIn')}
            trackColor={{ true: colors.accent, false: colors.divider }}
            testID="sync-optin-toggle"
          />
        </View>
      </View>

      {/* AVISO DE PRIVACIDADE — o que sincroniza vs. o que NUNCA sai do aparelho. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('sync.privacyTitle')}</Text>
        <Text style={styles.body}>{t('sync.privacySyncs')}</Text>
        <Text style={styles.body}>{t('sync.privacyNever')}</Text>
        <Text style={styles.hint}>{t('sync.noTelemetry')}</Text>
      </View>

      {/* BACKUP MANUAL (todos os alvos, 100% local, sem conta/rede). */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('sync.manualTitle')}</Text>
        <Text style={styles.hint}>{t('sync.manualHint')}</Text>
        <Pressable
          onPress={onExport}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.syncExport')}
          testID="sync-export"
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
        >
          <Text style={styles.primaryButtonText}>{t('sync.exportButton')}</Text>
        </Pressable>

        <Text style={[styles.sectionTitle, styles.importTitle]}>{t('sync.importTitle')}</Text>
        <TextInput
          style={styles.importField}
          value={importText}
          onChangeText={setImportText}
          placeholder={t('sync.importPlaceholder')}
          placeholderTextColor={colors.muted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t('a11y.syncImportField')}
          testID="sync-import-input"
        />
        <View style={styles.buttonRow}>
          <Pressable
            onPress={onImportPasted}
            disabled={busy || importText.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.syncImport')}
            testID="sync-import"
            style={[
              styles.secondaryButton,
              (busy || importText.trim().length === 0) && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.secondaryButtonText}>{t('sync.importButton')}</Text>
          </Pressable>
          {isWeb ? (
            <Pressable
              onPress={onImportFile}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.syncImportFile')}
              testID="sync-import-file"
              style={[styles.secondaryButton, busy && styles.buttonDisabled]}
            >
              <Text style={styles.secondaryButtonText}>{t('sync.importFileButton')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* GOOGLE DRIVE — só web + só com o opt-in ON. */}
      {optIn === true ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('sync.driveTitle')}</Text>
          {!isWeb ? (
            <Text style={styles.hint}>{t('sync.driveWebOnly')}</Text>
          ) : (
            <>
              <Text style={styles.body}>
                {driveLinked ? t('sync.driveStatusLinked') : t('sync.driveStatusUnlinked')}
              </Text>
              <Text style={styles.hint}>{t('sync.driveNotConfigured')}</Text>
              <View style={styles.buttonRow}>
                <Pressable
                  onPress={undefined}
                  disabled={!DRIVE_CONFIGURED || busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.syncDriveLink')}
                  testID="drive-link"
                  style={[styles.secondaryButton, (!DRIVE_CONFIGURED || busy) && styles.buttonDisabled]}
                >
                  <Text style={styles.secondaryButtonText}>{t('sync.driveLink')}</Text>
                </Pressable>
                <Pressable
                  onPress={onDriveUnlink}
                  disabled={!driveLinked || busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.syncDriveUnlink')}
                  testID="drive-unlink"
                  style={[styles.secondaryButton, (!driveLinked || busy) && styles.buttonDisabled]}
                >
                  <Text style={styles.secondaryButtonText}>{t('sync.driveUnlink')}</Text>
                </Pressable>
                <Pressable
                  onPress={onDriveSyncNow}
                  disabled={!driveLinked || busy}
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.syncDriveSyncNow')}
                  testID="drive-sync-now"
                  style={[styles.primaryButton, (!driveLinked || busy) && styles.buttonDisabled]}
                >
                  <Text style={styles.primaryButtonText}>{t('sync.driveSyncNow')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      ) : null}

      {/* Estado do último resultado (cromo + contadores/erro interpolados). */}
      <View style={styles.statusRow}>
        {busy ? <ActivityIndicator color={colors.text} /> : null}
        {statusText ? (
          <Text
            style={status.kind === 'error' ? styles.errorText : styles.statusText}
            accessibilityRole="text"
            testID="sync-status"
          >
            {statusText}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

// Cria o serviço de auth do Drive (F5.24) sobre o TokenStore de SESSÃO + fetch/crypto do
// runtime. Instanciar NÃO faz rede (só monta o serviço); as leituras usadas aqui
// (`isLinked`/`unlink`) NÃO tocam a rede. `beginLink`/consent real = F5.27.
async function makeDriveAuth() {
  const { createDriveAuth } = await import('../lib/driveAuth');
  const g = globalThis as { fetch?: unknown; crypto?: unknown };
  return createDriveAuth({
    clientId: DRIVE_CLIENT_ID,
    redirectUri: typeof location !== 'undefined' ? location.origin : '',
    tokenStore: sessionTokenStore,
    fetch: g.fetch as never,
    crypto: g.crypto as never,
  });
}

// Traduz o estado de resultado NO RENDER (reativo ao idioma). Contadores/erro são DADOS.
function renderStatus(status: SyncStatus, t: TranslateFn): string {
  switch (status.kind) {
    case 'exported':
      return t('sync.statusExported', { notes: status.notes, highlights: status.highlights });
    case 'imported':
      return t('sync.statusImported', { notes: status.notes, highlights: status.highlights });
    case 'error':
      return t('sync.statusError', { message: status.message });
    default:
      return '';
  }
}

// Download de um blob JSON no WEB (sem rede — origem local). Guardado por `Platform.OS`.
function downloadJsonWeb(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// File picker do navegador (WEB): resolve o texto do arquivo escolhido, ou `null` se
// cancelado. Sem rede (leitura local do arquivo). Guardado por `Platform.OS`.
function pickJsonFileWeb(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve(text)).catch(() => resolve(null));
    };
    input.click();
  });
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 18 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 22, fontWeight: '700', color: colors.text },
    closeButton: { paddingVertical: 8, paddingHorizontal: 8 },
    closeButtonText: { fontSize: 15, fontWeight: '600', color: colors.accent },
    offlineBanner: {
      padding: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.chipActiveBg,
    },
    offlineText: { fontSize: 15, fontWeight: '600', color: colors.chipActiveText },
    section: {
      gap: 8,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    importTitle: { marginTop: 8 },
    body: { fontSize: 14, color: colors.text, lineHeight: 20 },
    hint: { fontSize: 13, color: colors.muted, lineHeight: 18 },
    optInRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    optInLabelWrap: { flex: 1, gap: 4 },
    importField: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 10,
      minHeight: 88,
      fontSize: 14,
      color: colors.text,
      textAlignVertical: 'top',
    },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    primaryButton: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.chipActiveBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: { fontSize: 15, fontWeight: '700', color: colors.chipActiveText },
    secondaryButton: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: { fontSize: 15, fontWeight: '600', color: colors.text },
    buttonDisabled: { opacity: 0.5 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
    statusText: { fontSize: 14, color: colors.accent, flex: 1 },
    errorText: { fontSize: 14, color: colors.error, flex: 1 },
  });
}
