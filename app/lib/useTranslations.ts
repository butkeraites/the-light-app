// app/lib/useTranslations.ts — ADR-0070 (deepening): carregador único das traduções do store
//
// O efeito `useState<Translation[]>` + `ensureReadingDb`/`listTranslations` era TRIPLICADO (Home,
// Busca, `useChapterReader`). Concentrado aqui. Degrada a [] silenciosamente (sem store → o seletor
// some; a leitura ainda tenta a default). PERF (F5.12/ADR-0040): `db`/`reading` (glue + sqlite-mirror,
// a parte pesada) entram por `import()` DINÂMICO — fora do 1º paint eager da Home; `Translation` é
// `import type` (apagado). Sem isso, importar este hook na Home puxaria a leitura para o entry eager.
import { useEffect, useState } from 'react';

import type { Translation } from '../web/reading';

export function useTranslations(): Translation[] {
  const [translations, setTranslations] = useState<Translation[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ ensureReadingDb }, { listTranslations }] = await Promise.all([
          import('./db'),
          import('../web/reading'),
        ]);
        const dbPath = await ensureReadingDb();
        const ts = await listTranslations(dbPath);
        if (alive) setTranslations(ts);
      } catch {
        /* sem traduções → o seletor some; a leitura usa a default do idioma */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return translations;
}
