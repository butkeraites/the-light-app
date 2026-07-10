// app/lib/translationDefault.ts — tradução default por IDIOMA da UI (fonte única)
//
// ADR-0064: um leitor em português começa em Almeida (alm1911), não em KJV — o texto casa o
// idioma do usuário. Esta função era DUPLICADA na busca e na home; a leitura passa a usá-la
// também para não nascer sempre em inglês. Cai no `FALLBACK_TRANSLATION` (KJV) fora de pt.
//
// NÃO decide QUAL versão está selecionada — só o DEFAULT quando nenhuma foi escolhida/passada.
// A versão explícita (escolha do usuário ou parâmetro de navegação) sempre vence.
//
// ADR-0070 (deepening): a ESCADA de resolução (`resolveEffectiveTranslation`) e a derivação de
// idioma (`langForTranslation`) eram duplicadas byte-a-byte na Home e na Busca (e no leitor, o
// `nameLang`). Concentradas aqui como funções PURAS (import só-de-tipo → headless-testável), servidas
// pelo hook `useVersionSelection`. Não muda comportamento — é a MESMA escada, num lugar só.
import type { Translation } from '../web/reading';

export const FALLBACK_TRANSLATION = 'kjv';

export function defaultTranslationFor(locale: 'pt' | 'en'): string {
  return locale === 'pt' ? 'alm1911' : FALLBACK_TRANSLATION;
}

/**
 * Tradução EFETIVA: a escolha do usuário (`picked`) se válida no store, senão o default do idioma
 * (se presente/store vazio), senão a 1ª do MESMO idioma, senão a 1ª disponível, senão o default.
 * Puro: `translations` é o store validado; `picked` é a escolha explícita (ou `null`).
 */
export function resolveEffectiveTranslation(
  picked: string | null,
  translations: readonly Translation[],
  locale: 'pt' | 'en',
): string {
  if (picked && translations.some((x) => x.id === picked)) {
    return picked;
  }
  const byLocale = defaultTranslationFor(locale);
  if (translations.length === 0 || translations.some((x) => x.id === byLocale)) {
    return byLocale;
  }
  return translations.find((x) => x.language === locale)?.id ?? translations[0]?.id ?? byLocale;
}

/**
 * Idioma ('pt'|'en') de uma tradução resolvida — para o dicionário de autocomplete (busca `searchLang`)
 * e o nome do livro no leitor (`nameLang`). Cai no `locale` se a versão não declarar idioma conhecido.
 */
export function langForTranslation(
  id: string,
  translations: readonly Translation[],
  locale: 'pt' | 'en',
): 'pt' | 'en' {
  const lang = translations.find((x) => x.id === id)?.language;
  return lang === 'en' || lang === 'pt' ? lang : locale;
}
