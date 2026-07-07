// app/components/ReaderChatPanel.tsx — F3.6 (molde ReaderAskPanel F2.5 + ReaderStudyPanel F3.5)
//
// Painel de CONVERSA/FOLLOW-UP ANCORADO (bottom sheet, molde do `ReaderAskPanel`/
// `ReaderStudyPanel`) aberto pela ação "Conversa (IA)" do painel por-versículo. A partir
// de uma passagem selecionada, o usuário mantém uma CONVERSA MULTI-TURNO (histórico de
// turnos User/Assistant) sobre aquela passagem: cada follow-up chama a fronteira
// `ask_session_anchored` (F3.4 via JSI), passando SEMPRE o mesmo `book/chapter/verse` do
// store — a ÂNCORA (texto do versículo) é montada pelo core, do store local, e injetada
// só no 1º turno de usuário (invariante do core).
//
// Anti-alucinação VISÍVEL: o `citedText` (âncora, VERBATIM do store) é exibido UMA vez,
// ROTULADO como texto bíblico, SEPARADO e distinto de cada `interpretation` (LLM, mock)
// na thread de turnos. A UI SÓ chama a fronteira e APRESENTA o retorno: NENHUM prompt/
// RAG/contexto/conversa é reimplementado em TS (uma fonte da verdade — o texto bíblico e a
// âncora vêm do Rust/core). NENHUM texto bíblico/interpretação é hardcoded. Cores via
// TOKENS de tema (`useTheme`).
//
// BYOK/offline-first (LEI): o usuário escolhe um PROVEDOR (mock default + BYOK reais). A chave
// dos provedores REAIS é lida SOB DEMANDA via `keystore.getKey(provider)` e passada à fronteira
// `ask_session_anchored(..., providerName, key)` — NUNCA logada/impressa/exibida; sem chave no
// cofre → erro claro + CTA p/ Ajustes, sem chamar a IA. Com `"mock"` não há chave nem rede
// (default offline, o caminho da prova headless). O texto bíblico vem SEMPRE do store local,
// verbatim; o LLM só interpreta. (F6.7 des-mocka; transporte/core inalterados.)
import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { errMessage } from '../lib/errMessage';
import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { askSessionAnchored, ChatRole, type AiAnswer, type ChatTurn } from '../web/reading';
import { AiProviderNotice } from './AiProviderNotice';
import { ProviderChips, useProviderSelection } from './ProviderPicker';
import { BottomSheet, Button, CitedText, InterpretationBlock, SectionLabel } from './ui';

export function ReaderChatPanel({
  visible,
  sourceLabel,
  book,
  chapter,
  verse,
  dbPath,
  translation,
  lang,
  onClose,
}: {
  visible: boolean;
  /** Rótulo legível da passagem (ex.: "João 3:16"), só p/ o cabeçalho. */
  sourceLabel: string;
  /** Passagem NUMÉRICA p/ a fronteira (book/chapter[/verse]) — não string canônica. */
  book: number;
  chapter: number;
  /** Versículo alvo; `null` = capítulo inteiro (o core deriva do reference). */
  verse: number | null;
  /** Caminho do banco só-leitura (`ensureReadingDb()`); `null` enquanto carrega. */
  dbPath: string | null;
  /** Tradução corrente (ex.: "kjv") — de onde o `citedText` (âncora) é lido, verbatim. */
  translation: string;
  /** Idioma de resposta/exibição ("pt"|"en"); o core faz o default sensato. */
  lang: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Histórico multi-turno (User/Assistant) — a conversa que a UI monta e reenvia a cada
  // follow-up. `answer` guarda o AiAnswer corrente (p/ o `citedText`, a âncora do store).
  // Seleção de provedor + derivações BYOK (seam compartilhado — ADR-0059): provedor default
  // `mock` (offline), checagem do cofre, isMock/needsKey/showNoProviderNotice e loadKey (lê a
  // chave sob demanda). O seam desconhece `AiAnswer` (anti-alucinação intacta).
  const {
    provider,
    setProvider,
    options,
    isMock,
    providersWithKey,
    needsKey,
    showNoProviderNotice,
    loadKey,
  } = useProviderSelection(visible);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // F6.6: leva à tela de AJUSTES (hub canônico de chave BYOK, campos por provedor). Fecha antes.
  function onConfigureProvider() {
    onClose();
    router.push('/settings');
  }

  // Ao trocar de passagem (nova âncora) ou fechar, limpa a conversa inteira — o histórico
  // NUNCA persiste texto entre passagens (a âncora é sempre a passagem corrente do store).
  useEffect(() => {
    setTurns([]);
    setInput('');
    setAnswer(null);
    setError(null);
  }, [book, chapter, verse, visible]);

  // Bloqueia o envio se ocupado, sem banco, sem texto, ou com provedor real sem chave (needsKey)
  // — assim um provedor sem chave NÃO chama a IA (sem travar): o aviso + CTA orientam o usuário.
  const sendDisabled = busy || dbPath == null || input.trim().length === 0 || needsKey;

  async function onSend() {
    if (sendDisabled || dbPath == null) {
      return;
    }
    const content = input.trim();
    setBusy(true);
    setError(null);
    try {
      // BYOK (LEI): `loadKey()` (seam ADR-0059) lê a chave real SOB DEMANDA do cofre — NUNCA
      // logada/exibida — e lança o erro i18n de needKey p/ provedor real sem chave (a chamada é
      // PULADA antes do update otimista → input preservado); `mock` = undefined (sem chave/rede).
      const key = await loadKey();
      // Monta o histórico do follow-up: os turnos anteriores + o novo turno do usuário.
      const history: ChatTurn[] = [...turns, { role: ChatRole.User, content }];
      // Otimista: mostra o turno do usuário e limpa o input SÓ após a chave validar (assim, se
      // faltar chave, o input não é perdido nem um turno órfão fica sem resposta).
      setTurns(history);
      setInput('');
      // Follow-up REAL pela fronteira. Provedor selecionado + chave BYOK (ou undefined p/ mock);
      // modelo undefined → default do core. A passagem vai NUMÉRICA (mesmo book/chapter/verse
      // SEMPRE → âncora preservada). Ordem REAL: `lang` ANTES de `turns`; `studyMode`/`studyLens`
      // (undefined) DEPOIS de `turns` e ANTES de `providerName`.
      const result = await askSessionAnchored(
        dbPath,
        translation,
        book,
        chapter,
        verse ?? undefined,
        lang,
        history,
        undefined,
        undefined,
        provider,
        key,
        undefined,
      );
      // Anexa o turno do assistente (só a `interpretation` do LLM — o texto bíblico viaja
      // separado em `citedText` e é exibido à parte). `answer` guarda a âncora corrente.
      setTurns((prev) => [...prev, { role: ChatRole.Assistant, content: result.interpretation }]);
      setAnswer(result);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('chat.title', { source: sourceLabel })}
      testIDPrefix="chat-panel"
      maxHeightPercent={88}
    >
      {/* ── AVISO "sem provedor de IA" (F5.37) ────────────────────────────
          A conversa usa IA; sem nenhum provedor configurado, convite CLARO p/ configurar
          (link à tela Ajustes), não um erro cru. Os recursos offline seguem sem chave; o
          provedor offline `mock` ainda responde na thread abaixo. */}
      {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

      {/* ── PROVEDOR (F6.7) ───────────────────────────────────────────────
          Seletor mock + BYOK reais (molde ReaderAskPanel). `mock` = default OFFLINE
          (sem chave/rede, prova headless). Provedor real → a chave BYOK é lida SOB
          DEMANDA do cofre em onSend; sem chave → aviso claro + CTA p/ Ajustes. */}
      <SectionLabel>{t('ask.providerSection')}</SectionLabel>
      <ProviderChips
        options={options}
        provider={provider}
        providersWithKey={providersWithKey}
        disabled={busy}
        testIdPrefix="chat"
        onSelect={setProvider}
      />
      {/* Provedor real sem chave → erro claro + CTA p/ Ajustes (não trava; envio desabilitado). */}
      {needsKey ? (
        <View style={styles.needKeyBlock} testID="chat-provider-needkey">
          <Text style={styles.error}>{t('ask.needKeyError', { provider })}</Text>
          <Button
            title={t('ai.noProviderCta')}
            variant="secondary"
            onPress={onConfigureProvider}
            testID="chat-provider-configure"
            accessibilityLabel={t('a11y.aiConfigure')}
            style={styles.actionBtn}
          />
        </View>
      ) : null}

      {/* ── PASSAGEM (texto bíblico, verbatim do store — a ÂNCORA) ─────────
          Anti-alucinação VISÍVEL, via a primitiva CitedText: o `citedText` vem do
          RETORNO real (store), exibido UMA vez, rotulado como texto bíblico — NUNCA
          como saída do LLM. Separado e distinto de cada interpretação na thread. */}
      {answer ? (
        <CitedText text={answer.citedText} label={t('ai.citedTitle')} testID="chat-cited-text" />
      ) : (
        <Text style={styles.hint}>{t('chat.emptyHint', { source: sourceLabel })}</Text>
      )}

      {/* ── THREAD DE TURNOS (conversa multi-turno) ───────────────────────
          Turno do usuário = bolha; turno do assistente = InterpretationBlock (cartão
          bordado ROTULADO "IA"), distinto do texto bíblico acima. Nada hardcoded — vem
          do histórico real. */}
      {turns.length > 0 ? (
        <View style={styles.thread} testID="chat-thread">
          {turns.map((turn, i) =>
            turn.role === ChatRole.User ? (
              <View key={i} style={styles.userTurn}>
                <Text style={styles.userRole}>{t('chat.roleUser')}</Text>
                <Text style={styles.userText}>{turn.content}</Text>
              </View>
            ) : (
              <InterpretationBlock key={i} label={t('chat.roleAssistant')}>
                <Text style={styles.interpretationText}>{turn.content}</Text>
              </InterpretationBlock>
            ),
          )}
          {busy ? <ActivityIndicator color={colors.text} style={styles.threadBusy} /> : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Nota do provedor OFFLINE `mock` — só quando ele está selecionado (F6.7). */}
      {isMock ? <Text style={styles.hint}>{t('ai.mockProviderNote')}</Text> : null}

      {/* ── ENTRADA DO FOLLOW-UP ──────────────────────────────────────── */}
      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder={
          turns.length === 0 ? t('ai.questionPlaceholder') : t('chat.followupPlaceholder')
        }
        placeholderTextColor={colors.muted}
        multiline
        editable={!busy}
        testID="chat-input"
        accessibilityLabel={t('a11y.chatField')}
      />
      <Button
        title={turns.length === 0 ? t('chat.send') : t('chat.sendFollowup')}
        onPress={onSend}
        loading={busy}
        disabled={sendDisabled}
        testID="chat-send"
        style={styles.actionBtn}
      />

      {/* ── PROVEDOR/MODELO + DISCLAIMER (anti-alucinação) ──────────────── */}
      {answer ? (
        <View style={styles.metaBlock}>
          <Text style={styles.metaText} testID="chat-meta">
            {t('ai.meta', { provider: answer.provider, model: answer.model })}
          </Text>
          <Text style={styles.disclaimer}>{t('chat.disclaimer')}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    // Chips de provedor em `<ProviderChips>` (ADR-0059); âncora/interpretação em CitedText/
    // InterpretationBlock (kit) — anti-alucinação. Aqui só a thread, o input e a meta.
    hint: { ...type.caption, color: colors.muted, marginTop: space.sm, fontStyle: 'italic' },
    needKeyBlock: { marginTop: space.sm, gap: space.xs },
    thread: { marginTop: space.md, gap: space.sm },
    userTurn: {
      alignSelf: 'flex-end',
      maxWidth: '90%',
      borderRadius: radius.md,
      backgroundColor: colors.chipActiveBg,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    userRole: { ...type.label, color: colors.chipActiveText, opacity: 0.7, marginBottom: 2 },
    userText: { ...type.body, color: colors.chipActiveText },
    interpretationText: { ...type.body, color: colors.text },
    threadBusy: { alignSelf: 'flex-start', marginTop: space.xs },
    input: {
      minHeight: 60,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
      ...type.body,
      color: colors.verseText,
      textAlignVertical: 'top',
      marginTop: space.sm,
    },
    actionBtn: { marginTop: space.sm },
    metaBlock: { marginTop: space.md, gap: space.xs },
    metaText: { ...type.caption, color: colors.muted },
    disclaimer: { ...type.caption, color: colors.muted, fontStyle: 'italic', marginTop: space.xs },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
  });
}
