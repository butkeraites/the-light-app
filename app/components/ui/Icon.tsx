// app/components/ui/Icon.tsx — ADR-0066 (component kit "Vigil") · ADR-0068 Fase 5 (@expo/vector-icons)
//
// Abstração fina de ÍCONE por NOME lógico. A Fase 5 troca os glifos Unicode (Fase 1) pelo set
// FEATHER de `@expo/vector-icons` — linha fina, consistente, casa com a estética Vigil — SEM mudar
// nenhum call site (`<Icon name="chevron" />`). Um único set = uma única fonte de ícones (sem inchar
// o bundle com vários). DECORATIVO: escondido do leitor de tela (o controle que o contém carrega o
// `accessibilityLabel`). No web o RNW injeta o @font-face do Feather; no nativo a fonte é bundlada.
import { type ComponentProps } from 'react';
import { type StyleProp, type TextStyle } from 'react-native';
// Subpath import (só o set Feather) — NÃO o barril `@expo/vector-icons`, que puxaria TODOS os
// sets (Ionicons/Material/FontAwesome…) para o entry EAGER e incharia o bundle. Uma fonte só.
import Feather from '@expo/vector-icons/Feather';

import { useTheme } from '../../lib/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

// Nome lógico → nome no set Feather. `satisfies` faz o tsc PROVAR que cada valor é um ícone Feather
// REAL (erro de compilação se alguém digitar um nome inexistente). As chaves definem `IconName`, então
// os call sites e os outros primitivos do kit (IconButton/ListRow) não mudam.
const FEATHER = {
  chevron: 'chevron-right',
  chevronDown: 'chevron-down',
  back: 'chevron-left',
  close: 'x',
  check: 'check',
  search: 'search',
  note: 'edit-3',
  highlight: 'bookmark',
  share: 'share-2',
  settings: 'settings',
  info: 'info',
  book: 'book',
  plans: 'calendar',
  cloud: 'cloud',
  moon: 'moon',
  sun: 'sun',
  auto: 'circle',
  plus: 'plus',
  minus: 'minus',
  ask: 'help-circle',
  study: 'book-open',
  chat: 'message-circle',
  compare: 'columns',
  bullet: 'disc',
} satisfies Record<string, FeatherName>;

export type IconName = keyof typeof FEATHER;

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
    <Feather
      name={FEATHER[name]}
      size={size}
      color={color ?? colors.text}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
