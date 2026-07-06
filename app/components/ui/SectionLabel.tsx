// app/components/ui/SectionLabel.tsx — ADR-0066 (component kit "Vigil")
//
// Rótulo de seção (maiúsculas atenuadas, `type.label`) — substitui os `sectionTitle` copiados nos
// painéis. Aceita cor opcional (ex.: ouro num cabeçalho de destaque).
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useTheme } from '../../lib/theme';

export function SectionLabel({
  children,
  color,
  style,
}: {
  children: string;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { colors, type } = useTheme();
  return <Text style={[type.label, { color: color ?? colors.muted }, style]}>{children}</Text>;
}
