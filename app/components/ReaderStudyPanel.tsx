// app/components/ReaderStudyPanel.tsx — F3.5 (ADR-0027; molde ReaderAskPanel F2.5 +
// atribuição CC-BY do ReaderXrefPanel F1.9)
//
// Painel de ESTUDO PROFUNDO ANCORADO (bottom sheet, molde do `ReaderAskPanel` da F2.5)
// aberto pela ação "Estudo (IA)" do painel por-versículo. A partir de uma passagem
// selecionada, o usuário escolhe MODO × LENTE (denominação) × PROFUNDIDADE e recebe um
// estudo estruturado com ANTI-ALUCINAÇÃO VISÍVEL: a `passageText` (texto bíblico,
// VERBATIM do store) é exibida SEPARADA e ROTULADA, distinta da `interpretation` (LLM);
// mais `sections`/`citations`/`warnings` e o LÉXICO Strong inline (`lexicalEntries`).
//
// A UI SÓ chama a fronteira (`deepStudy`/`lexicalEntries`, F3.3/F3.2 via JSI) e APRESENTA
// o retorno: NENHUM prompt/RAG/aparato/SQL/JOIN de léxico é reimplementado em TS (uma
// fonte da verdade — o texto bíblico, o léxico e as citações vêm do Rust/core). NENHUM
// texto/glosa/citação é hardcoded. Cores via TOKENS de tema (`useTheme`).
//
// ATRIBUIÇÃO STEP CC-BY (ADR-0026, OBRIGATÓRIA): as `VerifiedLexiconOut.sources` (a
// atribuição verbatim de `scholarly_sources.attribution`) são exibidas SEMPRE que o
// léxico/estudo aparece — mesmo requisito de licença do xref (ADR-0016).
//
// BYOK/offline-first (LEI): o usuário escolhe um PROVEDOR (mock default + BYOK reais). A
// chave dos provedores REAIS é lida SOB DEMANDA via `keystore.getKey(provider)` e passada à
// fronteira `deep_study(..., providerName, key)` — NUNCA logada/impressa/exibida; sem chave
// no cofre → erro claro + CTA p/ Ajustes, sem chamar a IA. Com `"mock"` não há chave nem rede
// (default offline, o caminho da prova headless). O texto bíblico e as glosas vêm SEMPRE do
// store local, verbatim; o LLM só interpreta. (F6.7 des-mocka; transporte/core inalterados.)
import { useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useI18n, type MessageKey } from '../lib/i18n';
import { getKey, SUPPORTED_PROVIDERS } from '../lib/keystore';
import { buildStudyExport } from '../lib/studyExport';
import { useReaderModalA11y } from '../lib/useReaderModalA11y';
import { useTheme, type ThemeColors } from '../lib/theme';
import { AiProviderNotice, useConfiguredAiProviders } from './AiProviderNotice';
import {
  deepStudy,
  lexicalEntries,
  StudyDepth,
  StudyLens,
  StudyMode,
  type LexEntry,
  type StudyResultOut,
  type VerifiedLexiconOut,
} from '../web/reading';

// Provedor determinístico OFFLINE (sem chave, sem rede): default seguro e o caminho da prova
// headless. NÃO está em `SUPPORTED_PROVIDERS` (que é só BYOK real) — é adicionado ao seletor
// apenas para o estudo offline.
const MOCK_PROVIDER = 'mock';
// Ordem do seletor (molde ReaderAskPanel): mock primeiro (default offline), depois os
// provedores BYOK reais. F6.7 des-mocka o estudo: a chave real é lida SOB DEMANDA do cofre.
const PROVIDER_OPTIONS: readonly string[] = [MOCK_PROVIDER, ...SUPPORTED_PROVIDERS];

// Backends de pesquisa web OPT-IN (ADR-0028/ADR-0032/ADR-0035): rede além do LLM, DESLIGADA
// por padrão. Quando o usuário liga, o estudo (modo Acadêmico) ganha citações `[W:n]`/
// `kind="Web"` das URLs buscadas — montadas pelo Rust `ai-pure`, nunca pelo modelo. Sem liga
// → `undefined` (offline, comportamento F3.12a).
//   - Wikipedia: KEYLESS (nenhuma chave/segredo).
//   - Tavily (F4.4): BYOK — a chave é SESSION-ONLY (in-memory, `useState`; perdida no reload,
//     NUNCA persistida/logada/em git) e vai SÓ no CORPO do POST a `api.tavily.com/search`.
const WIKIPEDIA_BACKEND = 'wikipedia';
const TAVILY_BACKEND = 'tavily';

/** Estado do seletor 3-vias de pesquisa web (off | Wikipedia keyless | Tavily BYOK). */
type WebBackend = 'off' | 'wikipedia' | 'tavily';

/**
 * Atribuição STEP CC-BY CANÔNICA (ADR-0026) — string verbatim de
 * `scholarly_sources.attribution`. A UI exibe as `sources` REAIS do retorno (não esta
 * constante), mas exportamos a substring canônica p/ o grep de verificação e como
 * fallback textual do requisito de licença. NÃO alterar/omitir "STEP Bible".
 */
export const STEP_ATTRIBUTION =
  "Credit it to 'STEP Bible' linked to www.STEPBible.org (data based on work at Tyndale House, Cambridge; CC BY 4.0)";

// Opção de seletor: valor do enum (fronteira) + `key` estável p/ o `testID` + `labelKey`
// (chave i18n do CROMO). O RÓTULO é traduzido em render via `t(o.labelKey)`; o `value`/enum
// e o `key`/testID NÃO mudam com o idioma (uma fonte da verdade da fronteira, F5.11).
type Option<T> = { value: T; key: string; labelKey: MessageKey };

// Variantes REAIS da fronteira (F3.3) — `key` = nome da variante (testID estável); `labelKey`
// = chave do rótulo traduzível. Os VALORES são os enums gerados (uma fonte da verdade).
const MODE_OPTIONS: readonly Option<StudyMode>[] = [
  { value: StudyMode.Academic, key: 'Academic', labelKey: 'study.modeAcademic' },
  { value: StudyMode.Devotional, key: 'Devotional', labelKey: 'study.modeDevotional' },
  { value: StudyMode.Introductory, key: 'Introductory', labelKey: 'study.modeIntroductory' },
  { value: StudyMode.Sermon, key: 'Sermon', labelKey: 'study.modeSermon' },
];
const LENS_OPTIONS: readonly Option<StudyLens>[] = [
  { value: StudyLens.Baptist, key: 'Baptist', labelKey: 'study.lensBaptist' },
  { value: StudyLens.Presbyterian, key: 'Presbyterian', labelKey: 'study.lensPresbyterian' },
  { value: StudyLens.Lutheran, key: 'Lutheran', labelKey: 'study.lensLutheran' },
  { value: StudyLens.Pentecostal, key: 'Pentecostal', labelKey: 'study.lensPentecostal' },
  { value: StudyLens.Catholic, key: 'Catholic', labelKey: 'study.lensCatholic' },
  { value: StudyLens.Orthodox, key: 'Orthodox', labelKey: 'study.lensOrthodox' },
];
const DEPTH_OPTIONS: readonly Option<StudyDepth>[] = [
  { value: StudyDepth.Overview, key: 'Overview', labelKey: 'study.depthOverview' },
  { value: StudyDepth.Exegetical, key: 'Exegetical', labelKey: 'study.depthExegetical' },
  { value: StudyDepth.WordStudy, key: 'WordStudy', labelKey: 'study.depthWordStudy' },
];

/** Linha legível de uma entrada léxica (do RETORNO real; nada hardcoded). */
function lexLine(e: LexEntry): string {
  const parts = [e.strongs];
  if (e.lemma) parts.push(e.lemma);
  if (e.translit) parts.push(e.translit);
  if (e.gloss) parts.push(`"${e.gloss}"`);
  return parts.join(' · ');
}

export function ReaderStudyPanel({
  visible,
  sourceLabel,
  book,
  chapter,
  verse,
  dbPath,
  translation,
  lang,
  onClose,
}: {
  visible: boolean;
  /** Rótulo legível da passagem (ex.: "João 3:16"), só p/ o cabeçalho. */
  sourceLabel: string;
  /** Passagem NUMÉRICA p/ a fronteira (book/chapter[/verse]) — não string canônica. */
  book: number;
  chapter: number;
  /** Versículo alvo; `null` = capítulo inteiro (o core deriva do reference). */
  verse: number | null;
  /** Caminho do banco só-leitura (`ensureReadingDb()`); `null` enquanto carrega. */
  dbPath: string | null;
  /** Tradução corrente (ex.: "kjv") — de onde a `passageText` é lida, verbatim. */
  translation: string;
  /** Idioma de resposta/exibição ("pt"|"en"); o core faz o default sensato. */
  lang: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // F5.21: ao abrir, foco do leitor de tela no título (ordem lógica + anúncio de abertura).
  const titleRef = useReaderModalA11y(visible);

  // Provedor de IA selecionado. Default `mock` (offline, sem chave/rede); o usuário troca por
  // um provedor real quando tiver chave no cofre. F6.7: substitui o `MOCK_PROVIDER` hardcoded.
  const [provider, setProvider] = useState<string>(MOCK_PROVIDER);
  const [mode, setMode] = useState<StudyMode>(StudyMode.Academic);
  const [lens, setLens] = useState<StudyLens>(StudyLens.Presbyterian);
  const [depth, setDepth] = useState<StudyDepth>(StudyDepth.Exegetical);
  // Pesquisa web OPT-IN — padrão DESLIGADO (offline por padrão). É uma PREFERÊNCIA do usuário:
  // persiste entre passagens (não é resultado; não reseta no useEffect).
  const [webBackend, setWebBackend] = useState<WebBackend>('off');
  // Chave BYOK do Tavily — SESSION-ONLY / in-memory (ADR-0025): vive só neste estado, perdida
  // no reload, NUNCA persistida (Storage/IndexedDB/disco), NUNCA logada, NUNCA em git. Vai só
  // no CORPO do POST (o transporte a coloca em `api_key`).
  const [tavilyKey, setTavilyKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudyResultOut | null>(null);
  const [lexicon, setLexicon] = useState<VerifiedLexiconOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // F5.37: há algum provedor de IA configurado? (NOMES com chave no cofre, nunca valores.)
  // Sem nenhum → aviso claro + CTA (esta entrega ainda usa `mock` offline; BYOK real = F3.10).
  const { checked: providersChecked, providers: providersWithKey } = useConfiguredAiProviders(visible);
  const showNoProviderNotice = providersChecked && providersWithKey.length === 0;

  const isMock = provider === MOCK_PROVIDER;
  const providerHasKey = providersWithKey.includes(provider);
  // Provedor REAL selecionado sem chave no cofre → não dá p/ chamar a IA: erro claro + CTA p/
  // Ajustes (a chave é inserida lá, F6.6). `mock` nunca cai aqui (offline, sem chave/rede).
  const needsKey = !isMock && providersChecked && !providerHasKey;

  // F6.6: leva à tela de AJUSTES (hub canônico de chave BYOK, campos por provedor). Fecha antes.
  function onConfigureProvider() {
    onClose();
    router.push('/settings');
  }

  // Ao trocar de passagem ou fechar, limpa o resultado (nunca persiste texto entre refs).
  useEffect(() => {
    setResult(null);
    setLexicon(null);
    setError(null);
    setExportError(null);
  }, [book, chapter, verse, visible]);

  // Bloqueia o envio se ocupado, sem banco, ou com provedor real sem chave (needsKey) — assim
  // um provedor sem chave NÃO chama a IA (sem travar): o aviso + CTA abaixo orientam o usuário.
  const studyDisabled = busy || dbPath == null || needsKey;

  async function onStudy() {
    if (studyDisabled || dbPath == null) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setLexicon(null);
    try {
      // BYOK (LEI): a chave do LLM é a do KEYSTORE (≠ chave Tavily de web-research). Provedores
      // REAIS leem a chave SOB DEMANDA do cofre e a passam à fronteira; NUNCA logada/exibida.
      // `mock` = sem chave, sem rede (default offline). Sem chave p/ provedor real → erro claro
      // (mesmo texto do CTA/Ajustes) e a chamada é PULADA (o catch exibe; não trava).
      let key: string | undefined;
      if (!isMock) {
        const stored = await getKey(provider);
        if (!stored) {
          throw new Error(t('ask.needKeyError', { provider }));
        }
        key = stored;
      }

      // Pesquisa web opt-in: Wikipedia (keyless) ou Tavily (BYOK). Off → `undefined` (offline).
      // A chave Tavily (session-only, in-memory) vai SÓ no `researchKey` → o transporte a coloca
      // no CORPO do POST (nunca URL/header/log). Backend=tavily sem chave → o core lança citando
      // só "tavily" (0 fetch). É SEPARADA da chave do LLM acima.
      const researchBackend =
        webBackend === 'off' ? undefined : webBackend === 'tavily' ? TAVILY_BACKEND : WIKIPEDIA_BACKEND;
      const researchKey = webBackend === 'tavily' ? tavilyKey.trim() || undefined : undefined;

      // Provedor selecionado + chave BYOK (ou undefined p/ mock); modelo undefined → default do
      // core. O léxico é independente de tradução (sem `translation`). Ambas as chamadas leem do
      // STORE local verbatim (anti-alucinação): `passageText` + glosas do banco.
      const [study, lex] = await Promise.all([
        deepStudy(
          dbPath,
          translation,
          book,
          chapter,
          verse ?? undefined,
          mode,
          lens,
          depth,
          lang,
          provider,
          key,
          undefined,
          researchBackend,
          researchKey,
        ),
        lexicalEntries(dbPath, book, chapter, verse ?? undefined, lang, undefined),
      ]);
      setResult(study);
      setLexicon(lex);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // EXPORTAÇÃO ACADÊMICA (F3.8): o Markdown SBL vem INTEIRO do core
  // (`result.academicMarkdown` — fonte única, zero drift); o sidecar só AGREGA as
  // citações/atribuições já retornadas (molde F1.11 `buildNotesExport`). Nada de
  // serialização SBL reimplementada aqui. Compartilha pelo Share nativo (F1.11).
  async function onExportAcademic() {
    if (result == null) {
      return;
    }
    setExportError(null);
    try {
      const exp = buildStudyExport(result, sourceLabel, lexicon?.sources ?? []);
      await Share.share({ message: exp.message, title: t('study.shareTitle', { source: sourceLabel }) });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    }
  }

  // Atribuição a exibir: as `sources` REAIS do léxico (verbatim do banco). Fallback à
  // constante canônica só se o retorno vier sem fontes (mantém o requisito de licença
  // sempre visível quando o léxico/estudo aparece).
  const sources = lexicon?.sources ?? [];
  const attributionLines = sources.length > 0 ? sources : [STEP_ATTRIBUTION];
  const showAttribution = result != null || (lexicon != null && lexicon.entries.length > 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="study-panel-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t('ai.close')}
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.header}>
          <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
            {t('study.title', { source: sourceLabel })}
          </Text>
          <Pressable onPress={onClose} testID="study-panel-close" accessibilityRole="button" hitSlop={12}>
            <Text style={styles.close}>{t('ai.close')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── AVISO "sem provedor de IA" (F5.37) ────────────────────────────
              Estudo profundo usa IA; sem nenhum provedor configurado, convite CLARO p/
              configurar (link à tela Sobre), não um erro cru. Os recursos offline seguem
              sem chave; o provedor offline `mock` ainda produz o estudo abaixo. */}
          {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

          {/* ── PROVEDOR (F6.7) ───────────────────────────────────────────────
              Seletor mock + BYOK reais (molde ReaderAskPanel). `mock` = default OFFLINE
              (sem chave/rede, prova headless). Provedor real → a chave BYOK é lida SOB
              DEMANDA do cofre em onStudy; sem chave → aviso claro + CTA p/ Ajustes. */}
          <Text style={styles.sectionTitle}>{t('ask.providerSection')}</Text>
          <View style={styles.providers}>
            {PROVIDER_OPTIONS.map((p) => {
              const active = provider === p;
              const real = p !== MOCK_PROVIDER;
              const withKey = providersWithKey.includes(p);
              return (
                <Pressable
                  key={p}
                  style={[styles.provChip, active ? styles.provChipActive : null]}
                  onPress={() => setProvider(p)}
                  disabled={busy}
                  testID={`study-provider-${p}`}
                  hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    real
                      ? withKey
                        ? t('a11y.providerWithKey', { provider: p })
                        : t('a11y.providerNoKey', { provider: p })
                      : t('a11y.providerOffline', { provider: p })
                  }
                >
                  <Text style={[styles.provChipText, active ? styles.provChipTextActive : null]}>
                    {p}
                  </Text>
                  <Text style={[styles.provKeyBadge, active ? styles.provChipTextActive : null]}>
                    {real ? (withKey ? t('ask.keyBadgeYes') : t('ask.keyBadgeNo')) : t('ai.offlineBadge')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Provedor real sem chave → erro claro + CTA p/ Ajustes (não trava; envio desabilitado). */}
          {needsKey ? (
            <View style={styles.needKeyBlock} testID="study-provider-needkey">
              <Text style={styles.error}>{t('ask.needKeyError', { provider })}</Text>
              <Pressable
                style={styles.cta}
                onPress={onConfigureProvider}
                testID="study-provider-configure"
                accessibilityRole="button"
                accessibilityLabel={t('a11y.aiConfigure')}
              >
                <Text style={styles.ctaText}>{t('ai.noProviderCta')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── MODO ──────────────────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('study.modeSection')}</Text>
          <View style={styles.chips}>
            {MODE_OPTIONS.map((o) => {
              const active = mode === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setMode(o.value)}
                  disabled={busy}
                  hitSlop={{ top: 8, bottom: 8 }}
                  testID={`study-mode-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {t(o.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── LENTE (denominação) ───────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('study.lensSection')}</Text>
          <View style={styles.chips}>
            {LENS_OPTIONS.map((o) => {
              const active = lens === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setLens(o.value)}
                  disabled={busy}
                  hitSlop={{ top: 8, bottom: 8 }}
                  testID={`study-lens-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {t(o.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── PROFUNDIDADE ──────────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>{t('study.depthSection')}</Text>
          <View style={styles.chips}>
            {DEPTH_OPTIONS.map((o) => {
              const active = depth === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setDepth(o.value)}
                  disabled={busy}
                  hitSlop={{ top: 8, bottom: 8 }}
                  testID={`study-depth-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {t(o.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── PESQUISA WEB (opt-in) — ADR-0028/ADR-0032/ADR-0035 ───────────────
              Padrão DESLIGADO. Quando ligada, é rede além do LLM e o estudo Acadêmico ganha
              citações [W:n] das URLs (montadas pelo Rust `ai-pure`, NUNCA pelo modelo):
                • Wikipedia — KEYLESS (sem chave/segredo).
                • Tavily    — BYOK: a chave é SESSION-ONLY (perdida no reload, nunca persistida/
                  logada) e vai SÓ no CORPO do POST. Aviso de privacidade/atribuição abaixo. */}
          <Text style={styles.sectionTitle}>{t('study.webSection')}</Text>
          <View style={styles.chips}>
            {(
              [
                { value: 'off', key: 'off', labelKey: 'study.webOff' },
                { value: 'wikipedia', key: 'wikipedia', labelKey: 'study.webWikipedia' },
                { value: 'tavily', key: 'tavily', labelKey: 'study.webTavily' },
              ] as const
            ).map((o) => {
              const active = webBackend === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setWebBackend(o.value)}
                  disabled={busy}
                  hitSlop={{ top: 8, bottom: 8 }}
                  testID={`study-web-research-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {t(o.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {webBackend === 'wikipedia' ? (
            <Text style={styles.hint} testID="study-web-research-privacy">
              {t('study.wikipediaPrivacy')}
            </Text>
          ) : null}
          {webBackend === 'tavily' ? (
            <>
              <TextInput
                style={styles.keyInput}
                value={tavilyKey}
                onChangeText={setTavilyKey}
                placeholder={t('study.tavilyKeyPlaceholder')}
                placeholderTextColor={colors.muted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                testID="study-web-research-tavily-key"
                accessibilityLabel={t('a11y.tavilyKey')}
              />
              <Text style={styles.hint} testID="study-web-research-privacy">
                {t('study.tavilyPrivacy')}
              </Text>
            </>
          ) : null}

          {/* Nota do provedor OFFLINE `mock` — só quando ele está selecionado (F6.7). */}
          {isMock ? <Text style={styles.hint}>{t('ai.mockProviderNote')}</Text> : null}

          <Pressable
            style={[styles.btn, studyDisabled ? styles.btnDisabled : styles.btnPrimary]}
            onPress={onStudy}
            disabled={studyDisabled}
            testID="study-submit"
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.chipActiveText} />
            ) : (
              <Text style={styles.btnText}>{t('study.submit')}</Text>
            )}
          </Pressable>

          {/* ── CARREGANDO (UX do dado ON-DEMAND) — F5.15 (ADR-0044) ──────────
              O léxico (~9 MB) foi SEPARADO do caminho de leitura: só "desce"
              (lexicon-sample.sqlite, asset local — sem rede externa) quando o estudo/
              léxico roda. Este indicador torna a deferência HONESTA na 1ª abertura;
              nas próximas o léxico já está em OPFS (local, instantâneo). */}
          {busy ? (
            <View style={styles.loadingRow} testID="study-loading-lexicon">
              <ActivityIndicator color={colors.muted} />
              <Text style={styles.loadingText}>{t('study.loadingLexicon')}</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* ── PASSAGEM (texto bíblico, verbatim do store) ───────────────────
              Anti-alucinação VISÍVEL: a `passageText` vem do RETORNO real (store),
              rotulada como texto bíblico — NUNCA como saída do LLM. */}
          {result ? (
            <View style={styles.passageBlock}>
              <Text style={styles.sectionTitle}>{t('ai.citedTitle')}</Text>
              <Text style={styles.passageText} testID="study-passage-text">
                {result.passageText}
              </Text>
            </View>
          ) : null}

          {/* ── INTERPRETAÇÃO (IA) ────────────────────────────────────────────
              Rótulo DISTINTO do texto bíblico. É a saída do modelo (mock), separada. */}
          {result ? (
            <View style={styles.interpBlock}>
              <Text style={styles.sectionTitle}>{t('ai.interpTitle')}</Text>
              <Text style={styles.interpText} testID="study-interpretation">
                {result.interpretation}
              </Text>
              {/* Seções estruturadas (fatiadas por `## ` pelo core), quando houver. */}
              {result.sections.map((s, i) => (
                <View key={`${s.heading}-${i}`} style={styles.section}>
                  <Text style={styles.sectionHeading}>{s.heading}</Text>
                  <Text style={styles.interpText}>{s.body}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── AVISOS de verificação (Strong/[W:n] fora do acervo) ─────────── */}
          {result && result.warnings.length > 0 ? (
            <View style={styles.warnBlock} testID="study-warnings">
              <Text style={styles.sectionTitle}>{t('study.warnings')}</Text>
              {result.warnings.map((w, i) => (
                <Text key={i} style={styles.warnText}>
                  ⚠ {w}
                </Text>
              ))}
            </View>
          ) : null}

          {/* ── CITAÇÕES verificáveis (do banco/URLs — nunca do modelo) ─────── */}
          {result && result.citations.length > 0 ? (
            <View style={styles.citeBlock} testID="study-citations">
              <Text style={styles.sectionTitle}>{t('study.citations')}</Text>
              {result.citations.map((c, i) => (
                <View key={`${c.kind}-${c.key}-${i}`} style={styles.citeRow}>
                  <Text style={styles.citeText}>
                    [{c.kind}:{c.key}]
                    {c.title ? ` ${c.title}` : ''}
                    {c.license ? ` · ${c.license}` : ''}
                  </Text>
                  {c.attribution ? (
                    <Text style={styles.attribution}>{c.attribution}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* ── LÉXICO Strong inline (verbatim do léxico local verificado) ────
              Anti-alucinação: Strong/lema/translit/glosa vêm SÓ do banco (STEP Bible /
              TBESH–TBESG), nunca do modelo. */}
          {lexicon && lexicon.entries.length > 0 ? (
            <View style={styles.lexBlock} testID="study-lexicon">
              <Text style={styles.sectionTitle}>{t('study.lexicon')}</Text>
              {lexicon.entries.map((e) => (
                <View key={e.strongs} style={styles.lexRow}>
                  <Text style={styles.lexText}>{lexLine(e)}</Text>
                  <Text style={styles.lexOcc}>
                    {e.testament} · {e.occurrences}×
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── ATRIBUIÇÃO STEP CC-BY (ADR-0026, OBRIGATÓRIA) ────────────────
              Exibida SEMPRE que o léxico/estudo aparece (requisito de licença, molde do
              xref/ADR-0016). Vem das `sources` REAIS do retorno (verbatim do banco). */}
          {showAttribution ? (
            <View style={styles.attributionBlock} testID="study-attribution">
              {attributionLines.map((s, i) => (
                <Text key={i} style={styles.attribution}>
                  {s}
                </Text>
              ))}
            </View>
          ) : null}

          {/* ── PROVEDOR/MODELO + DISCLAIMER (anti-alucinação) ──────────────── */}
          {result ? (
            <View style={styles.metaBlock}>
              <Text style={styles.metaText} testID="study-meta">
                {t('ai.meta', { provider: result.provider, model: result.model })}
              </Text>
              <Text style={styles.disclaimer}>{t('study.disclaimer')}</Text>
            </View>
          ) : null}

          {/* ── EXPORTAÇÃO ACADÊMICA (F3.8) ──────────────────────────────────
              Markdown SBL (do core) + sidecar de citações, compartilhados pelo Share
              nativo (molde F1.11). Habilitado quando há resultado. */}
          {result ? (
            <>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={onExportAcademic}
                testID="study-export-academic"
                accessibilityRole="button"
              >
                <Text style={styles.btnText}>{t('study.exportAcademic')}</Text>
              </Pressable>
              {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
      maxHeight: '88%',
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingBottom: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    title: { fontSize: 16, fontWeight: '700', color: colors.text, flexShrink: 1 },
    close: { fontSize: 14, fontWeight: '600', color: colors.accent, paddingLeft: 12 },
    scroll: { padding: 16, gap: 8 },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 12,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    chipText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
    chipTextActive: { color: colors.chipActiveText },
    // Seletor de PROVEDOR (F6.7) — chip com badge de chave/offline (molde ReaderAskPanel).
    providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    provChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    provChipActive: { backgroundColor: colors.chipActiveBg, borderColor: colors.chipActiveBg },
    provChipText: { fontSize: 13, fontWeight: '600', color: colors.chipText },
    provChipTextActive: { color: colors.chipActiveText },
    provKeyBadge: { fontSize: 11, color: colors.muted },
    needKeyBlock: { marginTop: 8, gap: 6 },
    cta: {
      alignSelf: 'flex-start',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.chipActiveBg,
    },
    ctaText: { fontSize: 14, fontWeight: '700', color: colors.chipActiveText },
    hint: { fontSize: 12, color: colors.muted, marginTop: 10, fontStyle: 'italic' },
    keyInput: {
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.background,
    },
    btn: {
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    btnPrimary: { backgroundColor: colors.chipActiveBg },
    btnDisabled: { backgroundColor: colors.divider, opacity: 0.6 },
    btnText: { fontSize: 15, fontWeight: '700', color: colors.chipActiveText },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    loadingText: { fontSize: 13, color: colors.muted, flexShrink: 1 },
    passageBlock: {
      marginTop: 14,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingLeft: 12,
    },
    passageText: { fontSize: 15, lineHeight: 22, color: colors.verseText, marginTop: 4 },
    interpBlock: {
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
    },
    interpText: { fontSize: 15, lineHeight: 22, color: colors.text, marginTop: 4 },
    section: { marginTop: 10 },
    sectionHeading: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 4 },
    warnBlock: { marginTop: 12 },
    warnText: { fontSize: 13, color: colors.error, marginTop: 2 },
    citeBlock: { marginTop: 12 },
    citeRow: { marginTop: 6 },
    citeText: { fontSize: 13, color: colors.muted },
    lexBlock: { marginTop: 12 },
    lexRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    lexText: { fontSize: 14, color: colors.verseText, flexShrink: 1, paddingRight: 8 },
    lexOcc: { fontSize: 12, color: colors.muted },
    attributionBlock: { marginTop: 12 },
    attribution: {
      fontSize: 12,
      color: colors.muted,
      textAlign: 'center',
      paddingHorizontal: 8,
      paddingTop: 6,
    },
    metaBlock: { marginTop: 14, gap: 4 },
    metaText: { fontSize: 12, color: colors.muted },
    disclaimer: { fontSize: 12, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
    error: { fontSize: 14, color: colors.error, marginTop: 10 },
  });
}
