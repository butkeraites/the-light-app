// app/components/DevotionalNudge.tsx — Rodada 5 (engajamento): card do NUDGE devocional (in-app)
//
// Card GENTIL, não-bloqueante (pinado embaixo), que convida a ORAR e LER e mostra o VERSÍCULO DO DIA.
// Aparece quando o controlador (`useDevotionalNudgeController` no `_layout`) decide — no web ao ABRIR/
// voltar ao app (o único mecanismo honesto sem servidor; ADR-0042), no nativo idem (mesmo card, NÃO é
// notificação de sistema). Some ao dispensar/atuar. Opt-in via Ajustes (OFF por padrão).
//
// ANTI-ALUCINAÇÃO: a saudação/convite são CROMO i18n; o TEXTO do versículo vem VERBATIM do store
// (`getChapter`, molde de `HomeVerseOfDay`) — nunca gerado. Se o store não carregou, mostra só o
// convite + a referência (nunca inventa). Offline-first: nenhuma rede/conta.
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { hideNudge, useDevotionalNudge } from '../lib/devotionalNudge';
import { recordNudgeEngaged } from '../lib/devotionalNudgeState';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { readingChapterHref } from '../lib/readingNav';
import { defaultTranslationFor } from '../lib/translationDefault';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { verseOfDayRef, type VerseRef } from '../lib/verseOfDay';
import { Button, Surface } from './ui';

type LoadedVerse = { label: string; text: string; translationId: string };

/**
 * Busca o texto do versículo do dia VERBATIM do store (molde de `HomeVerseOfDay`). SÓ busca quando
 * `active` (o card está visível) — o card mora no `_layout` (global), então buscar sempre dispararia
 * a carga do banco de leitura (~64 MB) em toda abertura, mesmo com o lembrete desligado. LAZY.
 */
function useVerseOfDay(
  locale: 'pt' | 'en',
  t: TranslateFn,
  active: boolean,
): { ref: VerseRef; loaded: LoadedVerse | null } {
  const ref = useMemo(() => verseOfDayRef(new Date()), []);
  const [loaded, setLoaded] = useState<LoadedVerse | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    let alive = true;
    const tid = defaultTranslationFor(locale);
    void (async () => {
      try {
        const [{ ensureReadingDb }, { getChapter, listBooks }] = await Promise.all([
          import('../lib/db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const passage = await getChapter(dbPath, tid, ref.book, ref.chapter);
        const hit = passage.verses.find(
          (v) => v.reference.verses.tag === 'Single' && v.reference.verses.inner.verse === ref.verse,
        );
        if (!hit) {
          return; // fora de faixa numa tradução → só a referência (sem inventar)
        }
        const bk = listBooks().find((x) => x.number === ref.book);
        const name = bk
          ? locale === 'en'
            ? bk.nameEn
            : bk.namePt
          : t('read.bookFallback', { number: ref.book });
        if (alive) {
          setLoaded({ label: `${name} ${ref.chapter}:${ref.verse}`, text: hit.text, translationId: tid });
        }
      } catch {
        /* store indisponível → card mostra só o convite (offline-first) */
      }
    })();
    return () => {
      alive = false;
    };
  }, [locale, ref, t, active]);

  return { ref, loaded };
}

export function DevotionalNudge() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { visible, kind } = useDevotionalNudge();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { ref, loaded } = useVerseOfDay(locale, t, visible);

  if (!visible) {
    return null;
  }

  const greeting = kind === 'idleReturn' ? t('reminders.idleGreeting') : t('reminders.morningGreeting');
  const version = loaded?.translationId ?? defaultTranslationFor(locale);

  function onOpen() {
    void recordNudgeEngaged();
    hideNudge();
    router.push(
      readingChapterHref({ book: ref.book, chapter: ref.chapter, verse: ref.verse, version }),
    );
  }
  function onPray() {
    void recordNudgeEngaged();
    hideNudge();
  }
  function onLater() {
    hideNudge();
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Surface elevated padded style={styles.card}>
        <Text style={styles.greeting} testID="devotional-nudge-greeting">
          {greeting}
        </Text>
        <Text style={styles.invite}>{t('reminders.invite')}</Text>
        {loaded ? (
          <View style={styles.verse}>
            {/* Texto bíblico VERBATIM do store — serifa de leitura, régua dourada à esquerda. */}
            <Text style={styles.verseText} testID="devotional-nudge-text">
              {loaded.text}
            </Text>
            <Text style={styles.reference}>{loaded.label}</Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            title={t('reminders.open')}
            onPress={onOpen}
            testID="devotional-nudge-open"
            accessibilityLabel={t('reminders.open')}
          />
          <Button
            title={t('reminders.pray')}
            variant="secondary"
            onPress={onPray}
            testID="devotional-nudge-pray"
            accessibilityLabel={t('reminders.pray')}
          />
          <Button
            title={t('reminders.later')}
            variant="ghost"
            onPress={onLater}
            testID="devotional-nudge-later"
            accessibilityLabel={t('reminders.later')}
          />
        </View>
      </Surface>
    </View>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: space.md,
    },
    card: {
      gap: space.sm,
      // Régua dourada à esquerda — âncora de leitura (Vigil), como o cartão do versículo do dia.
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
    },
    greeting: { ...type.heading, color: colors.text },
    invite: { ...type.body, color: colors.muted },
    verse: { gap: space.xs, marginTop: space.xs },
    verseText: { ...type.verse, color: colors.verseText },
    reference: { ...type.caption, color: colors.accent },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  });
}
