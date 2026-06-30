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
        onChanged={() => void refreshUserData()}
        onClose={() => setSelectedVerse(null)}
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
