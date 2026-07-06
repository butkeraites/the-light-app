// app/components/ui/Icon.tsx — ADR-0066 (component kit "Vigil")
//
// Abstração fina de ÍCONE por NOME lógico. Na Fase 1 é backed por glifos (texto); a Fase 5 troca
// a implementação para `@expo/vector-icons` SEM mudar os call sites (`<Icon name="chevron" />`).
// DECORATIVO: escondido do leitor de tela (o controle que o contém carrega o `accessibilityLabel`).
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useTheme } from '../../lib/theme';

// Nome lógico → glifo Unicode (temporário; Fase 5 mapeia para ícones reais).
const GLYPH = {
  chevron: '›', // ›
  chevronDown: '▾', // ▾
  back: '‹', // ‹
  close: '✕', // ✕
  check: '✓', // ✓
  search: '⌕', // ⌕
  note: '✎', // ✎
  highlight: '▍', // ▍
  share: '↪', // ↪
  settings: '⚙', // ⚙
  info: 'ⓘ', // ⓘ
  book: '❖', // ❖
  plans: '☷', // ☷
  cloud: '☁', // ☁
  moon: '☾', // ☾
  sun: '☀', // ☀
  auto: '◐', // ◐
  plus: '＋', // ＋
  minus: '−', // −
  ask: '?',
  study: '✧', // ✧
  chat: '⚇', // ⚇
  compare: '☷', // ☷
  bullet: '•', // •
} as const;

export type IconName = keyof typeof GLYPH;

export function Icon({
  name,
  size = 18,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ fontSize: size, lineHeight: Math.round(size * 1.15), color: color ?? colors.text }, style]}
    >
      {GLYPH[name] ?? GLYPH.bullet}
    </Text>
  );
}
