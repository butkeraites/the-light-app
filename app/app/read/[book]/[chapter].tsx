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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReaderChapterView } from '../../../components/ReaderChapterView';
import { ReaderParallelView } from '../../../components/ReaderParallelView';
import { WasmGate } from '../../../components/WasmGate';
import { ReaderVersionPicker } from '../../../components/ReaderVersionPicker';
import { ReaderVersePanel } from '../../../components/ReaderVersePanel';
import { ReaderAskPanel } from '../../../components/ReaderAskPanel';
import { ReaderStudyPanel } from '../../../components/ReaderStudyPanel';
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
import { useReadingPrefs } from '../../../lib/useReadingPrefs';
import { studyScope, useStudyScope } from '../../../lib/useStudyScope';
import { versesForChapter } from '../../../lib/studyScope';
import { useTheme, type ThemeColors } from '../../../lib/theme';
import { listBooks, type CrossRef } from '../../../web/reading';

const DEFAULT_TRANSLATION = 'kjv';

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
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  // F5.5: `locale` da UI. Distinto de `translation` (versão bíblica): o `locale` traduz
  // o CROMO e escolhe o campo de nome do livro no STORE; ele NÃO altera o texto citado.
  // É também o `lang` repassado aos painéis de IA (a resposta segue o idioma da UI).
  const { locale, t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // ADR-0067: preferências de leitura (tamanho/entrelinha/tema/família/just) + folha de ajustes.
  const readingPrefs = useReadingPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Fase 2: Escopo de Estudo (multi-seleção). O estado vive num store acima da rota (persiste ao
  // navegar entre capítulos/livros). `scopeSheetOpen` abre a pré-visualização verbatim do escopo.
  const scope = useStudyScope();
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);
  const { book, chapter, verse } = useLocalSearchParams<{
    book: string;
    chapter: string;
    verse?: string;
  }>();
  const bookNumber = Number(book);
  const chapterNumber = Number(chapter);
  // F5.32: versículo-ÂNCORA opcional vindo de busca/xref (`?verse=N`). A tela lia só
  // book/chapter e descartava `verse` — então o alvo aterrissava no TOPO. Agora é
  // repassado ao `ReaderChapterView`, que rola até ele e o destaca. `expo-router` pode
  // devolver string | string[]; normaliza-se ao 1º e valida-se finitude (fora disso → null,
  // comportamento idêntico ao de hoje: sem âncora).
  const verseParamRaw = Array.isArray(verse) ? verse[0] : verse;
  const verseParam = verseParamRaw != null ? Number(verseParamRaw) : NaN;
  const anchorVerse = Number.isFinite(verseParam) && verseParam > 0 ? verseParam : null;

  // Estado de CONTROLE da tela (o fetching de fronteira vive no hook useChapterReader).
  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  // F1.4: modo lado a lado (a 2ª tradução é reconciliada pelo hook).
  const [parallel, setParallel] = useState(false);
  // F1.9: versículo selecionado (dirige o carregamento de xref no hook).
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);

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
  type PanelKind = 'ask' | 'study' | 'chat' | 'compare';
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

  // Fase 7 (follow-up): o nome do livro EXIBIDO segue o IDIOMA DA VERSÃO lida, não o `locale` da
  // UI — lendo Almeida (pt) o header/painéis mostram "João" mesmo com a UI em inglês (e KJV → "John"
  // mesmo com a UI em português). Cai no `locale` se a versão não declarar idioma conhecido. A
  // `reference` CANÔNICA passada às fronteiras segue EN (`bookNameEn`, a âncora) — anti-alucinação.
  const nameLang: 'pt' | 'en' = useMemo(() => {
    const lang = translations.find((tr) => tr.id === translation)?.language;
    return lang === 'en' || lang === 'pt' ? lang : locale === 'en' ? 'en' : 'pt';
  }, [translations, translation, locale]);

  // Nome do livro no IDIOMA DA VERSÃO, para o `sourceLabel` (cabeçalho) dos painéis de IA. O nome
  // vem SEMPRE do STORE (`namePt`/`nameEn`) — `nameLang` só ESCOLHE o campo, NUNCA traduz via `t()`.
  const bookLabel = useCallback(
    (bookNum: number): string => {
      const b = listBooks().find((x) => x.number === bookNum);
      return b ? (nameLang === 'en' ? b.nameEn : b.namePt) : t('read.bookFallback', { number: bookNum });
    },
    [nameLang, t],
  );

  // Título = "<nome do livro> <capítulo>". O nome vem SEMPRE do STORE/core (namePt/nameEn) — nunca
  // de `t()` (anti-alucinação): `nameLang` (idioma da VERSÃO) só ESCOLHE o campo. Reativo à versão.
  useEffect(() => {
    const b = listBooks().find((x) => x.number === bookNumber);
    const name = b
      ? nameLang === 'en'
        ? b.nameEn
        : b.namePt
      : t('read.bookFallback', { number: bookNumber });
    // ADR-0067: o header do leitor ganha o botão "Aa" (ajustes de leitura), ao lado do idioma
    // e do tema. Substitui o headerRight global (idioma+tema) SÓ nesta tela.
    navigation.setOptions({
      title: `${name} ${chapterNumber}`,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            label="Aa"
            onPress={() => setSettingsOpen(true)}
            accessibilityLabel={t('a11y.readingSettings')}
            testID="reading-settings-open"
          />
          <LanguageToggleButton />
          <ThemeModeSelector />
        </View>
      ),
    });
  }, [navigation, bookNumber, chapterNumber, nameLang, t]);

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
    router.push({
      pathname: '/read/[book]/[chapter]',
      params: {
        book: String(ref.book),
        chapter: String(ref.chapter),
        ...(verse != null ? { verse: String(verse) } : {}),
      },
    });
  }

  // 2ª tradução só oferece versões DIFERENTES da primária.
  const secondaryOptions = translations.filter((tr) => tr.id !== translation);
  const canParallel = secondaryOptions.length > 0;

  return (
    <View style={styles.container}>
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
          <ReaderParallelView primary={passage} secondary={secondaryPassage} />
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
        onClose={() => setScopeSheetOpen(false)}
      />
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
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
