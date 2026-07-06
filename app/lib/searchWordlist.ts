// app/lib/searchWordlist.ts — ADR-0064 Fase B (autocomplete de termo do corpus)
//
// Carregador LAZY do dicionário de palavras do corpus (asset `assets/data/wordlist.<lang>.json`,
// gerado por `scripts/gen-search-wordlist.mjs`). Importado SOB DEMANDA (dynamic import) só quando
// a tela de busca precisa — chunk async no web (fora do 1º paint, orçamento travado) e require
// inline no nativo. Memoizado por idioma. A LÓGICA de prefixo (pura) mora em `searchWordlistIndex`.
//
// DEGRADAÇÃO GRACIOSA: se o asset não existir (ex.: checkout sem o passo de build) ou falhar, o
// autocomplete de termo simplesmente não aparece — os demais recursos de busca seguem intactos.

import { makeWordlist, prefixMatches, type Wordlist, type WordEntry } from './searchWordlistIndex';

export type WordlistLang = 'pt' | 'en';

const cache: Partial<Record<WordlistLang, Wordlist>> = {};
const loading: Partial<Record<WordlistLang, Promise<Wordlist | null>>> = {};

async function load(lang: WordlistLang): Promise<Wordlist | null> {
  if (cache[lang]) {
    return cache[lang] ?? null;
  }
  if (!loading[lang]) {
    loading[lang] = (async () => {
      try {
        // Paths LITERAIS (Metro resolve os dois) — nunca um template dinâmico.
        const mod =
          lang === 'pt'
            ? await import('../assets/data/wordlist.pt.json')
            : await import('../assets/data/wordlist.en.json');
        const data = (mod as { default?: unknown }).default ?? mod;
        const words = (data as { words?: WordEntry[] }).words ?? [];
        const wl = makeWordlist(words);
        cache[lang] = wl;
        return wl;
      } catch {
        return null; // asset ausente/erro → autocomplete de termo desligado (degrada)
      }
    })();
  }
  return loading[lang];
}

/** Até `max` completações de PREFIXO do corpus da língua (ordenadas por frequência). */
export async function suggestWords(prefix: string, lang: WordlistLang, max = 6): Promise<string[]> {
  const wl = await load(lang);
  return wl ? prefixMatches(wl, prefix, max) : [];
}
