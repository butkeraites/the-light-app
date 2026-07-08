// app/components/HomeVerseOfDay.tsx — Rodada 4 (engajamento): cartão do versículo do dia
//
// Mostra, na Home, o versículo do dia (referência DETERMINÍSTICA por data — `verseOfDayRef`) com o
// TEXTO VERBATIM do store (fronteira `getChapter` na tradução default do idioma) — anti-alucinação:
// a UI NUNCA gera/hardcoda texto bíblico. Toca → abre o versículo no leitor (ancorado). Offline: se
// o store não carregar, o cartão simplesmente NÃO aparece (a Home nunca quebra por causa disto).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { useI18n } from '../lib/i18n';
import { shareVerse } from '../lib/shareVerse';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { verseOfDayRef } from '../lib/verseOfDay';
import { IconButton } from './ui';

/** Rótulo curto da versão default por idioma (nome próprio da tradução; não é cromo traduzível). */
function translationLabelFor(locale: 'pt' | 'en'): string {
  return locale === 'pt' ? 'Almeida 1911' : 'KJV';
}

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
  // Confirmação transitória "copiado" (fallback web sem Web Share API). Limpa sozinha.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Limpa o timer da confirmação ao desmontar.
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  if (!loaded) return null;

  async function onShare() {
    if (!loaded) return;
    try {
      const res = await shareVerse(loaded.text, loaded.label, translationLabelFor(locale));
      if (res === 'copied') {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 2200);
      }
    } catch {
      /* compartilhar falhou/cancelou → silencioso (não é erro de app) */
    }
  }

  return (
    <View style={styles.card}>
      {/* Área tocável → abre o versículo no leitor. Separada do botão de compartilhar (sem
          aninhar touchables): no RN o responder mais interno vence, mas manter em Views distintas
          é mais previsível no web (RNW). */}
      <Pressable
        style={styles.tap}
        onPress={() =>
          router.push({
            pathname: '/read/[book]/[chapter]',
            params: { book: String(loaded.book), chapter: String(loaded.chapter), verse: String(loaded.verse) },
          })
        }
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
      <View style={styles.footer}>
        {/* Confirmação "copiado" (só aparece no fallback web sem Web Share API). */}
        <Text style={styles.copied} testID="verse-of-day-copied">
          {copied ? t('home.verseCopied') : ''}
        </Text>
        <IconButton
          name="share"
          onPress={onShare}
          testID="verse-of-day-share"
          accessibilityLabel={t('home.shareVerseA11y', { reference: loaded.label })}
        />
      </View>
    </View>
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
    tap: { gap: space.sm, minHeight: 44 },
    eyebrow: { ...type.label, color: colors.accent, letterSpacing: 1 },
    verseText: { ...type.verse, color: colors.verseText },
    reference: { ...type.caption, color: colors.muted },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs },
    copied: { ...type.caption, color: colors.accent, flexShrink: 1 },
  });
}
