// app/components/ReaderAskPanel.tsx — F2.5 (D3 BYOK / D4 streaming; ADR-0015 tema)
//
// Painel de ESTUDO ASSISTIDO ANCORADO (bottom sheet, molde do `ReaderVersePanel` da
// F1.11) aberto a partir da ação "Perguntar" do painel por-versículo. A partir de uma
// passagem selecionada, o usuário escolhe um PROVEDOR (mock + BYOK reais), digita uma
// pergunta e recebe a INTERPRETAÇÃO em STREAMING (token a token), com o TEXTO CITADO
// (verbatim do store) SEPARADO da interpretação (LLM) — anti-alucinação VISÍVEL.
//
// A UI SÓ chama a fronteira de IA (`askAnchoredStream`, F2.1/F2.3a via JSI) e APRESENTA
// o `AiAnswer`: NENHUM prompt/RAG/citação/streaming é reimplementado em TS (uma fonte da
// verdade — o texto bíblico e a interpretação vêm do Rust/core). NENHUMA resposta de IA
// é hardcoded. Cores via TOKENS de tema (`useTheme`).
//
// BYOK/offline-first (LEI): a chave é lida SOB DEMANDA via `keystore.getKey(provider)`
// e passada à fronteira — NUNCA é logada/impressa/exibida. Com o provedor `"mock"` não
// há chave nem rede (é o caminho da prova headless). O texto bíblico vem SEMPRE do store
// local, verbatim; o LLM só interpreta.
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useI18n } from '../lib/i18n';
import { getKey, listProviders, setKey, SUPPORTED_PROVIDERS } from '../lib/keystore';
import { useTheme, type ThemeColors } from '../lib/theme';
import { askAnchoredStream, type AiAnswer } from '../web/reading';

// Provedor determinístico OFFLINE (sem chave, sem rede): default seguro e o caminho da
// prova headless. NÃO está em `SUPPORTED_PROVIDERS` (que é só BYOK real) — é adicionado
// ao seletor apenas para o estudo offline.
const MOCK_PROVIDER = 'mock';
// Ordem do seletor: mock primeiro (default offline), depois os provedores BYOK reais.
const PROVIDER_OPTIONS: readonly string[] = [MOCK_PROVIDER, ...SUPPORTED_PROVIDERS];

/** Estimativa de custo SIMPLIFICADA (a fronteira não expõe custo): ~4 chars/token. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function ReaderAskPanel({
  visible,
  sourceLabel,
  reference,
  dbPath,
  translation,
  lang,
  onClose,
}: {
  visible: boolean;
  /** Rótulo legível da passagem selecionada (ex.: "João 3:16"), só p/ o cabeçalho. */
  sourceLabel: string;
  /** Referência CANÔNICA p/ a fronteira (ex.: "John 3:16"); o core a parseia. */
  reference: string;
  /** Caminho do banco só-leitura (`ensureReadingDb()`); `null` enquanto carrega. */
  dbPath: string | null;
  /** Tradução corrente (ex.: "kjv") — de onde o `cited_text` é lido, verbatim. */
  translation: string;
  /** Idioma de resposta/exibição ("pt"|"en"); o core faz o default sensato. */
  lang: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [provider, setProvider] = useState<string>(MOCK_PROVIDER);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // NOMES dos provedores que TÊM chave no cofre (nunca os valores) — só p/ o badge.
  const [providersWithKey, setProvidersWithKey] = useState<string[]>([]);
  // Rascunho da chave BYOK (input controlado) — NUNCA logado/exibido em claro (input
  // mascarado). No web o cofre é session-only (perdido no reload, ADR-0025); no nativo,
  // secure-store do device. Estado local, some ao fechar/salvar.
  const [keyDraft, setKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  // Ao abrir, descobre quais provedores reais já têm chave (indicador visual, sem
  // expor valores). `mock` não precisa de chave. Best-effort: falha silenciosa.
  useEffect(() => {
    if (!visible) {
      return;
    }
    let alive = true;
    (async () => {
      try {
        const withKey = await listProviders();
        if (alive) setProvidersWithKey(withKey);
      } catch {
        // Sem indicadores de chave; a pergunta ainda funciona (mock/entrada real).
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  // Ao trocar de passagem (nova referência) ou fechar, limpa a resposta e o rascunho
  // de chave (o rascunho nunca persiste no estado além da sessão de uso).
  useEffect(() => {
    setAnswer(null);
    setStreamed('');
    setError(null);
    setKeyDraft('');
  }, [reference, visible]);

  const isMock = provider === MOCK_PROVIDER;
  const providerHasKey = providersWithKey.includes(provider);
  const askDisabled = busy || dbPath == null || question.trim().length === 0;

  async function onAsk() {
    if (askDisabled || dbPath == null) {
      return;
    }
    const q = question.trim();
    setBusy(true);
    setError(null);
    setAnswer(null);
    setStreamed('');
    try {
      // BYOK: só provedores REAIS precisam de chave — lida SOB DEMANDA do cofre e
      // passada à fronteira; NUNCA logada/exibida. `mock` = sem chave, sem rede.
      let key: string | undefined;
      if (!isMock) {
        const stored = await getKey(provider);
        if (!stored) {
          throw new Error(t('ask.needKeyError', { provider }));
        }
        key = stored;
      }
      // STREAMING: a fronteira invoca `onToken` a cada incremento da INTERPRETAÇÃO
      // (LLM), acumulado no estado e renderizado incrementalmente. `model = undefined`
      // → o core usa o default do provedor. O `AiAnswer` final traz o `citedText`
      // (store, verbatim) SEPARADO da interpretação.
      const result = await askAnchoredStream(
        dbPath,
        translation,
        reference,
        q,
        provider,
        key,
        undefined,
        lang,
        (token) => setStreamed((prev) => prev + token),
      );
      setAnswer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Salva a chave BYOK do provedor selecionado no cofre (web = session-only, ADR-0025;
  // nativo = secure-store). A chave NUNCA é logada/exibida: só `setKey` a recebe; o
  // rascamento é limpo após salvar. Fluxo mínimo p/ inserir a chave sem sair do painel.
  async function onSaveKey() {
    const draft = keyDraft.trim();
    if (draft.length === 0 || isMock) {
      return;
    }
    setSavingKey(true);
    setError(null);
    try {
      await setKey(provider, draft);
      setKeyDraft('');
      const withKey = await listProviders();
      setProvidersWithKey(withKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(false);
    }
  }

  // Interpretação a exibir: o `AiAnswer` final quando pronto; senão os tokens
  // acumulados (streaming ao vivo). NUNCA texto hardcoded — sempre do retorno/callback.
  const interpretationText = answer ? answer.interpretation : streamed;
  const hasInterpretation = interpretationText.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="ask-panel-backdrop" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('ask.title', { source: sourceLabel })}</Text>
          <Pressable onPress={onClose} testID="ask-panel-close" accessibilityRole="button">
            <Text style={styles.close}>{t('ai.close')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── PROVEDOR / MODELO ─────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('ask.providerSection')}</Text>
          <View style={styles.providers}>
            {PROVIDER_OPTIONS.map((p) => {
              const active = provider === p;
              const real = p !== MOCK_PROVIDER;
              const withKey = providersWithKey.includes(p);
              return (
                <Pressable
                  key={p}
                  style={[styles.provChip, active ? styles.provChipActive : null]}
                  onPress={() => setProvider(p)}
                  disabled={busy}
                  testID={`ask-provider-${p}`}
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
                  {real ? (
                    <Text style={[styles.provKeyBadge, active ? styles.provChipTextActive : null]}>
                      {withKey ? t('ask.keyBadgeYes') : t('ask.keyBadgeNo')}
                    </Text>
                  ) : (
                    <Text style={[styles.provKeyBadge, active ? styles.provChipTextActive : null]}>
                      {t('ai.offlineBadge')}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
          {!isMock && !providerHasKey ? (
            <View style={styles.keyBlock}>
              <Text style={styles.hint}>{t('ask.byokHint')}</Text>
              <TextInput
                style={styles.keyInput}
                value={keyDraft}
                onChangeText={setKeyDraft}
                placeholder={t('ask.keyPlaceholder', { provider })}
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!savingKey && !busy}
                testID="ask-key-input"
                accessibilityLabel={t('a11y.byokKey', { provider })}
              />
              <Pressable
                style={[
                  styles.btn,
                  keyDraft.trim().length === 0 || savingKey ? styles.btnDisabled : styles.btnPrimary,
                ]}
                onPress={onSaveKey}
                disabled={keyDraft.trim().length === 0 || savingKey}
                testID="ask-key-save"
                accessibilityRole="button"
              >
                {savingKey ? (
                  <ActivityIndicator color={colors.chipActiveText} />
                ) : (
                  <Text style={styles.btnText}>{t('ask.saveKey')}</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {/* ── PERGUNTA ──────────────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('ai.questionSection')}</Text>
          <TextInput
            style={styles.questionInput}
            value={question}
            onChangeText={setQuestion}
            placeholder={t('ai.questionPlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
            editable={!busy}
            testID="ask-question-input"
            accessibilityLabel={t('a11y.questionField')}
          />
          <Pressable
            style={[styles.btn, askDisabled ? styles.btnDisabled : styles.btnPrimary]}
            onPress={onAsk}
            disabled={askDisabled}
            testID="ask-submit"
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.chipActiveText} />
            ) : (
              <Text style={styles.btnText}>{t('ask.submit')}</Text>
            )}
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* ── PASSAGEM (texto bíblico, verbatim do store) ───────────────────
              Anti-alucinação VISÍVEL: o `citedText` vem do RETORNO real (store),
              rotulado como texto bíblico — NUNCA como saída do LLM. Só aparece
              quando o `AiAnswer` retorna (do Rust). */}
          {answer ? (
            <View style={styles.citedBlock}>
              <Text style={styles.sectionTitle}>{t('ai.citedTitle')}</Text>
              <Text style={styles.citedText} testID="ask-cited-text">
                {answer.citedText}
              </Text>
            </View>
          ) : null}

          {/* ── INTERPRETAÇÃO (IA) ────────────────────────────────────────────
              Rótulo DISTINTO do texto bíblico. Renderiza os tokens acumulados
              (streaming) e, ao fim, a `interpretation` do `AiAnswer`. */}
          {hasInterpretation ? (
            <View style={styles.interpBlock}>
              <Text style={styles.sectionTitle}>{t('ai.interpTitle')}</Text>
              <Text style={styles.interpText} testID="ask-interpretation-text">
                {interpretationText}
                {busy ? ' ▍' : ''}
              </Text>
            </View>
          ) : null}

          {/* ── PROVEDOR/MODELO USADO + CUSTO (simplificado) ─────────────────
              A fronteira NÃO expõe estimativa de custo (sem função de custo no core);
              exibimos uma ESTIMATIVA aproximada de tokens da interpretação, com aviso
              de que o custo exato é indisponível — sem criar função nova de fronteira. */}
          {answer ? (
            <View style={styles.metaBlock}>
              <Text style={styles.metaText} testID="ask-meta">
                {t('ai.meta', { provider: answer.provider, model: answer.model })}
              </Text>
              <Text style={styles.metaText}>
                {t('ask.estimate', { tokens: approxTokens(answer.interpretation) })}
              </Text>
              <Text style={styles.disclaimer}>{t('ask.disclaimer')}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
      maxHeight: '85%',
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingBottom: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    title: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
    close: { fontSize: 14, fontWeight: '600', color: colors.accent, paddingLeft: 12 },
    scroll: { padding: 16, gap: 8 },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 12,
    },
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
    hint: { fontSize: 12, color: colors.muted, marginTop: 6 },
    keyBlock: { marginTop: 6, gap: 6 },
    keyInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.verseText,
      marginTop: 4,
    },
    questionInput: {
      minHeight: 70,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: colors.verseText,
      textAlignVertical: 'top',
      marginTop: 6,
    },
    btn: {
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
    },
    btnPrimary: { backgroundColor: colors.chipActiveBg },
    btnDisabled: { backgroundColor: colors.divider, opacity: 0.6 },
    btnText: { fontSize: 15, fontWeight: '700', color: colors.chipActiveText },
    citedBlock: {
      marginTop: 12,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingLeft: 12,
    },
    citedText: { fontSize: 15, lineHeight: 22, color: colors.verseText, marginTop: 4 },
    interpBlock: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
    },
    interpText: { fontSize: 15, lineHeight: 22, color: colors.text, marginTop: 4 },
    metaBlock: { marginTop: 14, gap: 4 },
    metaText: { fontSize: 12, color: colors.muted },
    disclaimer: { fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
    error: { fontSize: 14, color: colors.error, marginTop: 10 },
  });
}
