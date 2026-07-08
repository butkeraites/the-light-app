// app/lib/useChapterReader.ts — deepening (ADR-0060): seam profunda de leitura do capítulo
//
// Hook que passa a POSSUIR todo o fetching de fronteira da tela do capítulo
// (`app/app/read/[book]/[chapter].tsx`): lista de traduções, reconciliação da 2ª tradução,
// passagem primária, passagem paralela, xrefs do versículo selecionado, `dbPath` (uma vez),
// `dataDir` (uma vez), e o refresh de notas/highlights (delegando a REDUÇÃO à função pura
// `deriveVerseMarkers`). Cinco entradas simples → um saco plano de estado pronto p/ render,
// escondendo 7 efeitos assíncronos, os `ensure*`/chamadas de fronteira e os race-guards.
//
// Segue o mesmo padrão de hook de leitura do `useReaderModalA11y` (ADR-0049). NÃO reimplementa
// SQL/IO em TS: só orquestra as MESMAS chamadas de `app/web/reading` + `ensureReadingDb`/
// `ensureUserDataDir`. Offline-first/anti-alucinação preservados: só transita o retorno da
// fronteira; o texto do versículo segue verbatim do store, `deriveVerseMarkers` só toca dado
// do usuário.
import { useCallback, useEffect, useState } from 'react';

import { ensureReadingDb } from './db';
import { ensureUserDataDir } from './userdata';
import { deriveVerseMarkers } from './verseMarkers';
import {
  crossRefs,
  getChapter,
  listHighlights,
  listNotes,
  listTranslations,
  type CrossRef,
  type Passage,
  type Translation,
} from '../web/reading';

export interface ChapterReaderInput {
  book: number;
  chapter: number;
  translation: string;
  parallel: boolean;
  selectedVerse: number | null;
}

export interface ChapterReader {
  translations: Translation[];
  secondTranslation: string | null;
  setSecondTranslation: (id: string | null) => void;
  passage: Passage | null;
  secondaryPassage: Passage | null;
  error: string | null;
  xrefs: CrossRef[];
  xrefLoading: boolean;
  xrefError: string | null;
  dbPath: string | null;
  dataDir: string | null;
  notedVerses: Set<number>;
  highlightColors: Map<number, string>;
  refreshUserData: () => Promise<void>;
}

export function useChapterReader(input: ChapterReaderInput): ChapterReader {
  const { book, chapter, translation, parallel, selectedVerse } = input;

  const [translations, setTranslations] = useState<Translation[]>([]);
  const [passage, setPassage] = useState<Passage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondTranslation, setSecondTranslation] = useState<string | null>(null);
  const [secondaryPassage, setSecondaryPassage] = useState<Passage | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [xrefs, setXrefs] = useState<CrossRef[]>([]);
  const [xrefLoading, setXrefLoading] = useState(false);
  const [xrefError, setXrefError] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [notedVerses, setNotedVerses] = useState<Set<number>>(new Set());
  // versículo → NOME da cor (dado do usuário); resolvido p/ hex no render (na tela).
  const [highlightColors, setHighlightColors] = useState<Map<number, string>>(new Map());

  // Carrega as traduções disponíveis (seletor de versão) uma vez.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const path = await ensureReadingDb();
        const ts = await listTranslations(path);
        if (alive) setTranslations(ts);
      } catch {
        // Sem traduções → o seletor some; a leitura ainda tenta a default.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Mantém a 2ª tradução válida e SEMPRE diferente da primária.
  useEffect(() => {
    if (translations.length === 0) {
      return;
    }
    setSecondTranslation((prev) => {
      if (prev && prev !== translation && translations.some((tr) => tr.id === prev)) {
        return prev;
      }
      // Rodada 3 (ADR-0012): com 4 versões, prefere uma 2ª tradução em OUTRO IDIOMA — o paralelo
      // cross-língua é o mais útil (ex.: KJV en × Almeida pt), não KJV × BSB (ambas en). Cai p/
      // qualquer outra versão se todas forem do mesmo idioma da primária.
      const primaryLang = translations.find((tr) => tr.id === translation)?.language;
      const crossLang = translations.find((tr) => tr.id !== translation && tr.language !== primaryLang);
      return (crossLang ?? translations.find((tr) => tr.id !== translation))?.id ?? null;
    });
  }, [translations, translation]);

  // Carrega o texto do capítulo na tradução PRIMÁRIA (recarrega ao trocar versão).
  useEffect(() => {
    let alive = true;
    setPassage(null);
    setError(null);
    (async () => {
      try {
        const path = await ensureReadingDb();
        const p = await getChapter(path, translation, book, chapter);
        if (alive) setPassage(p);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [translation, book, chapter]);

  // F1.4: no modo paralelo, carrega o MESMO capítulo na 2ª tradução (2ª chamada de
  // get_chapter). O alinhamento por número de versículo é feito na view.
  useEffect(() => {
    if (!parallel || !secondTranslation) {
      setSecondaryPassage(null);
      return;
    }
    let alive = true;
    setSecondaryPassage(null);
    (async () => {
      try {
        const path = await ensureReadingDb();
        const p = await getChapter(path, secondTranslation, book, chapter);
        if (alive) setSecondaryPassage(p);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [parallel, secondTranslation, book, chapter]);

  // F1.9: ao selecionar um versículo, carrega suas xrefs pela fronteira `cross_refs`
  // (defaults do core p/ min_votes/limit). A UI só APRESENTA o `Vec<CrossRef>` retornado
  // (já ordenado por votos DESC pelo core) — anti-alucinação: xref é só referência.
  useEffect(() => {
    if (selectedVerse == null) {
      return;
    }
    let alive = true;
    setXrefLoading(true);
    setXrefError(null);
    setXrefs([]);
    (async () => {
      try {
        const path = await ensureReadingDb();
        const refs = await crossRefs(path, book, chapter, selectedVerse);
        if (alive) {
          setXrefs(refs);
          setXrefLoading(false);
        }
      } catch (err) {
        if (alive) {
          setXrefError(err instanceof Error ? err.message : String(err));
          setXrefLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedVerse, book, chapter]);

  // F2.5: resolve o caminho do banco só-leitura uma vez (p/ os painéis de IA ancorarem o
  // `cited_text` no store). A leitura já resolve o mesmo caminho nos seus efeitos.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const path = await ensureReadingDb();
        if (alive) setDbPath(path);
      } catch {
        // Sem banco → o estudo assistido fica indisponível; a leitura não regride.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // F1.11: resolve o diretório de userdata gravável uma vez (separado do banco só-leitura).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dir = await ensureUserDataDir();
        if (alive) setDataDir(dir);
      } catch {
        // userdata indisponível neste alvo → indicadores/edição ficam inativos.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // F1.11: deriva os indicadores do capítulo atual a partir de `list_notes`/`list_highlights`
  // (fronteira). A REDUÇÃO (filtrar book/chapter, mapear versículo→cor/nota) vive na função
  // pura `deriveVerseMarkers` — testável headless.
  const refreshUserData = useCallback(async () => {
    if (!dataDir) {
      return;
    }
    try {
      const [notes, highlights] = await Promise.all([listNotes(dataDir), listHighlights(dataDir)]);
      const markers = deriveVerseMarkers(notes, highlights, book, chapter);
      setNotedVerses(markers.notedVerses);
      setHighlightColors(markers.highlightColors);
    } catch {
      // best-effort: sem indicadores se a fronteira falhar; a leitura não regride.
    }
  }, [dataDir, book, chapter]);

  useEffect(() => {
    void refreshUserData();
  }, [refreshUserData]);

  return {
    translations,
    secondTranslation,
    setSecondTranslation,
    passage,
    secondaryPassage,
    error,
    xrefs,
    xrefLoading,
    xrefError,
    dbPath,
    dataDir,
    notedVerses,
    highlightColors,
    refreshUserData,
  };
}
