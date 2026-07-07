// app/app/settings.tsx — F6.6 (ADR-0023/0025 BYOK; molde about.tsx F5.35 + bloco de chave do Ask F2.5)
//
// TELA DE AJUSTES / CHAVES BYOK. É o HUB CANÔNICO onde o usuário configura as chaves dos
// provedores de IA (Claude/GPT/Gemini/Ollama). Antes, a entrada de chave só existia INLINE no
// painel Perguntar (Ask), e o CTA "configurar provedor" dos 4 painéis de IA (AiProviderNotice)
// levava à tela SOBRE — que só EXPLICA o BYOK, sem campos (beco sem saída). Agora os 4 CTAs
// aterrissam AQUI, e Estudo/Comparar/Conversa ganham um lugar para inserir a chave.
//
// ANTI-VAZAMENTO (LEI, ADR-0023): o STATUS de cada provedor vem de `listProviders()` — só os
// NOMES dos provedores COM chave, NUNCA o valor. Os inputs são `secureTextEntry`; nada loga,
// ecoa ou exibe uma chave. `setKey`/`deleteKey` são as ÚNICAS funções que tocam o valor.
//
// REALIDADE DA CHAVE (ADR-0025): no WEB o cofre é só-de-sessão (perdido no reload); no NATIVO,
// secure-store do device (Keychain/Keystore). Isso fica EXPLÍCITO na UI (`settings.keyStorageNote`)
// — nenhuma persistência nova de chave web é introduzida aqui.
//
// OFFLINE-FIRST / anti-alucinação: 100% CROMO — nenhum texto bíblico, nenhuma rede (o keystore é
// I/O local: secure-store no device / Map de sessão no web). i18n via `t()` (PT/EN); interativos
// com role+label+alvo de toque; cores por TOKENS de tema (zero hex). Reusa `SUPPORTED_PROVIDERS`
// e as funções do keystore compartilhado (mesma superfície nativa/web).
//
// NOTA DE DUPLICAÇÃO (deliberada): o bloco de chave do Ask (`ReaderAskPanel.tsx`) usa um SELETOR
// (chips) + 1 input p/ o provedor ativo; esta tela usa UMA LINHA POR PROVEDOR. As duas UIs são
// estruturalmente distintas, então a regra "só-nomes / secure-entry / nunca-vazar-valor" é
// espelhada aqui em vez de extrair um componente que serviria mal os dois formatos.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useI18n, type MessageKey, type TranslateFn } from '../lib/i18n';
import { deleteKey, listProviders, setKey, SUPPORTED_PROVIDERS } from '../lib/keystore';
import { useTheme, type ThemeColors, type ThemeContextValue } from '../lib/theme';
import { Button, Surface } from '../components/ui';

// F6.8 (ADR-0058): rótulo HONESTO da capacidade de cada provedor no alvo CORRENTE. No WEB, os
// provedores de nuvem (anthropic/openai/gemini) alcançam o navegador — a Anthropic via o header
// opt-in `anthropic-dangerous-direct-browser-access` (transporte web); o Ollama, por ser LOCAL,
// só é alcançável se o usuário liberar `OLLAMA_ORIGINS` do próprio lado (sem proxy — não prometemos
// o que o browser não entrega). No NATIVO (reqwest, sem CORS) TODOS funcionam. Só CROMO via `t()`.
function capabilityKey(provider: string): MessageKey {
  if (Platform.OS === 'web') {
    return provider === 'ollama' ? 'settings.capOllamaWeb' : 'settings.capBrowserOk';
  }
  return 'settings.capNative';
}

export default function SettingsScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // NOMES dos provedores COM chave no cofre (nunca os valores) — só p/ o status por-linha.
  const [providersWithKey, setProvidersWithKey] = useState<string[]>([]);

  // (Re)descobre quais provedores têm chave. Best-effort, offline-first: falha silenciosa
  // → tratamos como "nenhum configurado". Chamado no mount e após cada salvar/remover.
  const refresh = useCallback(async () => {
    try {
      const withKey = await listProviders();
      setProvidersWithKey(withKey);
    } catch {
      setProvidersWithKey([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const withKey = await listProviders();
        if (alive) setProvidersWithKey(withKey);
      } catch {
        if (alive) setProvidersWithKey([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="settings-screen"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('settings.title')}
      </Text>
      <Text style={styles.intro}>{t('settings.intro')}</Text>

      {/* Realidade da chave (web só-sessão / nativo cofre) — EXPLÍCITA, via t() (ADR-0025). */}
      <Surface elevated padded>
        <Text style={styles.note}>{t('settings.keyStorageNote')}</Text>
      </Surface>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('settings.providersTitle')}
        </Text>
        {/* Uma linha por provedor BYOK real (anthropic/openai/gemini/ollama). O status vem de
            `listProviders()` (só NOMES); o input é secure; o valor NUNCA é lido de volta. */}
        {SUPPORTED_PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider}
            provider={provider}
            configured={providersWithKey.includes(provider)}
            onChanged={refresh}
            styles={styles}
            colors={colors}
            t={t}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Linha de um provedor: nome + status (só-nome), input `secureTextEntry` p/ salvar (`setKey`),
 * e botão remover (`deleteKey`) quando há chave. O rascunho da chave é estado LOCAL, some ao
 * salvar e NUNCA é logado/exibido em claro (input mascarado). Ao salvar/remover, chama
 * `onChanged` p/ o pai re-consultar os NOMES com chave (nunca valores).
 */
function ProviderRow({
  provider,
  configured,
  onChanged,
  styles,
  colors,
  t,
}: {
  provider: string;
  configured: boolean;
  onChanged: () => Promise<void>;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  t: TranslateFn;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDisabled = busy || draft.trim().length === 0;

  async function onSave() {
    if (saveDisabled) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // ÚNICO ponto que toca o valor da chave: entregue direto a `setKey` (cofre). O rascunho
      // é limpo em seguida; o valor nunca é relido/exibido/logado.
      await setKey(provider, draft.trim());
      setDraft('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteKey(provider);
      setDraft('');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface padded style={styles.row} testID={`settings-provider-${provider}`}>
      <View style={styles.rowHeader}>
        {/* Nome do provedor = id técnico (dado), não cromo traduzível. */}
        <Text style={styles.providerName}>{provider}</Text>
        <Text
          style={configured ? styles.statusOn : styles.statusOff}
          testID={`settings-status-${provider}`}
        >
          {configured ? t('settings.statusConfigured') : t('settings.statusNotConfigured')}
        </Text>
      </View>

      {/* F6.8 (ADR-0058): capacidade HONESTA por provedor no alvo corrente (web = Ollama exige
          config local; nuvem funciona no navegador; nativo = todos). Só informa — não promete. */}
      <Text style={styles.capability} testID={`settings-capability-${provider}`}>
        {t(capabilityKey(provider))}
      </Text>

      <TextInput
        style={styles.keyInput}
        value={draft}
        onChangeText={setDraft}
        placeholder={t('settings.keyPlaceholder', { provider })}
        placeholderTextColor={colors.muted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!busy}
        testID={`settings-key-input-${provider}`}
        accessibilityLabel={t('a11y.byokKey', { provider })}
      />

      <View style={styles.rowActions}>
        <Button
          title={t('settings.saveKey')}
          onPress={onSave}
          loading={busy}
          disabled={saveDisabled}
          testID={`settings-key-save-${provider}`}
          accessibilityLabel={t('a11y.settingsSaveKey', { provider })}
        />
        {configured ? (
          <Button
            title={t('settings.removeKey')}
            variant="danger"
            onPress={onRemove}
            disabled={busy}
            testID={`settings-key-remove-${provider}`}
            accessibilityLabel={t('a11y.settingsRemoveKey', { provider })}
          />
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Surface>
  );
}

// Estilos derivados dos TOKENS de tema (zero hex). Cartões via <Surface>, botões via <Button>.
function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: space.xl, gap: space.md },
    title: { ...type.title, color: colors.text },
    intro: { ...type.body, color: colors.text },
    note: { ...type.caption, color: colors.muted, lineHeight: 19 },
    section: {
      gap: space.md,
      paddingTop: space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    sectionTitle: { ...type.heading, color: colors.text },
    // <Surface> traz fundo/borda/raio/padding; aqui só o espaçamento interno entre linhas.
    row: { gap: space.sm },
    rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    providerName: { ...type.body, fontWeight: '600', color: colors.text },
    statusOn: { ...type.caption, fontWeight: '600', color: colors.accent },
    statusOff: { ...type.caption, color: colors.muted },
    capability: { ...type.caption, color: colors.muted, lineHeight: 17 },
    keyInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      ...type.body,
      fontSize: 14,
      color: colors.verseText,
    },
    rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    error: { ...type.caption, color: colors.error, lineHeight: 18 },
  });
}
