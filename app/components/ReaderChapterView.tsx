// app/components/ReaderChapterView.tsx — F1.3 · tokens de tema F1.4 (ADR-0015)
//
// Apresentacional: renderiza o capítulo (Passage) com versículos NUMERADOS e
// TEXTO VERBATIM do store (anti-alucinação — o texto vem do `get_chapter` do
// Rust, nunca gerado/hardcodado na UI). Cores via TOKENS de tema (`useTheme`),
// não mais hex hardcoded. Não faz I/O nem lógica de domínio.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useI18n } from '../lib/i18n';
import {
  DEFAULT_FONT_STEP,
  DEFAULT_LINE_SPACING,
  DEFAULT_READING_FONT,
  fontScaleForStep,
  LINE_HEIGHT_FACTOR,
  type LineSpacing,
  type ReadingFont,
  type ReadingTheme,
} from '../lib/readingPrefs';
import { READING_PALETTES, useTheme, type ThemeColors, type ThemeContextValue } from '../lib/theme';
import type { Passage } from '../web/reading';

/** Estilo de verso resolvido a partir das preferências de leitura (tamanho/entrelinha/família/just). */
type VerseStyle = { fontSize: number; lineHeight: number; fontFamily?: string; textAlign: 'left' | 'justify' };

/** Número do versículo a partir do `VerseRange` (sempre `Single` num capítulo). */
function verseNumber(passageVerseRange: Passage['verses'][number]['reference']['verses']): number | null {
  return passageVerseRange.tag === 'Single' ? passageVerseRange.inner.verse : null;
}

// F5.32: duração (ms) do realce transitório aplicado ao versículo-âncora (busca/xref).
// Determinístico e curto: some sozinho após a rolagem, sem exigir interação.
const ANCHOR_FLASH_MS = 2500;
// F5.32: folga (px) acima do versículo-âncora ao rolar — deixa o alvo respirando no topo.
const ANCHOR_SCROLL_OFFSET = 12;

export function ReaderChapterView({
  passage,
  heading,
  onVersePress,
  selectedVerse,
  highlightedVerses,
  notedVerses,
  anchorVerse,
  fontStep = DEFAULT_FONT_STEP,
  lineSpacing = DEFAULT_LINE_SPACING,
  readingTheme = null,
  readingFont = DEFAULT_READING_FONT,
  justify = false,
}: {
  passage: Passage;
  /**
   * ADR-0063 ("Vigil"): título de abertura do capítulo (ex.: "João 3"), em serifa, como a
   * âncora de leitura no topo do texto (molde do livro impresso). OPCIONAL (retrocompat).
   */
  heading?: string;
  /**
   * F1.9: torna os versículos SELECIONÁVEIS (Pressable) p/ abrir o painel de
   * referências cruzadas. OPCIONAL — sem o prop, o comportamento é o de F1.3 (texto
   * estático), preservando a retrocompatibilidade.
   */
  onVersePress?: (verse: number) => void;
  /** Versículo selecionado (realce por token); só usado com `onVersePress`. */
  selectedVerse?: number | null;
  /**
   * F1.11: indicador de HIGHLIGHT do usuário — mapa `versículo → cor de fundo`
   * (hex já resolvido p/ o tema, a partir de `list_highlights`). OPCIONAL
   * (retrocompat). A cor do usuário é distinta da seleção (`verseSelected`).
   */
  highlightedVerses?: Map<number, string>;
  /**
   * F1.11: indicador de NOTA do usuário — conjunto de versículos com nota (de
   * `list_notes`). OPCIONAL (retrocompat); mostra um realce/marcador discreto.
   */
  notedVerses?: Set<number>;
  /**
   * F5.32: versículo-ÂNCORA vindo de busca/xref (`?verse=N`). Quando definido, a view
   * ROLA até ele (medindo o offset no `onLayout`) e aplica um realce TRANSITÓRIO
   * (reusa o visual `verseSelected`) que some sozinho — sem abrir o painel de seleção.
   * OPCIONAL (retrocompat): sem o prop, a leitura fica no topo, como antes. Fora de
   * faixa → no-op seguro (nenhuma linha casa o alvo; sem rolagem, sem crash).
   */
  anchorVerse?: number | null;
  /** ADR-0067: preferências de leitura (tamanho/entrelinha/tema/família/justificação). */
  fontStep?: number;
  lineSpacing?: LineSpacing;
  /** Tema de leitura da SUPERFÍCIE (claro/sépia/escuro); `null` = seguir o modo do app. */
  readingTheme?: ReadingTheme | null;
  readingFont?: ReadingFont;
  justify?: boolean;
}) {
  const theme = useTheme();
  // ADR-0067: a SUPERFÍCIE de leitura usa a paleta de LEITURA escolhida (claro/sépia/escuro),
  // distinta da paleta do app; `null` segue o modo do app. O cromo do reader (header/picker) fica
  // na paleta do app — só o texto do versículo é re-tematizado.
  const colors: ThemeColors = readingTheme ? READING_PALETTES[readingTheme] : theme.colors;
  // Verso escalado pelas prefs: tamanho (passo), entrelinha (densidade), família (serifa/sem) e just.
  const verseFontSize = Math.round(theme.type.verse.fontSize * fontScaleForStep(fontStep));
  const verse: VerseStyle = {
    fontSize: verseFontSize,
    lineHeight: Math.round(verseFontSize * LINE_HEIGHT_FACTOR[lineSpacing]),
    fontFamily: readingFont === 'sans' ? undefined : theme.type.verse.fontFamily,
    textAlign: justify ? 'justify' : 'left',
  };
  // F5.8: só o CROMO (estado-vazio + hint do gesto no versículo) passa por `t()`. O TEXTO do
  // versículo é VERBATIM do store — permanece como conteúdo do <Text> (rótulo lido pelo
  // leitor de tela), nunca substituído por `t()`. O hint só descreve a AÇÃO (abrir opções).
  const { t } = useI18n();
  const styles = useMemo(
    () => makeStyles(theme, colors, verse),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, colors, verse.fontSize, verse.lineHeight, verse.fontFamily, verse.textAlign],
  );

  // F5.32: ancoragem no versículo-alvo (busca/xref). `scrollRef` p/ comandar a rolagem;
  // `offsetsRef` acumula o Y de cada linha via `onLayout`; `pendingRef` guarda o alvo até
  // sua linha ter layout (rolagem só quando o offset é conhecido). O realce transitório é
  // ESTADO (`flashVerse`) p/ forçar re-render e limpar sozinho após `ANCHOR_FLASH_MS`.
  const scrollRef = useRef<ScrollView>(null);
  const offsetsRef = useRef<Map<number, number>>(new Map());
  const pendingRef = useRef<number | null>(null);
  const [flashVerse, setFlashVerse] = useState<number | null>(null);

  const scrollToVerse = (n: number) => {
    const y = offsetsRef.current.get(n);
    if (y == null) {
      // Linha ainda sem layout → adia; o `onLayout` correspondente completa a rolagem.
      pendingRef.current = n;
      return;
    }
    pendingRef.current = null;
    scrollRef.current?.scrollTo({ y: Math.max(y - ANCHOR_SCROLL_OFFSET, 0), animated: true });
  };

  const onVerseLayout = (n: number, event: LayoutChangeEvent) => {
    offsetsRef.current.set(n, event.nativeEvent.layout.y);
    if (pendingRef.current === n) {
      scrollToVerse(n);
    }
  };

  // Ao mudar a âncora (nova navegação c/ `?verse=N`): rola até ela e a destaca por um
  // instante. Fora de faixa → `scrollToVerse` só registra o pendente que nunca casa (no-op).
  useEffect(() => {
    if (anchorVerse == null) {
      setFlashVerse(null);
      return;
    }
    setFlashVerse(anchorVerse);
    scrollToVerse(anchorVerse);
    const timer = setTimeout(() => {
      setFlashVerse((cur) => (cur === anchorVerse ? null : cur));
    }, ANCHOR_FLASH_MS);
    return () => clearTimeout(timer);
    // `scrollToVerse` é estável (refs); só a âncora deve reprocessar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorVerse]);

  if (passage.verses.length === 0) {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.empty}>{t('read.chapterNotFound')}</Text>
      </ScrollView>
    );
  }
  return (
    <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content}>
      {heading ? (
        <View style={styles.headingBlock}>
          <Text style={styles.chapTitle} accessibilityRole="header">
            {heading}
          </Text>
          <View style={styles.chapRule} />
        </View>
      ) : null}
      {passage.verses.map((v, i) => {
        const n = verseNumber(v.reference.verses);
        const selectable = onVersePress != null && n != null;
        const isSelected = selectable && selectedVerse === n;
        // F5.32: realce TRANSITÓRIO do versículo-âncora (busca/xref). Reusa o visual
        // `verseSelected`; independe da seleção (não abre o painel).
        const isAnchored = n != null && flashVerse === n;
        // F1.11: realce de highlight do usuário (cor escolhida) + marcador de nota.
        // A seleção (`verseSelected`) tem precedência visual sobre o highlight.
        const highlightColor = n != null ? highlightedVerses?.get(n) : undefined;
        const isNoted = n != null && notedVerses?.has(n) === true;
        return (
          <Text
            key={n ?? i}
            style={[
              styles.verse,
              highlightColor ? { backgroundColor: highlightColor } : null,
              isSelected || isAnchored ? styles.verseSelected : null,
            ]}
            testID={n != null ? `verse-${n}` : undefined}
            onLayout={n != null ? (event) => onVerseLayout(n, event) : undefined}
            onPress={selectable ? () => onVersePress!(n!) : undefined}
            accessibilityRole={selectable ? 'button' : undefined}
            accessibilityHint={selectable ? t('a11y.verseOptions') : undefined}
          >
            {n != null ? <Text style={styles.verseNumber}>{n} </Text> : null}
            {isNoted ? <Text style={styles.noteMark}>✎ </Text> : null}
            <Text style={styles.verseText}>{v.text}</Text>
          </Text>
        );
      })}
    </ScrollView>
  );
}

function makeStyles({ type, space, radius }: ThemeContextValue, colors: ThemeColors, verse: VerseStyle) {
  return StyleSheet.create({
    scroll: { backgroundColor: colors.background },
    content: {
      paddingHorizontal: space.xl,
      paddingVertical: space.lg,
      gap: space.md,
      backgroundColor: colors.background,
    },
    // Abertura do capítulo em serifa (type.title) + régua dourada — âncora de leitura.
    headingBlock: { marginBottom: space.xs },
    chapTitle: { ...type.title, color: colors.text },
    chapRule: {
      width: 44,
      height: 3,
      borderRadius: 3,
      backgroundColor: colors.accent,
      marginTop: space.sm,
    },
    // Corpo do versículo em SERIFA de leitura (type.verse), ESCALADO pelas prefs (tamanho/
    // entrelinha/família/justificação) — verbatim do store.
    verse: {
      ...type.verse,
      fontSize: verse.fontSize,
      lineHeight: verse.lineHeight,
      fontFamily: verse.fontFamily,
      textAlign: verse.textAlign,
    },
    // Seleção/âncora: banho de ouro sutil + régua dourada à esquerda (não invertido — o
    // texto segue legível em `verseText`, par auditado AA sobre `selectionBg`).
    verseSelected: {
      backgroundColor: colors.selectionBg,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingLeft: space.sm,
      marginLeft: -space.sm,
      borderTopRightRadius: radius.sm,
      borderBottomRightRadius: radius.sm,
    },
    // iOS: `lineHeight` NÃO herda para <Text> aninhado (só no web/CSS). Como o número/marca/corpo
    // são runs ANINHADOS dentro do <Text> do versículo, a entrelinha PRECISA vir em cada run —
    // senão mudar a pref de espaçamento não muda nada no iOS (o `lineHeight` do pai não tem texto
    // direto p/ aplicar). `verse.lineHeight` é a densidade escolhida (compacto/confortável/amplo).
    verseNumber: { ...type.verseNumber, lineHeight: verse.lineHeight, color: colors.accent },
    noteMark: { ...type.verseNumber, lineHeight: verse.lineHeight, color: colors.accent },
    verseText: { color: colors.verseText, lineHeight: verse.lineHeight },
    empty: { ...type.body, color: colors.muted },
  });
}
