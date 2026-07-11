// app/components/ReadingDbBanner.tsx — aviso GLOBAL do 1º carregamento do banco de leitura.
//
// No WEB a Bíblia completa (~64 MB) é baixada UMA vez por sessão para uso offline (ver
// `sqlite-reading-opfs.web.ts`); no celular esse download inicial demora, então mostramos
// uma barra NÃO-BLOQUEANTE (pinada embaixo) com a mensagem + progresso enquanto
// `phase === 'loading'` — some sozinha ao ficar `ready`. Vive no `_layout` (raiz), então
// aparece em QUALQUER tela onde a carga comece (a Home/versículo-do-dia costuma disparar
// primeiro). No NATIVO o hook devolve sempre `idle` (Bíblia embutida no app) → não renderiza.
//
// CROMO puro: nenhum texto bíblico passa por aqui — só o progresso de I/O de um asset local.
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useReadingDbLoad } from '../lib/readingDbLoad';
import { useTheme, type ThemeColors } from '../lib/theme';

export function ReadingDbBanner() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const load = useReadingDbLoad();

  if (load.phase !== 'loading') {
    return null;
  }

  // `%` só quando o tamanho é conhecido (Content-Length presente e coerente); senão a barra
  // fica indeterminada (só a mensagem + o spinner).
  const pct =
    load.total > 0
      ? Math.min(100, Math.round((load.loaded / load.total) * 100))
      : null;
  const styles = makeStyles(colors);

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityRole="alert">
      <View style={styles.card}>
        <ActivityIndicator color={colors.accent} />
        <View style={styles.textCol}>
          <Text style={styles.title} numberOfLines={1}>
            {t('reading.preparingOffline')}
            {pct != null ? `  ${pct}%` : ''}
          </Text>
          <Text style={styles.hint} numberOfLines={2}>
            {t('reading.preparingOfflineHint')}
          </Text>
        </View>
      </View>
      {pct != null ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
      backgroundColor: colors.surfaceElevated,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    textCol: { flex: 1 },
    title: { color: colors.text, fontSize: 15, fontWeight: '600' },
    hint: { color: colors.chipText, fontSize: 12, marginTop: 2 },
    track: { height: 3, backgroundColor: colors.border },
    fill: { height: 3, backgroundColor: colors.accent },
  });
}
