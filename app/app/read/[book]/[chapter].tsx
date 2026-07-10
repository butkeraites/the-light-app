// app/app/read/[book]/[chapter].tsx — F1.3 · lado a lado + tema F1.4 (ADR-0015)
//
// Tela 3 do fluxo de leitura: TEXTO DO CAPÍTULO (versículos numerados, VERBATIM
// do store via `get_chapter`) + SELETOR DE VERSÃO (`listTranslations(db)` —
// KJV ⇄ Almeida 1911). Duas capacidades novas (F1.4):
//   1) LADO A LADO: um toggle ativa o modo paralelo; carregamos `get_chapter`
//      para AS DUAS traduções (uma chamada cada) e alinhamos por número de
//      versículo no `ReaderParallelView` (apresentação sobre o retorno da
//      fronteira — SEM SQL/leitura/texto em TS).
//   2) TEMA claro/escuro: cores via tokens (`useTheme`), não mais hex hardcoded.
// Anti-alucinação: o texto vem sempre do Rust/store, nunca gerado na UI.
//
// ADR-0060 (deepening): todo o FETCHING de fronteira do capítulo (traduções, passagens,
// xrefs, dbPath/dataDir, notas/highlights) vive na seam `useChapterReader`; esta tela retém
// só estado de CONTROLE + apresentação. Os 4 painéis de IA compartilham um `activePanel`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReaderChapterView } from '../../../components/ReaderChapterView';
import { ReaderParallelView } from '../../../components/ReaderParallelView';
import { WasmGate } from '../../../components/WasmGate';
import { ReaderVersionPicker } from '../../../components/ReaderVersionPicker';
import { ReaderVersePanel } from '../../../components/ReaderVersePanel';
import { ReaderAskPanel } from '../../../components/ReaderAskPanel';
import { ReaderStudyPanel } from '../../../components/ReaderStudyPanel';
import { ReaderInterlinearPanel } from '../../../components/ReaderInterlinearPanel';
import { ReaderChatPanel } from '../../../components/ReaderChatPanel';
import { ReaderComparePanel } from '../../../components/ReaderComparePanel';
import { ReadingSettingsSheet } from '../../../components/ReadingSettingsSheet';
import { ReaderScopeBar } from '../../../components/ReaderScopeBar';
import { ScopeStudySheet } from '../../../components/ScopeStudySheet';
import { LanguageToggleButton } from '../../../components/LanguageToggleButton';
import { ThemeModeSelector } from '../../../components/ThemeModeSelector';
import { Chip, IconButton } from '../../../components/ui';
import { resolveHighlightColor } from '../../../lib/highlightColors';
import { useI18n } from '../../../lib/i18n';
import { useChapterReader } from '../../../lib/useChapterReader';
import { useImmersiveChrome } from '../../../lib/useImmersiveChrome';
import { useReadingPrefs } from '../../../lib/useReadingPrefs';
import { studyScope, useStudyScope } from '../../../lib/useStudyScope';
import { versesForChapter } from '../../../lib/studyScope';
import { useTheme, type ThemeContextValue } from '../../../lib/theme';
import { listBooks, type CrossRef } from '../../../web/reading';
import { chapterNav } from '../../../lib/chapterNav';
import { defaultTranslationFor, langForTranslation } from '../../../lib/translationDefault';
import { readingChapterHref } from '../../../lib/readingNav';
import { READING_COLUMN_MAX, READING_COLUMN_MAX_PARALLEL } from '../../../lib/readingLayout';
import { useChapterTurnGestures } from '../../../lib/useChapterTurnGestures';

/** Nome (PT) de um livro pelo número canônico (cânon puro, independe do banco). */
function bookNamePt(book: number): string {
  return listBooks().find((b) => b.number === book)?.namePt ?? `Livro ${book}`;
}

/** Nome (EN) de um livro — base da referência CANÔNICA passada à fronteira userdata. */
function bookNameEn(book: number): string {
  return listBooks().find((b) => b.number === book)?.nameEn ?? `Book ${book}`;
}

export default function ChapterScreen() {
  // F5.3: esta tela chama `listBooks()` (síncrono, exige o wasm da fronteira) tanto no
  // RENDER (via `bookNamePt`/`bookNameEn`) quanto em efeito. Como o 1º paint não bloqueia
  // mais no wasm (`_layout.tsx`), ela se auto-gateia: o conteúdo só monta com o wasm
  // pronto. No nativo o gate é transparente (pronto de imediato).
  return (
    <WasmGate>
      <ChapterContent />
    </WasmGate>
  );
}

function ChapterContent() {
  const theme = useTheme();
  const { colors, isDark } = theme;
  // F5.5: `locale` da UI. Distinto de `translation` (versão bíblica): o `locale` traduz
  // o CROMO e escolhe o campo de nome do livro no STORE; ele NÃO altera o texto citado.
  // É também o `lang` repassado aos painéis de IA (a resposta segue o idioma da UI).
  const { locale, t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // ADR-0067: preferências de leitura (tamanho/entrelinha/tema/família/just) + folha de ajustes.
  const readingPrefs = useReadingPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Fase 2: Escopo de Estudo (multi-seleção). O estado vive num store acima da rota (persiste ao
  // navegar entre capítulos/livros). `scopeSheetOpen` abre a pré-visualização verbatim do escopo.
  const scope = useStudyScope();
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  const { book, chapter, verse, version } = useLocalSearchParams<{
    book: string;
    chapter: string;
    verse?: string;
    version?: string;
  }>();
  const bookNumber = Number(book);
  const chapterNumber = Number(chapter);
  // A VERSÃO de origem (`?version=`) — de qual tradução veio o salto (busca/referência/xref/virar
  // capítulo). A tela lia só book/chapter/verse e nascia sempre em KJV, então a versão escolhida
  // (ex.: Almeida) se perdia no salto. Normaliza `string | string[]` → 1ª string não-vazia; fora
  // disso → null (deep-link a frio: cai no default do idioma).
  const versionParamRaw = Array.isArray(version) ? version[0] : version;
  const versionParam = versionParamRaw && versionParamRaw.length > 0 ? versionParamRaw : null;
  // F5.32: versículo-ÂNCORA opcional vindo de busca/xref (`?verse=N`). A tela lia só
  // book/chapter e descartava `verse` — então o alvo aterrissava no TOPO. Agora é
  // repassado ao `ReaderChapterView`, que rola até ele e o destaca. `expo-router` pode
  // devolver string | string[]; normaliza-se ao 1º e valida-se finitude (fora disso → null,
  // comportamento idêntico ao de hoje: sem âncora).
  const verseParamRaw = Array.isArray(verse) ? verse[0] : verse;
  const verseParam = verseParamRaw != null ? Number(verseParamRaw) : NaN;
  const anchorVerse = Number.isFinite(verseParam) && verseParam > 0 ? verseParam : null;

  // Estado de CONTROLE da tela (o fetching de fronteira vive no hook useChapterReader).
  // Versão INICIAL = a de origem (`?version=`), senão o default do IDIOMA da UI (pt→Almeida) —
  // não mais KJV fixo. O usuário ainda troca livremente pelo seletor; o parâmetro só semeia.
  const [translation, setTranslation] = useState(() => versionParam ?? defaultTranslationFor(locale));
  // F1.4: modo lado a lado (a 2ª tradução é reconciliada pelo hook).
  const [parallel, setParallel] = useState(false);
  // F1.9: versículo selecionado (dirige o carregamento de xref no hook).
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);

  // LEITURA IMERSIVA (ADR-0069-feel / ADR-0076): o topo INTEIRO (voltar + título + versão + Aa + idioma +
  // tema + controles) é UMA barra-OVERLAY absoluta que desliza ao rolar (translateY+opacity, driver
  // nativo; sem pulo). O CICLO da barra (hidden→anim→gone), a medição e o reset por âncora vivem na
  // costura `useImmersiveChrome`; a tela só espalha os props no `<Animated.View>`.
  const insets = useSafeAreaInsets();
  const { barHeight, onReaderScroll, resetChrome, overlayProps, gone: chromeGone, animatedStyle } =
    useImmersiveChrome(anchorVerse);

  // Fase 2: versículos DESTE capítulo já no Escopo (realce multi-seleção) + handlers de gesto.
  const chapterScope = useMemo(
    () => versesForChapter(scope.chunks, bookNumber, chapterNumber),
    [scope.chunks, bookNumber, chapterNumber],
  );
  // Toque num versículo: no MODO SELEÇÃO alterna o versículo no Escopo; senão abre o painel
  // por-versículo de sempre (sem regressão).
  const onVerse = (n: number) => {
    if (scope.selecting) {
      studyScope.toggleVerse(bookNumber, chapterNumber, n);
    } else {
      setSelectedVerse(n);
    }
  };
  // Long-press: ENTRA no modo seleção e já adiciona o versículo (a entrada natural da multi-seleção).
  const onVerseLong = (n: number) => {
    studyScope.startSelecting();
    studyScope.toggleVerse(bookNumber, chapterNumber, n);
  };

  // F2.5/F3.5/F3.6/F3.7: qual painel de IA está aberto e em qual versículo. Colapsa os quatro
  // estados paralelos (ask/study/chat/compare) num só — só UM painel abre por vez (cada um é
  // aberto pelo painel por-versículo, que fecha antes). A âncora não se perde ao fechar o
  // painel por-versículo porque vive aqui, SEPARADA de `selectedVerse`.
  type PanelKind = 'ask' | 'study' | 'chat' | 'compare' | 'interlinear';
  type ActivePanel = { kind: PanelKind; verse: number } | null;
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const panelVerse = (kind: PanelKind): number | null =>
    activePanel?.kind === kind ? activePanel.verse : null;

  // Seam profunda de leitura (ADR-0060): todo o fetching de fronteira do capítulo (traduções,
  // passagens primária/paralela, xrefs, dbPath/dataDir, indicadores de nota/highlight).
  const {
    translations,
    secondTranslation,
    setSecondTranslation,
    passage,
    secondaryPassage,
    error,
    xrefs,
    xrefLoading,
    xrefError,
    dbPath,
    dataDir,
    notedVerses,
    highlightColors,
    refreshUserData,
  } = useChapterReader({
    book: bookNumber,
    chapter: chapterNumber,
    translation,
    parallel,
    selectedVerse,
  });

  // Defensivo: se a versão semeada (do parâmetro) não existir no store, cai no default do idioma —
  // mesmo espírito da reconciliação da 2ª tradução no hook (`useChapterReader`). Slugs vindos da
  // busca/xref são sempre válidos (kjv/alm1911); isto só protege um `?version=` inválido a frio.
  useEffect(() => {
    if (translations.length === 0) return;
    if (!translations.some((tr) => tr.id === translation)) {
      setTranslation(defaultTranslationFor(locale));
    }
  }, [translations, translation, locale]);

  // Fase 7 (follow-up): o nome do livro EXIBIDO segue o IDIOMA DA VERSÃO lida, não o `locale` da
  // UI — lendo Almeida (pt) o header/painéis mostram "João" mesmo com a UI em inglês (e KJV → "John"
  // mesmo com a UI em português). Cai no `locale` se a versão não declarar idioma conhecido. A
  // `reference` CANÔNICA passada às fronteiras segue EN (`bookNameEn`, a âncora) — anti-alucinação.
  const nameLang: 'pt' | 'en' = useMemo(
    () => langForTranslation(translation, translations, locale),
    [translations, translation, locale],
  );

  // Nome do livro no IDIOMA DA VERSÃO, para o `sourceLabel` (cabeçalho) dos painéis de IA. O nome
  // vem SEMPRE do STORE (`namePt`/`nameEn`) — `nameLang` só ESCOLHE o campo, NUNCA traduz via `t()`.
  const bookLabel = useCallback(
    (bookNum: number): string => {
      const b = listBooks().find((x) => x.number === bookNum);
      return b ? (nameLang === 'en' ? b.nameEn : b.namePt) : t('read.bookFallback', { number: bookNum });
    },
    [nameLang, t],
  );

  // (Leitura imersiva) O título + os controles (Aa/idioma/tema) NÃO vão mais ao header nativo —
  // ele está desligado nesta rota. Vivem na barra-overlay in-screen (ver render). O rótulo do
  // título usa `bookLabel(bookNumber)` (nome do STORE, `nameLang` escolhe o campo — anti-alucinação).

  // Resolve os nomes de cor (dado do usuário) p/ a amostra de fundo do tema corrente.
  const highlightedVerses = useMemo(() => {
    const resolved = new Map<number, string>();
    highlightColors.forEach((name, verse) => {
      resolved.set(verse, resolveHighlightColor(name, isDark));
    });
    return resolved;
  }, [highlightColors, isDark]);

  // Navega ao capítulo de destino de uma xref (rota F1.3). `verse` vai como param
  // OPCIONAL (best-effort: a ancoragem/realce é follow-up; chegar ao capítulo já
  // satisfaz o aceite). Fecha o painel antes de navegar.
  function openXref(ref: CrossRef['reference']) {
    const v = ref.verses;
    const verse = v.tag === 'Single' ? v.inner.verse : v.tag === 'Range' ? v.inner.start : null;
    setSelectedVerse(null);
    // A xref abre na MESMA tradução que se estava lendo (a costura EXIGE `version`).
    router.push(readingChapterHref({ book: ref.book, chapter: ref.chapter, verse, version: translation }));
  }

  // Navegação CAPÍTULO-A-CAPÍTULO (leitura contínua): vizinhos canônicos do capítulo atual, cruzando
  // livros (Gn 50 → Êx 1) e parando nos extremos (Gn 1 sem anterior; Ap 22 sem próximo). `listBooks()`
  // é síncrono (wasm pré-aquecido no boot). Só decide a ROTA — o texto segue verbatim do store.
  const adj = useMemo(() => chapterNav(listBooks(), bookNumber, chapterNumber), [bookNumber, chapterNumber]);

  // Vai ao capítulo alvo: `replace` (não empilha uma leitura longa; back = sair). Sem `?verse` → topo;
  // `resetChrome()` reexibe a barra ao chegar. O corpo remonta no topo (useChapterReader zera o passage).
  const goToChapter = useCallback(
    (target: { book: number; chapter: number }) => {
      setSelectedVerse(null);
      resetChrome();
      // Virar capítulo NÃO reseta a tradução: a costura carrega a versão corrente (sem `verse` → topo).
      router.replace(readingChapterHref({ book: target.book, chapter: target.chapter, version: translation }));
    },
    [resetChrome, translation],
  );

  // Rótulo curto do capítulo-alvo p/ os botões/a11y (nome do livro VERBATIM do store, nunca fabricado).
  const chapterLabel = (r: { book: number; chapter: number }) => `${bookLabel(r.book)} ${r.chapter}`;

  // Rodapé de fim-de-capítulo: Anterior (esq.) / Próximo (dir.), cada um só quando há adjacência.
  // Montado UMA vez e passado aos dois corpos (normal + paralelo) → paridade sem duplicar lógica.
  const readerFooter =
    adj.prev || adj.next ? (
      <View style={styles.chapterNavFooter}>
        {adj.prev ? (
          <Pressable
            style={styles.chapterNavBtn}
            onPress={() => goToChapter(adj.prev!)}
            testID="reader-prev-chapter"
            accessibilityRole="button"
            accessibilityLabel={t('a11y.prevChapter', { label: chapterLabel(adj.prev) })}
          >
            <Text style={styles.chapterNavText}>{t('read.prevChapter', { label: chapterLabel(adj.prev) })}</Text>
          </Pressable>
        ) : (
          <View style={styles.chapterNavSpacer} />
        )}
        {adj.next ? (
          <Pressable
            style={[styles.chapterNavBtn, styles.chapterNavBtnEnd]}
            onPress={() => goToChapter(adj.next!)}
            testID="reader-next-chapter"
            accessibilityRole="button"
            accessibilityLabel={t('a11y.nextChapter', { label: chapterLabel(adj.next) })}
          >
            <Text style={styles.chapterNavText}>{t('read.nextChapter', { label: chapterLabel(adj.next) })}</Text>
          </Pressable>
        ) : (
          <View style={styles.chapterNavSpacer} />
        )}
      </View>
    ) : null;

  // Atalhos de e-reader p/ virar capítulo, SÓ NO WEB (Platform), reusando `goToChapter`/`adj`. São
  // listeners PASSIVOS de `window` (sem overlay sobre o ScrollView → scroll/roda/seleção de versículo
  // 100% intactos). Suprimidos quando qualquer painel/folha está aberto ou há seleção multi-trecho.
  const navBlocked =
    selectedVerse != null || activePanel != null || settingsOpen || scopeSheetOpen || scope.selecting;

  // Largura da COLUNA de leitura efetivamente renderizada (simples vs. paralelo) — a zona de
  // clique-lateral é a MARGEM vazia fora dela. Mesma constante que os corpos usam p/ centralizar.
  const readingColumnMax =
    parallel && secondaryPassage != null ? READING_COLUMN_MAX_PARALLEL : READING_COLUMN_MAX;

  // ADR-0071: os 3 atalhos de virar-capítulo (teclado ←/→, clique-nas-laterais, swipe de toque —
  // SÓ NO WEB, listeners passivos) vivem numa costura; as decisões puras estão em `gestureNav`.
  useChapterTurnGestures({ adj, goToChapter, navBlocked, readingColumnMax });

  // 2ª tradução só oferece versões DIFERENTES da primária.
  const secondaryOptions = translations.filter((tr) => tr.id !== translation);
  const canParallel = secondaryOptions.length > 0;

  return (
    <View style={styles.container}>
      {/* Leitura imersiva: TODO o topo é UMA barra-OVERLAY absoluta que DESLIZA (translateY+opacity,
          driver nativo) — o frame do ScrollView NÃO muda de tamanho (sem pulo). A altura natural é
          medida (onLayout) p/ o translateY e p/ o paddingTop do texto (topInset). */}
      <Animated.View
        testID="reader-chrome"
        // Escondida → sem toque/mouse e fora da a11y (`chromeGone` → display:none). Os props de medição +
        // a11y e o estilo ANIMADO (translateY+opacity, driver nativo) vêm da costura `useImmersiveChrome`.
        {...overlayProps}
        style={[styles.chrome, { paddingTop: insets.top }, chromeGone ? styles.chromeGone : null, animatedStyle]}
      >
        {/* Linha de navegação: voltar + título (nome do STORE, `bookLabel`) + Aa / idioma / tema. */}
        <View style={styles.navRow}>
          <IconButton
            name="back"
            // Deep-link a frio (pilha vazia): `router.back()` seria no-op → cai na lista de leitura.
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/read'))}
            accessibilityLabel={t('a11y.back')}
            testID="reader-back"
          />
          {/* Setas de CAPÍTULO flanqueando o título (o botão SAIR fica à esquerda). Somem no extremo. */}
          {adj.prev ? (
            <IconButton
              name="back"
              onPress={() => goToChapter(adj.prev!)}
              accessibilityLabel={t('a11y.prevChapter', { label: chapterLabel(adj.prev) })}
              testID="reader-prev-chapter-top"
            />
          ) : null}
          <Text style={styles.navTitle} numberOfLines={1}>
            {`${bookLabel(bookNumber)} ${chapterNumber}`}
          </Text>
          {adj.next ? (
            <IconButton
              name="chevron"
              onPress={() => goToChapter(adj.next!)}
              accessibilityLabel={t('a11y.nextChapter', { label: chapterLabel(adj.next) })}
              testID="reader-next-chapter-top"
            />
          ) : null}
          <View style={styles.navRight}>
            <IconButton
              label="Aa"
              onPress={() => setSettingsOpen(true)}
              accessibilityLabel={t('a11y.readingSettings')}
              testID="reading-settings-open"
            />
            <LanguageToggleButton />
            <ThemeModeSelector />
          </View>
        </View>
        {translations.length > 0 ? (
          <ReaderVersionPicker
            translations={translations}
            current={translation}
            onChange={setTranslation}
          />
        ) : null}

      <View style={styles.controls}>
        {canParallel ? (
          <Pressable
            style={[styles.toggle, parallel ? styles.toggleActive : null]}
            onPress={() => setParallel((v) => !v)}
            testID="parallel-toggle"
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="switch"
            accessibilityState={{ checked: parallel }}
            accessibilityLabel={t('read.parallel')}
          >
            <Text style={[styles.toggleText, parallel ? styles.toggleTextActive : null]}>
              {t('read.parallel')}
            </Text>
          </Pressable>
        ) : null}
        {/* Fase 2: entrada da MULTI-SELEÇÃO — ativa o modo seleção (long-press num versículo também
            entra). No modo, tocar versículos os acumula no Escopo; a barra-escopo aparece no rodapé. */}
        <Chip
          label={t('scope.select')}
          active={scope.selecting}
          onPress={() => studyScope.setSelecting(!scope.selecting)}
          testID="scope-select-toggle"
        />
      </View>

          {parallel && canParallel && secondTranslation ? (
            <ReaderVersionPicker
              translations={secondaryOptions}
              current={secondTranslation}
              onChange={setSecondTranslation}
              testIDPrefix="version2"
            />
          ) : null}
      </Animated.View>

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : passage == null ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : parallel && canParallel ? (
        secondaryPassage == null ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : (
          <ReaderParallelView
            primary={passage}
            secondary={secondaryPassage}
            onScroll={onReaderScroll}
            topInset={barHeight}
            footer={readerFooter}
          />
        )
      ) : (
        <ReaderChapterView
          passage={passage}
          heading={`${bookLabel(bookNumber)} ${chapterNumber}`}
          onVersePress={onVerse}
          onVerseLongPress={onVerseLong}
          selectedVerse={selectedVerse}
          scopeVerses={chapterScope.verses}
          scopeWhole={chapterScope.whole}
          highlightedVerses={highlightedVerses}
          notedVerses={notedVerses}
          anchorVerse={anchorVerse}
          fontStep={readingPrefs.fontStep}
          lineSpacing={readingPrefs.lineSpacing}
          readingTheme={readingPrefs.readingTheme}
          readingFont={readingPrefs.readingFont}
          justify={readingPrefs.justify}
          onScroll={onReaderScroll}
          topInset={barHeight}
          footer={readerFooter}
        />
      )}

      {/* F1.11: painel por-versículo (nota + marcação + referências cruzadas +
          exportar), aberto pelo mesmo gesto de seleção. Nota/highlight vão pela
          fronteira `userdata` (F1.10); xref pela `cross_refs` (F1.9) com a
          atribuição CC-BY (ADR-0016). A referência canônica (EN) é passada à
          fronteira; o rótulo do cabeçalho é o nome PT. */}
      <ReaderVersePanel
        visible={selectedVerse != null}
        sourceLabel={
          selectedVerse != null
            ? `${bookNamePt(bookNumber)} ${chapterNumber}:${selectedVerse}`
            : ''
        }
        reference={
          selectedVerse != null
            ? `${bookNameEn(bookNumber)} ${chapterNumber}:${selectedVerse}`
            : ''
        }
        dataDir={dataDir}
        currentHighlight={selectedVerse != null ? (highlightColors.get(selectedVerse) ?? null) : null}
        refs={xrefs}
        xrefLoading={xrefLoading}
        xrefError={xrefError}
        bookNameOf={bookNamePt}
        onSelectXref={openXref}
        onAsk={() => {
          // F2.5: abre o estudo assistido ancorado na MESMA passagem; fecha o painel
          // por-versículo preservando a referência no `activePanel`.
          if (selectedVerse != null) {
            setActivePanel({ kind: 'ask', verse: selectedVerse });
            setSelectedVerse(null);
          }
        }}
        onStudy={() => {
          // F3.5: abre o estudo profundo ancorado na MESMA passagem; fecha o painel
          // por-versículo preservando a referência no `activePanel`.
          if (selectedVerse != null) {
            setActivePanel({ kind: 'study', verse: selectedVerse });
            setSelectedVerse(null);
          }
        }}
        onChat={() => {
          // F3.6: abre a conversa/follow-up ancorada na MESMA passagem; fecha o painel
          // por-versículo preservando a âncora no `activePanel`.
          if (selectedVerse != null) {
            setActivePanel({ kind: 'chat', verse: selectedVerse });
            setSelectedVerse(null);
          }
        }}
        onCompare={() => {
          // F3.7: abre a comparação multi-IA (N provedores) ancorada na MESMA passagem;
          // fecha o painel por-versículo preservando a âncora no `activePanel`.
          if (selectedVerse != null) {
            setActivePanel({ kind: 'compare', verse: selectedVerse });
            setSelectedVerse(null);
          }
        }}
        onInterlinear={() => {
          // Rodada 2: abre o interlinear (palavra-a-palavra, língua original) ancorado na MESMA
          // passagem; fecha o painel por-versículo preservando a âncora no `activePanel`.
          if (selectedVerse != null) {
            setActivePanel({ kind: 'interlinear', verse: selectedVerse });
            setSelectedVerse(null);
          }
        }}
        onAddToScope={
          // Fase 4b: junta este versículo ao Escopo (o painel segue aberto — dá p/ ir somando).
          selectedVerse != null
            ? () => studyScope.toggleVerse(bookNumber, chapterNumber, selectedVerse)
            : undefined
        }
        inScope={selectedVerse != null && (chapterScope.whole || chapterScope.verses.has(selectedVerse))}
        onChanged={() => void refreshUserData()}
        onClose={() => setSelectedVerse(null)}
      />

      {/* F2.5: estudo assistido (IA) ancorado na passagem. O texto CITADO (verbatim
          do store) vem do retorno da fronteira `ask_anchored_stream` (F2.1/F2.3a) e é
          exibido SEPARADO da interpretação (LLM) — anti-alucinação visível. A chave
          BYOK é lida sob demanda pelo painel (mock não usa chave). */}
      <ReaderAskPanel
        visible={panelVerse('ask') != null}
        sourceLabel={
          panelVerse('ask') != null ? `${bookLabel(bookNumber)} ${chapterNumber}:${panelVerse('ask')}` : ''
        }
        reference={
          panelVerse('ask') != null ? `${bookNameEn(bookNumber)} ${chapterNumber}:${panelVerse('ask')}` : ''
        }
        dbPath={dbPath}
        translation={translation}
        lang={locale}
        onClose={() => setActivePanel(null)}
      />

      {/* F3.5: estudo profundo (IA) ancorado na passagem — modo × lente × profundidade.
          A `passageText` (verbatim do store) e o LÉXICO Strong vêm do retorno das
          fronteiras `deep_study`/`lexical_entries` (F3.3/F3.2) e são exibidos SEPARADOS da
          interpretação (LLM) — anti-alucinação visível — com a ATRIBUIÇÃO STEP CC-BY
          obrigatória. Provedor "mock" nesta entrega (offline, sem chave/rede; BYOK = F3.10).
          A passagem vai NUMÉRICA (book/chapter/verse) — não string canônica. */}
      <ReaderStudyPanel
        visible={panelVerse('study') != null}
        sourceLabel={
          panelVerse('study') != null ? `${bookLabel(bookNumber)} ${chapterNumber}:${panelVerse('study')}` : ''
        }
        book={bookNumber}
        chapter={chapterNumber}
        verse={panelVerse('study')}
        dbPath={dbPath}
        translation={translation}
        lang={locale}
        onClose={() => setActivePanel(null)}
      />

      {/* F3.6: conversa/follow-up (IA) multi-turno ancorada na passagem. Cada follow-up
          chama a fronteira `ask_session_anchored` (F3.4) com o MESMO book/chapter/verse
          (âncora preservada); o `citedText` (verbatim do store) é exibido SEPARADO de cada
          interpretação (LLM) — anti-alucinação visível. Provedor "mock" nesta entrega
          (offline, sem chave/rede; BYOK = F3.10). A passagem vai NUMÉRICA. */}
      <ReaderChatPanel
        visible={panelVerse('chat') != null}
        sourceLabel={
          panelVerse('chat') != null ? `${bookLabel(bookNumber)} ${chapterNumber}:${panelVerse('chat')}` : ''
        }
        book={bookNumber}
        chapter={chapterNumber}
        verse={panelVerse('chat')}
        dbPath={dbPath}
        translation={translation}
        lang={locale}
        onClose={() => setActivePanel(null)}
      />

      {/* F3.7: comparação multi-IA (N provedores lado a lado) ancorada na passagem. Cada
          coluna faz UMA chamada independente à fronteira `ask_anchored` (F2.1/F2.3a) com
          seu provedor, sobre a MESMA `reference` (âncora). O `citedText` (verbatim do
          store) é IDÊNTICO em todas → exibido UMA vez, SEPARADO das N interpretações (LLM)
          — anti-alucinação visível. Provedores reais usam a chave do cofre (BYOK); a
          comparação de respostas reais (diferentes) é a F3.10. A referência vai como
          string canônica EN (`bookNameEn`), como no `ReaderAskPanel`. */}
      <ReaderComparePanel
        visible={panelVerse('compare') != null}
        sourceLabel={
          panelVerse('compare') != null
            ? `${bookLabel(bookNumber)} ${chapterNumber}:${panelVerse('compare')}`
            : ''
        }
        reference={
          panelVerse('compare') != null
            ? `${bookNameEn(bookNumber)} ${chapterNumber}:${panelVerse('compare')}`
            : ''
        }
        dbPath={dbPath}
        translation={translation}
        lang={locale}
        onClose={() => setActivePanel(null)}
      />

      {/* Rodada 2: INTERLINEAR (palavra-a-palavra na língua original) ancorado na passagem. Os
          tokens (superfície/translit/glosa/Strong) vêm VERBATIM do store via a fronteira
          `interlinearVerse` (dado embarcado; NT + Gênesis + Salmos) — nunca de IA (anti-alucinação),
          com a ATRIBUIÇÃO STEP CC-BY obrigatória. Livro sem cobertura → estado-vazio honesto. */}
      <ReaderInterlinearPanel
        visible={panelVerse('interlinear') != null}
        sourceLabel={
          panelVerse('interlinear') != null
            ? `${bookLabel(bookNumber)} ${chapterNumber}:${panelVerse('interlinear')}`
            : ''
        }
        book={bookNumber}
        chapter={chapterNumber}
        verse={panelVerse('interlinear')}
        dbPath={dbPath}
        onClose={() => setActivePanel(null)}
      />

      {/* ADR-0067: folha de AJUSTES DE LEITURA (tamanho/entrelinha/tema/família/just), aberta
          pelo botão "Aa" do header. Aplica no ReaderChapterView via `readingPrefs`. */}
      <ReadingSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={readingPrefs}
      />

      {/* Fase 2: BARRA-ESCOPO de multi-seleção — aparece no modo seleção ou com trechos no escopo.
          Persiste ao navegar entre capítulos/livros (store acima da rota). Tocar "Estudar seleção"
          abre a pré-visualização verbatim do escopo inteiro. */}
      {scope.selecting || scope.chunks.length > 0 ? (
        <ReaderScopeBar
          chunks={scope.chunks}
          bookLabelOf={bookLabel}
          chapterWhole={chapterScope.whole}
          onToggleChapter={() => studyScope.toggleWholeChapter(bookNumber, chapterNumber)}
          onRemove={(key) => studyScope.removeChunk(key)}
          onClear={() => studyScope.clear()}
          onDone={() => studyScope.setSelecting(false)}
          onStudy={() => setScopeSheetOpen(true)}
        />
      ) : null}
      <ScopeStudySheet
        visible={scopeSheetOpen}
        chunks={scope.chunks}
        translation={translation}
        lang={locale}
        bookLabelOf={bookLabel}
        onClose={() => setScopeSheetOpen(false)}
      />
    </View>
  );
}

function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Leitura imersiva: barra-OVERLAY absoluta no topo (desliza via translateY). Opaca + acima do
    // ScrollView (zIndex) p/ o texto não vazar por trás; hairline embaixo como o header nativo tinha.
    chrome: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      backgroundColor: colors.headerBackground,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    // Leitura imersiva: barra TOTALMENTE escondida sai do fluxo/foco/a11y (não só translada).
    chromeGone: { display: 'none' },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.sm,
    },
    navTitle: { ...type.title, color: colors.text, flex: 1, marginHorizontal: space.sm },
    navRight: { flexDirection: 'row', alignItems: 'center' },
    // Rodapé de navegação de capítulo (fim da leitura): Anterior à esquerda, Próximo à direita.
    chapterNavFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: space.xl,
      paddingTop: space.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    chapterNavBtn: { minHeight: 44, justifyContent: 'center', paddingVertical: space.sm, paddingHorizontal: space.md, flexShrink: 1 },
    chapterNavBtnEnd: { alignItems: 'flex-end' },
    chapterNavSpacer: { flex: 1 },
    chapterNavText: { ...type.body, color: colors.accent, fontWeight: '600' },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    toggle: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    toggleActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    toggleText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
    toggleTextActive: { color: colors.chipActiveText },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { fontSize: 14, color: colors.error, textAlign: 'center' },
  });
}
