// i18n.test.mjs — F5.2 (ADR-0038; molde keystore.test.mjs)
//
// PROVA HEADLESS (node, SEM device/browser, SEM rede) da camada de i18n de CROMO de UI
// (PT/EN) + do KV de prefs OFFLINE. Bundla (esbuild) `app/lib/i18n.ts` + `app/lib/prefs.ts`
// (com um `PrefsBackend` FAKE em memória injetado) e asseveram-se, de forma determinística:
//   1) PARIDADE de catálogo: todo `MessageKey` existe em `pt` E `en`, sem chave órfã dos
//      dois lados (contagem e conjuntos idênticos);
//   2) `translate()`: valores esperados em PT/EN (incl. uma chave que DIVERGE entre os
//      idiomas, provando a troca real) + interpolação de `{param}`;
//   3) ROUND-TRIP de persistência: `setPref`→`getPref` sobre backend em memória; a
//      escolha SOBREVIVE a uma nova instância de `Prefs` sobre o MESMO storage (simula
//      reabrir o app) e re-hidrata via `normalizeLocale`; `removePref` volta ao default;
//   4) DETECÇÃO/FALLBACK offline: `normalizeLocale` 'pt-BR'→'pt','en-US'→'en',
//      desconhecido/vazio→'pt'; `detectDeviceLocale()` devolve um Locale válido (sem rede);
//   5) ANTI-ALUCINAÇÃO (estrutural): TODA chave de mensagem é CROMO de UI (namespaces
//      home/search/nav/read/plans/ref/a11y/language/theme) — nenhuma de "versículo"/"tradução";
//   6) HIGIENE: `i18n.ts`/`prefs.ts`/`prefs.web.ts` não contêm `console.*` (prefs nunca loga).
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'i18n-headless-entry.ts');
const I18N_TS = join(__dirname, '..', '..', 'lib', 'i18n.ts');
const PREFS_TS = join(__dirname, '..', '..', 'lib', 'prefs.ts');
const PREFS_WEB_TS = join(__dirname, '..', '..', 'lib', 'prefs.web.ts');

async function loadBundle() {
  const outfile = join(tmpdir(), `i18n-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    // O backend padrão do prefs importa `expo-file-system` de forma lazy; a prova injeta
    // um fake em memória e nunca o aciona — mantê-lo EXTERNAL evita puxar o módulo nativo.
    external: ['expo-file-system', 'expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

// Backend FAKE de prefs em memória (subconjunto get/set/remove). Espelha o storage.
function makeMemBackend() {
  const store = new Map();
  return {
    store,
    async getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
  };
}

async function main() {
  const {
    CATALOGS,
    LOCALES,
    MESSAGE_KEYS,
    LOCALE_PREF_KEY,
    isLocale,
    normalizeLocale,
    detectDeviceLocale,
    translate,
    createPrefs,
    prefIdFor,
  } = await loadBundle();

  // ══ (1) PARIDADE DE CATÁLOGO — pt ↔ en, sem chave órfã dos dois lados ══════════════════
  assert.deepEqual([...LOCALES], ['pt', 'en'], 'LOCALES = [pt, en]');
  const ptKeys = Object.keys(CATALOGS.pt).sort();
  const enKeys = Object.keys(CATALOGS.en).sort();
  assert.deepEqual(ptKeys, enKeys, 'pt e en têm EXATAMENTE o mesmo conjunto de chaves (sem órfã)');
  assert.deepEqual(
    [...MESSAGE_KEYS].sort(),
    ptKeys,
    'MESSAGE_KEYS reflete o catálogo (sem chave a mais/menos)',
  );
  for (const key of MESSAGE_KEYS) {
    assert.ok(key in CATALOGS.pt, `chave "${key}" existe em pt`);
    assert.ok(key in CATALOGS.en, `chave "${key}" existe em en`);
    assert.ok(
      typeof CATALOGS.pt[key] === 'string' && CATALOGS.pt[key].length > 0,
      `pt["${key}"] é string não-vazia`,
    );
    assert.ok(
      typeof CATALOGS.en[key] === 'string' && CATALOGS.en[key].length > 0,
      `en["${key}"] é string não-vazia`,
    );
  }

  // ══ (2) translate() — valores esperados, divergência real PT≠EN, interpolação ══════════
  assert.equal(translate('pt', 'home.title'), 'The Light', 'pt home.title (marca)');
  assert.equal(translate('en', 'home.title'), 'The Light', 'en home.title (marca, igual)');
  // Chave que DIVERGE entre idiomas → prova a troca de fato re-renderiza texto diferente.
  assert.equal(translate('pt', 'home.readBible'), 'Ler a Bíblia', 'pt home.readBible');
  assert.equal(translate('en', 'home.readBible'), 'Read the Bible', 'en home.readBible');
  assert.notEqual(
    translate('pt', 'home.readBible'),
    translate('en', 'home.readBible'),
    'home.readBible DIFERE entre pt e en (troca de idioma é observável)',
  );
  assert.equal(
    translate('pt', 'home.resultPlaceholder'),
    'O resultado aparecerá aqui.',
    'pt home.resultPlaceholder',
  );
  assert.equal(
    translate('en', 'home.resultPlaceholder'),
    'The result will appear here.',
    'en home.resultPlaceholder',
  );
  // Interpolação de {param}.
  assert.equal(
    translate('pt', 'home.resolveError', { message: 'entrada X' }),
    'Não foi possível resolver: entrada X',
    'pt home.resolveError interpola {message}',
  );
  assert.equal(
    translate('en', 'home.resolveError', { message: 'input X' }),
    'Could not resolve: input X',
    'en home.resolveError interpola {message}',
  );
  // ── F5.5: PROVA de que strings do FLUXO DE LEITURA trocam de idioma ──────────────────
  // Título de header (nav.read) e rótulo da tela de leitura (read.parallel) DIVERGEM
  // PT≠EN → alternar o idioma re-renderiza o cromo do fluxo de leitura de fato.
  assert.equal(translate('pt', 'nav.read'), 'Ler a Bíblia', 'pt nav.read');
  assert.equal(translate('en', 'nav.read'), 'Read the Bible', 'en nav.read');
  assert.notEqual(
    translate('pt', 'nav.read'),
    translate('en', 'nav.read'),
    'nav.read DIFERE entre pt e en (título de header do fluxo de leitura é reativo)',
  );
  assert.equal(translate('pt', 'read.parallel'), 'Lado a lado', 'pt read.parallel');
  assert.equal(translate('en', 'read.parallel'), 'Side by side', 'en read.parallel');
  assert.notEqual(
    translate('pt', 'read.parallel'),
    translate('en', 'read.parallel'),
    'read.parallel DIFERE entre pt e en (rótulo da tela de leitura é reativo)',
  );
  // nav.home é a MARCA → idêntica nos dois idiomas (proposital).
  assert.equal(translate('pt', 'nav.home'), 'The Light', 'pt nav.home (marca)');
  assert.equal(translate('en', 'nav.home'), 'The Light', 'en nav.home (marca, igual)');
  // Fallback de livro AUSENTE do store é CROMO com {number} interpolado (o nome REAL do
  // livro vem do store/core, nunca daqui — anti-alucinação).
  assert.equal(
    translate('pt', 'read.bookFallback', { number: 5 }),
    'Livro 5',
    'pt read.bookFallback interpola {number}',
  );
  assert.equal(
    translate('en', 'read.bookFallback', { number: 5 }),
    'Book 5',
    'en read.bookFallback interpola {number}',
  );
  // ── F5.8: PROVA de que o CROMO da BUSCA + navegação troca de idioma ──────────────────
  // Placeholder da busca DIVERGE PT≠EN → alternar idioma re-renderiza o cromo da busca.
  assert.equal(
    translate('pt', 'search.inputPlaceholder'),
    'Buscar na Bíblia (ex.: God, amor, light)',
    'pt search.inputPlaceholder',
  );
  assert.equal(
    translate('en', 'search.inputPlaceholder'),
    'Search the Bible (e.g., God, love, light)',
    'en search.inputPlaceholder',
  );
  assert.notEqual(
    translate('pt', 'search.inputPlaceholder'),
    translate('en', 'search.inputPlaceholder'),
    'search.inputPlaceholder DIFERE entre pt e en (cromo da busca é reativo ao idioma)',
  );
  // `search.noResults` interpola o TERMO do usuário (dado dele) — traduzido é só o cromo à
  // volta; o `{term}` entra VERBATIM (aqui provamos com um termo arbitrário).
  assert.equal(
    translate('pt', 'search.noResults', { term: 'graça' }),
    'Nenhum resultado para “graça”.',
    'pt search.noResults interpola o {term} do usuário',
  );
  assert.equal(
    translate('en', 'search.noResults', { term: 'grace' }),
    'No results for “grace”.',
    'en search.noResults interpola o {term} do usuário',
  );
  // A11Y de navegação: rótulo de gesto com o NOME do livro (vem do store; aqui só provamos a
  // interpolação do cromo) e do CAPÍTULO (número, dado) — DIVERGEM PT≠EN.
  assert.equal(
    translate('pt', 'a11y.openBook', { name: 'Gênesis' }),
    'Abrir o livro Gênesis',
    'pt a11y.openBook interpola {name} (nome do livro vem do store)',
  );
  assert.equal(
    translate('en', 'a11y.openBook', { name: 'Genesis' }),
    'Open the Genesis book',
    'en a11y.openBook interpola {name} (nome do livro vem do store)',
  );
  assert.notEqual(
    translate('pt', 'a11y.openChapter', { chapter: 3 }),
    translate('en', 'a11y.openChapter', { chapter: 3 }),
    'a11y.openChapter DIFERE entre pt e en (rótulo de navegação reativo)',
  );

  // ── F5.11: PROVA de que o CROMO dos PAINÉIS DE IA troca de idioma ────────────────────
  // Botões/títulos dos painéis (Ask/Study/Compare) DIVERGEM PT≠EN → alternar o idioma
  // re-renderiza o cromo dos painéis de IA de fato. O `citedText`/`interpretation`/
  // `reference`/atribuições NÃO passam por aqui (nenhuma chave de conteúdo bíblico).
  assert.equal(translate('pt', 'ask.submit'), 'Perguntar', 'pt ask.submit');
  assert.equal(translate('en', 'ask.submit'), 'Ask', 'en ask.submit');
  assert.notEqual(
    translate('pt', 'ask.submit'),
    translate('en', 'ask.submit'),
    'ask.submit DIFERE entre pt e en (botão do painel de IA é reativo ao idioma)',
  );
  assert.equal(translate('pt', 'study.submit'), 'Estudar', 'pt study.submit');
  assert.equal(translate('en', 'study.submit'), 'Study', 'en study.submit');
  assert.notEqual(
    translate('pt', 'study.submit'),
    translate('en', 'study.submit'),
    'study.submit DIFERE entre pt e en',
  );
  assert.notEqual(
    translate('pt', 'ai.interpTitle'),
    translate('en', 'ai.interpTitle'),
    'ai.interpTitle DIFERE entre pt e en (rótulo "Interpretação (IA)" reativo)',
  );
  // Interpolação do CROMO com DADOS que entram VERBATIM (nunca traduzidos): `{source}` (rótulo da
  // passagem, do store), `{count}` (nº de colunas), `{provider}`/`{model}` (ids técnicos do retorno).
  assert.equal(
    translate('pt', 'ask.title', { source: 'João 3:16' }),
    'Perguntar · João 3:16',
    'pt ask.title interpola {source} VERBATIM (nome do livro vem do store, não de t())',
  );
  assert.equal(
    translate('en', 'ask.title', { source: 'John 3:16' }),
    'Ask · John 3:16',
    'en ask.title interpola {source} VERBATIM (âncora canônica EN preservada)',
  );
  assert.equal(
    translate('pt', 'compare.consistencyOk', { count: 3 }),
    '✓ Mesma passagem do acervo em todas as 3 colunas',
    'pt compare.consistencyOk interpola {count}',
  );
  assert.notEqual(
    translate('pt', 'compare.consistencyOk', { count: 3 }),
    translate('en', 'compare.consistencyOk', { count: 3 }),
    'compare.consistencyOk DIFERE entre pt e en (com o mesmo {count})',
  );
  assert.equal(
    translate('en', 'ai.meta', { provider: 'anthropic', model: 'claude-x' }),
    'Provider: anthropic · Model: claude-x',
    'ai.meta interpola provider/model (ids técnicos do retorno) VERBATIM',
  );
  // O identificador de provedor/idioma-neutro fica IGUAL nos dois idiomas (marca/acrônimo).
  assert.equal(translate('pt', 'compare.byokBadge'), '· BYOK', 'pt compare.byokBadge (acrônimo)');
  assert.equal(translate('en', 'compare.byokBadge'), '· BYOK', 'en compare.byokBadge (idêntico)');

  // ── F5.16: PROVA de que o CROMO dos componentes de leitura RESTANTES troca de idioma ──
  // Botões/seções/a11y dos painéis por-versículo e de xref (verse/xref/common) DIVERGEM
  // PT≠EN → alternar o idioma re-renderiza esse cromo de fato. O `{source}` (rótulo da
  // passagem, do store), o `{count}` (nº de votos, dado) e o `{color}` (rótulo da paleta,
  // dado da app) só INTERPOLAM — nunca são traduzidos; a atribuição CC-BY é verbatim (nunca
  // via t()); o TEXTO do versículo e os NOMES de livro vêm do store, não daqui.
  assert.equal(translate('pt', 'common.close'), 'Fechar', 'pt common.close');
  assert.equal(translate('en', 'common.close'), 'Close', 'en common.close');
  assert.notEqual(
    translate('pt', 'common.close'),
    translate('en', 'common.close'),
    'common.close DIFERE entre pt e en (botão Fechar reativo ao idioma)',
  );
  assert.equal(translate('pt', 'versePanel.saveNote'), 'Salvar nota', 'pt verse.saveNote');
  assert.equal(translate('en', 'versePanel.saveNote'), 'Save note', 'en verse.saveNote');
  assert.notEqual(
    translate('pt', 'versePanel.saveNote'),
    translate('en', 'versePanel.saveNote'),
    'versePanel.saveNote DIFERE entre pt e en (botão do painel por-versículo reativo)',
  );
  // `xref.title` interpola o {source} (rótulo da passagem, do store) VERBATIM; o cromo à
  // volta ("Referências cruzadas — ") DIVERGE PT≠EN.
  assert.equal(
    translate('pt', 'xref.title', { source: 'João 3:16' }),
    'Referências cruzadas — João 3:16',
    'pt xref.title interpola {source} VERBATIM (nome do livro vem do store, não de t())',
  );
  assert.equal(
    translate('en', 'xref.title', { source: 'John 3:16' }),
    'Cross references — John 3:16',
    'en xref.title interpola {source} VERBATIM',
  );
  assert.notEqual(
    translate('pt', 'xref.title', { source: 'X 1:1' }),
    translate('en', 'xref.title', { source: 'X 1:1' }),
    'xref.title DIFERE entre pt e en (com o mesmo {source})',
  );
  // `xref.votes` interpola o {count} (nº de votos, dado da fronteira) — só o rótulo é cromo.
  assert.equal(
    translate('pt', 'xref.votes', { count: 12 }),
    '12 votos',
    'pt xref.votes interpola o {count} (dado)',
  );
  assert.equal(
    translate('en', 'xref.votes', { count: 12 }),
    '12 votes',
    'en xref.votes interpola o {count} (dado)',
  );
  // `verse.highlightWith` interpola o {color} (rótulo da paleta de marcação, dado da app —
  // não texto bíblico); o cromo à volta ("Marcar com ") DIVERGE PT≠EN.
  assert.notEqual(
    translate('pt', 'versePanel.highlightWith', { color: 'Amarelo' }),
    translate('en', 'versePanel.highlightWith', { color: 'Amarelo' }),
    'versePanel.highlightWith DIFERE entre pt e en (com o mesmo {color})',
  );
  // ── F5.28: nomes de EXIBIÇÃO das cores de destaque via t() (não mais hardcoded em PT) ──
  // Antes, o `label` PT ('Amarelo') era a fonte do a11y do swatch → EN anunciava "Highlight
  // with Amarelo". Agora o swatch resolve o nome via `t(`highlight.${name}`)`, então cada
  // idioma traduz o nome da cor. `name` (yellow/green/…) é dado do usuário; só o rótulo passa.
  assert.equal(translate('pt', 'highlight.yellow'), 'Amarelo', 'pt highlight.yellow');
  assert.equal(translate('en', 'highlight.yellow'), 'Yellow', 'en highlight.yellow');
  assert.equal(translate('pt', 'highlight.green'), 'Verde', 'pt highlight.green');
  assert.equal(translate('en', 'highlight.green'), 'Green', 'en highlight.green');
  assert.equal(translate('pt', 'highlight.blue'), 'Azul', 'pt highlight.blue');
  assert.equal(translate('en', 'highlight.blue'), 'Blue', 'en highlight.blue');
  assert.equal(translate('pt', 'highlight.pink'), 'Rosa', 'pt highlight.pink');
  assert.equal(translate('en', 'highlight.pink'), 'Pink', 'en highlight.pink');
  // COMPOSIÇÃO REAL do a11y do swatch (como ReaderVersePanel monta): o nome da cor entra
  // como {color} já traduzido → EN diz "Highlight with Yellow", PT "Marcar com Amarelo".
  assert.equal(
    translate('en', 'versePanel.highlightWith', { color: translate('en', 'highlight.yellow') }),
    'Highlight with Yellow',
    'en: leitor de tela anuncia "Highlight with Yellow" (não "Amarelo")',
  );
  assert.equal(
    translate('pt', 'versePanel.highlightWith', { color: translate('pt', 'highlight.yellow') }),
    'Marcar com Amarelo',
    'pt: segue "Marcar com Amarelo"',
  );

  // Sem params, o placeholder de interpolação fica intacto (não quebra).
  assert.ok(
    translate('pt', 'home.resolveError').includes('{message}'),
    'sem params, translate mantém o placeholder literal (nunca lança)',
  );

  // ══ (3) ROUND-TRIP de persistência OFFLINE + re-hidratação (reabrir o app) ══════════════
  const backend = makeMemBackend();
  const prefs = createPrefs(backend);

  assert.equal(await prefs.getPref(LOCALE_PREF_KEY), null, 'sem preferência salva no início');
  await prefs.setPref(LOCALE_PREF_KEY, 'en');
  assert.equal(await prefs.getPref(LOCALE_PREF_KEY), 'en', 'getPref devolve o idioma salvo');
  // O storage guarda sob a chave NAMESPACEADA (nunca a chave crua).
  assert.equal(prefIdFor(LOCALE_PREF_KEY), 'tla.pref.ui.locale', 'prefIdFor namespaceia a chave');
  assert.ok(backend.store.has('tla.pref.ui.locale'), 'valor gravado sob a chave namespaceada');
  assert.ok(!backend.store.has(LOCALE_PREF_KEY), 'a chave CRUA não é usada no storage');

  // Simula REABRIR o app: uma NOVA instância de Prefs sobre o MESMO storage lê a escolha.
  const prefsReopened = createPrefs(backend);
  const saved = await prefsReopened.getPref(LOCALE_PREF_KEY);
  assert.equal(saved, 'en', 'a escolha SOBREVIVE a uma nova instância (reabrir o app)');
  // E re-hidrata para um Locale válido via normalizeLocale (o que o I18nProvider faz no boot).
  assert.ok(isLocale(saved), 'o valor salvo é um Locale válido');
  assert.equal(normalizeLocale(saved), 'en', 're-hidratação: idioma efetivo = en');

  // removePref volta ao default (segue o device).
  await prefs.removePref(LOCALE_PREF_KEY);
  assert.equal(await prefs.getPref(LOCALE_PREF_KEY), null, 'removePref limpa a preferência');
  assert.ok(!backend.store.has('tla.pref.ui.locale'), 'storage sem a entrada após remove');

  // ══ (4) DETECÇÃO / FALLBACK offline (sem rede) ═════════════════════════════════════════
  assert.equal(normalizeLocale('pt-BR'), 'pt', "'pt-BR' → 'pt'");
  assert.equal(normalizeLocale('en-US'), 'en', "'en-US' → 'en'");
  assert.equal(normalizeLocale('PT'), 'pt', "'PT' (maiúsculo) → 'pt'");
  assert.equal(normalizeLocale('en'), 'en', "'en' → 'en'");
  assert.equal(normalizeLocale('fr-FR'), 'pt', "desconhecido 'fr-FR' → 'pt' (default)");
  assert.equal(normalizeLocale(''), 'pt', "'' → 'pt' (default)");
  assert.equal(normalizeLocale(undefined), 'pt', 'undefined → pt (default)');
  const detected = detectDeviceLocale();
  assert.ok(isLocale(detected), `detectDeviceLocale() devolve um Locale válido (veio: ${detected})`);

  // ══ (5) ANTI-ALUCINAÇÃO estrutural: TODA chave é CROMO de UI (nenhum "versículo") ══════
  // F5.5 estendeu o cromo ao fluxo de leitura: `nav.*` (títulos de header do expo-router),
  // `read.*` (rótulos das telas read/*) e `theme.*` (a11y do toggle de tema). F5.7 acrescenta
  // `plans.*` (cromo da tela de planos: títulos, botões, contadores, estados). F5.8 acrescenta
  // `search.*` (cromo da BUSCA: placeholder, dicas, sem-resultado) — o TEXTO/refs de RESULTADO
  // vêm VERBATIM do store, nunca de `t()`; o `{term}` é o dado digitado pelo usuário. F5.11
  // acrescenta `ai.*`/`ask.*`/`chat.*`/`compare.*`/`study.*` (cromo dos 4 painéis de IA:
  // rótulos, botões, estados, dicas) — o `citedText`/versículo (store), a `interpretation`
  // (modelo, já em `lang={locale}`), a `reference` canônica EN e as atribuições STEP CC-BY
  // NÃO passam por `t()`; só INTERPOLAM como `{source}`/`{provider}`/`{model}`/`{count}` (dados).
  // Nenhuma dessas é texto bíblico/versão — nomes de livro/plano e rótulos de dia vêm do store/core.
  const CHROME_NAMESPACES = new Set([
    'home',
    'search',
    'nav',
    'read',
    'reading',
    'plans',
    'ref',
    'a11y',
    'language',
    'theme',
    'ai',
    'ask',
    'chat',
    'compare',
    'study',
    // F5.16: cromo dos componentes de leitura restantes (verse/xref panels) + `common`.
    // `versePanel` (não `verse`) para NÃO colidir com o guard anti-alucinação `^verse\b`.
    'common',
    'versePanel',
    'xref',
    // F5.28: nomes de EXIBIÇÃO das cores da paleta de marcação (highlight.yellow/green/…).
    // CROMO puro (Amarelo/Yellow …) — não texto bíblico; a `name` (yellow) é dado do usuário.
    'highlight',
    // F5.26 (ADR-0054): cromo da sincronização opt-in + backup (privacidade / offline-first).
    'sync',
    // F5.35: cromo da tela SOBRE / créditos / licenças (fontes, princípios, provedores) + os
    // DOIS identificadores de licença CC-BY VERBATIM (idênticos pt/en). Nenhum texto bíblico.
    'about',
    // F6.3: cromo do gate do wasm da fronteira (WasmGate) — mensagem de erro de init + rótulo
    // do botão de retry. Só CROMO (nenhum texto bíblico).
    'wasm',
    // F6.6: cromo da tela de AJUSTES / chaves BYOK — título, rótulos por-provedor, salvar/
    // remover, status (só-nomes) e o aviso web-só-sessão (ADR-0025). Nenhuma chave/valor.
    'settings',
  ]);
  for (const key of MESSAGE_KEYS) {
    const ns = key.split('.')[0];
    assert.ok(
      CHROME_NAMESPACES.has(ns),
      `chave "${key}" está num namespace de CROMO (${[...CHROME_NAMESPACES].join('/')})`,
    );
    assert.ok(
      !/^(verse|scripture|translation|bible)\b/i.test(key),
      `nenhuma chave de conteúdo bíblico ("${key}") — i18n só traduz UI`,
    );
  }

  // ══ (6) HIGIENE de log: prefs/i18n não contêm `console.*` ══════════════════════════════
  const i18nSrc = await readFile(I18N_TS, 'utf8');
  const prefsSrc = await readFile(PREFS_TS, 'utf8');
  const prefsWebSrc = await readFile(PREFS_WEB_TS, 'utf8');
  assert.ok(!/console\./.test(i18nSrc), 'i18n.ts sem `console.*`');
  assert.ok(!/console\./.test(prefsSrc), 'prefs.ts sem `console.*` (preferência nunca logada)');
  assert.ok(!/console\./.test(prefsWebSrc), 'prefs.web.ts sem `console.*`');

  console.log('PASS — i18n de CROMO (PT/EN) + KV de prefs OFFLINE (backend fake, sem device/rede):');
  console.log(`  paridade de catálogo pt↔en: ${MESSAGE_KEYS.length} chaves, mesmos conjuntos (sem órfã)`);
  console.log('  translate(): PT/EN corretos; home.readBible DIVERGE (troca observável); interpola {message}');
  console.log('  fluxo de leitura (F5.5): nav.read/read.parallel DIVERGEM PT≠EN; read.bookFallback interpola {number}');
  console.log('  busca + navegação (F5.8): search.inputPlaceholder/a11y.openChapter DIVERGEM PT≠EN; search.noResults/a11y.openBook interpolam {term}/{name} (dados do store/usuário)');
  console.log('  painéis de IA (F5.11): ask.submit/study.submit/ai.interpTitle DIVERGEM PT≠EN; ask.title/ai.meta/compare.consistencyOk interpolam {source}/{provider}/{model}/{count} VERBATIM (citedText/interpretation/reference/CC-BY nunca via t())');
  console.log('  componentes de leitura restantes (F5.16): common.close/verse.saveNote/xref.title DIVERGEM PT≠EN; xref.title/xref.votes/verse.highlightWith interpolam {source}/{count}/{color} VERBATIM (texto do versículo/nomes de livro do store, CC-BY verbatim, nunca via t())');
  console.log('  persistência: setPref→getPref; SOBREVIVE a nova instância (reabrir); removePref volta ao default');
  console.log("  detecção offline: 'pt-BR'→pt, 'en-US'→en, desconhecido/''→pt; detectDeviceLocale() válido");
  console.log(`  anti-alucinação: todas as ${MESSAGE_KEYS.length} chaves são CROMO (home/search/nav/read/plans/ref/a11y/language/theme); nenhuma de versículo`);
  console.log('  higiene: i18n.ts / prefs.ts / prefs.web.ts sem console.* (prefs nunca loga)');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
