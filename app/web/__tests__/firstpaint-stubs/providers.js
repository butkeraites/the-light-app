// firstpaint-stubs/providers.js — F5.3
//
// Stubs headless dos providers/toggles/i18n/tema que o `_layout.tsx` importa. Os
// providers só repassam `children`; `useTheme` devolve um palette mínimo com as
// chaves que o shell lê (`background`/`text`/`headerBackground`); os toggles são
// no-ops. Assim a prova de 1º paint não arrasta `react-native`/persistência reais.
//
// Um único módulo serve a `../lib/i18n`, `../lib/theme` e `../components/*` (o
// plugin do teste mapeia todos para cá): exporta TODOS os nomes que o `_layout`
// consome desses três.
import React from 'react';

const colors = {
  background: '#ffffff',
  text: '#000000',
  headerBackground: '#eeeeee',
  accent: '#0066cc',
  border: '#cccccc',
  muted: '#888888',
  error: '#cc0000',
};

// ../lib/i18n
export function I18nProvider({ children }) {
  return React.createElement(React.Fragment, null, children);
}
export function useI18n() {
  return { t: (k) => k, lang: 'pt', setLang() {} };
}

// ../lib/theme
export function ThemeProvider({ children }) {
  return React.createElement(React.Fragment, null, children);
}
export function useTheme() {
  return { colors, isDark: false, setOverride() {} };
}

// ../components/LanguageToggleButton, ../components/ThemeModeSelector
export function LanguageToggleButton() {
  return React.createElement('LanguageToggleButton', null);
}
export function ThemeModeSelector() {
  return React.createElement('ThemeModeSelector', null);
}
