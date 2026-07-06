// app/lib/useReadingPrefs.ts — ADR-0067 (ajustes de leitura; molde theme.ts)
//
// Hook que LÊ/PERSISTE as preferências de leitura (tamanho/entrelinha/tema/família/justificação)
// no KV de prefs OFFLINE (F5.2), reusando a LÓGICA PURA de `readingPrefs.ts` (tipos/guardas/chaves/
// parsers) — sem 2º mecanismo, sem rede. No boot re-hidrata o salvo; os setters gravam (ou limpam,
// no caso do tema, p/ voltar a seguir o modo do app). É o ÚNICO ponto com `react`/estado; a lógica
// pura fica testável headless (`test:web:readingprefs`).
import { useCallback, useEffect, useState } from 'react';

import { getPref, removePref, setPref } from './prefs';
import {
  DEFAULT_FONT_STEP,
  DEFAULT_JUSTIFY,
  DEFAULT_LINE_SPACING,
  DEFAULT_READING_FONT,
  READING_FONT_KEY,
  READING_FONT_STEP_KEY,
  READING_JUSTIFY_KEY,
  READING_SPACING_KEY,
  READING_THEME_KEY,
  clampFontStep,
  fontStepToString,
  isLineSpacing,
  isReadingFont,
  isReadingTheme,
  justifyToString,
  parseFontStep,
  parseJustify,
  type LineSpacing,
  type ReadingFont,
  type ReadingTheme,
} from './readingPrefs';

export type ReadingPrefs = {
  /** `true` quando o estado persistido já re-hidratou (evita flash do default). */
  loaded: boolean;
  fontStep: number;
  lineSpacing: LineSpacing;
  /** `null` = seguir o modo do app (claro/escuro). */
  readingTheme: ReadingTheme | null;
  readingFont: ReadingFont;
  justify: boolean;
  setFontStep: (n: number) => void;
  setLineSpacing: (s: LineSpacing) => void;
  setReadingTheme: (t: ReadingTheme | null) => void;
  setReadingFont: (f: ReadingFont) => void;
  setJustify: (b: boolean) => void;
};

// Persistência fire-and-forget (offline-first: falha tolerada; `null` limpa a chave).
function persist(key: string, value: string | null) {
  void (async () => {
    try {
      if (value == null) {
        await removePref(key);
      } else {
        await setPref(key, value);
      }
    } catch {
      /* tolerado */
    }
  })();
}

export function useReadingPrefs(): ReadingPrefs {
  const [loaded, setLoaded] = useState(false);
  const [fontStep, setFontStepS] = useState(DEFAULT_FONT_STEP);
  const [lineSpacing, setLineSpacingS] = useState<LineSpacing>(DEFAULT_LINE_SPACING);
  const [readingTheme, setReadingThemeS] = useState<ReadingTheme | null>(null);
  const [readingFont, setReadingFontS] = useState<ReadingFont>(DEFAULT_READING_FONT);
  const [justify, setJustifyS] = useState(DEFAULT_JUSTIFY);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [step, spacing, theme, font, just] = await Promise.all([
          getPref(READING_FONT_STEP_KEY),
          getPref(READING_SPACING_KEY),
          getPref(READING_THEME_KEY),
          getPref(READING_FONT_KEY),
          getPref(READING_JUSTIFY_KEY),
        ]);
        if (!alive) return;
        setFontStepS(parseFontStep(step));
        if (isLineSpacing(spacing)) setLineSpacingS(spacing);
        if (isReadingTheme(theme)) setReadingThemeS(theme);
        if (isReadingFont(font)) setReadingFontS(font);
        setJustifyS(parseJustify(just));
      } catch {
        /* prefs indisponível → mantém os defaults (offline-first) */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setFontStep = useCallback((n: number) => {
    const c = clampFontStep(n);
    setFontStepS(c);
    persist(READING_FONT_STEP_KEY, fontStepToString(c));
  }, []);
  const setLineSpacing = useCallback((s: LineSpacing) => {
    setLineSpacingS(s);
    persist(READING_SPACING_KEY, s);
  }, []);
  const setReadingTheme = useCallback((t: ReadingTheme | null) => {
    setReadingThemeS(t);
    persist(READING_THEME_KEY, t); // null → remove (volta a seguir o modo do app)
  }, []);
  const setReadingFont = useCallback((f: ReadingFont) => {
    setReadingFontS(f);
    persist(READING_FONT_KEY, f);
  }, []);
  const setJustify = useCallback((b: boolean) => {
    setJustifyS(b);
    persist(READING_JUSTIFY_KEY, justifyToString(b));
  }, []);

  return {
    loaded,
    fontStep,
    lineSpacing,
    readingTheme,
    readingFont,
    justify,
    setFontStep,
    setLineSpacing,
    setReadingTheme,
    setReadingFont,
    setJustify,
  };
}
