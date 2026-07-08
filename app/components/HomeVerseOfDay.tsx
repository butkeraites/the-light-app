// app/components/HomeVerseOfDay.tsx — Rodada 4 (engajamento): cartão do versículo do dia
//
// Mostra, na Home, o versículo do dia (referência DETERMINÍSTICA por data — `verseOfDayRef`) com o
// TEXTO VERBATIM do store (fronteira `getChapter` na tradução default do idioma) — anti-alucinação:
// a UI NUNCA gera/hardcoda texto bíblico. Toca → abre o versículo no leitor (ancorado). Offline: se
// o store não carregar, o cartão simplesmente NÃO aparece (a Home nunca quebra por causa disto).
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { verseOfDayRef } from '../lib/verseOfDay';

/** Tradução default do lookup por idioma (mesma regra da Home) — o texto casa o idioma da UI. */
function defaultTranslationFor(locale: 'pt' | 'en'): string {
  return locale === 'pt' ? 'alm1911' : 'kjv';
}

type Loaded = { label: string; text: string; book: number; chapter: number; verse: number };

export function HomeVerseOfDay() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // A referência do dia é determinística (data → referência). Calculada UMA vez no mount.
  const ref = useMemo(() => verseOfDayRef(new Date()), []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ ensureReadingDb }, { getChapter, listBooks }] = await Promise.all([
          import('../lib/db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const passage = await getChapter(dbPath, defaultTranslationFor(locale), ref.book, ref.chapter);
        // Texto VERBATIM do store: acha o versículo-alvo no capítulo (Single). Nada gerado aqui.
        const hit = passage.verses.find(
          (v) => v.reference.verses.tag === 'Single' && v.reference.verses.inner.verse === ref.verse,
        );
        if (!hit) return; // fora de faixa numa tradução → cartão some (sem inventar)
        const books = listBooks();
        const bk = books.find((x) => x.number === ref.book);
        const name = bk ? (locale === 'en' ? bk.nameEn : bk.namePt) : t('read.bookFallback', { number: ref.book });
        if (alive) setLoaded({ label: `${name} ${ref.chapter}:${ref.verse}`, text: hit.text, ...ref });
      } catch {
        /* store indisponível → cartão não aparece; a Home segue normal (offline-first) */
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale, ref]);

  if (!loaded) return null;

  return (
    <Pressable
      style={styles.card}
      onPress={() => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(loaded.book), chapter: String(loaded.chapter), verse: String(loaded.verse) } })}
      testID="verse-of-day"
      accessibilityRole="link"
      accessibilityLabel={t('home.verseOfDayA11y', { reference: loaded.label })}
    >
      <Text style={styles.eyebrow}>{t('home.verseOfDay')}</Text>
      {/* Texto bíblico VERBATIM do store — serifa de leitura, distinto do cromo. */}
      <Text style={styles.verseText} testID="verse-of-day-text">
        {loaded.text}
      </Text>
      <Text style={styles.reference}>{loaded.label}</Text>
    </Pressable>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.sm,
      // Régua dourada à esquerda — âncora de leitura (Vigil).
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
    },
    eyebrow: { ...type.label, color: colors.accent, letterSpacing: 1 },
    verseText: { ...type.verse, color: colors.verseText },
    reference: { ...type.caption, color: colors.muted },
  });
}
