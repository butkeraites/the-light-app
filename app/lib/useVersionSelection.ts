// app/lib/useVersionSelection.ts — ADR-0070 (deepening): seletor de versão como UMA costura
//
// A Home e a Busca repetiam: (1) o carregador de traduções, (2) o estado `picked` da escolha do
// usuário, (3) a escada `effectiveTranslation` (byte-idêntica). Este hook concentra os três. Cada tela
// tem sua PRÓPRIA instância (estado LOCAL) — a busca segue o idioma da UI independentemente e um salto
// para o leitor NÃO muta o seletor da Home (ADR-0064 preservado; NÃO é um store global).
//
// Molde: `useChapterReader` (hook-costura que possui o boundary). A resolução em si é a função PURA
// `resolveEffectiveTranslation` (headless-testável), aqui só orquestrada com o estado de React.
import { useMemo, useState } from 'react';

import { resolveEffectiveTranslation } from './translationDefault';
import { useTranslations } from './useTranslations';
import type { Translation } from '../web/reading';

export interface VersionSelection {
  /** Traduções presentes no store (para o seletor). Vazio até carregar. */
  translations: Translation[];
  /** Escolha explícita do usuário (`null` = ainda seguindo o default do idioma). */
  picked: string | null;
  setPicked: (id: string | null) => void;
  /** Versão EFETIVA resolvida (escolha válida → default do idioma → mesmo idioma → 1ª → default). */
  effective: string;
}

export function useVersionSelection(locale: 'pt' | 'en'): VersionSelection {
  const translations = useTranslations();
  const [picked, setPicked] = useState<string | null>(null);
  const effective = useMemo(
    () => resolveEffectiveTranslation(picked, translations, locale),
    [picked, translations, locale],
  );
  return { translations, picked, setPicked, effective };
}
