// app/components/WasmGate.tsx — F5.3
//
// Gate POR-ROTA do wasm da fronteira. A F5.3 tirou o pré-aquecimento do wasm do
// caminho render-blocking do `_layout.tsx` (o shell do app pinta na hora e o wasm
// AQUECE em segundo plano). Mas `listBooks()` (cânon de 66, do RUST/wasm) é
// SÍNCRONO no web e exige o wasm já inicializado — então cada TELA DE LEITURA que o
// chama se auto-gateia com este componente: enquanto `useWasmReady()` for `false`
// mostra um spinner temático; quando o wasm fica pronto, monta os `children` (que
// então chamam `listBooks()` com segurança). No NATIVO `useWasmReady()` é sempre
// `true` (o cânon vem do JSI) → os `children` montam de imediato, sem regressão.
//
// Por que envolver os filhos (e não gatear inline)? Assim o componente-conteúdo só
// MONTA quando o wasm está pronto: seus hooks/efeitos que chamam `listBooks()` nunca
// rodam cedo demais, respeitando as regras de hooks sem early-return no meio.
import type { PropsWithChildren } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '../lib/theme';
import { useWasmReady } from '../web/wasm';

/**
 * Só monta `children` quando o wasm da fronteira estiver inicializado; até lá mostra
 * um `ActivityIndicator` temático. No nativo é transparente (pronto de imediato).
 */
export function WasmGate({ children }: PropsWithChildren): React.ReactElement {
  const { colors } = useTheme();
  const ready = useWasmReady();
  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  return <>{children}</>;
}
