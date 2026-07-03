// app/lib/i18n.ts — F5.2 (ADR-0038)
//
// Camada de INTERNACIONALIZAÇÃO do CROMO da UI (PT/EN), dependency-free (molde do
// `theme.ts`, ADR-0015: `.ts` puro com `createElement`, SEM biblioteca nova). Expõe
// catálogos tipados `pt`/`en`, uma função pura `translate(locale, key, params?)`, e
// um `I18nProvider`/`useI18n()` com `{ locale, t, setLocale, isSystem }`.
//
// ANTI-ALUCINAÇÃO (LEI): esta camada traduz APENAS texto de INTERFACE (títulos,
// rótulos, dicas, mensagens de erro da UI). NUNCA traduz TEXTO BÍBLICO nem
// referências: o texto de versículo vem sempre VERBATIM do store local (Rust) e
// nunca passa por `t()`. Atribuições/licenças (CC-BY OpenBible/STEP) também não são
// tocadas aqui.
//
// DISTINÇÃO DE CONCEITOS (proposital): `locale`/`language` = idioma da INTERFACE
// (isto aqui). `translation` = VERSÃO bíblica (KJV/…): conceito SEPARADO, tratado
// no store/fronteira. Este módulo NÃO usa o nome `translation` para não colidir.
//
// OFFLINE-FIRST: a detecção do idioma do device e a persistência da escolha são
// 100% locais (sem rede/conta). A escolha persiste via `prefs` (arquivo nativo /
// localStorage web); no boot, o override salvo re-hidrata a UI.
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getPref, removePref, setPref } from './prefs';

/** Idioma da INTERFACE. NÃO confundir com `translation` (versão bíblica). */
export type Locale = 'pt' | 'en';

/** Idiomas suportados pela UI, em ordem canônica. */
export const LOCALES: readonly Locale[] = ['pt', 'en'] as const;

/** Chave da preferência OFFLINE onde o idioma escolhido é persistido. */
export const LOCALE_PREF_KEY = 'ui.locale';

/**
 * Chaves de mensagem tipadas (union). Como AMBOS os catálogos são
 * `Record<MessageKey, string>`, o TypeScript EXIGE que toda chave exista em `pt` E
 * `en` (paridade garantida em tempo de compilação; o teste headless confere em runtime).
 */
export type MessageKey =
  | 'home.title'
  | 'home.resultPlaceholder'
  | 'home.inputPlaceholder'
  | 'home.hint'
  | 'home.readBible'
  | 'home.searchBible'
  | 'home.readingPlans'
  | 'home.resolveError'
  | 'home.verseNotFound'
  // CROMO da tela de BUSCA (F5.8). O texto/refs de RESULTADO vêm SEMPRE do store (verbatim,
  // via `search`), NUNCA de `t()` (anti-alucinação); o `{term}` de `search.noResults` é o
  // TERMO digitado pelo usuário (dado dele), só INTERPOLADO no cromo — não traduzido.
  | 'search.inputPlaceholder'
  | 'search.hintEmpty'
  | 'search.noResults'
  // Rótulo do SELETOR DE TRADUÇÃO da busca (F5.31). CROMO puro: só o rótulo "Tradução"
  // passa por t(); os NOMES/abreviações das versões vêm do STORE (`listTranslations`),
  // nunca de t() (anti-alucinação), e o texto/ref de resultado seguem VERBATIM do store.
  | 'search.translationLabel'
  // Títulos de header do expo-router (fluxo de leitura + busca + planos). "The Light"
  // é a MARCA — idêntica nos dois idiomas de propósito.
  | 'nav.home'
  | 'nav.read'
  | 'nav.chapters'
  | 'nav.reading'
  | 'nav.search'
  | 'nav.plans'
  // CROMO da tela de PLANOS de leitura (F5.7). Os NOMES dos planos e os RÓTULOS de dia
  // vêm SEMPRE do core (CATALOG/`reading_plan_day`), NUNCA de `t()` (anti-alucinação);
  // aqui só o cromo (títulos, botões, contadores, estados) é traduzível.
  | 'plans.chooseTitle'
  | 'plans.dayCount'
  | 'plans.start'
  | 'plans.progress'
  | 'plans.streak'
  | 'plans.today'
  | 'plans.dayLabel'
  | 'plans.markDone'
  | 'plans.change'
  | 'plans.doneBadge'
  | 'plans.completedAll'
  | 'plans.empty'
  // CROMO do LEMBRETE LOCAL do plano (F5.13). `plans.reminderTitle`/`plans.reminderBody` são o
  // TÍTULO/CORPO da notificação LOCAL (opt-in, offline); `{plan}` é o NOME do plano VERBATIM do
  // core (nunca via t() — anti-alucinação). `plans.reminderChannel` = nome do canal Android.
  | 'plans.reminderSection'
  | 'plans.reminderTitle'
  | 'plans.reminderBody'
  | 'plans.reminderChannel'
  | 'plans.reminderTimeLabel'
  | 'plans.reminderPermissionHint'
  | 'a11y.startPlan'
  | 'a11y.openDay'
  | 'a11y.markDone'
  | 'a11y.changePlan'
  | 'a11y.reminderToggle'
  | 'a11y.reminderTime'
  // CROMO das telas de leitura (read/*). `read.bookFallback` é só o rótulo de um
  // livro AUSENTE no store (edge-case) — os NOMES reais de livro vêm do store/core
  // (namePt/nameEn), NUNCA de `t()` (anti-alucinação).
  | 'read.parallel'
  | 'read.bookFallback'
  // Estados-VAZIO das telas/componentes de navegação (F5.8) — CROMO puro (sem texto
  // bíblico): grade de capítulos sem itens e capítulo ausente do banco de leitura.
  | 'read.emptyChapters'
  | 'read.chapterNotFound'
  | 'ref.book'
  | 'ref.chapter'
  | 'ref.verseSingle'
  | 'ref.verseRange'
  | 'ref.wholeChapter'
  | 'a11y.searchInput'
  // A11Y da BUSCA + navegação de leitura (F5.8). `{name}` (livro) vem do STORE
  // (namePt/nameEn; `locale` só ESCOLHE o campo), `{chapter}` é DADO — nada aqui é texto
  // bíblico. `a11y.verseOptions` é HINT do gesto no versículo (não substitui o texto lido).
  | 'a11y.searchTextInput'
  | 'a11y.openBook'
  | 'a11y.openChapter'
  | 'a11y.verseOptions'
  | 'language.switchToOther'
  // Rótulos de acessibilidade do SELETOR TRI-ESTADO de tema (F5.33): claro / escuro / seguir o sistema.
  | 'theme.light'
  | 'theme.dark'
  | 'theme.system'
  // ─── CROMO dos PAINÉIS DE IA (F5.11) ─────────────────────────────────────────────────
  // ANTI-ALUCINAÇÃO (LEI, crítico p/ IA): estas chaves traduzem SÓ o CROMO (rótulos, botões,
  // estados, dicas, a11y). O `citedText`/versículo citado vem VERBATIM do store (nunca via
  // `t()`); a `interpretation` é a saída do modelo (já produzida no `lang={locale}`, F5.5 —
  // NÃO retraduzida pós-hoc); a `reference` canônica permanece EN (âncora); as atribuições/
  // licenças (STEP CC-BY) são VERBATIM. `{source}` = rótulo da passagem (nome do livro do
  // STORE + capítulo:versículo, dados); `{provider}`/`{model}`/`{tokens}`/`{count}` = dados
  // técnicos do retorno — só INTERPOLADOS, nunca traduzidos.
  // Comum aos 4 painéis (texto idêntico entre eles).
  | 'ai.close'
  | 'ai.citedTitle'
  | 'ai.interpTitle'
  | 'ai.meta'
  | 'ai.questionSection'
  | 'ai.questionPlaceholder'
  | 'ai.mockProviderNote'
  | 'ai.offlineBadge'
  // Painel PERGUNTAR (Ask, F2.5).
  | 'ask.title'
  | 'ask.providerSection'
  | 'ask.keyBadgeYes'
  | 'ask.keyBadgeNo'
  | 'ask.byokHint'
  | 'ask.keyPlaceholder'
  | 'ask.saveKey'
  | 'ask.submit'
  | 'ask.estimate'
  | 'ask.disclaimer'
  | 'ask.needKeyError'
  // Painel CONVERSA (Chat, F3.6).
  | 'chat.title'
  | 'chat.emptyHint'
  | 'chat.roleUser'
  | 'chat.roleAssistant'
  | 'chat.followupPlaceholder'
  | 'chat.send'
  | 'chat.sendFollowup'
  | 'chat.disclaimer'
  // Painel COMPARAR (Compare, F3.7).
  | 'compare.title'
  | 'compare.providersSection'
  | 'compare.byokBadge'
  | 'compare.providersHint'
  | 'compare.submit'
  | 'compare.anchorTitle'
  | 'compare.consistencyOk'
  | 'compare.consistencyBad'
  | 'compare.columnNoKey'
  | 'compare.disclaimer'
  // Painel ESTUDO (Study, F3.5). Rótulos de MODO/LENTE/PROFUNDIDADE (o `value`/enum vem da
  // fronteira; aqui só o RÓTULO de exibição é traduzido).
  | 'study.title'
  | 'study.modeSection'
  | 'study.modeAcademic'
  | 'study.modeDevotional'
  | 'study.modeIntroductory'
  | 'study.modeSermon'
  | 'study.lensSection'
  | 'study.lensBaptist'
  | 'study.lensPresbyterian'
  | 'study.lensLutheran'
  | 'study.lensPentecostal'
  | 'study.lensCatholic'
  | 'study.lensOrthodox'
  | 'study.depthSection'
  | 'study.depthOverview'
  | 'study.depthExegetical'
  | 'study.depthWordStudy'
  | 'study.webSection'
  | 'study.webOff'
  | 'study.webWikipedia'
  | 'study.webTavily'
  | 'study.wikipediaPrivacy'
  | 'study.tavilyKeyPlaceholder'
  | 'study.tavilyPrivacy'
  | 'study.submit'
  | 'study.loadingLexicon'
  | 'study.warnings'
  | 'study.citations'
  | 'study.lexicon'
  | 'study.disclaimer'
  | 'study.exportAcademic'
  | 'study.shareTitle'
  // A11Y adicional dos painéis de IA (`{provider}` = id técnico do provedor, verbatim).
  | 'a11y.providerWithKey'
  | 'a11y.providerNoKey'
  | 'a11y.providerOffline'
  | 'a11y.providerByok'
  | 'a11y.byokKey'
  | 'a11y.questionField'
  | 'a11y.chatField'
  | 'a11y.compareField'
  | 'a11y.tavilyKey'
  // ─── CROMO dos componentes de LEITURA restantes (F5.16) ──────────────────────────────
  // ANTI-ALUCINAÇÃO (LEI): só CROMO (rótulos, botões, seções, a11y, placeholders). O TEXTO
  // do versículo e os NOMES de livro vêm do STORE (nunca via `t()`); as REFERÊNCIAS cruzadas
  // são só destino+votos (sem texto bíblico); a atribuição CC-BY (OpenBible) é VERBATIM e NÃO
  // passa por aqui. `{source}` = rótulo da passagem (nome do livro do store + cap:versículo,
  // dados); `{count}` = nº de votos (dado); `{color}` = rótulo da paleta de marcação (dado da
  // app, não texto bíblico) — só INTERPOLADOS, nunca traduzidos.
  | 'common.close'
  | 'xref.title'
  | 'xref.section'
  | 'xref.empty'
  | 'xref.votes'
  | 'versePanel.noteSection'
  | 'versePanel.notePlaceholder'
  | 'versePanel.noteEditorLabel'
  | 'versePanel.saveNote'
  | 'versePanel.deleteNote'
  | 'versePanel.highlightSection'
  | 'versePanel.highlightWith'
  | 'versePanel.unhighlight'
  | 'versePanel.exportButton'
  | 'versePanel.exportShareTitle'
  | 'versePanel.askLabel'
  | 'versePanel.askButton'
  | 'versePanel.studyLabel'
  | 'versePanel.studyButton'
  | 'versePanel.chatLabel'
  | 'versePanel.chatButton'
  | 'versePanel.compareLabel'
  | 'versePanel.compareButton'
  // ─── CROMO dos NOMES das cores de destaque (F5.28) ───────────────────────────────────
  // Nomes de EXIBIÇÃO das 4 cores da paleta de marcação (`highlightColors.ts`). São CROMO
  // puro (não texto bíblico): antes ficavam hardcoded em PT (`label: 'Amarelo'`) e vazavam
  // para o `accessibilityLabel` do swatch — um leitor de tela em EN anunciava "Highlight
  // with Amarelo". Agora o swatch resolve o nome via `t(`highlight.${cor.name}`)`, então EN
  // lê "Highlight with Yellow" e PT "Marcar com Amarelo". A chave `name` (yellow/green/…) é
  // dado do usuário/persistência; só o rótulo humano passa por `t()`.
  | 'highlight.yellow'
  | 'highlight.green'
  | 'highlight.blue'
  | 'highlight.pink'
  // ─── CROMO da SINCRONIZAÇÃO OPT-IN + backup (F5.26, ADR-0054/0036) ───────────────────
  // OFFLINE-FIRST explícito: a tela DIZ que o app funciona 100% offline sem sync (OFF por
  // padrão). Aviso de PRIVACIDADE: o que sincroniza (notas + marcações + progresso de plano)
  // vs. o que NUNCA sai do aparelho (sessões de IA, banco bíblico, chaves/segredos, texto de
  // versículo além da referência). Sem telemetria. Só CROMO aqui — nenhum dado do usuário/
  // store/token passa por `t()`; contadores ({notes}/{highlights}) e erros ({message}) são
  // DADOS só interpolados. O token do Drive vive no TokenStore (F5.24), nunca aqui/no log.
  | 'home.syncBackup'
  | 'sync.title'
  | 'sync.offlineFirst'
  | 'sync.optInLabel'
  | 'sync.optInHint'
  | 'sync.privacyTitle'
  | 'sync.privacySyncs'
  | 'sync.privacyNever'
  | 'sync.noTelemetry'
  | 'sync.manualTitle'
  | 'sync.manualHint'
  | 'sync.exportButton'
  | 'sync.importTitle'
  | 'sync.importPlaceholder'
  | 'sync.importButton'
  | 'sync.importFileButton'
  | 'sync.driveTitle'
  | 'sync.driveWebOnly'
  | 'sync.driveEnableFirst'
  | 'sync.driveNotConfigured'
  | 'sync.driveLink'
  | 'sync.driveUnlink'
  | 'sync.driveSyncNow'
  | 'sync.driveStatusLinked'
  | 'sync.driveStatusUnlinked'
  | 'sync.statusExported'
  | 'sync.statusImported'
  | 'sync.statusError'
  | 'a11y.openSync'
  | 'a11y.syncOptIn'
  | 'a11y.syncExport'
  | 'a11y.syncImportField'
  | 'a11y.syncImport'
  | 'a11y.syncImportFile'
  | 'a11y.syncDriveLink'
  | 'a11y.syncDriveUnlink'
  | 'a11y.syncDriveSyncNow'
  | 'a11y.syncClose';

// Catálogo PORTUGUÊS (default do app). "The Light" é o NOME do produto (marca),
// idêntico nos dois idiomas de propósito.
const pt: Record<MessageKey, string> = {
  'home.title': 'The Light',
  'home.resultPlaceholder': 'O resultado aparecerá aqui.',
  'home.inputPlaceholder': 'Digite uma passagem (ex.: João 3:16)',
  'home.hint': 'Pressione Enter para interpretar (via Rust/wasm).',
  'home.readBible': 'Ler a Bíblia →',
  'home.searchBible': 'Buscar na Bíblia →',
  'home.readingPlans': 'Planos de leitura →',
  'home.resolveError': 'Não foi possível resolver: {message}',
  'home.verseNotFound': 'Versículo não encontrado no store local.',
  'search.inputPlaceholder': 'Buscar na Bíblia (ex.: God, amor, light)',
  'search.hintEmpty': 'Digite um termo para buscar no texto bíblico.',
  'search.noResults': 'Nenhum resultado para “{term}”.',
  'search.translationLabel': 'Tradução',
  'nav.home': 'The Light',
  'nav.read': 'Ler a Bíblia',
  'nav.chapters': 'Capítulos',
  'nav.reading': 'Leitura',
  'nav.search': 'Buscar',
  'nav.plans': 'Planos de leitura',
  'plans.chooseTitle': 'Escolha um plano de leitura',
  'plans.dayCount': '{days} dias',
  'plans.start': 'Começar',
  'plans.progress': '{completed} de {total} dias',
  'plans.streak': 'Sequência: {streak}',
  'plans.today': 'Hoje',
  'plans.dayLabel': 'Dia {day}',
  'plans.markDone': 'Marcar dia como lido',
  'plans.change': 'Trocar/encerrar plano',
  'plans.doneBadge': 'Lido',
  'plans.completedAll': 'Plano concluído!',
  'plans.empty': 'Nenhum plano disponível.',
  'plans.reminderSection': 'Lembrete diário',
  'plans.reminderTitle': 'Hora da leitura',
  'plans.reminderBody': 'Continue seu plano: {plan}',
  'plans.reminderChannel': 'Lembretes de leitura',
  'plans.reminderTimeLabel': 'Horário',
  'plans.reminderPermissionHint':
    'Permita notificações no aparelho para receber o lembrete diário (o lembrete é local, sem conta nem internet).',
  'read.parallel': 'Lado a lado',
  'read.bookFallback': 'Livro {number}',
  'read.emptyChapters': 'Nenhum capítulo disponível nesta versão do banco de leitura.',
  'read.chapterNotFound': 'Capítulo não encontrado no banco de leitura.',
  'ref.book': 'livro',
  'ref.chapter': 'cap.',
  'ref.verseSingle': 'v.',
  'ref.verseRange': 'vv.',
  'ref.wholeChapter': 'capítulo inteiro',
  'a11y.searchInput': 'Campo de busca de passagem bíblica',
  'a11y.searchTextInput': 'Campo de busca no texto bíblico',
  'a11y.openBook': 'Abrir o livro {name}',
  'a11y.openChapter': 'Abrir o capítulo {chapter}',
  'a11y.verseOptions': 'Abrir opções do versículo',
  'a11y.startPlan': 'Começar o plano {name}',
  'a11y.openDay': 'Abrir a leitura do dia {day}: {label}',
  'a11y.markDone': 'Marcar o dia de hoje como lido',
  'a11y.changePlan': 'Trocar ou encerrar o plano ativo',
  'a11y.reminderToggle': 'Ativar lembrete diário do plano',
  'a11y.reminderTime': 'Escolher o horário {time} do lembrete',
  'language.switchToOther': 'Mudar para Inglês',
  'theme.light': 'Tema claro',
  'theme.dark': 'Tema escuro',
  'theme.system': 'Seguir o sistema',
  // ─── Painéis de IA (F5.11) — só CROMO (ver nota na união de chaves) ───────────────────
  'ai.close': 'Fechar',
  'ai.citedTitle': 'Passagem (texto bíblico)',
  'ai.interpTitle': 'Interpretação (IA) — confira nas Escrituras',
  'ai.meta': 'Provedor: {provider} · Modelo: {model}',
  'ai.questionSection': 'Pergunta',
  'ai.questionPlaceholder': 'O que você quer entender sobre esta passagem?',
  'ai.mockProviderNote': 'Provedor: mock (offline, sem chave/rede — F3.10 traz BYOK).',
  'ai.offlineBadge': '· offline',
  'ask.title': 'Perguntar · {source}',
  'ask.providerSection': 'Provedor',
  'ask.keyBadgeYes': '· chave ✓',
  'ask.keyBadgeNo': '· sem chave',
  'ask.byokHint':
    'Este provedor precisa de uma chave (BYOK). Cole-a abaixo: no navegador ela fica só nesta sessão (some ao recarregar); no app, no cofre do aparelho. Nunca é registrada nem sai do dispositivo, exceto na chamada ao provedor.',
  'ask.keyPlaceholder': 'Chave do provedor "{provider}"',
  'ask.saveKey': 'Salvar chave',
  'ask.submit': 'Perguntar',
  'ask.estimate': 'Estimativa: ~{tokens} tokens de interpretação (custo exato indisponível).',
  'ask.disclaimer':
    'O texto bíblico vem do seu acervo local (verbatim); a IA apenas interpreta.',
  'ask.needKeyError':
    'Configure a chave do provedor "{provider}" nas configurações para usar a IA.',
  'chat.title': 'Conversa · {source}',
  'chat.emptyHint':
    'Converse sobre {source}. O texto bíblico (âncora) vem do seu acervo local e aparece separado das respostas da IA.',
  'chat.roleUser': 'Você',
  'chat.roleAssistant': 'IA — confira nas Escrituras',
  'chat.followupPlaceholder': 'Faça um follow-up…',
  'chat.send': 'Enviar',
  'chat.sendFollowup': 'Enviar follow-up',
  'chat.disclaimer':
    'O texto bíblico (âncora) vem do seu acervo local (verbatim); a IA apenas interpreta.',
  'compare.title': 'Comparar IA · {source}',
  'compare.providersSection': 'Provedores (escolha ≥2)',
  'compare.byokBadge': '· BYOK',
  'compare.providersHint':
    'Provedores reais usam a chave do cofre (BYOK); a comparação de respostas reais (diferentes) é a F3.10. O provedor "mock" responde offline (sem chave/rede).',
  'compare.submit': 'Comparar ({count})',
  'compare.anchorTitle': 'Passagem (texto bíblico) — âncora comum',
  'compare.consistencyOk': '✓ Mesma passagem do acervo em todas as {count} colunas',
  'compare.consistencyBad': '⚠ Passagens divergentes entre as colunas',
  'compare.columnNoKey': 'sem chave (BYOK — F3.10)',
  'compare.disclaimer':
    'IA — confira nas Escrituras. O texto bíblico (âncora) vem do seu acervo local (verbatim), idêntico para todos os modelos; a IA apenas interpreta. Custo estimado indisponível (a fronteira não o expõe).',
  'study.title': 'Estudo · {source}',
  'study.modeSection': 'Modo',
  'study.modeAcademic': 'Acadêmico',
  'study.modeDevotional': 'Devocional',
  'study.modeIntroductory': 'Introdutório',
  'study.modeSermon': 'Pregação',
  'study.lensSection': 'Lente (denominação)',
  'study.lensBaptist': 'Batista',
  'study.lensPresbyterian': 'Presbiteriana',
  'study.lensLutheran': 'Luterana',
  'study.lensPentecostal': 'Pentecostal',
  'study.lensCatholic': 'Católica',
  'study.lensOrthodox': 'Ortodoxa',
  'study.depthSection': 'Profundidade',
  'study.depthOverview': 'Visão geral',
  'study.depthExegetical': 'Exegético',
  'study.depthWordStudy': 'Estudo de palavras',
  'study.webSection': 'Pesquisa web (opcional)',
  'study.webOff': 'Desligada',
  'study.webWikipedia': 'Wikipedia',
  'study.webTavily': 'Tavily (chave)',
  'study.wikipediaPrivacy':
    'Privacidade: ligada, esta opção consulta a Wikipedia (rede) para citar fontes. Nenhuma chave/segredo é enviada (Wikipedia é keyless). O texto bíblico e as glosas continuam vindo do seu acervo local; as citações são montadas pelo app (não pela IA).',
  'study.tavilyKeyPlaceholder': 'Chave Tavily (BYOK) — só nesta sessão',
  'study.tavilyPrivacy':
    'Privacidade: ligada, esta opção consulta o Tavily (rede) usando sua chave BYOK. A chave fica só nesta sessão (na memória, perdida ao recarregar), nunca é salva no dispositivo nem registrada, e viaja apenas no corpo da requisição. As citações Web são montadas pelo app a partir das URLs retornadas (nunca pela IA); o texto bíblico e as glosas continuam vindo do seu acervo local.',
  'study.submit': 'Estudar',
  'study.loadingLexicon': 'Carregando o léxico (dado local sob demanda, ~9 MB na 1ª vez)…',
  'study.warnings': 'Avisos',
  'study.citations': 'Citações',
  'study.lexicon': 'Léxico (línguas originais)',
  'study.disclaimer':
    'O texto bíblico e as glosas vêm do seu acervo local (verbatim); a IA apenas interpreta.',
  'study.exportAcademic': 'Exportar (acadêmico)',
  'study.shareTitle': 'Estudo — {source}',
  'a11y.providerWithKey': 'Provedor {provider}, com chave',
  'a11y.providerNoKey': 'Provedor {provider}, sem chave',
  'a11y.providerOffline': 'Provedor {provider}, offline',
  'a11y.providerByok': 'Provedor {provider} (BYOK — chave via cofre)',
  'a11y.byokKey': 'Chave BYOK do provedor {provider}',
  'a11y.questionField': 'Campo de pergunta sobre a passagem',
  'a11y.chatField': 'Campo de conversa sobre a passagem',
  'a11y.compareField': 'Campo de pergunta para comparar entre provedores',
  'a11y.tavilyKey': 'Chave Tavily (session-only)',
  // ─── Componentes de leitura restantes (F5.16) — só CROMO (ver nota na união de chaves) ─
  'common.close': 'Fechar',
  'xref.title': 'Referências cruzadas — {source}',
  'xref.section': 'Referências cruzadas',
  'xref.empty': 'Sem referências cruzadas para este versículo.',
  'xref.votes': '{count} votos',
  'versePanel.noteSection': 'Nota',
  'versePanel.notePlaceholder': 'Escreva uma nota (Markdown)…',
  'versePanel.noteEditorLabel': 'Editor de nota do versículo',
  'versePanel.saveNote': 'Salvar nota',
  'versePanel.deleteNote': 'Remover nota',
  'versePanel.highlightSection': 'Marcação',
  'versePanel.highlightWith': 'Marcar com {color}',
  'versePanel.unhighlight': 'Desmarcar',
  'versePanel.exportButton': 'Exportar minhas notas',
  'versePanel.exportShareTitle': 'Minhas notas — The Light',
  'versePanel.askLabel': 'Perguntar à IA sobre esta passagem',
  'versePanel.askButton': 'Perguntar (IA)',
  'versePanel.studyLabel': 'Estudo profundo (IA) desta passagem',
  'versePanel.studyButton': 'Estudo (IA)',
  'versePanel.chatLabel': 'Conversar (IA) sobre esta passagem',
  'versePanel.chatButton': 'Conversa (IA)',
  'versePanel.compareLabel': 'Comparar respostas de várias IAs sobre esta passagem',
  'versePanel.compareButton': 'Comparar (IA)',
  'highlight.yellow': 'Amarelo',
  'highlight.green': 'Verde',
  'highlight.blue': 'Azul',
  'highlight.pink': 'Rosa',
  // ─── Sincronização opt-in + backup (F5.26) — só CROMO (ver nota na união de chaves) ───
  'home.syncBackup': 'Sincronização e backup →',
  'sync.title': 'Sincronização e backup',
  'sync.offlineFirst':
    'O app funciona 100% offline sem isto. Sincronização e backup são totalmente opcionais.',
  'sync.optInLabel': 'Sincronizar meus dados',
  'sync.optInHint':
    'Desligado por padrão. Com o interruptor desligado, o app nunca acessa a rede nem uma conta — nada é enviado.',
  'sync.privacyTitle': 'Privacidade',
  'sync.privacySyncs':
    'O que é sincronizado: suas notas, marcações e o progresso do plano de leitura.',
  'sync.privacyNever':
    'O que NUNCA sai do aparelho: sessões de IA, o banco bíblico, chaves e segredos, e o texto dos versículos (só a referência canônica viaja).',
  'sync.noTelemetry': 'Sem telemetria. Nenhum uso é rastreado.',
  'sync.manualTitle': 'Backup manual (todos os aparelhos, sem conta)',
  'sync.manualHint':
    'Exporte um arquivo de backup e guarde-o onde quiser; importe-o em outro aparelho. 100% local, sem rede.',
  'sync.exportButton': 'Exportar backup',
  'sync.importTitle': 'Importar backup',
  'sync.importPlaceholder': 'Cole aqui o conteúdo de um backup exportado…',
  'sync.importButton': 'Importar',
  'sync.importFileButton': 'Escolher arquivo…',
  'sync.driveTitle': 'Google Drive (opcional)',
  'sync.driveWebOnly': 'Disponível apenas na versão web.',
  'sync.driveEnableFirst': 'Ative "Sincronizar meus dados" acima para usar o Google Drive.',
  'sync.driveNotConfigured':
    'Conectar uma conta Google real é a etapa de validação humana (F5.27). Nada é enviado à rede nesta versão.',
  'sync.driveLink': 'Conectar o Google Drive',
  'sync.driveUnlink': 'Desconectar',
  'sync.driveSyncNow': 'Sincronizar agora',
  'sync.driveStatusLinked': 'Conta conectada.',
  'sync.driveStatusUnlinked': 'Nenhuma conta conectada.',
  'sync.statusExported': 'Backup exportado: {notes} notas, {highlights} marcações.',
  'sync.statusImported': 'Backup importado: {notes} notas, {highlights} marcações aplicadas.',
  'sync.statusError': 'Não foi possível concluir: {message}',
  'a11y.openSync': 'Abrir sincronização e backup',
  'a11y.syncOptIn': 'Ativar a sincronização dos meus dados (opcional, desligado por padrão)',
  'a11y.syncExport': 'Exportar um arquivo de backup dos meus dados',
  'a11y.syncImportField': 'Campo para colar o conteúdo de um backup',
  'a11y.syncImport': 'Importar o backup colado',
  'a11y.syncImportFile': 'Escolher um arquivo de backup para importar',
  'a11y.syncDriveLink': 'Conectar uma conta do Google Drive',
  'a11y.syncDriveUnlink': 'Desconectar a conta do Google Drive',
  'a11y.syncDriveSyncNow': 'Sincronizar agora com o Google Drive',
  'a11y.syncClose': 'Fechar sincronização e backup',
};

// Catálogo ENGLISH. As MESMAS chaves de `pt` (paridade forçada pelo tipo).
const en: Record<MessageKey, string> = {
  'home.title': 'The Light',
  'home.resultPlaceholder': 'The result will appear here.',
  'home.inputPlaceholder': 'Enter a passage (e.g., John 3:16)',
  'home.hint': 'Press Enter to interpret (via Rust/wasm).',
  'home.readBible': 'Read the Bible →',
  'home.searchBible': 'Search the Bible →',
  'home.readingPlans': 'Reading plans →',
  'home.resolveError': 'Could not resolve: {message}',
  'home.verseNotFound': 'Verse not found in the local store.',
  'search.inputPlaceholder': 'Search the Bible (e.g., God, love, light)',
  'search.hintEmpty': 'Type a term to search the biblical text.',
  'search.noResults': 'No results for “{term}”.',
  'search.translationLabel': 'Translation',
  'nav.home': 'The Light',
  'nav.read': 'Read the Bible',
  'nav.chapters': 'Chapters',
  'nav.reading': 'Reading',
  'nav.search': 'Search',
  'nav.plans': 'Reading plans',
  'plans.chooseTitle': 'Choose a reading plan',
  'plans.dayCount': '{days} days',
  'plans.start': 'Start',
  'plans.progress': '{completed} of {total} days',
  'plans.streak': 'Streak: {streak}',
  'plans.today': 'Today',
  'plans.dayLabel': 'Day {day}',
  'plans.markDone': 'Mark day as read',
  'plans.change': 'Change/end plan',
  'plans.doneBadge': 'Read',
  'plans.completedAll': 'Plan completed!',
  'plans.empty': 'No plans available.',
  'plans.reminderSection': 'Daily reminder',
  'plans.reminderTitle': 'Time to read',
  'plans.reminderBody': 'Continue your plan: {plan}',
  'plans.reminderChannel': 'Reading reminders',
  'plans.reminderTimeLabel': 'Time',
  'plans.reminderPermissionHint':
    'Allow notifications on your device to receive the daily reminder (the reminder is local, no account or internet).',
  'read.parallel': 'Side by side',
  'read.bookFallback': 'Book {number}',
  'read.emptyChapters': 'No chapters available in this version of the reading database.',
  'read.chapterNotFound': 'Chapter not found in the reading database.',
  'ref.book': 'book',
  'ref.chapter': 'ch.',
  'ref.verseSingle': 'v.',
  'ref.verseRange': 'vv.',
  'ref.wholeChapter': 'whole chapter',
  'a11y.searchInput': 'Bible passage search field',
  'a11y.searchTextInput': 'Biblical text search field',
  'a11y.openBook': 'Open the {name} book',
  'a11y.openChapter': 'Open chapter {chapter}',
  'a11y.verseOptions': 'Open verse options',
  'a11y.startPlan': 'Start the {name} plan',
  'a11y.openDay': 'Open the reading for day {day}: {label}',
  'a11y.markDone': "Mark today's day as read",
  'a11y.changePlan': 'Change or end the active plan',
  'a11y.reminderToggle': "Enable the plan's daily reminder",
  'a11y.reminderTime': 'Choose the reminder time {time}',
  'language.switchToOther': 'Switch to Portuguese',
  'theme.light': 'Light theme',
  'theme.dark': 'Dark theme',
  'theme.system': 'Follow system',
  // ─── AI panels (F5.11) — CHROME only (see note on the key union) ──────────────────────
  'ai.close': 'Close',
  'ai.citedTitle': 'Passage (biblical text)',
  'ai.interpTitle': 'Interpretation (AI) — verify against Scripture',
  'ai.meta': 'Provider: {provider} · Model: {model}',
  'ai.questionSection': 'Question',
  'ai.questionPlaceholder': 'What would you like to understand about this passage?',
  'ai.mockProviderNote': 'Provider: mock (offline, no key/network — F3.10 brings BYOK).',
  'ai.offlineBadge': '· offline',
  'ask.title': 'Ask · {source}',
  'ask.providerSection': 'Provider',
  'ask.keyBadgeYes': '· key ✓',
  'ask.keyBadgeNo': '· no key',
  'ask.byokHint':
    'This provider requires a key (BYOK). Paste it below: in the browser it stays only in this session (lost on reload); in the app, in the device vault. It is never logged and never leaves the device, except in the call to the provider.',
  'ask.keyPlaceholder': 'Key for provider "{provider}"',
  'ask.saveKey': 'Save key',
  'ask.submit': 'Ask',
  'ask.estimate': 'Estimate: ~{tokens} interpretation tokens (exact cost unavailable).',
  'ask.disclaimer':
    'The biblical text comes from your local library (verbatim); the AI only interprets.',
  'ask.needKeyError':
    'Configure the "{provider}" provider key in settings to use the AI.',
  'chat.title': 'Conversation · {source}',
  'chat.emptyHint':
    'Chat about {source}. The biblical text (anchor) comes from your local library and appears separate from the AI responses.',
  'chat.roleUser': 'You',
  'chat.roleAssistant': 'AI — verify against Scripture',
  'chat.followupPlaceholder': 'Ask a follow-up…',
  'chat.send': 'Send',
  'chat.sendFollowup': 'Send follow-up',
  'chat.disclaimer':
    'The biblical text (anchor) comes from your local library (verbatim); the AI only interprets.',
  'compare.title': 'Compare AI · {source}',
  'compare.providersSection': 'Providers (choose ≥2)',
  'compare.byokBadge': '· BYOK',
  'compare.providersHint':
    'Real providers use the vault key (BYOK); comparing real (different) responses is F3.10. The "mock" provider answers offline (no key/network).',
  'compare.submit': 'Compare ({count})',
  'compare.anchorTitle': 'Passage (biblical text) — common anchor',
  'compare.consistencyOk': '✓ Same passage from the library across all {count} columns',
  'compare.consistencyBad': '⚠ Divergent passages across columns',
  'compare.columnNoKey': 'no key (BYOK — F3.10)',
  'compare.disclaimer':
    'AI — verify against Scripture. The biblical text (anchor) comes from your local library (verbatim), identical for all models; the AI only interprets. Estimated cost unavailable (the boundary does not expose it).',
  'study.title': 'Study · {source}',
  'study.modeSection': 'Mode',
  'study.modeAcademic': 'Academic',
  'study.modeDevotional': 'Devotional',
  'study.modeIntroductory': 'Introductory',
  'study.modeSermon': 'Sermon',
  'study.lensSection': 'Lens (denomination)',
  'study.lensBaptist': 'Baptist',
  'study.lensPresbyterian': 'Presbyterian',
  'study.lensLutheran': 'Lutheran',
  'study.lensPentecostal': 'Pentecostal',
  'study.lensCatholic': 'Catholic',
  'study.lensOrthodox': 'Orthodox',
  'study.depthSection': 'Depth',
  'study.depthOverview': 'Overview',
  'study.depthExegetical': 'Exegetical',
  'study.depthWordStudy': 'Word study',
  'study.webSection': 'Web research (optional)',
  'study.webOff': 'Off',
  'study.webWikipedia': 'Wikipedia',
  'study.webTavily': 'Tavily (key)',
  'study.wikipediaPrivacy':
    'Privacy: when on, this option queries Wikipedia (network) to cite sources. No key/secret is sent (Wikipedia is keyless). The biblical text and glosses still come from your local library; the citations are assembled by the app (not by the AI).',
  'study.tavilyKeyPlaceholder': 'Tavily key (BYOK) — this session only',
  'study.tavilyPrivacy':
    'Privacy: when on, this option queries Tavily (network) using your BYOK key. The key stays only in this session (in memory, lost on reload), is never saved on the device nor logged, and travels only in the request body. Web citations are assembled by the app from the returned URLs (never by the AI); the biblical text and glosses still come from your local library.',
  'study.submit': 'Study',
  'study.loadingLexicon': 'Loading the lexicon (on-demand local data, ~9 MB on first use)…',
  'study.warnings': 'Warnings',
  'study.citations': 'Citations',
  'study.lexicon': 'Lexicon (original languages)',
  'study.disclaimer':
    'The biblical text and glosses come from your local library (verbatim); the AI only interprets.',
  'study.exportAcademic': 'Export (academic)',
  'study.shareTitle': 'Study — {source}',
  'a11y.providerWithKey': 'Provider {provider}, with key',
  'a11y.providerNoKey': 'Provider {provider}, without key',
  'a11y.providerOffline': 'Provider {provider}, offline',
  'a11y.providerByok': 'Provider {provider} (BYOK — key via vault)',
  'a11y.byokKey': 'BYOK key for provider {provider}',
  'a11y.questionField': 'Question field about the passage',
  'a11y.chatField': 'Conversation field about the passage',
  'a11y.compareField': 'Question field to compare across providers',
  'a11y.tavilyKey': 'Tavily key (session-only)',
  // ─── Remaining reading components (F5.16) — CHROME only (see note on the key union) ────
  'common.close': 'Close',
  'xref.title': 'Cross references — {source}',
  'xref.section': 'Cross references',
  'xref.empty': 'No cross references for this verse.',
  'xref.votes': '{count} votes',
  'versePanel.noteSection': 'Note',
  'versePanel.notePlaceholder': 'Write a note (Markdown)…',
  'versePanel.noteEditorLabel': 'Verse note editor',
  'versePanel.saveNote': 'Save note',
  'versePanel.deleteNote': 'Remove note',
  'versePanel.highlightSection': 'Highlight',
  'versePanel.highlightWith': 'Highlight with {color}',
  'versePanel.unhighlight': 'Unhighlight',
  'versePanel.exportButton': 'Export my notes',
  'versePanel.exportShareTitle': 'My notes — The Light',
  'versePanel.askLabel': 'Ask the AI about this passage',
  'versePanel.askButton': 'Ask (AI)',
  'versePanel.studyLabel': 'Deep study (AI) of this passage',
  'versePanel.studyButton': 'Study (AI)',
  'versePanel.chatLabel': 'Chat (AI) about this passage',
  'versePanel.chatButton': 'Chat (AI)',
  'versePanel.compareLabel': 'Compare answers from multiple AIs about this passage',
  'versePanel.compareButton': 'Compare (AI)',
  'highlight.yellow': 'Yellow',
  'highlight.green': 'Green',
  'highlight.blue': 'Blue',
  'highlight.pink': 'Pink',
  // ─── Opt-in sync + backup (F5.26) — CHROME only (see note on the key union) ───────────
  'home.syncBackup': 'Sync & backup →',
  'sync.title': 'Sync & backup',
  'sync.offlineFirst':
    'The app works 100% offline without this. Sync and backup are entirely optional.',
  'sync.optInLabel': 'Sync my data',
  'sync.optInHint':
    'Off by default. While the switch is off, the app never touches the network or an account — nothing is sent.',
  'sync.privacyTitle': 'Privacy',
  'sync.privacySyncs':
    'What syncs: your notes, highlights and reading-plan progress.',
  'sync.privacyNever':
    'What NEVER leaves the device: AI sessions, the Bible database, keys and secrets, and verse text (only the canonical reference travels).',
  'sync.noTelemetry': 'No telemetry. No usage is tracked.',
  'sync.manualTitle': 'Manual backup (every device, no account)',
  'sync.manualHint':
    'Export a backup file and keep it wherever you like; import it on another device. 100% local, no network.',
  'sync.exportButton': 'Export backup',
  'sync.importTitle': 'Import backup',
  'sync.importPlaceholder': 'Paste the contents of an exported backup here…',
  'sync.importButton': 'Import',
  'sync.importFileButton': 'Choose file…',
  'sync.driveTitle': 'Google Drive (optional)',
  'sync.driveWebOnly': 'Available only on the web version.',
  'sync.driveEnableFirst': 'Turn on "Sync my data" above to use Google Drive.',
  'sync.driveNotConfigured':
    'Connecting a real Google account is the human-validation step (F5.27). Nothing is sent to the network in this version.',
  'sync.driveLink': 'Connect Google Drive',
  'sync.driveUnlink': 'Disconnect',
  'sync.driveSyncNow': 'Sync now',
  'sync.driveStatusLinked': 'Account connected.',
  'sync.driveStatusUnlinked': 'No account connected.',
  'sync.statusExported': 'Backup exported: {notes} notes, {highlights} highlights.',
  'sync.statusImported': 'Backup imported: {notes} notes, {highlights} highlights applied.',
  'sync.statusError': 'Could not complete: {message}',
  'a11y.openSync': 'Open sync & backup',
  'a11y.syncOptIn': 'Enable syncing my data (optional, off by default)',
  'a11y.syncExport': 'Export a backup file of my data',
  'a11y.syncImportField': 'Field to paste the contents of a backup',
  'a11y.syncImport': 'Import the pasted backup',
  'a11y.syncImportFile': 'Choose a backup file to import',
  'a11y.syncDriveLink': 'Connect a Google Drive account',
  'a11y.syncDriveUnlink': 'Disconnect the Google Drive account',
  'a11y.syncDriveSyncNow': 'Sync now with Google Drive',
  'a11y.syncClose': 'Close sync & backup',
};

/** Catálogos por idioma (uma fonte de verdade de texto de UI). */
export const CATALOGS: Record<Locale, Record<MessageKey, string>> = { pt, en };

/** Todas as chaves conhecidas (derivadas do catálogo PT). */
export const MESSAGE_KEYS = Object.keys(pt) as MessageKey[];

/** True se `value` é um `Locale` suportado. */
export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Normaliza uma tag de idioma BCP-47 (ex.: `pt-BR`, `en-US`) para um `Locale`
 * suportado: usa o subtag primário; `pt*`→`pt`, `en*`→`en`; DESCONHECIDO→`pt`
 * (preserva o comportamento PT-default atual). Puro, sem rede.
 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const primary = (raw ?? '').toLowerCase().split('-')[0];
  return isLocale(primary) ? primary : 'pt';
}

/**
 * Detecta o idioma do DEVICE 100% OFFLINE (sem rede):
 *   - web: `navigator.language`;
 *   - nativo (Hermes com Intl): `Intl.DateTimeFormat().resolvedOptions().locale`.
 * Cai em `pt` se nada for detectável. Sem `react-native` (mantém o módulo
 * bundlável headless): usa `navigator` (web) e `Intl` (nativo) diretamente.
 */
export function detectDeviceLocale(): Locale {
  // Web (e qualquer ambiente com navigator.language).
  const nav =
    typeof navigator !== 'undefined' ? (navigator as { language?: string }) : undefined;
  if (nav?.language) {
    return normalizeLocale(nav.language);
  }
  // Nativo (Hermes com Intl).
  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) {
      return normalizeLocale(intlLocale);
    }
  } catch {
    /* Intl indisponível → default */
  }
  return 'pt';
}

/**
 * Traduz uma chave para o `locale` dado. PURA. `params` interpola `{nome}` no texto
 * (ex.: `translate('pt','home.resolveError',{ message })`). Nunca toca texto bíblico.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  let out = CATALOGS[locale][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      // `split/join` (universal) em vez de `replaceAll` — sem depender de lib ES2021.
      out = out.split(`{${name}}`).join(String(value));
    }
  }
  return out;
}

/** Função de tradução ligada ao locale corrente (o que a UI consome). */
export type TranslateFn = (key: MessageKey, params?: Record<string, string | number>) => string;

export type I18nContextValue = {
  /** Idioma efetivo da UI (`pt`/`en`). */
  locale: Locale;
  /** Traduz uma chave no idioma efetivo. */
  t: TranslateFn;
  /** Fixa o idioma (persiste offline) ou `null` p/ voltar a seguir o device. */
  setLocale: (locale: Locale | null) => void;
  /** `true` quando seguindo o device (sem override salvo). */
  isSystem: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Provedor de i18n. Base = idioma detectado do device (offline); override opcional
 * PERSISTIDO via `prefs` (arquivo nativo / localStorage web). No boot, re-hidrata o
 * override salvo; `setLocale` persiste a escolha. Coloque no topo da árvore (ex.:
 * `app/_layout.tsx`), envolvendo o `ThemeProvider`.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  // Idioma do device (estável na sessão) — base quando não há override salvo.
  const detected = useMemo(() => detectDeviceLocale(), []);
  const [override, setOverride] = useState<Locale | null>(null);
  const locale: Locale = override ?? detected;

  // Re-hidrata o override PERSISTIDO no boot (offline). Falha de leitura → mantém a
  // detecção do device (nunca quebra: offline-first).
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const saved = await getPref(LOCALE_PREF_KEY);
        if (alive && saved != null && isLocale(saved)) {
          setOverride(saved);
        }
      } catch {
        /* prefs indisponível → segue com o idioma do device */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale | null) => {
    setOverride(next);
    // Persiste a escolha offline (fire-and-forget; falha não quebra a UI).
    void (async () => {
      try {
        if (next == null) {
          await removePref(LOCALE_PREF_KEY);
        } else {
          await setPref(LOCALE_PREF_KEY, next);
        }
      } catch {
        /* falha de persistência é tolerada (offline-first) */
      }
    })();
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      setLocale,
      isSystem: override === null,
    }),
    [locale, override, setLocale],
  );

  // `createElement` (não JSX) p/ manter este módulo `.ts` puro (molde theme.ts).
  return createElement(I18nContext.Provider, { value }, children);
}

/** Lê o i18n corrente. Lança se usado fora de um `<I18nProvider>`. */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n deve ser usado dentro de <I18nProvider>.');
  }
  return ctx;
}
