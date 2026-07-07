// app/components/ScopeStudySheet.tsx — Escopo de Estudo: pré-visualização + PERGUNTAR sobre o escopo
//
// Folha que abre da barra-escopo. Duas metades:
//  1) ÂNCORA verbatim — o TEXTO do escopo inteiro, lido do store (resolvePassageQuery + PassageResultView),
//     mostrado ANTES de qualquer IA ("é exatamente isto que será citado"). Anti-alucinação visível.
//  2) PERGUNTAR sobre o escopo, com fidelidade ESCALONADA e HONESTA à fronteira (sem tocar o core):
//     • 1 TRECHO (faixa contígua ou capítulo) → UMA chamada CONJUNTA real via `askAnchoredStream`
//       (o caminho reference-string aceita "João 3:16-18" / "João 3") — resposta única, em streaming.
//     • VÁRIOS trechos (disjuntos/cross-capítulo/livro) → FAN-OUT: uma `askAnchored` por trecho,
//       empilhadas num acordeão (cada bloco = CitedText verbatim daquele trecho + InterpretationBlock),
//       rotulado "N passagens · respostas independentes". NÃO é síntese conjunta (isso é gate/core).
//
// BYOK/offline-first: provedor via o seam ADR-0059 (mock default offline; chave real lida sob demanda,
// nunca logada). O citedText de cada resposta vem do core, do store, verbatim — o LLM só interpreta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { errMessage } from '../lib/errMessage';
import { useI18n } from '../lib/i18n';
import { resolvePassageQuery, type PassageResult } from '../lib/passageResolve';
import { chunkKey, chunkLabel, chunkToReference, isSingleChunk, type ScopeChunk } from '../lib/studyScope';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { parseReference } from '../web/reference';
import { askAnchored, askAnchoredStream, type AiAnswer } from '../web/reading';
import { AiProviderNotice } from './AiProviderNotice';
import { ProviderChips, useProviderSelection } from './ProviderPicker';
import { PassageResultView } from './PassageResultView';
import { BottomSheet, Button, CitedText, InterpretationBlock, SectionLabel } from './ui';

/** Resultado de UM trecho no fan-out: resposta (com âncora verbatim) ou erro. */
type ChunkAnswer =
  | { chunk: ScopeChunk; kind: 'answer'; answer: AiAnswer }
  | { chunk: ScopeChunk; kind: 'error'; message: string };

export function ScopeStudySheet({
  visible,
  chunks,
  translation,
  lang,
  bookLabelOf,
  onClose,
}: {
  visible: boolean;
  chunks: ScopeChunk[];
  /** Tradução corrente — de onde o texto verbatim é lido. */
  translation: string;
  /** Idioma de resposta/exibição ("pt"|"en"). */
  lang: string;
  /** Nome de EXIBIÇÃO do livro (idioma da versão/UI), do store — p/ rotular os trechos no fan-out. */
  bookLabelOf: (book: number) => string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const { provider, setProvider, options, isMock, providersWithKey, needsKey, showNoProviderNotice, loadKey } =
    useProviderSelection(visible);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [single, setSingle] = useState<AiAnswer | null>(null);
  const [fanout, setFanout] = useState<ChunkAnswer[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Pré-visualização verbatim do escopo (a âncora), enquanto não há resposta.
  const [preview, setPreview] = useState<PassageResult | null>(null);

  // Ao trocar o escopo (ou fechar), limpa a resposta e re-resolve a pré-visualização.
  useEffect(() => {
    setSingle(null);
    setFanout([]);
    setStreamed('');
    setError(null);
  }, [chunks, visible]);

  useEffect(() => {
    if (!visible || chunks.length === 0) {
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [{ ensureReadingDb }, { getChapter, listBooks }] = await Promise.all([
          import('../lib/db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const books = listBooks();
        const nameEn = (b: number) => books.find((x) => x.number === b)?.nameEn ?? `Book ${b}`;
        const query = chunks.map((c) => chunkToReference(c, nameEn(c.book))).join('; ');
        const res = await resolvePassageQuery(query, {
          parseReference,
          getChapter: (b, c) => getChapter(dbPath, translation, b, c),
          chapterCountOf: (b) => books.find((x) => x.number === b)?.chapterCount ?? 1,
          bookLabel: (b) => bookLabelOf(b),
          maxVerses: 2000,
          maxChapters: 150,
        });
        if (alive) setPreview(res.segments.length > 0 ? res : null);
      } catch {
        if (alive) setPreview(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, chunks, translation, bookLabelOf]);

  function onConfigureProvider() {
    onClose();
    router.push('/settings');
  }

  const askDisabled = busy || question.trim().length === 0 || chunks.length === 0 || needsKey;

  const onAsk = useCallback(async () => {
    if (askDisabled) {
      return;
    }
    const q = question.trim();
    setBusy(true);
    setError(null);
    setSingle(null);
    setFanout([]);
    setStreamed('');
    try {
      const key = await loadKey();
      const { ensureReadingDb } = await import('../lib/db');
      const { listBooks } = await import('../web/reading');
      const dbPath = await ensureReadingDb();
      const books = listBooks();
      const nameEn = (b: number) => books.find((x) => x.number === b)?.nameEn ?? `Book ${b}`;
      const refs = chunks.map((c) => ({ chunk: c, ref: chunkToReference(c, nameEn(c.book)) }));

      if (refs.length === 1) {
        // UM trecho → chamada CONJUNTA real (streaming). citedText multi-verso verbatim do store.
        const answer = await askAnchoredStream(
          dbPath,
          translation,
          refs[0].ref,
          q,
          provider,
          key,
          undefined,
          lang,
          (tok) => setStreamed((prev) => prev + tok),
        );
        setSingle(answer);
      } else {
        // VÁRIOS trechos → FAN-OUT: uma chamada por trecho (molde ReaderComparePanel), agregadas.
        // Cada resposta traz SEU citedText verbatim; erro por trecho não derruba os outros.
        const results = await Promise.all(
          refs.map(async ({ chunk, ref }): Promise<ChunkAnswer> => {
            try {
              const answer = await askAnchored(dbPath, translation, ref, q, provider, key, undefined, lang);
              return { chunk, kind: 'answer', answer };
            } catch (err) {
              return { chunk, kind: 'error', message: errMessage(err) };
            }
          }),
        );
        setFanout(results);
      }
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }, [askDisabled, question, chunks, translation, provider, lang, loadKey]);

  const interpretationText = single ? single.interpretation : streamed;
  const hasResult = single != null || fanout.length > 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('scope.title')} testIDPrefix="scope-sheet" maxHeightPercent={90}>
      {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

      {/* PROVEDOR (seam BYOK ADR-0059). */}
      <SectionLabel>{t('ask.providerSection')}</SectionLabel>
      <ProviderChips
        options={options}
        provider={provider}
        providersWithKey={providersWithKey}
        disabled={busy}
        testIdPrefix="scope"
        onSelect={setProvider}
      />
      {needsKey ? (
        <View style={styles.needKey} testID="scope-provider-needkey">
          <Text style={styles.error}>{t('ask.needKeyError', { provider })}</Text>
          <Button
            title={t('ai.noProviderCta')}
            variant="secondary"
            onPress={onConfigureProvider}
            testID="scope-provider-configure"
            style={styles.actionBtn}
          />
        </View>
      ) : null}

      {/* PERGUNTA sobre o escopo inteiro. */}
      <SectionLabel>{t('ai.questionSection')}</SectionLabel>
      <Text style={styles.hint}>{t('scope.askHint')}</Text>
      <TextInput
        style={styles.input}
        value={question}
        onChangeText={setQuestion}
        placeholder={t('ai.questionPlaceholder')}
        placeholderTextColor={colors.muted}
        multiline
        editable={!busy}
        testID="scope-question-input"
        accessibilityLabel={t('a11y.questionField')}
      />
      <Button title={t('scope.ask')} icon="ask" onPress={onAsk} loading={busy} disabled={askDisabled} testID="scope-ask" style={styles.actionBtn} />
      {isMock ? <Text style={styles.hint}>{t('ai.mockProviderNote')}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* RESULTADO — 1 trecho: resposta conjunta; vários: fan-out (uma por trecho). */}
      {single != null ? (
        <>
          <CitedText text={single.citedText} label={t('ai.citedTitle')} testID="scope-cited-text" />
          <InterpretationBlock label={t('ai.interpTitle')}>
            <Text style={styles.interpText} testID="scope-interpretation">
              {interpretationText}
              {busy ? <Text style={styles.cursor}> ▍</Text> : null}
            </Text>
          </InterpretationBlock>
          <Text style={styles.meta} testID="scope-meta">
            {t('ai.meta', { provider: single.provider, model: single.model })}
          </Text>
        </>
      ) : fanout.length > 0 ? (
        <View testID="scope-fanout">
          <Text style={styles.fanoutHead}>{t('scope.independentAnswers', { count: fanout.length })}</Text>
          {fanout.map((r) => (
            <View key={chunkKey(r.chunk)} style={styles.fanoutItem}>
              {r.kind === 'answer' ? (
                <>
                  <CitedText text={r.answer.citedText} label={chunkLabel(r.chunk, bookLabelOf(r.chunk.book))} testID={`scope-fanout-cited-${chunkKey(r.chunk)}`} />
                  <InterpretationBlock label={t('ai.interpTitle')}>
                    <Text style={styles.interpText}>{r.answer.interpretation}</Text>
                  </InterpretationBlock>
                </>
              ) : (
                <InterpretationBlock label={chunkLabel(r.chunk, bookLabelOf(r.chunk.book))}>
                  <Text style={styles.error}>{r.message}</Text>
                </InterpretationBlock>
              )}
            </View>
          ))}
        </View>
      ) : preview != null && !hasResult ? (
        <>
          <SectionLabel>{t('scope.preview')}</SectionLabel>
          <PassageResultView result={preview} full />
        </>
      ) : null}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    needKey: { marginTop: space.sm, gap: space.xs },
    hint: { ...type.caption, color: colors.muted, marginTop: space.xs, fontStyle: 'italic' },
    input: {
      minHeight: 64,
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
    meta: { ...type.caption, color: colors.muted, marginTop: space.md },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
    fanoutHead: { ...type.label, color: colors.muted, marginTop: space.lg },
    fanoutItem: { marginTop: space.xs },
  });
}
