// app/components/AiProviderNotice.tsx — F5.37 (clareza de UX: recursos de IA precisam de provedor)
//
// COMPONENTE COMPARTILHADO pelos 4 painéis de IA (Perguntar/Estudo/Comparar/Conversa). Quando
// NENHUM provedor de IA está configurado (nem chave BYOK de Claude/GPT/Gemini nem Ollama no
// cofre), o painel exibe este AVISO CLARO E ACIONÁVEL — em vez de um erro cru ou tela vazia que
// pareça "app quebrado". Diz que o recurso usa IA, como configurar um provedor (BYOK) e um
// botão que leva à tela de AJUSTES (F6.6 — hub canônico de chave BYOK, com campos por provedor).
// Reassegura, ainda, que os recursos OFFLINE (leitura/busca/notas/planos) funcionam sem provedor.
//
// OFFLINE-FIRST / BYOK / anti-alucinação: este componente é 100% CROMO — não lê chave/valor,
// não toca rede, não exibe texto bíblico. Só o hook `useConfiguredAiProviders` consulta o cofre,
// e APENAS os NOMES dos provedores com chave (nunca os valores) — o mesmo `listProviders()` do
// keystore. Todo texto via `t()` (paridade pt/en); cores por TOKENS de tema (zero hex).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { listProviders } from '../lib/keystore';
import { useTheme, type ThemeColors } from '../lib/theme';

/**
 * Hook: descobre se HÁ algum provedor de IA configurado (NOMES com chave no cofre, nunca os
 * valores). `active` (ex.: `visible` do painel) dispara/repete a checagem ao abrir. Retorna
 * `checked` (true após a 1ª leitura resolver — evita piscar o aviso antes de saber), a lista
 * de NOMES de provedores com chave, e `refresh()` para reler o cofre sob demanda (ex.: após o
 * `ReaderAskPanel` salvar uma chave inline). Falha de leitura → lista vazia (best-effort,
 * offline-first).
 */
export function useConfiguredAiProviders(active: boolean): {
  checked: boolean;
  providers: string[];
  refresh: () => void;
} {
  const [providers, setProviders] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  // Um contador que, ao mudar, re-executa a leitura do cofre (re-checagem sob demanda).
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!active) {
      return;
    }
    let alive = true;
    setChecked(false);
    (async () => {
      try {
        const withKey = await listProviders();
        if (alive) {
          setProviders(withKey);
          setChecked(true);
        }
      } catch {
        // Sem indicadores → tratamos como "nenhum provedor" (o aviso ajuda o usuário a configurar).
        if (alive) {
          setProviders([]);
          setChecked(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [active, nonce]);

  return { checked, providers, refresh };
}

/**
 * Aviso "sem provedor de IA configurado" + CTA. `onConfigure` deve fechar o painel e navegar à
 * tela de AJUSTES (F6.6 — onde a chave BYOK é inserida, campos por provedor) — o painel injeta o
 * handler, pois é ele quem detém o `onClose`/navegação.
 */
export function AiProviderNotice({ onConfigure }: { onConfigure: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.card} testID="ai-provider-notice">
      <Text style={styles.title} accessibilityRole="header">
        {t('ai.noProviderTitle')}
      </Text>
      <Text style={styles.body}>{t('ai.noProviderBody')}</Text>
      <Text style={styles.offline}>{t('ai.noProviderOffline')}</Text>
      <Pressable
        style={styles.cta}
        onPress={onConfigure}
        testID="ai-provider-configure"
        accessibilityRole="button"
        accessibilityLabel={t('a11y.aiConfigure')}
      >
        <Text style={styles.ctaText}>{t('ai.noProviderCta')}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      gap: 6,
    },
    title: { fontSize: 14, fontWeight: '700', color: colors.text },
    body: { fontSize: 14, lineHeight: 20, color: colors.text },
    offline: { fontSize: 12, lineHeight: 18, color: colors.muted },
    cta: {
      marginTop: 6,
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.chipActiveBg,
    },
    ctaText: { fontSize: 14, fontWeight: '700', color: colors.chipActiveText },
  });
}
