// app/components/ProviderPicker.tsx — deepening (ADR-0059): seam de seleção de provedor/BYOK
//
// O SEAM PROFUNDO dos 3 painéis single-select de IA (Perguntar/Conversa/Estudo). Concentra o que
// era quase-clone em cada um: o estado do provedor, a checagem do cofre (via `useConfiguredAiProviders`),
// as derivações BYOK (`isMock`/`providerHasKey`/`needsKey`/`showNoProviderNotice`), um `loadKey()`
// que lança o erro i18n de "precisa de chave", e o CHIP single-select idêntico (`<ProviderChips>`)
// com seus próprios estilos. O `ReaderComparePanel` (multi-select, badge/rótulo distintos) NÃO usa
// este módulo — só os helpers puros de `aiProviders`.
//
// O seam entrega SÓ seleção de provedor/chave — DESCONHECE `AiAnswer`: o `citedText`/`passageText`
// (verbatim do store) seguem SEPARADOS da interpretação, renderizados em cada painel (anti-alucinação
// intacta). `loadKey` lê a chave sob demanda e NUNCA a loga; `mock` = sem chave/rede.
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { getKey } from '../lib/keystore';
import {
  MOCK_PROVIDER,
  PROVIDER_OPTIONS_MOCK_FIRST,
  isMockProvider,
  keyArg,
  resolveProviderKey,
} from '../lib/aiProviders';
import { useTheme, type ThemeColors } from '../lib/theme';
import { useConfiguredAiProviders } from './AiProviderNotice';

/** Single-select provider state + BYOK-configured derivations, shared by Ask/Chat/Study. */
export interface ProviderSelection {
  provider: string;
  setProvider: (p: string) => void;
  /** Selector order: mock first, then BYOK reals. */
  options: readonly string[];
  isMock: boolean;
  /** True after the first vault check resolved (avoids flashing the no-provider notice). */
  providersChecked: boolean;
  /** NAMES of providers with a key in the vault — never the values. */
  providersWithKey: string[];
  providerHasKey: boolean;
  /** Real provider selected but no key → block the call, show CTA. */
  needsKey: boolean;
  /** No AI provider configured at all (checked + empty) → show AiProviderNotice. */
  showNoProviderNotice: boolean;
  /** Re-read the vault (after the Ask panel's inline key-save). */
  refresh: () => void;
  /**
   * Resolve the selected provider's key (undefined for mock), throwing the i18n needKey
   * error when a real provider has none. For the single-answer panels' call sites.
   */
  loadKey: () => Promise<string | undefined>;
}

/**
 * Estado de seleção de provedor + derivações BYOK, compartilhado por Perguntar/Conversa/Estudo.
 * `active` (o `visible` do painel) dispara a checagem do cofre ao abrir.
 */
export function useProviderSelection(active: boolean): ProviderSelection {
  const { t } = useI18n();
  const [provider, setProvider] = useState<string>(MOCK_PROVIDER);
  const { checked, providers, refresh } = useConfiguredAiProviders(active);
  const isMock = isMockProvider(provider);
  const providerHasKey = providers.includes(provider);
  const needsKey = !isMock && checked && !providerHasKey;
  const showNoProviderNotice = checked && providers.length === 0;
  const loadKey = useCallback(async () => {
    const res = await resolveProviderKey(provider, getKey);
    if (res.kind === 'no-key') {
      throw new Error(t('ask.needKeyError', { provider }));
    }
    return keyArg(res);
  }, [provider, t]);
  return {
    provider,
    setProvider,
    options: PROVIDER_OPTIONS_MOCK_FIRST,
    isMock,
    providersChecked: checked,
    providersWithKey: providers,
    providerHasKey,
    needsKey,
    showNoProviderNotice,
    refresh,
    loadKey,
  };
}

/**
 * Chips single-select de provedor (Perguntar/Conversa/Estudo). Dono dos próprios estilos. O
 * `testIdPrefix` preserva os testIDs estáveis por painel (`${prefix}-provider-${p}`). Cada chip
 * é um `Pressable` com role/rótulo/hitSlop (a11y-scan) e todos os textos via `t()` (i18n).
 */
export function ProviderChips({
  options,
  provider,
  providersWithKey,
  disabled,
  testIdPrefix,
  onSelect,
}: {
  options: readonly string[];
  provider: string;
  providersWithKey: string[];
  disabled: boolean;
  testIdPrefix: 'ask' | 'chat' | 'study' | 'scope';
  onSelect: (p: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeChipStyles(colors), [colors]);
  return (
    <View style={styles.providers}>
      {options.map((p) => {
        const active = provider === p;
        const real = !isMockProvider(p);
        const withKey = providersWithKey.includes(p);
        return (
          <Pressable
            key={p}
            style={[styles.provChip, active ? styles.provChipActive : null]}
            onPress={() => onSelect(p)}
            disabled={disabled}
            testID={`${testIdPrefix}-provider-${p}`}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              real
                ? withKey
                  ? t('a11y.providerWithKey', { provider: p })
                  : t('a11y.providerNoKey', { provider: p })
                : t('a11y.providerOffline', { provider: p })
            }
          >
            <Text style={[styles.provChipText, active ? styles.provChipTextActive : null]}>
              {p}
            </Text>
            <Text style={[styles.provKeyBadge, active ? styles.provChipTextActive : null]}>
              {real ? (withKey ? t('ask.keyBadgeYes') : t('ask.keyBadgeNo')) : t('ai.offlineBadge')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeChipStyles(colors: ThemeColors) {
  return StyleSheet.create({
    providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    provChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    provChipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    provChipText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
    provChipTextActive: { color: colors.chipActiveText },
    provKeyBadge: { fontSize: 11, color: colors.muted },
  });
}
