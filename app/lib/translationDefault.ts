// app/lib/translationDefault.ts — tradução default por IDIOMA da UI (fonte única)
//
// ADR-0064: um leitor em português começa em Almeida (alm1911), não em KJV — o texto casa o
// idioma do usuário. Esta função era DUPLICADA na busca e na home; a leitura passa a usá-la
// também para não nascer sempre em inglês. Cai no `FALLBACK_TRANSLATION` (KJV) fora de pt.
//
// NÃO decide QUAL versão está selecionada — só o DEFAULT quando nenhuma foi escolhida/passada.
// A versão explícita (escolha do usuário ou parâmetro de navegação) sempre vence.
export const FALLBACK_TRANSLATION = 'kjv';

export function defaultTranslationFor(locale: 'pt' | 'en'): string {
  return locale === 'pt' ? 'alm1911' : FALLBACK_TRANSLATION;
}
