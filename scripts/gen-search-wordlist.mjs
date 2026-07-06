// scripts/gen-search-wordlist.mjs — ADR-0064 Fase B (autocomplete de termo do corpus)
//
// Deriva, POR IDIOMA, a lista de palavras de conteúdo do corpus (a partir de `verses.text` do
// store) para o AUTOCOMPLETE de termo por PREFIXO ("eter" → eternamente, eternidade…). Emite um
// asset compacto ORDENADO pela forma DOBRADA (acento/caixa-insensível) para busca binária no
// runtime (`app/lib/searchWordlistIndex.ts`). Determinístico/reproduzível — molde dos gen-*.sh.
//
// Fonte: `assets/data/reading-lite.sqlite` (verses das duas traduções). Idioma ↔ tradução:
// pt→alm1911, en→kjv. NÃO toca o core nem o espelho parity-locked: é dado app derivado offline
// (ferramenta de busca — não texto bíblico exibido; anti-alucinação não se aplica ao índice).
//
// Uso: node scripts/gen-search-wordlist.mjs [caminho-do-db]
//   → escreve app/assets/data/wordlist.pt.json e wordlist.en.json
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..', 'app');
const DB = process.argv[2] ?? join(APP, 'assets', 'data', 'reading-lite.sqlite');
const OUT_DIR = join(APP, 'assets', 'data');

const TRANSLATIONS = [
  { id: 'alm1911', lang: 'pt' },
  { id: 'kjv', lang: 'en' },
];

// Conectivas ≥3 letras (PT+EN) a excluir do autocomplete (as <3 já caem pela regra de tamanho).
// Espelha o espírito de `app/lib/searchStopwords.ts` (duplicado de propósito: script de build).
const STOPWORDS = new Set([
  'dos', 'das', 'nos', 'nas', 'para', 'por', 'com', 'que', 'seu', 'sua', 'seus', 'suas', 'meu',
  'este', 'esta', 'esse', 'essa', 'sao', 'foi', 'uma', 'uns', 'umas', 'aos', 'como', 'mas', 'seja',
  'the', 'and', 'for', 'with', 'that', 'are', 'was', 'were', 'from', 'not', 'his', 'her', 'you',
  'your', 'them', 'they', 'thou', 'thee', 'thy', 'hath', 'shall', 'unto', 'this',
]);

const MIN_LEN = 3;

/** Minúsculas + sem acento — IDÊNTICO a `searchNormalize.fold` (para casar o runtime). */
function fold(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function buildForTranslation(id) {
  const raw = execFileSync(
    'sqlite3',
    [DB, `SELECT text FROM verses WHERE translation_id='${id}';`],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  // key(dobrada) → { freq total, surfaces: Map<display, count> } — display = token minúsculo (com acento).
  const byKey = new Map();
  for (const tok of raw.split(/[^\p{L}]+/u)) {
    if (tok.length < MIN_LEN) continue;
    const display = tok.toLowerCase();
    const key = fold(display);
    if (key.length < MIN_LEN || STOPWORDS.has(key)) continue;
    let e = byKey.get(key);
    if (!e) {
      e = { freq: 0, surfaces: new Map() };
      byKey.set(key, e);
    }
    e.freq++;
    e.surfaces.set(display, (e.surfaces.get(display) ?? 0) + 1);
  }
  // Para cada key: display CANÔNICO = a superfície mais frequente (resolve "esta"/"está").
  const entries = [];
  for (const [key, e] of byKey) {
    let best = '';
    let bestC = -1;
    for (const [d, c] of e.surfaces) {
      if (c > bestC) {
        best = d;
        bestC = c;
      }
    }
    entries.push([key, best, e.freq]);
  }
  // Ordena pela KEY dobrada (busca binária de prefixo no runtime).
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // Asset final: [display, freq] (a key é re-derivável por fold no load; economiza bytes).
  return entries.map(([, display, freq]) => [display, freq]);
}

for (const { id, lang } of TRANSLATIONS) {
  const words = buildForTranslation(id);
  const out = { lang, translation: id, count: words.length, words };
  const path = join(OUT_DIR, `wordlist.${lang}.json`);
  writeFileSync(path, JSON.stringify(out));
  process.stdout.write(`wordlist.${lang}.json — ${words.length} palavras (${id})\n`);
}
