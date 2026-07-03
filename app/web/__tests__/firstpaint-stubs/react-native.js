// firstpaint-stubs/react-native.js — F5.3
//
// Stub headless de `react-native` para a prova de 1º paint (react-test-renderer, sem
// nativo/DOM). Cada primitivo vira um HOST component (string) que o test-renderer
// registra na árvore — assim o teste pode achar/asserir por `type`. Só o que o
// `_layout.tsx` toca precisa existir; o resto é conveniência defensiva.
import React from 'react';

export const View = ({ children }) => React.createElement('View', null, children);
export const Text = ({ children }) => React.createElement('Text', null, children);
export const ActivityIndicator = (props) => React.createElement('ActivityIndicator', props);
export const Pressable = ({ children }) => React.createElement('Pressable', null, children);
export const StyleSheet = { create: (s) => s };
export const Platform = { OS: 'web', select: (o) => (o && ('web' in o ? o.web : o.default)) };

export default { View, Text, ActivityIndicator, Pressable, StyleSheet, Platform };
