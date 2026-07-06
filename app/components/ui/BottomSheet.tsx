// app/components/ui/BottomSheet.tsx — ADR-0066 (component kit "Vigil")
//
// FOLHA inferior compartilhada — consolida os 6 `<Modal>`+backdrop+sheet copiados nos painéis de
// leitura (Verse/Ask/Study/Chat/Compare/Xref). Traz: grabber, cabeçalho (título + fechar), corpo
// rolável, e a a11y de modal EMBUTIDA (`accessibilityViewIsModal` na folha + `useReaderModalA11y`
// no título + `accessibilityRole="header"`). A guarda `reader-modal-a11y` reconhece `<BottomSheet>`
// como o wrapper de modal e verifica ESTE arquivo. Cores/tipografia via tokens Vigil.
import { useMemo, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../lib/i18n';
import { useReaderModalA11y } from '../../lib/useReaderModalA11y';
import { useTheme, type ThemeContextValue } from '../../lib/theme';

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  testIDPrefix,
  scroll = true,
  maxHeightPercent = 85,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  testIDPrefix?: string;
  scroll?: boolean;
  maxHeightPercent?: number;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme, maxHeightPercent), [theme, maxHeightPercent]);
  // Ao abrir, foco do leitor de tela no título (no-op no web — RNW expõe a dialog via ARIA).
  const titleRef = useReaderModalA11y(visible);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID={testIDPrefix ? `${testIDPrefix}-backdrop` : undefined}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            testID={testIDPrefix ? `${testIDPrefix}-close` : undefined}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={12}
          >
            <Text style={styles.close}>{t('common.close')}</Text>
          </Pressable>
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={styles.content}>{children}</View>
        )}
      </View>
    </Modal>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue, maxHeightPercent: number) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      maxHeight: `${maxHeightPercent}%`,
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingBottom: space.lg,
    },
    grabber: {
      width: 38,
      height: 4,
      borderRadius: 4,
      backgroundColor: colors.border,
      alignSelf: 'center',
      marginTop: space.sm,
      marginBottom: space.xs,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    title: { ...type.heading, fontFamily: type.title.fontFamily, color: colors.text, flexShrink: 1 },
    close: { ...type.button, color: colors.accent, paddingLeft: space.md },
    content: { padding: space.lg, gap: space.sm },
  });
}
