// app/components/ReadingSettingsSheet.tsx — ADR-0067 (ajustes de leitura)
//
// Folha "Leitura" (sobre o <BottomSheet> do kit): tamanho do texto, entrelinha, TEMA DE LEITURA
// (claro/sépia/escuro — liga a paleta SÉPIA/READING_PALETTES antes ociosa), família (serifa/sem
// serifa) e justificação. Persiste via `useReadingPrefs`; aplica no leitor. Só apresentação +
// os setters do hook; nenhum texto bíblico é tocado (anti-alucinação n/a — é cromo de ajuste).
import { useMemo } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { fontScaleForStep, LINE_SPACINGS, READING_FONTS, READING_THEMES } from '../lib/readingPrefs';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import type { ReadingPrefs } from '../lib/useReadingPrefs';
import { BottomSheet, Chip, IconButton, SectionLabel } from './ui';

export function ReadingSettingsSheet({
  visible,
  onClose,
  prefs,
}: {
  visible: boolean;
  onClose: () => void;
  prefs: ReadingPrefs;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { colors, isDark, type } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Tema efetivo destacado nos chips: a escolha explícita, senão o modo atual do app.
  const effectiveTheme = prefs.readingTheme ?? (isDark ? 'dark' : 'light');
  const previewSize = Math.round(type.verse.fontSize * fontScaleForStep(prefs.fontStep));

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('reading.title')} testIDPrefix="reading-settings">
      {/* ── TAMANHO ─────────────────────────────────────────────── */}
      <SectionLabel>{t('reading.size')}</SectionLabel>
      <View style={styles.sizeRow}>
        <IconButton
          name="minus"
          onPress={() => prefs.setFontStep(prefs.fontStep - 1)}
          accessibilityLabel={t('reading.smaller')}
          testID="reading-size-minus"
        />
        <View style={styles.sizePreview}>
          <Text style={{ ...type.verse, fontSize: previewSize, lineHeight: Math.round(previewSize * 1.3), color: colors.text }}>Aa</Text>
        </View>
        <IconButton
          name="plus"
          onPress={() => prefs.setFontStep(prefs.fontStep + 1)}
          accessibilityLabel={t('reading.larger')}
          testID="reading-size-plus"
        />
      </View>

      {/* ── ENTRELINHA ──────────────────────────────────────────── */}
      <SectionLabel>{t('reading.spacing')}</SectionLabel>
      <View style={styles.seg}>
        {LINE_SPACINGS.map((s) => (
          <Chip
            key={s}
            label={t(`reading.spacing.${s}`)}
            active={prefs.lineSpacing === s}
            onPress={() => prefs.setLineSpacing(s)}
            testID={`reading-spacing-${s}`}
          />
        ))}
      </View>

      {/* ── TEMA DE LEITURA ─────────────────────────────────────── */}
      <SectionLabel>{t('reading.theme')}</SectionLabel>
      <View style={styles.seg}>
        {READING_THEMES.map((th) => (
          <Chip
            key={th}
            label={t(`reading.theme.${th}`)}
            active={effectiveTheme === th}
            onPress={() => prefs.setReadingTheme(th)}
            testID={`reading-theme-${th}`}
          />
        ))}
      </View>

      {/* ── FONTE ───────────────────────────────────────────────── */}
      <SectionLabel>{t('reading.font')}</SectionLabel>
      <View style={styles.seg}>
        {READING_FONTS.map((f) => (
          <Chip
            key={f}
            label={t(`reading.font.${f}`)}
            active={prefs.readingFont === f}
            onPress={() => prefs.setReadingFont(f)}
            testID={`reading-font-${f}`}
          />
        ))}
      </View>

      {/* ── JUSTIFICAR ──────────────────────────────────────────── */}
      <View style={styles.justifyRow}>
        <Text style={styles.justifyLabel}>{t('reading.justify')}</Text>
        <Switch
          value={prefs.justify}
          onValueChange={prefs.setJustify}
          testID="reading-justify"
          accessibilityLabel={t('reading.justify')}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.surface}
        />
      </View>
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    sizeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
    sizePreview: {
      flex: 1,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceElevated,
    },
    seg: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
    justifyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: space.lg,
      minHeight: 44,
    },
    justifyLabel: { ...type.body, color: colors.text },
  });
}
