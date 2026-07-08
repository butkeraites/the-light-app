// app/components/HomeStreak.tsx — Rodada 4 (engajamento): chip da sequência de leitura (streak)
//
// Mostra na Home o hábito diário: abrir o app REGISTRA a atividade de hoje (`recordActivity`) e o
// chip exibe a sequência atual. 100% LOCAL/offline (KV app-side, sem rede/conta/core). Some quando
// ainda não há sequência (current 0). Falha graciosa: erro de storage → chip não aparece (Home ok).
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { recordActivity } from '../lib/readingStreak';
import { useTheme, type ThemeContextValue } from '../lib/theme';

export function HomeStreak() {
  const theme = useTheme();
  const { t } = useI18n();
  const styles = makeStyles(theme);
  const [current, setCurrent] = useState(0);

  // Abrir o app conta como leitura do dia → registra e reflete a sequência. Uma vez no mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await recordActivity();
        if (alive) setCurrent(next.current);
      } catch {
        /* storage indisponível → chip some; a Home segue normal (offline-first) */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (current < 1) return null;

  const label = current === 1 ? t('home.streakDay', { count: current }) : t('home.streakDays', { count: current });
  return (
    <View style={styles.chip} testID="reading-streak" accessibilityRole="text" accessibilityLabel={label}>
      <Text style={styles.flame}>{'\u{1F525}'}</Text>
      <Text style={styles.text} testID="reading-streak-count">
        {label}
      </Text>
    </View>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: space.xs,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.pill,
      backgroundColor: colors.selectionBg,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    flame: { fontSize: 14 },
    text: { ...type.label, color: colors.accent },
  });
}
