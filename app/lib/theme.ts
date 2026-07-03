// app/lib/theme.ts — F1.4 (ADR-0015) · persistência F5.14 (ADR-0043)
//
// Tema claro/escuro para a UI de leitura. Centraliza os TOKENS de cor (antes
// hex hardcoded espalhados nos `Reader*`) em dois conjuntos — `light` e `dark` —
// e expõe um `ThemeProvider`/`useTheme()` que:
//   1) respeita o esquema do SISTEMA via `useColorScheme()` do React Native; e
//   2) permite um OVERRIDE por toggle que PERSISTE ENTRE REINÍCIOS no KV de prefs
//      OFFLINE da F5.2 (arquivo nativo / localStorage web), sob `tla.pref.theme.mode`.
//      No boot o override salvo re-hidrata; `toggle`/`setMode` gravam (ou limpam, p/
//      voltar a seguir o sistema). Isto FECHA a lacuna 'persistência é futura' do
//      ADR-0015 REUSANDO a infra da F5.2 — sem 2º mecanismo, sem nova dependência.
//
// A LÓGICA PURA de persistência (chave, guard) mora em `themePrefs.ts` (sem
// `react-native`), o que mantém a prova headless bundlável. Os componentes `Reader*`
// (e a tela do capítulo) consomem `colors` daqui, nunca hex literais. Isto é
// PRESENTAÇÃO pura: não há lógica de domínio — o texto bíblico continua vindo do store
// via `get_chapter` (anti-alucinação); o KV de tema não é logado nem toca a rede.
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { getPref, removePref, setPref } from './prefs';
import { isThemeMode, THEME_PREF_KEY, type ThemeMode } from './themePrefs';

export type { ThemeMode } from './themePrefs';

/** Tokens de cor consumidos pela UI de leitura (uma fonte de verdade visual). */
export type ThemeColors = {
  /** Fundo das telas/listas. */
  background: string;
  /** Fundo do header de navegação. */
  headerBackground: string;
  /** Texto primário (nomes de livro, números de capítulo, títulos). */
  text: string;
  /** Texto do versículo (corpo da leitura). */
  verseText: string;
  /** Texto secundário/atenuado (subtítulos, vazios). */
  muted: string;
  /** Elementos muito sutis (chevron). */
  faint: string;
  /** Divisórias finas (hairline) entre linhas. */
  divider: string;
  /** Bordas de chips/células. */
  border: string;
  /** Destaque do número do versículo. */
  accent: string;
  /** Chip/seleção ativa: fundo. */
  chipActiveBg: string;
  /** Chip/seleção ativa: texto. */
  chipActiveText: string;
  /** Chip inativo: texto. */
  chipText: string;
  /** Chip: rótulo de idioma. */
  chipLang: string;
  /** Mensagens de erro. */
  error: string;
};

const LIGHT: ThemeColors = {
  background: '#ffffff',
  headerBackground: '#ffffff',
  text: '#111111',
  verseText: '#1a1a1a',
  muted: '#888888',
  faint: '#cccccc',
  divider: '#e2e2e2',
  border: '#dddddd',
  accent: '#b08400',
  chipActiveBg: '#111111',
  chipActiveText: '#ffffff',
  chipText: '#333333',
  chipLang: '#999999',
  error: '#b00020',
};

const DARK: ThemeColors = {
  background: '#101012',
  headerBackground: '#16161a',
  text: '#f2f2f2',
  verseText: '#e6e6e6',
  muted: '#9a9a9a',
  faint: '#555555',
  divider: '#2a2a2e',
  border: '#3a3a40',
  accent: '#e0b84d',
  chipActiveBg: '#f2f2f2',
  chipActiveText: '#111111',
  chipText: '#cfcfcf',
  chipLang: '#8a8a8a',
  error: '#ff6b6b',
};

const PALETTES: Record<ThemeMode, ThemeColors> = { light: LIGHT, dark: DARK };

export type ThemeContextValue = {
  /** Modo efetivo aplicado (`light`/`dark`). */
  mode: ThemeMode;
  /** Tokens de cor do modo efetivo. */
  colors: ThemeColors;
  /** Atalho `mode === 'dark'`. */
  isDark: boolean;
  /** `true` quando seguindo o esquema do sistema (sem override persistido). */
  isSystem: boolean;
  /** Alterna claro⇄escuro, fixando e PERSISTINDO um override (offline). */
  toggle: () => void;
  /** Fixa um modo (ou `null` p/ voltar a seguir o sistema); persiste a escolha offline. */
  setMode: (mode: ThemeMode | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Provedor de tema. Base = `useColorScheme()` (sistema); override opcional PERSISTIDO
 * via `prefs` (arquivo nativo / localStorage web). No boot re-hidrata o override salvo;
 * `toggle`/`setMode` persistem a escolha (ou a limpam p/ voltar a seguir o sistema).
 * Coloque no topo da árvore (ex.: `app/_layout.tsx`).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [override, setOverride] = useState<ThemeMode | null>(null);
  const mode: ThemeMode = override ?? (system === 'dark' ? 'dark' : 'light');

  // Re-hidrata o override PERSISTIDO no boot (offline). Um valor ausente/inválido mantém a
  // base = esquema do sistema (guard `isThemeMode`); falha de leitura nunca quebra a UI
  // (offline-first). Há um breve default→hidrata: se o salvo diverge do sistema, o 1º paint
  // segue o sistema até a leitura async resolver (aceitável p/ ADR-0015; molde do i18n).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await getPref(THEME_PREF_KEY);
        if (alive && isThemeMode(saved)) {
          setOverride(saved);
        }
      } catch {
        /* prefs indisponível → segue o esquema do sistema */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Fixa (ou limpa) o modo e PERSISTE a escolha offline (fire-and-forget; falha tolerada).
  const setMode = useCallback((next: ThemeMode | null) => {
    setOverride(next);
    void (async () => {
      try {
        if (next == null) {
          await removePref(THEME_PREF_KEY);
        } else {
          await setPref(THEME_PREF_KEY, next);
        }
      } catch {
        /* falha de persistência é tolerada (offline-first) */
      }
    })();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      colors: PALETTES[mode],
      isDark: mode === 'dark',
      isSystem: override === null,
      toggle: () => setMode(mode === 'dark' ? 'light' : 'dark'),
      setMode,
    }),
    [mode, override, setMode],
  );

  // `createElement` (não JSX) p/ manter este módulo como `.ts` puro de tema.
  return createElement(ThemeContext.Provider, { value }, children);
}

/** Lê o tema corrente. Lança se usado fora de um `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>.');
  }
  return ctx;
}
