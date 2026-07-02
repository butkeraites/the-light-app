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
// BYOK/offline-first (LEI): esta entrega usa SÓ o provedor `"mock"` (sem chave, sem
// rede) — o caminho da prova headless. A chave real + rede são a F3.10. NENHUMA chave é
// usada/logada aqui. O texto bíblico e as glosas vêm SEMPRE do store local, verbatim; o
// LLM só interpreta.
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { buildStudyExport } from '../lib/studyExport';
import { useTheme, type ThemeColors } from '../lib/theme';
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

// Provedor determinístico OFFLINE (sem chave, sem rede): o caminho da prova headless e o
// único provedor desta entrega (a chave real + rede são a F3.10).
const MOCK_PROVIDER = 'mock';

// Backend de pesquisa web OPT-IN (Wikipedia keyless, ADR-0028/ADR-0032): a única rede além
// do LLM, DESLIGADA por padrão. Quando o usuário liga, o estudo (modo Acadêmico) ganha
// citações `[W:n]`/`kind="Web"` das URLs buscadas — montadas pelo Rust `ai-pure`, nunca pelo
// modelo. Sem liga → `undefined` (offline, comportamento F3.12a).
const WIKIPEDIA_BACKEND = 'wikipedia';

/**
 * Atribuição STEP CC-BY CANÔNICA (ADR-0026) — string verbatim de
 * `scholarly_sources.attribution`. A UI exibe as `sources` REAIS do retorno (não esta
 * constante), mas exportamos a substring canônica p/ o grep de verificação e como
 * fallback textual do requisito de licença. NÃO alterar/omitir "STEP Bible".
 */
export const STEP_ATTRIBUTION =
  "Credit it to 'STEP Bible' linked to www.STEPBible.org (data based on work at Tyndale House, Cambridge; CC BY 4.0)";

/** Opção de seletor (rótulo PT + valor do enum + chave estável p/ o `testID`). */
type Option<T> = { value: T; key: string; label: string };

// Variantes REAIS da fronteira (F3.3) — rótulos PT p/ exibição; `key` = nome da variante
// (testID estável). Os VALORES são os enums gerados (uma fonte da verdade).
const MODE_OPTIONS: readonly Option<StudyMode>[] = [
  { value: StudyMode.Academic, key: 'Academic', label: 'Acadêmico' },
  { value: StudyMode.Devotional, key: 'Devotional', label: 'Devocional' },
  { value: StudyMode.Introductory, key: 'Introductory', label: 'Introdutório' },
  { value: StudyMode.Sermon, key: 'Sermon', label: 'Pregação' },
];
const LENS_OPTIONS: readonly Option<StudyLens>[] = [
  { value: StudyLens.Baptist, key: 'Baptist', label: 'Batista' },
  { value: StudyLens.Presbyterian, key: 'Presbyterian', label: 'Presbiteriana' },
  { value: StudyLens.Lutheran, key: 'Lutheran', label: 'Luterana' },
  { value: StudyLens.Pentecostal, key: 'Pentecostal', label: 'Pentecostal' },
  { value: StudyLens.Catholic, key: 'Catholic', label: 'Católica' },
  { value: StudyLens.Orthodox, key: 'Orthodox', label: 'Ortodoxa' },
];
const DEPTH_OPTIONS: readonly Option<StudyDepth>[] = [
  { value: StudyDepth.Overview, key: 'Overview', label: 'Visão geral' },
  { value: StudyDepth.Exegetical, key: 'Exegetical', label: 'Exegético' },
  { value: StudyDepth.WordStudy, key: 'WordStudy', label: 'Estudo de palavras' },
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
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<StudyMode>(StudyMode.Academic);
  const [lens, setLens] = useState<StudyLens>(StudyLens.Presbyterian);
  const [depth, setDepth] = useState<StudyDepth>(StudyDepth.Exegetical);
  // Pesquisa web OPT-IN (Wikipedia keyless) — padrão DESLIGADO (offline por padrão). É uma
  // PREFERÊNCIA do usuário: persiste entre passagens (não é resultado; não reseta no useEffect).
  const [webResearch, setWebResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudyResultOut | null>(null);
  const [lexicon, setLexicon] = useState<VerifiedLexiconOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Ao trocar de passagem ou fechar, limpa o resultado (nunca persiste texto entre refs).
  useEffect(() => {
    setResult(null);
    setLexicon(null);
    setError(null);
    setExportError(null);
  }, [book, chapter, verse, visible]);

  const studyDisabled = busy || dbPath == null;

  async function onStudy() {
    if (studyDisabled || dbPath == null) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setLexicon(null);
    try {
      // Provedor "mock" → sem chave (undefined), sem rede; modelo undefined → default do
      // core. O léxico é independente de tradução (sem `translation`). Ambas as chamadas
      // leem do STORE local verbatim (anti-alucinação): `passageText` + glosas do banco.
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
          MOCK_PROVIDER,
          undefined,
          undefined,
          // Pesquisa web opt-in (Wikipedia keyless) — só quando o usuário liga; senão offline.
          webResearch ? WIKIPEDIA_BACKEND : undefined,
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
      await Share.share({ message: exp.message, title: `Estudo — ${sourceLabel}` });
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
      <Pressable style={styles.backdrop} onPress={onClose} testID="study-panel-backdrop" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Estudo · {sourceLabel}</Text>
          <Pressable onPress={onClose} testID="study-panel-close" accessibilityRole="button">
            <Text style={styles.close}>Fechar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── MODO ──────────────────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Modo</Text>
          <View style={styles.chips}>
            {MODE_OPTIONS.map((o) => {
              const active = mode === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setMode(o.value)}
                  disabled={busy}
                  testID={`study-mode-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── LENTE (denominação) ───────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Lente (denominação)</Text>
          <View style={styles.chips}>
            {LENS_OPTIONS.map((o) => {
              const active = lens === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setLens(o.value)}
                  disabled={busy}
                  testID={`study-lens-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── PROFUNDIDADE ──────────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Profundidade</Text>
          <View style={styles.chips}>
            {DEPTH_OPTIONS.map((o) => {
              const active = depth === o.value;
              return (
                <Pressable
                  key={o.key}
                  style={[styles.chip, active ? styles.chipActive : null]}
                  onPress={() => setDepth(o.value)}
                  disabled={busy}
                  testID={`study-depth-${o.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── PESQUISA WEB (opt-in, Wikipedia keyless) — ADR-0028/ADR-0032 ─────
              Padrão DESLIGADO. Quando ligada, é a ÚNICA rede além do LLM: faz um `fetch`
              à Wikipedia (keyless, sem chave/segredo) e o estudo Acadêmico ganha citações
              [W:n] das URLs (do Rust, nunca do modelo). Aviso de privacidade abaixo. */}
          <Text style={styles.sectionTitle}>Pesquisa web (opcional)</Text>
          <View style={styles.chips}>
            <Pressable
              style={[styles.chip, webResearch ? styles.chipActive : null]}
              onPress={() => setWebResearch((v) => !v)}
              disabled={busy}
              testID="study-web-research-toggle"
              accessibilityRole="switch"
              accessibilityState={{ checked: webResearch }}
            >
              <Text style={[styles.chipText, webResearch ? styles.chipTextActive : null]}>
                Wikipedia {webResearch ? '✓ ligada' : '· desligada'}
              </Text>
            </Pressable>
          </View>
          {webResearch ? (
            <Text style={styles.hint} testID="study-web-research-privacy">
              Privacidade: ligada, esta opção consulta a Wikipedia (rede) para citar fontes.
              É a única rede além da IA e nenhuma chave/segredo é enviada (Wikipedia é keyless).
              O texto bíblico e as glosas continuam vindo do seu acervo local.
            </Text>
          ) : null}

          {/* Provedor fixo "mock" nesta entrega (offline; sem chave/rede). */}
          <Text style={styles.hint}>Provedor: mock (offline, sem chave/rede — F3.10 traz BYOK).</Text>

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
              <Text style={styles.btnText}>Estudar</Text>
            )}
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {/* ── PASSAGEM (texto bíblico, verbatim do store) ───────────────────
              Anti-alucinação VISÍVEL: a `passageText` vem do RETORNO real (store),
              rotulada como texto bíblico — NUNCA como saída do LLM. */}
          {result ? (
            <View style={styles.passageBlock}>
              <Text style={styles.sectionTitle}>Passagem (texto bíblico)</Text>
              <Text style={styles.passageText} testID="study-passage-text">
                {result.passageText}
              </Text>
            </View>
          ) : null}

          {/* ── INTERPRETAÇÃO (IA) ────────────────────────────────────────────
              Rótulo DISTINTO do texto bíblico. É a saída do modelo (mock), separada. */}
          {result ? (
            <View style={styles.interpBlock}>
              <Text style={styles.sectionTitle}>Interpretação (IA) — confira nas Escrituras</Text>
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
              <Text style={styles.sectionTitle}>Avisos</Text>
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
              <Text style={styles.sectionTitle}>Citações</Text>
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
              <Text style={styles.sectionTitle}>Léxico (línguas originais)</Text>
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
                Provedor: {result.provider} · Modelo: {result.model}
              </Text>
              <Text style={styles.disclaimer}>
                O texto bíblico e as glosas vêm do seu acervo local (verbatim); a IA apenas
                interpreta.
              </Text>
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
                <Text style={styles.btnText}>Exportar (acadêmico)</Text>
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
    hint: { fontSize: 12, color: colors.muted, marginTop: 10, fontStyle: 'italic' },
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
