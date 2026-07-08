// app/components/ReaderComparePanel.tsx — F3.7 (molde ReaderAskPanel F2.5 + chips
// ReaderStudyPanel F3.5; reusa askAnchored F2.1/F2.3a) · ADR-0068 (kit "Vigil")
//
// Painel de COMPARAÇÃO MULTI-IA ANCORADO (bottom sheet, molde do `ReaderAskPanel` da
// F2.5) aberto pela ação "Comparar (IA)" do painel por-versículo. A partir de uma
// passagem selecionada, o usuário faz UMA pergunta e escolhe N provedores (≥2, de
// `[...SUPPORTED_PROVIDERS, 'mock']`) para respondê-la LADO A LADO. Cada coluna dispara
// uma chamada INDEPENDENTE à fronteira `ask_anchored` (F2.1/F2.3a, já em `reading.ts`)
// com o provedor daquela coluna, sobre a MESMA `reference` (mesma âncora do store).
//
// Anti-alucinação VISÍVEL: o `citedText` (âncora, VERBATIM do store) é IDÊNTICO em todas
// as colunas, então é exibido UMA vez — como âncora COMUM (primitiva CitedText) no topo,
// rotulada "Passagem (texto bíblico)" — SEPARADA das N `interpretation` (LLM), cada uma
// numa InterpretationBlock rotulada por `provider · model`, LADO A LADO (scroll horizontal).
// Isso prova que todos os N modelos receberam o MESMO texto do store (invariante
// `cited_match`), sem N cópias redundantes. A UI SÓ chama a fronteira e APRESENTA os
// `AiAnswer`: NENHUM prompt/RAG/citação é reimplementado em TS (uma fonte da verdade — o
// texto bíblico vem do Rust/core). NENHUM texto bíblico/interpretação é hardcoded. Cores/
// tipografia via TOKENS de tema (`useTheme`).
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
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  MOCK_PROVIDER,
  PROVIDER_OPTIONS_MOCK_LAST,
  isMockProvider,
  keyArg,
  resolveProviderKey,
} from '../lib/aiProviders';
import { errMessage } from '../lib/errMessage';
import { useI18n } from '../lib/i18n';
import { getKey } from '../lib/keystore';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { askAnchored, type AiAnswer } from '../web/reading';
import { AiProviderNotice, useConfiguredAiProviders } from './AiProviderNotice';
import { AiCostMeta } from './AiCostMeta';
import { BottomSheet, Button, Chip, CitedText, InterpretationBlock, SectionLabel } from './ui';
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
  const theme = useTheme();
  const { colors } = theme;
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [question, setQuestion] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>([...DEFAULT_PROVIDERS]);
  const [busy, setBusy] = useState(false);
  const [columns, setColumns] = useState<CompareColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  // F5.37: há algum provedor de IA configurado? (NOMES com chave no cofre, nunca valores.)
  // Sem nenhum → aviso claro + CTA (o provedor offline `mock` ainda responde; BYOK real = F3.10).
  const { checked: providersChecked, providers: providersWithKey } = useConfiguredAiProviders(visible);
  const showNoProviderNotice = providersChecked && providersWithKey.length === 0;

  // F6.6: leva à tela de AJUSTES (hub canônico de chave BYOK, campos por provedor). Fecha antes.
  function onConfigureProvider() {
    onClose();
    router.push('/settings');
  }

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
            // BYOK por coluna (seam ADR-0059, neutro de UX): no-key → célula "sem chave" (NÃO
            // lança). `mock` = sem chave/rede; a chave real vai SÓ à fronteira, nunca logada.
            const res = await resolveProviderKey(p, getKey);
            if (res.kind === 'no-key') {
              return { provider: p, kind: 'no-key' };
            }
            const key = keyArg(res);
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
              message: errMessage(err),
            };
          }
        }),
      );
      setColumns(results);
    } catch (err) {
      setError(errMessage(err));
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('compare.title', { source: sourceLabel })}
      testIDPrefix="compare-panel"
      maxHeightPercent={88}
    >
      {/* ── AVISO "sem provedor de IA" (F5.37) ────────────────────────────
          A comparação usa IA de provedores reais; sem nenhum configurado, convite CLARO
          p/ configurar (link à tela Ajustes), não um erro cru. Colunas de provedores sem
          chave já mostram nota própria abaixo; o `mock` responde offline. */}
      {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

      {/* ── PROVEDORES (seletor MULTI, ≥2) — Chip do kit + badge BYOK/offline ── */}
      <SectionLabel>{t('compare.providersSection')}</SectionLabel>
      <View style={styles.chips}>
        {PROVIDER_OPTIONS_MOCK_LAST.map((p) => {
          const active = selectedProviders.includes(p);
          const real = !isMockProvider(p);
          return (
            <Chip
              key={p}
              label={p}
              badge={real ? t('compare.byokBadge') : t('ai.offlineBadge')}
              active={active}
              onPress={() => toggleProvider(p)}
              disabled={busy}
              testID={`compare-provider-${p}`}
              accessibilityLabel={
                real
                  ? t('a11y.providerByok', { provider: p })
                  : t('a11y.providerOffline', { provider: p })
              }
            />
          );
        })}
      </View>
      <Text style={styles.hint}>{t('compare.providersHint')}</Text>

      {/* ── PERGUNTA (uma, para todas as colunas) ─────────────────────── */}
      <SectionLabel>{t('ai.questionSection')}</SectionLabel>
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
      <Button
        title={t('compare.submit', { count: selectedProviders.length })}
        onPress={onCompare}
        loading={busy}
        disabled={compareDisabled}
        testID="compare-submit"
        style={styles.actionBtn}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* ── PASSAGEM (âncora COMUM, verbatim do store) — primitiva CitedText ──
          Anti-alucinação VISÍVEL: o `citedText` vem do RETORNO real (store), é IDÊNTICO
          em todas as colunas → exibido UMA vez, atrás da régua dourada, SEPARADO das N
          interpretações. NUNCA é saída do LLM. O selo de consistência confirma o invariante. */}
      {anchorText != null ? (
        <>
          <CitedText text={anchorText} label={t('compare.anchorTitle')} testID="compare-cited-text" />
          {answered.length >= 2 ? (
            <Text
              style={[styles.consistency, citedMatch ? styles.consistencyOk : styles.consistencyBad]}
              testID="compare-consistency"
            >
              {citedMatch
                ? t('compare.consistencyOk', { count: answered.length })
                : t('compare.consistencyBad')}
            </Text>
          ) : null}
        </>
      ) : null}

      {/* ── COLUNAS DE INTERPRETAÇÃO (uma por provedor, LADO A LADO) ───────
          Scroll horizontal: cada coluna = InterpretationBlock rotulada `provider · model`,
          DISTINTA e SEPARADA do texto bíblico acima. Estados "sem chave" (BYOK/F3.10) e
          erro são mostrados sem chamar/vazar a fronteira. Nada hardcoded. */}
      {columns.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.columnsRow}
          testID="compare-columns"
        >
          {columns.map((col, i) => (
            <View key={`${col.provider}-${i}`} style={styles.column}>
              {col.kind === 'answer' ? (
                <>
                  <InterpretationBlock label={`${col.answer.provider} · ${col.answer.model}`}>
                    <Text style={styles.interpretationText} testID={`compare-interp-${col.provider}`}>
                      {col.answer.interpretation}
                    </Text>
                  </InterpretationBlock>
                  <AiCostMeta
                    model={col.answer.model}
                    promptText={`${question} ${col.answer.citedText}`}
                    interpretation={col.answer.interpretation}
                    style={styles.columnNote}
                    testID={`compare-cost-${col.provider}`}
                  />
                </>
              ) : col.kind === 'no-key' ? (
                <InterpretationBlock label={col.provider}>
                  <Text style={styles.columnNote} testID={`compare-nokey-${col.provider}`}>
                    {t('compare.columnNoKey')}
                  </Text>
                </InterpretationBlock>
              ) : (
                <InterpretationBlock label={col.provider}>
                  <Text style={styles.error}>{col.message}</Text>
                </InterpretationBlock>
              )}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {/* ── DISCLAIMER (anti-alucinação) ────────────────────────────────── */}
      {columns.length > 0 ? (
        <View style={styles.metaBlock}>
          <Text style={styles.disclaimer}>{t('compare.disclaimer')}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    // Folha/cabeçalho no <BottomSheet>; chips de provedor na <Chip> (com badge BYOK/offline);
    // âncora na CitedText; cada coluna numa InterpretationBlock; botão no <Button>. Aqui: layout
    // dos chips, o input, o selo de consistência e a faixa horizontal de colunas.
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
    hint: { ...type.caption, color: colors.muted, marginTop: space.sm, fontStyle: 'italic' },
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
    consistency: { ...type.caption, marginTop: space.sm, fontWeight: '600' },
    consistencyOk: { color: colors.accent },
    consistencyBad: { color: colors.error },
    // Faixa horizontal de colunas: cada card com largura fixa → a próxima "espia" na borda,
    // convidando ao swipe lateral (showcase multi-IA lado a lado).
    columnsRow: { gap: space.md, paddingVertical: space.xs, paddingRight: space.md },
    column: { width: 280 },
    interpretationText: { ...type.body, color: colors.text },
    columnNote: { ...type.caption, color: colors.muted, fontStyle: 'italic' },
    metaBlock: { marginTop: space.md, gap: space.xs },
    disclaimer: { ...type.caption, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
    error: { ...type.body, color: colors.error, marginTop: space.xs },
  });
}
