// app/components/ReaderComparePanel.tsx — F3.7 (molde ReaderAskPanel F2.5 + chips
// ReaderStudyPanel F3.5; reusa askAnchored F2.1/F2.3a)
//
// Painel de COMPARAÇÃO MULTI-IA ANCORADO (bottom sheet, molde do `ReaderAskPanel` da
// F2.5) aberto pela ação "Comparar (IA)" do painel por-versículo. A partir de uma
// passagem selecionada, o usuário faz UMA pergunta e escolhe N provedores (≥2, de
// `[...SUPPORTED_PROVIDERS, 'mock']`) para respondê-la LADO A LADO. Cada coluna dispara
// uma chamada INDEPENDENTE à fronteira `ask_anchored` (F2.1/F2.3a, já em `reading.ts`)
// com o provedor daquela coluna, sobre a MESMA `reference` (mesma âncora do store).
//
// Anti-alucinação VISÍVEL: o `citedText` (âncora, VERBATIM do store) é IDÊNTICO em todas
// as colunas, então é exibido UMA vez — como bloco de âncora COMUM no topo, rotulado
// "Passagem (texto bíblico)" — SEPARADO das N `interpretation` (LLM) rotuladas por
// `provider · model`. Isso prova que todos os N modelos receberam o MESMO texto do store
// (invariante `cited_match`), sem N cópias redundantes. A UI SÓ chama a fronteira e
// APRESENTA os `AiAnswer`: NENHUM prompt/RAG/citação é reimplementado em TS (uma fonte da
// verdade — o texto bíblico vem do Rust/core). NENHUM texto bíblico/interpretação é
// hardcoded. Cores via TOKENS de tema (`useTheme`).
//
// DECISÃO DE DESENHO (F3.7): o `MockLlmProvider` devolve uma resposta FIXA → comparar
// mock×mock é DEGENERADO em conteúdo. Por isso a prova por MOCK cobre o WIRING de N
// provedores (N chamadas → N AiAnswer, todos com o MESMO `citedText` do store), NÃO a
// diferença de respostas. A comparação de respostas REAIS (Claude/GPT/Gemini) é a F3.10
// (chave real, gate). Esta entrega NÃO finge comparação real com mock.
//
// BYOK/offline-first (LEI): para provedores REAIS (não-mock) a chave viria do keystore
// (`getKey(provider)`) e seria passada à fronteira; se faltar, a coluna mostra "sem chave
// (BYOK — F3.10)" e NÃO chama a fronteira. Nesta entrega a prova usa SÓ `"mock"` (sem
// chave, sem rede). A chave NUNCA é logada/impressa/exibida. Custo estimado é OMITIDO — a
// fronteira não expõe `estimate_cost_usd` (simplificação idêntica à da F2.5).
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
import { getKey, SUPPORTED_PROVIDERS } from '../lib/keystore';
import { useTheme, type ThemeColors } from '../lib/theme';
import { askAnchored, type AiAnswer } from '../web/reading';

// Provedor determinístico OFFLINE (sem chave, sem rede): o caminho da prova headless.
const MOCK_PROVIDER = 'mock';
// Opções do seletor MULTI de provedores: os BYOK reais + o mock offline.
const PROVIDER_OPTIONS: readonly string[] = [...SUPPORTED_PROVIDERS, MOCK_PROVIDER];
// Default sensato: ≥2 provedores DISTINTOS (superfície de comparação). `mock` responde
// offline; `anthropic` demonstra o caminho BYOK ("sem chave — F3.10" até haver chave).
const DEFAULT_PROVIDERS: readonly string[] = [MOCK_PROVIDER, 'anthropic'];

/**
 * Resultado de UMA coluna (um provedor). `answer` quando a fronteira respondeu; `no-key`
 * quando um provedor REAL não tem chave no cofre (não chamamos a fronteira — BYOK/F3.10);
 * `error` quando a chamada falhou. Composto do RETORNO real (nada hardcoded).
 */
type CompareColumn =
  | { provider: string; kind: 'answer'; answer: AiAnswer }
  | { provider: string; kind: 'no-key' }
  | { provider: string; kind: 'error'; message: string };

export function ReaderComparePanel({
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
  /** Tradução corrente (ex.: "kjv") — de onde o `citedText` (âncora) é lido, verbatim. */
  translation: string;
  /** Idioma de resposta/exibição ("pt"|"en"); o core faz o default sensato. */
  lang: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [question, setQuestion] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>([...DEFAULT_PROVIDERS]);
  const [busy, setBusy] = useState(false);
  const [columns, setColumns] = useState<CompareColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Ao trocar de passagem (nova âncora) ou fechar, limpa os resultados — nunca persiste
  // texto entre passagens (a âncora é sempre a passagem corrente do store).
  useEffect(() => {
    setColumns([]);
    setError(null);
  }, [reference, visible]);

  function toggleProvider(p: string) {
    setSelectedProviders((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  const compareDisabled =
    busy || dbPath == null || question.trim().length === 0 || selectedProviders.length < 2;

  async function onCompare() {
    if (compareDisabled || dbPath == null) {
      return;
    }
    const q = question.trim();
    setBusy(true);
    setError(null);
    setColumns([]);
    try {
      // N chamadas INDEPENDENTES (uma por coluna) sobre a MESMA `reference` (mesma âncora
      // do store). Para provedores REAIS a chave viria do keystore (BYOK); se faltar, a
      // coluna vira "no-key" e NÃO chama a fronteira. `mock` = sem chave, sem rede.
      // `model = undefined` → o core usa o default do provedor. A chave NUNCA é logada.
      const results = await Promise.all(
        selectedProviders.map(async (p): Promise<CompareColumn> => {
          try {
            let key: string | undefined;
            if (p !== MOCK_PROVIDER) {
              const stored = await getKey(p);
              if (!stored) {
                return { provider: p, kind: 'no-key' };
              }
              key = stored;
            }
            const answer = await askAnchored(
              dbPath,
              translation,
              reference,
              q,
              p,
              key,
              undefined,
              lang,
            );
            return { provider: p, kind: 'answer', answer };
          } catch (err) {
            return {
              provider: p,
              kind: 'error',
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      setColumns(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Colunas que de fato responderam (têm `AiAnswer`). O `citedText` (âncora do store) é
  // IDÊNTICO em todas → tomamos o da 1ª resposta como o bloco de âncora COMUM.
  const answered = columns.filter(
    (c): c is Extract<CompareColumn, { kind: 'answer' }> => c.kind === 'answer',
  );
  const anchorText = answered.length > 0 ? answered[0].answer.citedText : null;
  // Invariante de comparação (o mesmo que o self-test comprova): todos os `citedText`
  // iguais e não-vazios = todas as colunas leram a MESMA passagem do store (anti-alucinação).
  const citedMatch =
    answered.length >= 2 &&
    answered.every((c) => c.answer.citedText === anchorText) &&
    (anchorText?.length ?? 0) > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="compare-panel-backdrop" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('compare.title', { source: sourceLabel })}</Text>
          <Pressable onPress={onClose} testID="compare-panel-close" accessibilityRole="button">
            <Text style={styles.close}>{t('ai.close')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── PROVEDORES (seletor MULTI, ≥2) ────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('compare.providersSection')}</Text>
          <View style={styles.chips}>
            {PROVIDER_OPTIONS.map((p) => {
              const active = selectedProviders.includes(p);
              const real = p !== MOCK_PROVIDER;
              return (
                <Pressable
                  key={p}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => toggleProvider(p)}
                  disabled={busy}
                  testID={`compare-provider-${p}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    real
                      ? t('a11y.providerByok', { provider: p })
                      : t('a11y.providerOffline', { provider: p })
                  }
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {p}
                  </Text>
                  <Text style={[styles.chipBadge, active ? styles.chipTextActive : null]}>
                    {real ? t('compare.byokBadge') : t('ai.offlineBadge')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{t('compare.providersHint')}</Text>

          {/* ── PERGUNTA (uma, para todas as colunas) ─────────────────────── */}
          <Text style={styles.sectionTitle}>{t('ai.questionSection')}</Text>
          <TextInput
            style={styles.questionInput}
            value={question}
            onChangeText={setQuestion}
            placeholder={t('ai.questionPlaceholder')}
            placeholderTextColor={colors.muted}
            multiline
            editable={!busy}
            testID="compare-question-input"
            accessibilityLabel={t('a11y.compareField')}
          />
          <Pressable
            style={[styles.btn, compareDisabled ? styles.btnDisabled : styles.btnPrimary]}
            onPress={onCompare}
            disabled={compareDisabled}
            testID="compare-submit"
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.chipActiveText} />
            ) : (
              <Text style={styles.btnText}>
                {t('compare.submit', { count: selectedProviders.length })}
              </Text>
            )}
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* ── PASSAGEM (âncora COMUM, texto bíblico verbatim do store) ───────
              Anti-alucinação VISÍVEL: o `citedText` vem do RETORNO real (store), é
              IDÊNTICO em todas as colunas → exibido UMA vez, rotulado como texto bíblico,
              SEPARADO das N interpretações abaixo. NUNCA é saída do LLM. */}
          {anchorText != null ? (
            <View style={styles.anchorBlock}>
              <Text style={styles.sectionTitle}>{t('compare.anchorTitle')}</Text>
              <Text style={styles.anchorText} testID="compare-cited-text">
                {anchorText}
              </Text>
              {answered.length >= 2 ? (
                <Text
                  style={[styles.consistency, citedMatch ? styles.consistencyOk : styles.error]}
                  testID="compare-consistency"
                >
                  {citedMatch
                    ? t('compare.consistencyOk', { count: answered.length })
                    : t('compare.consistencyBad')}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── COLUNAS DE INTERPRETAÇÃO (uma por provedor) ───────────────────
              Cada coluna: rótulo `provider · model` + a `interpretation` (LLM), DISTINTA
              e SEPARADA do texto bíblico acima. Estados "sem chave" (BYOK/F3.10) e erro
              são mostrados sem chamar/vazar a fronteira. Nada hardcoded. */}
          {columns.length > 0 ? (
            <View style={styles.columns} testID="compare-columns">
              {columns.map((col, i) => (
                <View key={`${col.provider}-${i}`} style={styles.column}>
                  {col.kind === 'answer' ? (
                    <>
                      <Text style={styles.columnLabel}>
                        {col.answer.provider} · {col.answer.model}
                      </Text>
                      <Text style={styles.interpretationText} testID={`compare-interp-${col.provider}`}>
                        {col.answer.interpretation}
                      </Text>
                    </>
                  ) : col.kind === 'no-key' ? (
                    <>
                      <Text style={styles.columnLabel}>{col.provider}</Text>
                      <Text style={styles.columnNote}>{t('compare.columnNoKey')}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.columnLabel}>{col.provider}</Text>
                      <Text style={styles.error}>{col.message}</Text>
                    </>
                  )}
                </View>
              ))}
            </View>
          ) : null}

          {/* ── DISCLAIMER (anti-alucinação) ────────────────────────────────── */}
          {columns.length > 0 ? (
            <View style={styles.metaBlock}>
              <Text style={styles.disclaimer}>{t('compare.disclaimer')}</Text>
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
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    chipText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
    chipTextActive: { color: colors.chipActiveText },
    chipBadge: { fontSize: 11, color: colors.muted },
    hint: { fontSize: 12, color: colors.muted, marginTop: 8, fontStyle: 'italic' },
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
    anchorBlock: {
      marginTop: 14,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingLeft: 12,
    },
    anchorText: { fontSize: 15, lineHeight: 22, color: colors.verseText, marginTop: 4 },
    consistency: { fontSize: 12, marginTop: 6, fontWeight: '600' },
    consistencyOk: { color: colors.accent },
    columns: { marginTop: 12, gap: 10 },
    column: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
    },
    columnLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    columnNote: { fontSize: 13, color: colors.muted, fontStyle: 'italic' },
    interpretationText: { fontSize: 15, lineHeight: 22, color: colors.text },
    metaBlock: { marginTop: 14, gap: 4 },
    disclaimer: { fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
    error: { fontSize: 14, color: colors.error, marginTop: 4 },
  });
}
