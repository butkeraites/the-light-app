// app/lib/useSearchIntent.ts — ADR-0080 (deepening): a INTENÇÃO de busca numa costura
//
// A tela de busca (ADR-0064) orquestrava QUATRO produtores assíncronos soltos, com debounces e deps
// DIFERENTES: autocomplete de termo (120ms), sugestões de livro (memo síncrono), detecção de referência
// (300ms) e a busca principal + "você quis dizer?" (300ms + race-guard `seqRef`). O estado de busca
// (results/loading/error/didYouMean/wordSuggestions/parsedRef) e esses 4 efeitos viviam na tela, sem
// interface. Concentrados aqui: o hook POSSUI os 4 produtores (cada um com o SEU debounce/deps — NÃO se
// mesclam, pra não mudar o timing) e o estado; a tela só injeta `term/translation/lang/locale/books` e
// RENDERIZA. A orquestração do zero-path é a costura PURA `resolveDidYouMean` (ADR-0075), já testada.
import { useEffect, useMemo, useRef, useState } from 'react';

import { ensureReadingDb } from './db';
import { resolveDidYouMean } from './searchIntent';
import { fold } from './searchNormalize';
import { suggestBooks, type BookSuggestion } from './searchReferenceSuggest';
import type { DidYouMean } from './searchSuggest';
import { suggestFuzzy, suggestWords } from './searchWordlist';
import { parseReference, type Reference } from '../web/reference';
import { search, type Book, type SearchHit } from '../web/reading';

const DEBOUNCE_MS = 300;

export interface SearchIntent {
  results: SearchHit[];
  loading: boolean;
  error: string | null;
  /** Sugestões "você quis dizer?" — SÓ no caminho zero-resultado. */
  didYouMean: DidYouMean[];
  /** Autocomplete de termo por prefixo do corpus (só 1 token). */
  wordSuggestions: string[];
  /** Referência COMPLETA parseada ("João 3") ou `null`. */
  parsedRef: Reference | null;
  /** Sugestões de LIVRO (do cânon, síncrono). */
  bookSuggestions: BookSuggestion[];
}

/**
 * Resolve a INTENÇÃO de busca a partir do termo digitado: hits, "você quis dizer?", autocomplete de
 * termo, sugestão de livro e detecção de referência. Cada produtor mantém o SEU debounce/deps (timing
 * inalterado). `term` já vem TRIMADO; os 4 produtores keyam por ele (a busca principal antes keava por
 * `query` cru — agora por `term`, como os outros: mesmos resultados, sem re-buscar em edições só-de-espaço).
 */
export function useSearchIntent(
  term: string,
  translation: string,
  lang: 'pt' | 'en',
  locale: 'pt' | 'en',
  books: Book[],
): SearchIntent {
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DidYouMean[]>([]);
  const [parsedRef, setParsedRef] = useState<Reference | null>(null);
  const [wordSuggestions, setWordSuggestions] = useState<string[]>([]);

  // (1) AUTOCOMPLETE de TERMO por prefixo do corpus. Só 1 token (sem espaço); palavras da tradução
  // buscada → tocar numa SEMPRE retorna resultados. Debounce curto (asset local, em memória).
  useEffect(() => {
    if (term.length < 2 || /\s/.test(term)) {
      setWordSuggestions([]);
      return;
    }
    let alive = true;
    const h = setTimeout(async () => {
      const ws = await suggestWords(term, lang, 6);
      if (alive) setWordSuggestions(ws.filter((w) => fold(w) !== fold(term))); // não sugere o próprio termo
    }, 120);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [term, lang]);

  // (2) Sugestões de LIVRO (síncrono, do cânon) — só para um token que prefixa um livro.
  const bookSuggestions = useMemo<BookSuggestion[]>(
    () => (books.length > 0 ? suggestBooks(term, books, locale) : []),
    [term, books, locale],
  );

  // (3) Detecção de REFERÊNCIA COMPLETA ("João 3") via a fronteira (async, debounced).
  useEffect(() => {
    if (term.length < 3) {
      setParsedRef(null);
      return;
    }
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const ref = await parseReference(term);
        if (alive) setParsedRef(ref);
      } catch {
        if (alive) setParsedRef(null); // não é uma referência → só busca de texto
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [term]);

  // (4) Busca principal com DEBOUNCE + race-guard (`seq`). Ao dar ZERO, computa o "você quis dizer?"
  // (via `resolveDidYouMean`, ADR-0075). A busca EXATA em si é inalterada (uma fonte da verdade).
  const seqRef = useRef(0);
  useEffect(() => {
    if (term.length === 0) {
      setResults([]);
      setSuggestions([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mySeq = ++seqRef.current;
    const handle = setTimeout(async () => {
      try {
        const dbPath = await ensureReadingDb();
        const hits = await search(dbPath, term, translation);
        if (mySeq !== seqRef.current) return;
        setResults(hits);
        setError(null);
        setLoading(false);
        if (hits.length === 0) {
          const dym = await resolveDidYouMean(term, translation, locale, lang, {
            search: (cand, tr, limit) => search(dbPath, cand, tr, undefined, limit),
            suggestFuzzy,
          });
          if (mySeq === seqRef.current) setSuggestions(dym);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        if (mySeq === seqRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setResults([]);
          setSuggestions([]);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [term, translation, locale, lang]);

  return { results, loading, error, didYouMean: suggestions, wordSuggestions, parsedRef, bookSuggestions };
}
