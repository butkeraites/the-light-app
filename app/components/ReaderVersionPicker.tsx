// app/components/ReaderVersionPicker.tsx — F1.3
//
// Apresentacional: seletor de versão (traduções vindas de `listTranslations(db)`
// — ex.: KJV en ⇄ Almeida 1911 pt). Trocar dispara `onChange(id)`; a tela
// recarrega o mesmo capítulo na outra tradução. Não faz I/O nem lógica de domínio.
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Translation } from '../web/reading';

export function ReaderVersionPicker({
  translations,
  current,
  onChange,
}: {
  translations: Translation[];
  current: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.bar}>
      {translations.map((t) => {
        const active = t.id === current;
        return (
          <Pressable
            key={t.id}
            style={[styles.chip, active ? styles.chipActive : null]}
            onPress={() => onChange(t.id)}
            testID={`version-${t.id}`}
          >
            <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
              {t.abbrev}
            </Text>
            <Text style={[styles.chipLang, active ? styles.chipTextActive : null]}>
              {t.language}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e2',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dddddd',
  },
  chipActive: { backgroundColor: '#111111', borderColor: '#111111' },
  chipText: { fontSize: 14, color: '#333333', fontWeight: '600' },
  chipLang: { fontSize: 11, color: '#999999', textTransform: 'uppercase' },
  chipTextActive: { color: '#ffffff' },
});
