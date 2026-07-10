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
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { errMessage } from '../lib/errMessage';
import { useI18n } from '../lib/i18n';
import { setKey } from '../lib/keystore';
import { goToProviderSettings } from '../lib/aiConfigure';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { askAnchoredStream, type AiAnswer } from '../web/reading';
import { AiProviderNotice } from './AiProviderNotice';
import { ProviderChips, useProviderSelection } from './ProviderPicker';
import { AiCostMeta } from './AiCostMeta';
import { BottomSheet, Button, CitedText, InterpretationBlock, SectionLabel } from './ui';

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
  const theme = useTheme();
  const { colors } = theme;
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

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
  const onConfigureProvider = () => goToProviderSettings(onClose);

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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('ask.title', { source: sourceLabel })}
      testIDPrefix="ask-panel"
      maxHeightPercent={88}
    >
      {/* Aviso "sem provedor de IA" (F5.37): convite claro p/ configurar. */}
      {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

      {/* ── PROVEDOR / MODELO ─────────────────────────────────────────── */}
      <SectionLabel>{t('ask.providerSection')}</SectionLabel>
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
          <Button
            title={t('ask.saveKey')}
            onPress={onSaveKey}
            loading={savingKey}
            disabled={keyDraft.trim().length === 0 || savingKey}
            testID="ask-key-save"
            style={styles.actionBtn}
          />
        </View>
      ) : null}

      {/* ── PERGUNTA ──────────────────────────────────────────────────── */}
      <SectionLabel>{t('ai.questionSection')}</SectionLabel>
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
      <Button title={t('ask.submit')} onPress={onAsk} loading={busy} disabled={askDisabled} testID="ask-submit" style={styles.actionBtn} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* PASSAGEM (verbatim do store) — anti-alucinação VISÍVEL, via a primitiva CitedText. */}
      {answer ? <CitedText text={answer.citedText} label={t('ai.citedTitle')} testID="ask-cited-text" /> : null}

      {/* INTERPRETAÇÃO (IA) — rótulo DISTINTO da Escritura; streaming + cursor. */}
      {hasInterpretation ? (
        <InterpretationBlock label={t('ai.interpTitle')}>
          <Text style={styles.interpText} testID="ask-interpretation-text">
            {interpretationText}
            {busy ? <Text style={styles.cursor}> ▍</Text> : null}
          </Text>
        </InterpretationBlock>
      ) : null}

      {/* PROVEDOR/MODELO USADO + CUSTO (estimativa; a fronteira não expõe custo). */}
      {answer ? (
        <View style={styles.metaBlock}>
          <Text style={styles.metaText} testID="ask-meta">
            {t('ai.meta', { provider: answer.provider, model: answer.model })}
          </Text>
          <AiCostMeta
            model={answer.model}
            promptText={`${question} ${answer.citedText}`}
            interpretation={answer.interpretation}
            style={styles.metaText}
            testID="ask-cost"
          />
          <Text style={styles.disclaimer}>{t('ask.disclaimer')}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    // Chips de provedor em `<ProviderChips>` (ADR-0059); Escritura/interpretação em CitedText/
    // InterpretationBlock (kit) — anti-alucinação. Aqui só os inputs e a meta.
    hint: { ...type.caption, color: colors.muted, marginTop: space.xs },
    keyBlock: { marginTop: space.xs, gap: space.xs },
    keyInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      ...type.body,
      fontSize: 14,
      color: colors.verseText,
      marginTop: space.xs,
    },
    questionInput: {
      minHeight: 70,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
      ...type.body,
      color: colors.verseText,
      textAlignVertical: 'top',
      marginTop: space.xs,
    },
    actionBtn: { marginTop: space.sm },
    interpText: { ...type.body, color: colors.text },
    cursor: { color: colors.accent },
    metaBlock: { marginTop: space.md, gap: space.xs },
    metaText: { ...type.caption, color: colors.muted },
    disclaimer: { ...type.caption, color: colors.muted, fontStyle: 'italic', marginTop: space.xs },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
  });
}
