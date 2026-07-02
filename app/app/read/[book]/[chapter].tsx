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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ReaderChapterView } from '../../../components/ReaderChapterView';
import { ReaderParallelView } from '../../../components/ReaderParallelView';
import { ReaderVersionPicker } from '../../../components/ReaderVersionPicker';
import { ReaderVersePanel } from '../../../components/ReaderVersePanel';
import { ReaderAskPanel } from '../../../components/ReaderAskPanel';
import { ReaderStudyPanel } from '../../../components/ReaderStudyPanel';
import { ReaderChatPanel } from '../../../components/ReaderChatPanel';
import { ReaderComparePanel } from '../../../components/ReaderComparePanel';
import { ensureReadingDb } from '../../../lib/db';
import { ensureUserDataDir } from '../../../lib/userdata';
import { resolveHighlightColor } from '../../../lib/highlightColors';
import { useTheme, type ThemeColors } from '../../../lib/theme';
import {
  crossRefs,
  getChapter,
  listBooks,
  listHighlights,
  listNotes,
  listTranslations,
  type CrossRef,
  type Passage,
  type Translation,
} from '../../../web/reading';

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
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { book, chapter } = useLocalSearchParams<{ book: string; chapter: string }>();
  const bookNumber = Number(book);
  const chapterNumber = Number(chapter);

  const [translation, setTranslation] = useState(DEFAULT_TRANSLATION);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // F1.4: modo lado a lado + 2ª tradução (sempre diferente da primária).
  const [parallel, setParallel] = useState(false);
  const [secondTranslation, setSecondTranslation] = useState<string | null>(null);
  const [secondaryPassage, setSecondaryPassage] = useState<Passage | null>(null);

  // F2.5: caminho do banco só-leitura (resolvido uma vez) p/ o estudo assistido (IA)
  // ancorado — o `ReaderAskPanel` recebe o `dbPath` p/ ler o `cited_text` do store.
  const [dbPath, setDbPath] = useState<string | null>(null);
  // F2.5: versículo alvo do painel de "Perguntar" (IA). Separado de `selectedVerse`
  // para que a referência não se perca ao fechar o painel por-versículo.
  const [askVerse, setAskVerse] = useState<number | null>(null);
  // F3.5: versículo alvo do painel de "Estudo" (IA profundo). Separado de `selectedVerse`
  // pelo mesmo motivo — a referência não se perde ao fechar o painel por-versículo.
  const [studyVerse, setStudyVerse] = useState<number | null>(null);
  // F3.6: versículo alvo do painel de "Conversa" (IA multi-turno). Separado de
  // `selectedVerse` pelo mesmo motivo — a âncora não se perde ao fechar o painel.
  const [chatVerse, setChatVerse] = useState<number | null>(null);
  // F3.7: versículo alvo do painel de "Comparar" (IA — N provedores lado a lado).
  // Separado de `selectedVerse` pelo mesmo motivo — a âncora não se perde ao fechar.
  const [compareVerse, setCompareVerse] = useState<number | null>(null);

  // F1.9: versículo selecionado + painel de referências cruzadas (xref). Os dados
  // vêm SEMPRE da fronteira `cross_refs` (F1.8) — sem SQL/ordenação/filtro em TS.
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);
  const [xrefs, setXrefs] = useState<CrossRef[]>([]);
  const [xrefLoading, setXrefLoading] = useState(false);
  const [xrefError, setXrefError] = useState<string | null>(null);

  // F1.11: userdata gravável (notas/highlights) — diretório SEPARADO do banco
  // só-leitura. Os indicadores por versículo vêm SEMPRE de `list_notes`/
  // `list_highlights` (fronteira F1.10) — sem I/O/serialização/ordenação em TS.
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [notedVerses, setNotedVerses] = useState<Set<number>>(new Set());
  // versículo → NOME da cor (dado do usuário); resolvido p/ hex no render.
  const [highlightColors, setHighlightColors] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const name = listBooks().find((b) => b.number === bookNumber)?.namePt ?? `Livro ${bookNumber}`;
    navigation.setOptions({ title: `${name} ${chapterNumber}` });
  }, [navigation, bookNumber, chapterNumber]);

  // Carrega as traduções disponíveis (seletor de versão) uma vez.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const ts = await listTranslations(dbPath);
        if (alive) setTranslations(ts);
      } catch {
        // Sem traduções → o seletor some; a leitura ainda tenta a default.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Mantém a 2ª tradução válida e SEMPRE diferente da primária.
  useEffect(() => {
    if (translations.length === 0) {
      return;
    }
    setSecondTranslation((prev) => {
      if (prev && prev !== translation && translations.some((t) => t.id === prev)) {
        return prev;
      }
      return translations.find((t) => t.id !== translation)?.id ?? null;
    });
  }, [translations, translation]);

  // Carrega o texto do capítulo na tradução PRIMÁRIA (recarrega ao trocar versão).
  useEffect(() => {
    let alive = true;
    setPassage(null);
    setError(null);
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const p = await getChapter(dbPath, translation, bookNumber, chapterNumber);
        if (alive) setPassage(p);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [translation, bookNumber, chapterNumber]);

  // F1.4: no modo paralelo, carrega o MESMO capítulo na 2ª tradução (2ª chamada
  // de get_chapter). O alinhamento por número de versículo é feito na view.
  useEffect(() => {
    if (!parallel || !secondTranslation) {
      setSecondaryPassage(null);
      return;
    }
    let alive = true;
    setSecondaryPassage(null);
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const p = await getChapter(dbPath, secondTranslation, bookNumber, chapterNumber);
        if (alive) setSecondaryPassage(p);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [parallel, secondTranslation, bookNumber, chapterNumber]);

  // F1.9: ao selecionar um versículo, carrega suas xrefs pela fronteira `cross_refs`
  // (defaults do core p/ min_votes/limit). A UI só APRESENTA o `Vec<CrossRef>`
  // retornado (já ordenado por votos DESC pelo core) — anti-alucinação: xref é só
  // referência, sem texto bíblico.
  useEffect(() => {
    if (selectedVerse == null) {
      return;
    }
    let alive = true;
    setXrefLoading(true);
    setXrefError(null);
    setXrefs([]);
    (async () => {
      try {
        const dbPath = await ensureReadingDb();
        const refs = await crossRefs(dbPath, bookNumber, chapterNumber, selectedVerse);
        if (alive) {
          setXrefs(refs);
          setXrefLoading(false);
        }
      } catch (err) {
        if (alive) {
          setXrefError(err instanceof Error ? err.message : String(err));
          setXrefLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedVerse, bookNumber, chapterNumber]);

  // F2.5: resolve o caminho do banco só-leitura uma vez (p/ o estudo assistido de IA
  // ancorar o `cited_text` no store). A leitura já resolve o mesmo caminho nos seus
  // efeitos; aqui guardamos p/ passar ao `ReaderAskPanel`.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const path = await ensureReadingDb();
        if (alive) setDbPath(path);
      } catch {
        // Sem banco → o estudo assistido fica indisponível; a leitura não regride.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // F1.11: resolve o diretório de userdata gravável uma vez (separado do banco
  // só-leitura). Sem ele, a leitura segue normal e as notas/highlights ficam off.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dir = await ensureUserDataDir();
        if (alive) setDataDir(dir);
      } catch {
        // userdata indisponível neste alvo → indicadores/edição ficam inativos.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // F1.11: deriva os indicadores do capítulo atual a partir de `list_notes`/
  // `list_highlights` (fronteira). NÃO ordena/parseia nada — só FILTRA os Records
  // do livro/capítulo correntes e mapeia versículo→cor/nota p/ apresentação.
  const refreshUserData = useCallback(async () => {
    if (!dataDir) {
      return;
    }
    try {
      const [notes, highlights] = await Promise.all([listNotes(dataDir), listHighlights(dataDir)]);
      const noted = new Set<number>();
      for (const note of notes) {
        const r = note.reference;
        if (r.book === bookNumber && r.chapter === chapterNumber && r.verses.tag === 'Single') {
          noted.add(r.verses.inner.verse);
        }
      }
      const colorsByVerse = new Map<number, string>();
      for (const h of highlights) {
        const r = h.reference;
        if (r.book === bookNumber && r.chapter === chapterNumber && r.verses.tag === 'Single') {
          colorsByVerse.set(r.verses.inner.verse, h.color);
        }
      }
      setNotedVerses(noted);
      setHighlightColors(colorsByVerse);
    } catch {
      // best-effort: sem indicadores se a fronteira falhar; a leitura não regride.
    }
  }, [dataDir, bookNumber, chapterNumber]);

  useEffect(() => {
    void refreshUserData();
  }, [refreshUserData]);

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
  const secondaryOptions = translations.filter((t) => t.id !== translation);
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

      {canParallel ? (
        <View style={styles.controls}>
          <Pressable
            style={[styles.toggle, parallel ? styles.toggleActive : null]}
            onPress={() => setParallel((v) => !v)}
            testID="parallel-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: parallel }}
          >
            <Text style={[styles.toggleText, parallel ? styles.toggleTextActive : null]}>
              Lado a lado
            </Text>
          </Pressable>
        </View>
      ) : null}

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
          onVersePress={setSelectedVerse}
          selectedVerse={selectedVerse}
          highlightedVerses={highlightedVerses}
          notedVerses={notedVerses}
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
          // por-versículo preservando a referência no `askVerse`.
          setAskVerse(selectedVerse);
          setSelectedVerse(null);
        }}
        onStudy={() => {
          // F3.5: abre o estudo profundo ancorado na MESMA passagem; fecha o painel
          // por-versículo preservando a referência no `studyVerse`.
          setStudyVerse(selectedVerse);
          setSelectedVerse(null);
        }}
        onChat={() => {
          // F3.6: abre a conversa/follow-up ancorada na MESMA passagem; fecha o painel
          // por-versículo preservando a âncora no `chatVerse`.
          setChatVerse(selectedVerse);
          setSelectedVerse(null);
        }}
        onCompare={() => {
          // F3.7: abre a comparação multi-IA (N provedores) ancorada na MESMA passagem;
          // fecha o painel por-versículo preservando a âncora no `compareVerse`.
          setCompareVerse(selectedVerse);
          setSelectedVerse(null);
        }}
        onChanged={() => void refreshUserData()}
        onClose={() => setSelectedVerse(null)}
      />

      {/* F2.5: estudo assistido (IA) ancorado na passagem. O texto CITADO (verbatim
          do store) vem do retorno da fronteira `ask_anchored_stream` (F2.1/F2.3a) e é
          exibido SEPARADO da interpretação (LLM) — anti-alucinação visível. A chave
          BYOK é lida sob demanda pelo painel (mock não usa chave). */}
      <ReaderAskPanel
        visible={askVerse != null}
        sourceLabel={
          askVerse != null ? `${bookNamePt(bookNumber)} ${chapterNumber}:${askVerse}` : ''
        }
        reference={
          askVerse != null ? `${bookNameEn(bookNumber)} ${chapterNumber}:${askVerse}` : ''
        }
        dbPath={dbPath}
        translation={translation}
        lang="pt"
        onClose={() => setAskVerse(null)}
      />

      {/* F3.5: estudo profundo (IA) ancorado na passagem — modo × lente × profundidade.
          A `passageText` (verbatim do store) e o LÉXICO Strong vêm do retorno das
          fronteiras `deep_study`/`lexical_entries` (F3.3/F3.2) e são exibidos SEPARADOS da
          interpretação (LLM) — anti-alucinação visível — com a ATRIBUIÇÃO STEP CC-BY
          obrigatória. Provedor "mock" nesta entrega (offline, sem chave/rede; BYOK = F3.10).
          A passagem vai NUMÉRICA (book/chapter/verse) — não string canônica. */}
      <ReaderStudyPanel
        visible={studyVerse != null}
        sourceLabel={
          studyVerse != null ? `${bookNamePt(bookNumber)} ${chapterNumber}:${studyVerse}` : ''
        }
        book={bookNumber}
        chapter={chapterNumber}
        verse={studyVerse}
        dbPath={dbPath}
        translation={translation}
        lang="pt"
        onClose={() => setStudyVerse(null)}
      />

      {/* F3.6: conversa/follow-up (IA) multi-turno ancorada na passagem. Cada follow-up
          chama a fronteira `ask_session_anchored` (F3.4) com o MESMO book/chapter/verse
          (âncora preservada); o `citedText` (verbatim do store) é exibido SEPARADO de cada
          interpretação (LLM) — anti-alucinação visível. Provedor "mock" nesta entrega
          (offline, sem chave/rede; BYOK = F3.10). A passagem vai NUMÉRICA. */}
      <ReaderChatPanel
        visible={chatVerse != null}
        sourceLabel={
          chatVerse != null ? `${bookNamePt(bookNumber)} ${chapterNumber}:${chatVerse}` : ''
        }
        book={bookNumber}
        chapter={chapterNumber}
        verse={chatVerse}
        dbPath={dbPath}
        translation={translation}
        lang="pt"
        onClose={() => setChatVerse(null)}
      />

      {/* F3.7: comparação multi-IA (N provedores lado a lado) ancorada na passagem. Cada
          coluna faz UMA chamada independente à fronteira `ask_anchored` (F2.1/F2.3a) com
          seu provedor, sobre a MESMA `reference` (âncora). O `citedText` (verbatim do
          store) é IDÊNTICO em todas → exibido UMA vez, SEPARADO das N interpretações (LLM)
          — anti-alucinação visível. Provedores reais usam a chave do cofre (BYOK); a
          comparação de respostas reais (diferentes) é a F3.10. A referência vai como
          string canônica EN (`bookNameEn`), como no `ReaderAskPanel`. */}
      <ReaderComparePanel
        visible={compareVerse != null}
        sourceLabel={
          compareVerse != null ? `${bookNamePt(bookNumber)} ${chapterNumber}:${compareVerse}` : ''
        }
        reference={
          compareVerse != null
            ? `${bookNameEn(bookNumber)} ${chapterNumber}:${compareVerse}`
            : ''
        }
        dbPath={dbPath}
        translation={translation}
        lang="pt"
        onClose={() => setCompareVerse(null)}
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
