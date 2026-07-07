// search-smart-headless-entry.ts — ADR-0064 (molde contrast/theme headless-entry)
//
// Ponto de entrada VERSIONADO da prova headless da BUSCA INTELIGENTE. Empacotado (esbuild) por
// `search-smart.test.mjs` num único `.mjs` e executado em node SEM device/browser/rede. Reexporta
// SÓ a superfície PURA exercitada. NÃO importa a tela nem `react-native`; `searchReferenceSuggest`
// só usa o TIPO `Book` (import type, apagado). `recentSearches` puxa `prefs` (lazy expo-file-system,
// marcado external no test) mas a prova injeta um backend fake.
import { fold, trimEdges } from '../../lib/searchNormalize';
import { significantTerms, isStopword, STOPWORDS } from '../../lib/searchStopwords';
import { synonymsFor, conceptExpansions } from '../../lib/searchSynonyms';
import { buildDidYouMean } from '../../lib/searchSuggest';
import { suggestBooks } from '../../lib/searchReferenceSuggest';
import { makeWordlist, prefixMatches, fuzzyMatches, boundedLevenshtein } from '../../lib/searchWordlistIndex';
import {
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
  RECENT_KEY,
  RECENT_MAX,
} from '../../lib/recentSearches';

export {
  fold,
  trimEdges,
  significantTerms,
  isStopword,
  STOPWORDS,
  synonymsFor,
  conceptExpansions,
  buildDidYouMean,
  suggestBooks,
  makeWordlist,
  prefixMatches,
  fuzzyMatches,
  boundedLevenshtein,
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
  RECENT_KEY,
  RECENT_MAX,
};
