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
import { router } from 'expo-router';
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

import { errMessage } from '../lib/errMessage';
import { useI18n } from '../lib/i18n';
import { setKey } from '../lib/keystore';
import { useReaderModalA11y } from '../lib/useReaderModalA11y';
import { useTheme, type ThemeColors } from '../lib/theme';
import { askAnchoredStream, type AiAnswer } from '../web/reading';
import { AiProviderNotice } from './AiProviderNotice';
import { ProviderChips, useProviderSelection } from './ProviderPicker';

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
  // F5.21: ao abrir, foco do leitor de tela no título (ordem lógica + anúncio de abertura).
  const titleRef = useReaderModalA11y(visible);

  // Seleção de provedor + derivações BYOK (seam compartilhado — ADR-0059): provedor default
  // `mock` (offline), checagem do cofre (com `refresh()` p/ reler após salvar chave inline),
  // isMock/providerHasKey/showNoProviderNotice e loadKey (lê a chave sob demanda). O seam
  // desconhece `AiAnswer` — o `citedText` (store) segue separado da interpretação.
  const {
    provider,
    setProvider,
    options,
    isMock,
    providersWithKey,
    providerHasKey,
    showNoProviderNotice,
    refresh,
    loadKey,
  } = useProviderSelection(visible);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rascunho da chave BYOK (input controlado) — NUNCA logado/exibido em claro (input
  // mascarado). No web o cofre é session-only (perdido no reload, ADR-0025); no nativo,
  // secure-store do device. Estado local, some ao fechar/salvar.
  const [keyDraft, setKeyDraft] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  // Ao trocar de passagem (nova referência) ou fechar, limpa a resposta e o rascunho
  // de chave (o rascunho nunca persiste no estado além da sessão de uso).
  useEffect(() => {
    setAnswer(null);
    setStreamed('');
    setError(null);
    setKeyDraft('');
  }, [reference, visible]);

  const askDisabled = busy || dbPath == null || question.trim().length === 0;

  // F6.6: leva à tela de AJUSTES (hub canônico de chave BYOK, com campos por provedor). Fecha o
  // painel antes de navegar. A entrada inline abaixo permanece (complementa; Ajustes é o hub).
  function onConfigureProvider() {
    onClose();
    router.push('/settings');
  }

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
      // BYOK: `loadKey()` (seam ADR-0059) lê a chave real SOB DEMANDA do cofre — NUNCA
      // logada/exibida — e lança o erro i18n de needKey p/ provedor real sem chave; `mock` =
      // undefined (sem chave, sem rede).
      const key = await loadKey();
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
      setError(errMessage(err));
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
      // Relê o cofre pelo seam (ADR-0059) → o badge "com chave" atualiza e o aviso some.
      refresh();
    } catch (err) {
      setError(errMessage(err));
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
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="ask-panel-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t('ai.close')}
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
            {t('ask.title', { source: sourceLabel })}
          </Text>
          <Pressable onPress={onClose} testID="ask-panel-close" accessibilityRole="button" hitSlop={12}>
            <Text style={styles.close}>{t('ai.close')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── AVISO "sem provedor de IA" (F5.37) ────────────────────────────
              Recurso de IA sem nenhum provedor configurado → convite CLARO p/ configurar
              (com link à tela Sobre), não um erro cru/tela vazia. O provedor offline `mock`
              ainda responde abaixo; os recursos offline seguem sem chave. */}
          {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

          {/* ── PROVEDOR / MODELO ─────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('ask.providerSection')}</Text>
          <ProviderChips
            options={options}
            provider={provider}
            providersWithKey={providersWithKey}
            disabled={busy}
            testIdPrefix="ask"
            onSelect={setProvider}
          />
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
    // Chips de provedor agora em `<ProviderChips>` (ProviderPicker, ADR-0059) — donos dos estilos.
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
