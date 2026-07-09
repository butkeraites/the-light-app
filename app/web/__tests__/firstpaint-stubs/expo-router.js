// firstpaint-stubs/expo-router.js — F5.3
//
// Stub headless de `expo-router` para a prova de 1º paint. `Stack` renderiza os
// filhos (as `Stack.Screen`) de imediato; cada `Stack.Screen` vira um HOST `screen`
// com o `name` — o teste conta essas telas para provar que o shell montou a
// navegação SÍNCRONO (sem esperar o wasm). Não simula navegação real.
import React from 'react';

export function Stack({ children }) {
  // `React.Children.toArray` atribui keys → sem warning de lista.
  return React.createElement(React.Fragment, null, React.Children.toArray(children));
}
Stack.Screen = function Screen({ name }) {
  return React.createElement('screen', { name });
};

export const Link = ({ children }) => React.createElement('a', null, children);
export const router = { push() {}, replace() {}, back() {}, canGoBack: () => false };
export function useNavigation() {
  return { setOptions() {} };
}
export function useLocalSearchParams() {
  return {};
}
