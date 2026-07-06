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
import { useReaderModalA11y } from '../lib/useReaderModalA11y';
import { useTheme, type ThemeColors } from '../lib/theme';
import { askSessionAnchored, ChatRole, type AiAnswer, type ChatTurn } from '../web/reading';
import { AiProviderNotice } from './AiProviderNotice';
import { ProviderChips, useProviderSelection } from './ProviderPicker';

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
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // F5.21: ao abrir, foco do leitor de tela no título (ordem lógica + anúncio de abertura).
  const titleRef = useReaderModalA11y(visible);

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="chat-panel-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t('ai.close')}
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
            {t('chat.title', { source: sourceLabel })}
          </Text>
          <Pressable onPress={onClose} testID="chat-panel-close" accessibilityRole="button" hitSlop={12}>
            <Text style={styles.close}>{t('ai.close')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── AVISO "sem provedor de IA" (F5.37) ────────────────────────────
              A conversa usa IA; sem nenhum provedor configurado, convite CLARO p/ configurar
              (link à tela Sobre), não um erro cru. Os recursos offline seguem sem chave; o
              provedor offline `mock` ainda responde na thread abaixo. */}
          {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

          {/* ── PROVEDOR (F6.7) ───────────────────────────────────────────────
              Seletor mock + BYOK reais (molde ReaderAskPanel). `mock` = default OFFLINE
              (sem chave/rede, prova headless). Provedor real → a chave BYOK é lida SOB
              DEMANDA do cofre em onSend; sem chave → aviso claro + CTA p/ Ajustes. */}
          <Text style={styles.sectionTitle}>{t('ask.providerSection')}</Text>
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
              <Pressable
                style={styles.cta}
                onPress={onConfigureProvider}
                testID="chat-provider-configure"
                accessibilityRole="button"
                accessibilityLabel={t('a11y.aiConfigure')}
              >
                <Text style={styles.ctaText}>{t('ai.noProviderCta')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── PASSAGEM (texto bíblico, verbatim do store — a ÂNCORA) ─────────
              Anti-alucinação VISÍVEL: o `citedText` vem do RETORNO real (store),
              exibido UMA vez, rotulado como texto bíblico — NUNCA como saída do LLM.
              Separado e distinto de cada interpretação na thread abaixo. */}
          {answer ? (
            <View style={styles.citedBlock}>
              <Text style={styles.sectionTitle}>{t('ai.citedTitle')}</Text>
              <Text style={styles.citedText} testID="chat-cited-text">
                {answer.citedText}
              </Text>
            </View>
          ) : (
            <Text style={styles.hint}>{t('chat.emptyHint', { source: sourceLabel })}</Text>
          )}

          {/* ── THREAD DE TURNOS (conversa multi-turno) ───────────────────────
              Cada turno do usuário (pergunta/follow-up) e do assistente (interpretação
              do LLM/mock). As respostas da IA são ROTULADAS "IA — confira nas Escrituras",
              distintas do texto bíblico acima. Nada hardcoded — vem do histórico real. */}
          {turns.length > 0 ? (
            <View style={styles.thread} testID="chat-thread">
              {turns.map((turn, i) =>
                turn.role === ChatRole.User ? (
                  <View key={i} style={styles.userTurn}>
                    <Text style={styles.turnRole}>{t('chat.roleUser')}</Text>
                    <Text style={styles.userText}>{turn.content}</Text>
                  </View>
                ) : (
                  <View key={i} style={styles.assistantTurn}>
                    <Text style={styles.turnRole}>{t('chat.roleAssistant')}</Text>
                    <Text style={styles.interpretationText}>{turn.content}</Text>
                  </View>
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
          <Pressable
            style={[styles.btn, sendDisabled ? styles.btnDisabled : styles.btnPrimary]}
            onPress={onSend}
            disabled={sendDisabled}
            testID="chat-send"
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.chipActiveText} />
            ) : (
              <Text style={styles.btnText}>
                {turns.length === 0 ? t('chat.send') : t('chat.sendFollowup')}
              </Text>
            )}
          </Pressable>

          {/* ── PROVEDOR/MODELO + DISCLAIMER (anti-alucinação) ──────────────── */}
          {answer ? (
            <View style={styles.metaBlock}>
              <Text style={styles.metaText} testID="chat-meta">
                {t('ai.meta', { provider: answer.provider, model: answer.model })}
              </Text>
              <Text style={styles.disclaimer}>{t('chat.disclaimer')}</Text>
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
      maxHeight: '88%',
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
    hint: { fontSize: 12, color: colors.muted, marginTop: 10, fontStyle: 'italic' },
    // Seletor de PROVEDOR: chips agora em `<ProviderChips>` (ProviderPicker, ADR-0059).
    needKeyBlock: { marginTop: 8, gap: 6 },
    cta: {
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.chipActiveBg,
    },
    ctaText: { fontSize: 14, fontWeight: '700', color: colors.chipActiveText },
    citedBlock: {
      marginTop: 4,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingLeft: 12,
    },
    citedText: { fontSize: 15, lineHeight: 22, color: colors.verseText, marginTop: 4 },
    thread: { marginTop: 12, gap: 10 },
    userTurn: {
      alignSelf: 'flex-end',
      maxWidth: '90%',
      borderRadius: 8,
      backgroundColor: colors.chipActiveBg,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    assistantTurn: {
      alignSelf: 'flex-start',
      maxWidth: '95%',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    turnRole: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    userText: { fontSize: 15, lineHeight: 21, color: colors.chipActiveText },
    interpretationText: { fontSize: 15, lineHeight: 22, color: colors.text },
    threadBusy: { alignSelf: 'flex-start', marginTop: 4 },
    input: {
      minHeight: 60,
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
    metaBlock: { marginTop: 14, gap: 4 },
    metaText: { fontSize: 12, color: colors.muted },
    disclaimer: { fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
    error: { fontSize: 14, color: colors.error, marginTop: 10 },
  });
}
