import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseReference, type Reference } from '../web/reference';
// F5.12 (ADR-0041): `getPassage` (store web) só roda no submit (NUNCA no mount) —
// importado SOB DEMANDA via `import()` p/ sair do chunk EAGER de 1º paint (molde
// `reading.web.ts` / F5.9). O tipo `Passage` é `import type` (apagado na compilação
// → não puxa o glue p/ o entry).
import type { Passage } from '../web/passage';
import { runReferenceSelfTest } from '../web/selftest';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';

// F0.6b/F0.10 — tela ligada à fronteira Rust. A referência é SEMPRE resolvida
// PELO RUST (the-light-core via UniFFI), não por eco/parsing em TS.
//   - WEB (F0.10): `getPassage` resolve a referência (wasm) E lê o TEXTO do
//     versículo do store local (`wa-sqlite`/OPFS) — anti-alucinação: verbatim do
//     store, nunca hardcoded.
//   - NATIVO (F0.7/F0.8): `parseReference` via Turbo Module; a leitura de store
//     nativa (F0.9) não está ligada nesta tela.
//
// F5.2 (ADR-0038) — tela MIGRADA ponta a ponta: strings de UI via `t()` (i18n
// PT/EN), elementos interativos com a11y, e cores via TOKENS de tema (zero hex). O
// resultado é guardado como DADO estruturado (`Outcome`) e formatado no RENDER, de
// modo que trocar o idioma re-renderiza as strings de CROMO na hora — enquanto o
// TEXTO do versículo (`v.text`) permanece VERBATIM do store, nunca traduzido.
//
// ADR-0063 ("Vigil"): a apresentação foi retrabalhada sobre os TOKENS (tipografia serifa,
// escala de espaço/raio, superfícies) — título em serifa, campo de busca em pílula, uma AÇÃO
// PRIMÁRIA "Ler a Bíblia" em ouro e a navegação secundária agrupada num cartão. A LÓGICA
// (busca, self-test, sync, i18n, testIDs, a11y) é idêntica — só o CROMO/estrutura mudou.

// Estado do resultado como DADO (não string pronta): assim o CROMO (placeholder,
// rótulos de referência, erro) é traduzido no render, e o texto bíblico segue verbatim.
type Outcome =
  | { kind: 'idle' }
  | { kind: 'passage'; passage: Passage }
  | { kind: 'reference'; reference: Reference }
  | { kind: 'error'; message: string };

// Apresentação (NÃO parsing): formata o intervalo de versículos resolvido pelo Rust.
// Só rótulos de CROMO (`v.`/`vv.`/'capítulo inteiro') são traduzidos; os NÚMEROS são dados.
function formatVerses(verses: Reference['verses'], t: TranslateFn): string {
  switch (verses.tag) {
    case 'Single':
      return `${t('ref.verseSingle')} ${verses.inner.verse}`;
    case 'Range':
      return `${t('ref.verseRange')} ${verses.inner.start}-${verses.inner.end}`;
    case 'WholeChapter':
      return t('ref.wholeChapter');
    default:
      return '';
  }
}

// Rótulos de referência (CROMO) traduzidos; livro/capítulo são DADOS (números).
function formatReference(ref: Reference, t: TranslateFn): string {
  return `${t('ref.book')} ${ref.book} · ${t('ref.chapter')} ${ref.chapter} · ${formatVerses(ref.verses, t)}`;
}

// Apresentação: mostra o TEXTO verbatim lido do store local (NUNCA traduzido). Só o
// cabeçalho de referência e o aviso de "não encontrado" são CROMO traduzível.
function formatPassage(passage: Passage, t: TranslateFn): string {
  if (passage.verses.length === 0) {
    return t('home.verseNotFound');
  }
  const header = formatReference(passage.reference, t);
  const body = passage.verses.map((v) => v.text).join('\n');
  return `${header}\n\n${body}`;
}

export default function HomeScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const { colors } = theme;
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  // F5.26: SEÇÃO de SINCRONIZAÇÃO OPT-IN + backup. Carregada SOB DEMANDA (`import()`) —
  // o painel e seus motores (snapshot/driveAuth/driveSync) ficam num chunk ASYNC, FORA do
  // entry eager do 1º paint (perf-budget travado). Opt-in é OFF por padrão (`syncPrefs`).
  const [syncOpen, setSyncOpen] = useState(false);
  const [SyncPanel, setSyncPanel] = useState<ComponentType<{ onClose?: () => void }> | null>(null);
  const openSync = useCallback(async () => {
    if (!SyncPanel) {
      const mod = await import('../components/SyncSettings');
      setSyncPanel(() => mod.SyncSettings);
    }
    setSyncOpen(true);
  }, [SyncPanel]);

  // F0.7 — prova HEADLESS: sob EXPO_PUBLIC_TLA_SELFTEST=1, resolve "Jo 3.16" e
  // "John 3:16" pelo Turbo Module nativo e loga marcadores estáveis (capturados
  // pelo simulador). Não muda a UI normal (só dispara sob o env de teste).
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_TLA_SELFTEST === '1') {
      void runReferenceSelfTest();
    }
  }, []);

  async function handleSubmit() {
    const input = query.trim();
    if (input.length === 0) {
      setOutcome({ kind: 'idle' });
      return;
    }
    try {
      if (Platform.OS === 'web') {
        // WEB: resolve (Rust/wasm) + lê o texto do store local (wa-sqlite/OPFS).
        // O glue do store carrega SOB DEMANDA (F5.12) — chunk async, fora do 1º paint.
        const { getPassage } = await import('../web/passage');
        const passage = await getPassage(input);
        setOutcome({ kind: 'passage', passage });
      } else {
        // NATIVO: resolve a referência pelo Turbo Module (store nativo = F0.9).
        const ref = await parseReference(input);
        setOutcome({ kind: 'reference', reference: ref });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOutcome({ kind: 'error', message });
    }
  }

  // Formata o resultado NO RENDER (reativo ao idioma): cromo via `t()`; texto do
  // versículo verbatim do store (dentro de `formatPassage`).
  let resultText: string;
  switch (outcome.kind) {
    case 'passage':
      resultText = formatPassage(outcome.passage, t);
      break;
    case 'reference':
      resultText = formatReference(outcome.reference, t);
      break;
    case 'error':
      resultText = t('home.resolveError', { message: outcome.message });
      break;
    default:
      resultText = t('home.resultPlaceholder');
  }
  const hasResult = outcome.kind !== 'idle';

  // Painel de sync aberto → substitui a home (com voltar). O painel vive num chunk async.
  if (syncOpen && SyncPanel) {
    return <SyncPanel onClose={() => setSyncOpen(false)} />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {/* MARCA — título em serifa (type.display) + régua dourada. */}
      <View style={styles.brand}>
        <Text style={styles.title} accessibilityRole="header">
          {t('home.title')}
        </Text>
        <View style={styles.rule} />
      </View>

      {/* BUSCA — campo em pílula (mesma lógica de resolução da referência). */}
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={handleSubmit}
        returnKeyType="search"
        placeholder={t('home.inputPlaceholder')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        testID="passage-input"
        accessibilityLabel={t('a11y.searchInput')}
      />
      {Platform.OS === 'web' ? <Text style={styles.hint}>{t('home.hint')}</Text> : null}

      {/* F5.29: SEM accessibilityLabel — role="text" deixa o leitor anunciar os FILHOS
          (`resultText`): a passagem resolvida OU a mensagem de erro. Sem resultado, é um
          placeholder atenuado; com resultado, um cartão com o texto VERBATIM do store. */}
      <Text
        testID="result"
        style={[styles.result, hasResult ? styles.resultCard : styles.resultIdle]}
        accessibilityRole="text"
      >
        {resultText}
      </Text>

      {/* AÇÃO PRIMÁRIA — Ler a Bíblia (ouro). F5.30: paridade web concluída (as duas
          plataformas). F1.3: fluxo de leitura (livro → capítulo → texto). UM só elemento
          interativo (Pressable + router) com role/label/alvo ≥44 — a11y-scan verde. */}
      <Pressable
        onPress={() => router.push('/read')}
        style={styles.cta}
        testID="open-reader"
        accessibilityRole="link"
        accessibilityLabel={t('home.readBible')}
      >
        <Text style={styles.ctaTitle}>{t('home.readBible')}</Text>
        <Text style={styles.ctaChevron}>›</Text>
      </Pressable>

      {/* NAVEGAÇÃO SECUNDÁRIA — agrupada num cartão com divisórias (busca/planos/backup/
          sobre/ajustes). Cada linha é um Pressable único (role/label/alvo ≥44) — preserva o
          testID e a a11y do link original, sem aninhar Link+Pressable (a11y-scan). */}
      <View style={styles.rowsCard}>
        <Pressable
          onPress={() => router.push('/search')}
          style={styles.row}
          testID="open-search"
          accessibilityRole="link"
          accessibilityLabel={t('home.searchBible')}
        >
          <Text style={styles.rowLabel}>{t('home.searchBible')}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.rowDivider} />
        <Pressable
          onPress={() => router.push('/plans')}
          style={styles.row}
          testID="open-plans"
          accessibilityRole="link"
          accessibilityLabel={t('home.readingPlans')}
        >
          <Text style={styles.rowLabel}>{t('home.readingPlans')}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.rowDivider} />
        <Pressable
          onPress={openSync}
          style={styles.row}
          testID="open-sync"
          accessibilityRole="button"
          accessibilityLabel={t('a11y.openSync')}
        >
          <Text style={styles.rowLabel}>{t('home.syncBackup')}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.rowDivider} />
        <Pressable
          onPress={() => router.push('/about')}
          style={styles.row}
          testID="open-about"
          accessibilityRole="link"
          accessibilityLabel={t('a11y.openAbout')}
        >
          <Text style={styles.rowLabel}>{t('home.about')}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
        <View style={styles.rowDivider} />
        <Pressable
          onPress={() => router.push('/settings')}
          style={styles.row}
          testID="open-settings"
          accessibilityRole="link"
          accessibilityLabel={t('a11y.openSettings')}
        >
          <Text style={styles.rowLabel}>{t('home.settings')}</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Estilos derivados dos TOKENS (cor + tipografia + espaço + raio) — zero magic number.
function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      padding: space.xl,
      paddingTop: space.xxl,
      gap: space.lg,
    },
    brand: {
      gap: space.sm,
      marginBottom: space.xs,
    },
    title: {
      ...type.display,
      color: colors.text,
    },
    rule: {
      width: 44,
      height: 3,
      borderRadius: 3,
      backgroundColor: colors.accent,
    },
    input: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    hint: {
      ...type.caption,
      color: colors.muted,
      marginLeft: space.sm,
      marginTop: -space.sm,
    },
    result: {
      ...type.body,
      color: colors.text,
    },
    // Sem resultado: placeholder atenuado, sem cartão.
    resultIdle: {
      color: colors.muted,
    },
    // Com resultado: cartão de superfície (o texto do versículo é verbatim do store).
    resultCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: space.lg,
      lineHeight: 24,
    },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: radius.lg,
      paddingHorizontal: space.lg,
      paddingVertical: space.lg,
      // F5.20: alvo de toque confortável (≥44).
      minHeight: 56,
    },
    ctaTitle: {
      ...type.heading,
      color: colors.onAccent,
      flex: 1,
    },
    ctaChevron: {
      fontSize: 24,
      color: colors.onAccent,
    },
    rowsCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.lg,
      // F5.20: alvo de toque ≥44.
      minHeight: 52,
      paddingVertical: space.md,
    },
    rowLabel: {
      ...type.body,
      color: colors.text,
      flex: 1,
    },
    chevron: {
      fontSize: 20,
      color: colors.muted,
    },
    rowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginLeft: space.lg,
    },
  });
}
