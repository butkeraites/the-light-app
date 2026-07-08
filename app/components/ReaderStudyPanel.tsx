// app/components/ReaderStudyPanel.tsx — F3.5 (ADR-0027; molde ReaderAskPanel F2.5 +
// atribuição CC-BY do ReaderXrefPanel F1.9) · ADR-0068 (kit "Vigil")
//
// Painel de ESTUDO PROFUNDO ANCORADO (bottom sheet, molde do `ReaderAskPanel` da F2.5)
// aberto pela ação "Estudo (IA)" do painel por-versículo. A partir de uma passagem
// selecionada, o usuário escolhe MODO × LENTE (denominação) × PROFUNDIDADE e recebe um
// estudo estruturado com ANTI-ALUCINAÇÃO VISÍVEL: a `passageText` (texto bíblico,
// VERBATIM do store) é exibida SEPARADA e ROTULADA (primitiva CitedText), distinta da
// `interpretation` (LLM, na InterpretationBlock); mais `sections`/`citations`/`warnings`
// e o LÉXICO Strong inline (`lexicalEntries`).
//
// A UI SÓ chama a fronteira (`deepStudy`/`lexicalEntries`, F3.3/F3.2 via JSI) e APRESENTA
// o retorno: NENHUM prompt/RAG/aparato/SQL/JOIN de léxico é reimplementado em TS (uma
// fonte da verdade — o texto bíblico, o léxico e as citações vêm do Rust/core). NENHUM
// texto/glosa/citação é hardcoded. Cores/tipografia via TOKENS de tema (`useTheme`).
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
import { ActivityIndicator, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { errMessage } from '../lib/errMessage';
import { useI18n, type MessageKey } from '../lib/i18n';
import { buildStudyExport } from '../lib/studyExport';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { AiProviderNotice } from './AiProviderNotice';
import { ProviderChips, useProviderSelection } from './ProviderPicker';
import { AiCostMeta } from './AiCostMeta';
import { BottomSheet, Button, Chip, CitedText, InterpretationBlock, SectionLabel } from './ui';
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
// Opções do seletor de pesquisa web (chrome traduzível; `value`/testID estáveis).
const WEB_OPTIONS: readonly Option<WebBackend>[] = [
  { value: 'off', key: 'off', labelKey: 'study.webOff' },
  { value: 'wikipedia', key: 'wikipedia', labelKey: 'study.webWikipedia' },
  { value: 'tavily', key: 'tavily', labelKey: 'study.webTavily' },
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
  const theme = useTheme();
  const { colors } = theme;
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Seleção de provedor + derivações BYOK (seam compartilhado — ADR-0059): estado do provedor,
  // checagem do cofre, isMock/needsKey/showNoProviderNotice e loadKey (lê a chave sob demanda,
  // lança o erro i18n de needKey). O seam desconhece `StudyResultOut` (anti-alucinação intacta).
  const {
    provider,
    setProvider,
    options,
    isMock,
    providersWithKey,
    needsKey,
    showNoProviderNotice,
    loadKey,
  } = useProviderSelection(visible);
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
      // BYOK (LEI): a chave do LLM é a do KEYSTORE (≠ chave Tavily de web-research). `loadKey()`
      // (seam ADR-0059) lê a chave real SOB DEMANDA do cofre — NUNCA logada/exibida — e lança o
      // erro i18n de needKey p/ provedor real sem chave; `mock` = undefined (sem chave/rede).
      const key = await loadKey();

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
      //
      // ROBUSTEZ (regressão relatada): o ESTUDO (passagem + interpretação) é o conteúdo PRIMÁRIO;
      // o LÉXICO é SUPLEMENTAR. Antes, o `Promise.all` acoplava os dois — se `lexicalEntries`
      // falhasse (ex.: no web o asset do léxico não carrega → "no such table: original_tokens"),
      // o estudo INTEIRO era descartado e o usuário via só um erro. Agora a falha do léxico é
      // TOLERADA (→ null): o estudo aparece sem a seção de léxico. `deepStudy` falhar (provedor/
      // rede) segue fatal — é o conteúdo principal — e cai no catch abaixo.
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
        lexicalEntries(dbPath, book, chapter, verse ?? undefined, lang, undefined).catch(() => null),
      ]);
      setResult(study);
      setLexicon(lex);
    } catch (err) {
      setError(errMessage(err));
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
      setExportError(errMessage(err));
    }
  }

  // Atribuição a exibir: as `sources` REAIS do léxico (verbatim do banco). Fallback à
  // constante canônica só se o retorno vier sem fontes (mantém o requisito de licença
  // sempre visível quando o léxico/estudo aparece).
  const sources = lexicon?.sources ?? [];
  const attributionLines = sources.length > 0 ? sources : [STEP_ATTRIBUTION];
  const showAttribution = result != null || (lexicon != null && lexicon.entries.length > 0);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t('study.title', { source: sourceLabel })}
      testIDPrefix="study-panel"
      maxHeightPercent={88}
    >
      {/* ── AVISO "sem provedor de IA" (F5.37) ────────────────────────────
          Estudo profundo usa IA; sem nenhum provedor configurado, convite CLARO p/
          configurar (link à tela Ajustes), não um erro cru. Os recursos offline seguem
          sem chave; o provedor offline `mock` ainda produz o estudo abaixo. */}
      {showNoProviderNotice ? <AiProviderNotice onConfigure={onConfigureProvider} /> : null}

      {/* ── PROVEDOR (F6.7) ───────────────────────────────────────────────
          Seletor mock + BYOK reais. `mock` = default OFFLINE (prova headless). Provedor
          real → chave BYOK lida SOB DEMANDA em onStudy; sem chave → aviso + CTA p/ Ajustes. */}
      <SectionLabel>{t('ask.providerSection')}</SectionLabel>
      <ProviderChips
        options={options}
        provider={provider}
        providersWithKey={providersWithKey}
        disabled={busy}
        testIdPrefix="study"
        onSelect={setProvider}
      />
      {/* Provedor real sem chave → erro claro + CTA p/ Ajustes (não trava; envio desabilitado). */}
      {needsKey ? (
        <View style={styles.needKeyBlock} testID="study-provider-needkey">
          <Text style={styles.error}>{t('ask.needKeyError', { provider })}</Text>
          <Button
            title={t('ai.noProviderCta')}
            variant="secondary"
            onPress={onConfigureProvider}
            testID="study-provider-configure"
            accessibilityLabel={t('a11y.aiConfigure')}
            style={styles.actionBtn}
          />
        </View>
      ) : null}

      {/* ── MODO ──────────────────────────────────────────────────────── */}
      <SectionLabel>{t('study.modeSection')}</SectionLabel>
      <View style={styles.chips}>
        {MODE_OPTIONS.map((o) => (
          <Chip
            key={o.key}
            label={t(o.labelKey)}
            active={mode === o.value}
            onPress={() => setMode(o.value)}
            disabled={busy}
            testID={`study-mode-${o.key}`}
          />
        ))}
      </View>

      {/* ── LENTE (denominação) ───────────────────────────────────────── */}
      <SectionLabel>{t('study.lensSection')}</SectionLabel>
      <View style={styles.chips}>
        {LENS_OPTIONS.map((o) => (
          <Chip
            key={o.key}
            label={t(o.labelKey)}
            active={lens === o.value}
            onPress={() => setLens(o.value)}
            disabled={busy}
            testID={`study-lens-${o.key}`}
          />
        ))}
      </View>

      {/* ── PROFUNDIDADE ──────────────────────────────────────────────── */}
      <SectionLabel>{t('study.depthSection')}</SectionLabel>
      <View style={styles.chips}>
        {DEPTH_OPTIONS.map((o) => (
          <Chip
            key={o.key}
            label={t(o.labelKey)}
            active={depth === o.value}
            onPress={() => setDepth(o.value)}
            disabled={busy}
            testID={`study-depth-${o.key}`}
          />
        ))}
      </View>

      {/* ── PESQUISA WEB (opt-in) — ADR-0028/ADR-0032/ADR-0035 ───────────────
          Padrão DESLIGADO. Quando ligada, é rede além do LLM e o estudo Acadêmico ganha
          citações [W:n] das URLs (montadas pelo Rust `ai-pure`, NUNCA pelo modelo):
            • Wikipedia — KEYLESS (sem chave/segredo).
            • Tavily    — BYOK: a chave é SESSION-ONLY (perdida no reload, nunca persistida/
              logada) e vai SÓ no CORPO do POST. Aviso de privacidade/atribuição abaixo. */}
      <SectionLabel>{t('study.webSection')}</SectionLabel>
      <View style={styles.chips}>
        {WEB_OPTIONS.map((o) => (
          <Chip
            key={o.key}
            label={t(o.labelKey)}
            active={webBackend === o.value}
            onPress={() => setWebBackend(o.value)}
            disabled={busy}
            testID={`study-web-research-${o.key}`}
          />
        ))}
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

      <Button
        title={t('study.submit')}
        onPress={onStudy}
        loading={busy}
        disabled={studyDisabled}
        testID="study-submit"
        style={styles.actionBtn}
      />

      {/* ── CARREGANDO (UX do dado ON-DEMAND) — F5.15 (ADR-0044) ──────────
          O léxico (~9 MB) foi SEPARADO do caminho de leitura: só "desce" (lexicon-sample.
          sqlite, asset local — sem rede externa) quando o estudo/léxico roda. Este indicador
          torna a deferência HONESTA na 1ª abertura; nas próximas já está em OPFS (local). */}
      {busy ? (
        <View style={styles.loadingRow} testID="study-loading-lexicon">
          <ActivityIndicator color={colors.muted} />
          <Text style={styles.loadingText}>{t('study.loadingLexicon')}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* ── PASSAGEM (texto bíblico, verbatim do store) — primitiva CitedText ──
          Anti-alucinação VISÍVEL: a `passageText` vem do RETORNO real (store), atrás da
          régua dourada e rotulada como Escritura — NUNCA como saída do LLM. */}
      {result ? (
        <CitedText text={result.passageText} label={t('ai.citedTitle')} testID="study-passage-text" />
      ) : null}

      {/* ── INTERPRETAÇÃO (IA) — InterpretationBlock, rótulo DISTINTO da Escritura ──
          Saída do modelo (mock) + seções estruturadas (fatiadas por `## ` pelo core). */}
      {result ? (
        <InterpretationBlock label={t('ai.interpTitle')}>
          <Text style={styles.interpText} testID="study-interpretation">
            {result.interpretation}
          </Text>
          {result.sections.map((s, i) => (
            <View key={`${s.heading}-${i}`} style={styles.section}>
              <Text style={styles.sectionHeading}>{s.heading}</Text>
              <Text style={styles.interpText}>{s.body}</Text>
            </View>
          ))}
        </InterpretationBlock>
      ) : null}

      {/* ── AVISOS de verificação (Strong/[W:n] fora do acervo) ─────────── */}
      {result && result.warnings.length > 0 ? (
        <View style={styles.warnBlock} testID="study-warnings">
          <SectionLabel>{t('study.warnings')}</SectionLabel>
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
          <SectionLabel>{t('study.citations')}</SectionLabel>
          {result.citations.map((c, i) => (
            <View key={`${c.kind}-${c.key}-${i}`} style={styles.citeRow}>
              <Text style={styles.citeText}>
                [{c.kind}:{c.key}]
                {c.title ? ` ${c.title}` : ''}
                {c.license ? ` · ${c.license}` : ''}
              </Text>
              {c.attribution ? <Text style={styles.attribution}>{c.attribution}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {/* ── LÉXICO Strong inline (verbatim do léxico local verificado) ────
          Anti-alucinação: Strong/lema/translit/glosa vêm SÓ do banco (STEP Bible /
          TBESH–TBESG), nunca do modelo. */}
      {lexicon && lexicon.entries.length > 0 ? (
        <View style={styles.lexBlock} testID="study-lexicon">
          <SectionLabel>{t('study.lexicon')}</SectionLabel>
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
          <AiCostMeta
            model={result.model}
            promptText={result.passageText}
            interpretation={result.interpretation}
            style={styles.metaText}
            testID="study-cost"
          />
          <Text style={styles.disclaimer}>{t('study.disclaimer')}</Text>
        </View>
      ) : null}

      {/* ── EXPORTAÇÃO ACADÊMICA (F3.8) ──────────────────────────────────
          Markdown SBL (do core) + sidecar de citações, compartilhados pelo Share
          nativo (molde F1.11). Habilitado quando há resultado. */}
      {result ? (
        <>
          <Button
            title={t('study.exportAcademic')}
            onPress={onExportAcademic}
            testID="study-export-academic"
            style={styles.actionBtn}
          />
          {exportError ? <Text style={styles.error}>{exportError}</Text> : null}
        </>
      ) : null}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    // Folha/cabeçalho no <BottomSheet>; chips (mode/lens/depth/web) na <Chip> do kit; Escritura/
    // interpretação em CitedText/InterpretationBlock; botões em <Button>. Aqui: layout dos grupos
    // de chips, inputs, e os blocos de aparato (avisos/citações/léxico/atribuição/meta).
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
    needKeyBlock: { marginTop: space.sm, gap: space.xs },
    actionBtn: { marginTop: space.md },
    hint: { ...type.caption, color: colors.muted, marginTop: space.sm, fontStyle: 'italic' },
    keyInput: {
      marginTop: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      ...type.body,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.background,
    },
    loadingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
    loadingText: { ...type.caption, color: colors.muted, flexShrink: 1 },
    interpText: { ...type.body, color: colors.text, marginTop: space.xs },
    section: { marginTop: space.sm },
    sectionHeading: { ...type.body, fontWeight: '700', color: colors.text, marginTop: space.xs },
    warnBlock: { marginTop: space.md },
    warnText: { ...type.caption, color: colors.error, marginTop: 2 },
    citeBlock: { marginTop: space.md },
    citeRow: { marginTop: space.xs },
    citeText: { ...type.caption, color: colors.muted },
    lexBlock: { marginTop: space.md },
    lexRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    lexText: { ...type.body, fontSize: 14, color: colors.verseText, flexShrink: 1, paddingRight: space.sm },
    lexOcc: { ...type.caption, color: colors.muted },
    attributionBlock: { marginTop: space.md },
    attribution: {
      ...type.caption,
      color: colors.muted,
      textAlign: 'center',
      paddingHorizontal: space.sm,
      paddingTop: space.xs,
    },
    metaBlock: { marginTop: space.md, gap: space.xs },
    metaText: { ...type.caption, color: colors.muted },
    disclaimer: { ...type.caption, color: colors.muted, fontStyle: 'italic', marginTop: 2 },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
  });
}
