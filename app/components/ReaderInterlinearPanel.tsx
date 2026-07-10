// app/components/ReaderInterlinearPanel.tsx — Rodada 2 (modo interlinear; molde do ReaderStudyPanel)
//
// Painel por-versículo (bottom sheet) que exibe a passagem PALAVRA A PALAVRA na língua
// original (grego/hebraico): superfície + transliteração + glosa + Strong, na ORDEM de
// leitura. TUDO vem do STORE via a fronteira `interlinearVerse` (F5.15/Rodada 2) — o texto
// original NUNCA é gerado pela UI nem por IA (anti-alucinação). O dado (`original_tokens`,
// ~447k tokens) cobre todo o NT + Gênesis + Salmos; fora disso o retorno vem VAZIO e o painel
// mostra um aviso honesto — sem inventar.
//
// ATRIBUIÇÃO STEP CC-BY (ADR-0026, OBRIGATÓRIA): as `sources` REAIS do retorno (verbatim de
// `scholarly_sources.attribution`) são exibidas sempre que há tokens; fallback à constante
// canônica `STEP_ATTRIBUTION`. A UI SÓ chama a fronteira e APRESENTA — nenhuma lógica de domínio.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { interlinearVerse, type InterlinearTokenOut, type InterlinearVerseOut } from '../web/reading';
import { AttributionBlock, BottomSheet, SectionLabel } from './ui';

/** Sufixo legível do Strong + morfologia CRUA (quando etiquetada). Só do RETORNO real. */
function tokenMeta(tk: InterlinearTokenOut): string {
  const parts: string[] = [];
  if (tk.strongs) parts.push(tk.strongs);
  // `morphCode` é VERBATIM (a `morph_legend` ainda não decodifica — dado futuro, GATED). Exibido
  // cru p/ não inventar decodificação; some quando ausente.
  if (tk.morphCode) parts.push(tk.morphCode);
  return parts.join(' · ');
}

export function ReaderInterlinearPanel({
  visible,
  sourceLabel,
  book,
  chapter,
  verse,
  dbPath,
  onClose,
}: {
  visible: boolean;
  /** Rótulo legível da passagem (ex.: "João 3:16"), só p/ o cabeçalho. */
  sourceLabel: string;
  book: number;
  chapter: number;
  /** Versículo selecionado; `null` enquanto não há seleção (painel fechado). */
  verse: number | null;
  /** Caminho do DB de leitura (a fronteira carrega o léxico on-demand a partir dele); `null` enquanto carrega. */
  dbPath: string | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { colors } = theme;
  // Só o CROMO (seção, aviso, atribuição-fallback, a11y) passa por `t()`. A SUPERFÍCIE (palavra
  // original), a translit, a glosa e o Strong vêm do STORE — nunca de `t()` (anti-alucinação).
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [data, setData] = useState<InterlinearVerseOut | null>(null);
  // `loading` começa TRUE: o estado ocioso (antes do fetch) LÊ como carregando, nunca como vazio.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // RESET SÍNCRONO ao trocar de ALVO (padrão React "ajustar estado quando um prop muda"): zera
  // `data`/`error` e volta a `loading` no MESMO render em que o versículo muda — ANTES da pintura.
  // Sem isto, o `useEffect` (passivo, pós-pintura) deixaria UM frame com estado obsoleto: (a) na
  // 1ª abertura de um versículo COBERTO, o texto "sem interlinear" pisca (data=null, loading=false);
  // (b) ao reabrir noutro versículo, os tokens do ANTERIOR aparecem sob o cabeçalho do NOVO — um
  // deslize de PROVENIÊNCIA inaceitável num app anti-alucinação. `verse|book|chapter` = a identidade.
  const target = `${book}:${chapter}:${verse ?? 'none'}`;
  const [loadedTarget, setLoadedTarget] = useState(target);
  if (target !== loadedTarget) {
    setLoadedTarget(target);
    setData(null);
    setError(null);
    setLoading(true);
  }

  // Carrega os tokens do versículo ao abrir (round-trip via a fronteira). Reinicia ao trocar de
  // versículo. Livro sem cobertura → retorno vazio (sem throw) → estado-vazio informativo.
  useEffect(() => {
    if (!visible || verse == null || dbPath == null) {
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await interlinearVerse(dbPath, book, chapter, verse);
        if (alive) {
          setData(res);
          setLoading(false);
        }
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, dbPath, book, chapter, verse]);

  const tokens = data?.tokens ?? [];
  // Atribuição a exibir: as `sources` REAIS do retorno (verbatim do banco). Fallback à substring
  // canônica só se o retorno (por algum motivo) não trouxer nenhuma — o requisito de licença nunca cai.
  const sources = data?.sources ?? [];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={sourceLabel}
      testIDPrefix="interlinear-panel"
      maxHeightPercent={82}
    >
      <SectionLabel>{t('interlinear.section')}</SectionLabel>

      {loading ? (
        <View style={styles.loadingRow} testID="interlinear-loading">
          <ActivityIndicator color={colors.text} />
          <Text style={styles.loadingText}>{t('interlinear.loading')}</Text>
        </View>
      ) : error ? (
        <Text style={styles.error} testID="interlinear-error">
          {error}
        </Text>
      ) : tokens.length === 0 ? (
        <Text style={styles.empty} testID="interlinear-empty">
          {t('interlinear.empty')}
        </Text>
      ) : (
        <>
          {/* Grade palavra-a-palavra: cada célula empilha superfície (língua original) / translit /
              glosa / Strong+morf. Ordem = `wordIndex` (a fronteira já retorna ORDER BY word_index). */}
          <View style={styles.grid} testID="interlinear-grid">
            {tokens.map((tk) => (
              <View key={tk.wordIndex} style={styles.cell} testID={`interlinear-token-${tk.wordIndex}`}>
                <Text style={styles.surface}>{tk.surface}</Text>
                {tk.translit ? <Text style={styles.translit}>{tk.translit}</Text> : null}
                {tk.gloss ? <Text style={styles.gloss}>{tk.gloss}</Text> : null}
                {tokenMeta(tk) ? <Text style={styles.meta}>{tokenMeta(tk)}</Text> : null}
              </View>
            ))}
          </View>

          {/* Aviso anti-alucinação (a proveniência do texto original é EXPLÍCITA). */}
          <Text style={styles.note} testID="interlinear-note">
            {t('interlinear.note')}
          </Text>

          {/* ATRIBUIÇÃO STEP CC-BY (ADR-0026, OBRIGATÓRIA) — string(s) REAIS do retorno via `<AttributionBlock>`. */}
          <AttributionBlock sources={sources} testID="interlinear-attribution" />
        </>
      )}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
    loadingText: { ...type.caption, color: colors.muted, flexShrink: 1 },
    empty: { ...type.body, color: colors.muted, marginTop: space.sm },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
    // Grade de palavras: quebra em linhas, cada célula é uma coluna estreita empilhada.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
    cell: {
      minWidth: 68,
      paddingVertical: space.xs,
      paddingHorizontal: space.sm,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.selectionBg,
    },
    // Palavra na língua original: SERIFA de leitura, destaque — é o dado citado (verbatim do store).
    surface: { ...type.verse, fontSize: 20, color: colors.verseText },
    translit: { ...type.caption, fontStyle: 'italic', color: colors.muted, marginTop: 2 },
    gloss: { ...type.body, fontSize: 13, color: colors.text, marginTop: 2 },
    meta: { ...type.caption, color: colors.accent, marginTop: 2 },
    note: { ...type.caption, color: colors.muted, fontStyle: 'italic', marginTop: space.md },
  });
}
