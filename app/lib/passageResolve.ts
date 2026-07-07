// app/lib/passageResolve.ts — ADR-0065 (lookup de passagem: ranges + listas)
//
// RESOLVEDOR/COMPOSITOR (async) que expande os itens classificados (`passageQuery`) em leituras
// ATÔMICAS de capítulo e concatena o resultado. Cada peça é um `getChapter(book, chapter)` na
// tradução escolhida (texto VERBATIM do store) + FILTRO de versos APP-SIDE — o que evita o limite
// de "só verso único" do store web e a ausência de contagem de versos por capítulo (basta ler o
// capítulo e usar a lista devolvida). Nomes de livro resolvem via `parseReference("<livro> 1")`
// (reusa os aliases do core); a contagem de capítulos vem do cânon (`chapterCountOf`).
//
// GUARDA: acumula até um TETO (capítulos e versos) e marca `truncated` além disso — livros
// inteiros / spans enormes degradam com aviso, não travam. DEPS INJETADAS → testável headless.
// ANTI-ALUCINAÇÃO: só SELECIONA quais versos/capítulos mostrar e monta rótulos (chrome); o texto
// do verso segue verbatim do store, via `getChapter`.

import type { Passage } from '../web/reading';
import type { Reference } from '../web/reference';
import { parsePassageQuery } from './passageQuery';

type Verse = Passage['verses'][number];

/** Leitura atômica: um capítulo, opcionalmente recortado a `from..to`. */
export type ReadSpec = { book: number; chapter: number; from?: number; to?: number };

/** Um trecho resolvido: rótulo de referência (chrome) + versos verbatim do store. */
export type Segment = { label: string; verses: Verse[] };

export type PassageResult = {
  segments: Segment[];
  verseCount: number;
  truncated: boolean;
  resolved: number; // itens que produziram algo
  invalid: number; // itens não reconhecidos / não resolvidos
};

/** Acima deste nº de versos (num único trecho) o lookup deixa de ser "pequeno" (inline). */
export const INLINE_MAX_VERSES = 12;

/**
 * Fase 7 (follow-up): um resultado é "grande/múltiplo" (merece a tela DEDICADA de leitura em vez
 * do cartão inline da home) quando abrange VÁRIOS trechos, MUITOS versos, ou foi TRUNCADO. Um único
 * versículo ou um intervalo curto continua inline. Puro/derivado — sem I/O.
 */
export function isLargePassage(r: PassageResult): boolean {
  return r.segments.length > 1 || r.verseCount > INLINE_MAX_VERSES || r.truncated;
}

export type ResolveDeps = {
  parseReference: (s: string) => Promise<Reference>;
  getChapter: (book: number, chapter: number) => Promise<Passage>;
  chapterCountOf: (book: number) => number;
  bookLabel: (book: number) => string;
  maxChapters?: number;
  maxVerses?: number;
};

const DEFAULT_MAX_CHAPTERS = 15;
const DEFAULT_MAX_VERSES = 200;

function verseNum(v: Verse): number | null {
  const r = v.reference.verses;
  return r.tag === 'Single' ? r.inner.verse : null;
}

/** Resolve um token de livro em número canônico (reusa os aliases do core). `null` se inválido. */
async function resolveBook(token: string, deps: ResolveDeps): Promise<number | null> {
  try {
    const r = await deps.parseReference(`${token} 1`);
    return r.book;
  } catch {
    return null;
  }
}

/** Spec a partir de uma `Reference` resolvida pelo core (single/range/capítulo inteiro). */
function specFromRef(ref: Reference): ReadSpec {
  const v = ref.verses;
  if (v.tag === 'Single') {
    return { book: ref.book, chapter: ref.chapter, from: v.inner.verse, to: v.inner.verse };
  }
  if (v.tag === 'Range') {
    return { book: ref.book, chapter: ref.chapter, from: v.inner.start, to: v.inner.end };
  }
  return { book: ref.book, chapter: ref.chapter };
}

/** Rótulo do trecho (chrome): "Livro cap" ou "Livro cap:a-b", a partir dos versos MOSTRADOS. */
function labelFor(spec: ReadSpec, all: Verse[], shown: Verse[], deps: ResolveDeps): string {
  const name = deps.bookLabel(spec.book);
  const nums = shown.map(verseNum).filter((n): n is number => n != null);
  if (nums.length === 0) {
    return `${name} ${spec.chapter}`;
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const allNums = all.map(verseNum).filter((n): n is number => n != null);
  const chMin = allNums.length ? Math.min(...allNums) : min;
  const chMax = allNums.length ? Math.max(...allNums) : max;
  if (min === chMin && max === chMax) {
    return `${name} ${spec.chapter}`; // capítulo inteiro
  }
  return min === max ? `${name} ${spec.chapter}:${min}` : `${name} ${spec.chapter}:${min}-${max}`;
}

/** Expande a consulta em specs de capítulo, respeitando o teto de capítulos. */
async function buildSpecs(
  input: string,
  deps: ResolveDeps,
): Promise<{ specs: ReadSpec[]; truncated: boolean; resolved: number; invalid: number }> {
  const maxCh = deps.maxChapters ?? DEFAULT_MAX_CHAPTERS;
  const items = parsePassageQuery(input);
  const specs: ReadSpec[] = [];
  let truncated = false;
  let resolved = 0;
  let invalid = 0;

  const addAll = (arr: ReadSpec[]): boolean => {
    let any = false;
    for (const s of arr) {
      if (specs.length >= maxCh) {
        truncated = true;
        break;
      }
      specs.push(s);
      any = true;
    }
    return any;
  };

  for (const item of items) {
    if (specs.length >= maxCh) {
      truncated = true;
      break;
    }
    if (item.kind === 'ref') {
      let ref: Reference;
      try {
        ref = await deps.parseReference(item.text);
      } catch {
        invalid++;
        continue;
      }
      if (addAll([specFromRef(ref)])) resolved++;
    } else if (item.kind === 'chapterRange') {
      const b = await resolveBook(item.book, deps);
      if (b == null || item.from < 1 || item.to < item.from) {
        invalid++;
        continue;
      }
      const arr: ReadSpec[] = [];
      for (let ch = item.from; ch <= item.to; ch++) arr.push({ book: b, chapter: ch });
      if (addAll(arr)) resolved++;
    } else if (item.kind === 'crossChapter') {
      const b = await resolveBook(item.book, deps);
      if (b == null || item.fromCh < 1 || item.toCh < item.fromCh) {
        invalid++;
        continue;
      }
      const arr: ReadSpec[] = [];
      if (item.fromCh === item.toCh) {
        arr.push({ book: b, chapter: item.fromCh, from: item.fromV, to: item.toV });
      } else {
        arr.push({ book: b, chapter: item.fromCh, from: item.fromV });
        for (let ch = item.fromCh + 1; ch < item.toCh; ch++) arr.push({ book: b, chapter: ch });
        arr.push({ book: b, chapter: item.toCh, to: item.toV });
      }
      if (addAll(arr)) resolved++;
    } else if (item.kind === 'bookRange') {
      const a = await resolveBook(item.fromBook, deps);
      const z = await resolveBook(item.toBook, deps);
      if (a == null || z == null) {
        invalid++;
        continue;
      }
      const lo = Math.min(a, z);
      const hi = Math.max(a, z);
      const arr: ReadSpec[] = [];
      for (let bk = lo; bk <= hi; bk++) {
        for (let ch = 1; ch <= deps.chapterCountOf(bk); ch++) arr.push({ book: bk, chapter: ch });
      }
      if (addAll(arr)) resolved++;
    } else if (item.kind === 'wholeBook') {
      const b = await resolveBook(item.book, deps);
      if (b == null) {
        invalid++;
        continue;
      }
      const arr: ReadSpec[] = [];
      for (let ch = 1; ch <= deps.chapterCountOf(b); ch++) arr.push({ book: b, chapter: ch });
      if (addAll(arr)) resolved++;
    } else {
      invalid++;
    }
  }
  return { specs, truncated, resolved, invalid };
}

/**
 * Resolve a consulta (ranges + listas) em TRECHOS legíveis, respeitando os tetos de capítulos e
 * versos (marca `truncated` além deles). `getChapter` é MEMOIZADO por (livro,capítulo).
 */
export async function resolvePassageQuery(input: string, deps: ResolveDeps): Promise<PassageResult> {
  const maxV = deps.maxVerses ?? DEFAULT_MAX_VERSES;
  const built = await buildSpecs(input, deps);
  const specList = built.specs;
  let truncated = built.truncated;

  const chapCache = new Map<string, Promise<Passage>>();
  const getCh = (book: number, chapter: number): Promise<Passage> => {
    const key = `${book}-${chapter}`;
    let p = chapCache.get(key);
    if (!p) {
      p = deps.getChapter(book, chapter);
      chapCache.set(key, p);
    }
    return p;
  };

  const segments: Segment[] = [];
  let verseCount = 0;
  for (let i = 0; i < specList.length; i++) {
    const spec = specList[i];
    let passage: Passage;
    try {
      passage = await getCh(spec.book, spec.chapter);
    } catch {
      continue;
    }
    const all = passage.verses;
    const filtered = all.filter((v) => {
      const n = verseNum(v);
      if (n == null) return false;
      if (spec.from != null && n < spec.from) return false;
      if (spec.to != null && n > spec.to) return false;
      return true;
    });
    if (filtered.length === 0) continue;

    let shown = filtered;
    if (verseCount + filtered.length > maxV) {
      shown = filtered.slice(0, Math.max(0, maxV - verseCount));
      truncated = true;
    }
    if (shown.length > 0) {
      verseCount += shown.length;
      segments.push({ label: labelFor(spec, all, shown, deps), verses: shown });
    }
    if (verseCount >= maxV) {
      if (i < specList.length - 1) truncated = true;
      break;
    }
  }

  return { segments, verseCount, truncated, resolved: built.resolved, invalid: built.invalid };
}
