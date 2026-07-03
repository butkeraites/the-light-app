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
// BYOK/offline-first (LEI): esta entrega usa SÓ o provedor `"mock"` (sem chave, sem rede)
// — o caminho da prova headless. A chave real + rede são a F3.10. NENHUMA chave é usada/
// logada aqui. O texto bíblico vem SEMPRE do store local, verbatim; o LLM só interpreta.
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
import { useReaderModalA11y } from '../lib/useReaderModalA11y';
import { useTheme, type ThemeColors } from '../lib/theme';
import { askSessionAnchored, ChatRole, type AiAnswer, type ChatTurn } from '../web/reading';

// Provedor determinístico OFFLINE (sem chave, sem rede): o caminho da prova headless e o
// único provedor desta entrega (a chave real + rede são a F3.10).
const MOCK_PROVIDER = 'mock';

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
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ao trocar de passagem (nova âncora) ou fechar, limpa a conversa inteira — o histórico
  // NUNCA persiste texto entre passagens (a âncora é sempre a passagem corrente do store).
  useEffect(() => {
    setTurns([]);
    setInput('');
    setAnswer(null);
    setError(null);
  }, [book, chapter, verse, visible]);

  const sendDisabled = busy || dbPath == null || input.trim().length === 0;

  async function onSend() {
    if (sendDisabled || dbPath == null) {
      return;
    }
    const content = input.trim();
    // Monta o histórico do follow-up: os turnos anteriores + o novo turno do usuário.
    const history: ChatTurn[] = [...turns, { role: ChatRole.User, content }];
    setBusy(true);
    setError(null);
    // Otimista: mostra o turno do usuário imediatamente e limpa o input.
    setTurns(history);
    setInput('');
    try {
      // Follow-up REAL pela fronteira. Provedor "mock" → sem chave (undefined), sem rede;
      // modelo undefined → default do core. A passagem vai NUMÉRICA (mesmo book/chapter/
      // verse SEMPRE → âncora preservada). Ordem REAL: `lang` ANTES de `turns`;
      // `studyMode`/`studyLens` (undefined) DEPOIS de `turns` e ANTES de `providerName`.
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
        MOCK_PROVIDER,
        undefined,
        undefined,
      );
      // Anexa o turno do assistente (só a `interpretation` do LLM — o texto bíblico viaja
      // separado em `citedText` e é exibido à parte). `answer` guarda a âncora corrente.
      setTurns((prev) => [...prev, { role: ChatRole.Assistant, content: result.interpretation }]);
      setAnswer(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

          {/* Provedor fixo "mock" nesta entrega (offline; sem chave/rede). */}
          <Text style={styles.hint}>{t('ai.mockProviderNote')}</Text>

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
