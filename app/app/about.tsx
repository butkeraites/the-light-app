// app/app/about.tsx — F5.35 (ADR-0055; molde SyncSettings F5.26 / painéis de leitura)
//
// TELA SOBRE / CRÉDITOS / LICENÇAS. Consolida, num só lugar, o que antes só aparecia
// contextualmente (atribuição OpenBible no painel de xref; STEP no painel de estudo) e o
// que não aparecia em lugar nenhum (KJV / Almeida 1911). Serve também de EXPLICADOR de 1º
// uso: o que o app é e os princípios inegociáveis. É alcançável pela Home (link "/about").
//
// LICENÇAS (fonte da verdade): as DUAS atribuições CC-BY são exibidas VERBATIM via
// `t('about.xrefAttribution')` (= `XREF_ATTRIBUTION` de ReaderXrefPanel) e
// `t('about.stepAttribution')` (= `STEP_ATTRIBUTION` de ReaderStudyPanel) — strings IDÊNTICAS
// em pt/en (identificadores de licença, não texto traduzível), travadas contra drift pelo
// guard `test:about-attr`. KJV e Almeida 1911 são DOMÍNIO PÚBLICO.
//
// OFFLINE-FIRST / ANTI-ALUCINAÇÃO: a tela é 100% CROMO — nenhum acesso a rede, nenhum
// segredo, nenhum texto bíblico (nada de store/IA aqui). O atalho de backup REUSA o mesmo
// `SyncSettings` da Home, carregado SOB DEMANDA (`import()`) para não pesar o 1º paint.
//
// i18n/a11y/tema: TODO cromo via `t()` (PT/EN); interativos com role+label+alvo de toque;
// cores por TOKENS de tema (zero hex).
import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import { Button } from '../components/ui';

/**
 * Atribuição CC-BY CANÔNICA da Bíblia Livre (ADR-0012, Rodada 3) — string VERBATIM (CC BY 3.0
 * Brasil, atribuição OBRIGATÓRIA). Fonte da verdade, espelhada em `about.blivreAttribution`
 * (pt==en) e travada contra drift pelo guard `test:about-attr` — mesmo molde de
 * `XREF_ATTRIBUTION`/`STEP_ATTRIBUTION`. NÃO alterar/omitir sem revisar a licença.
 */
export const BLIVRE_ATTRIBUTION =
  'Bíblia Livre (BLIVRE), © Diego Santos, Mario Sérgio e Marco Teles — CC-BY (Brasil), fonte: github.com/blivre/BibliaLivre';

export default function AboutScreen() {
  const { t } = useI18n();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Atalho de BACKUP/SINCRONIZAÇÃO: REUSA `SyncSettings` (F5.26), carregado SOB DEMANDA
  // (chunk async, fora do entry eager). Idêntico ao padrão da Home — não construímos outra
  // superfície de backup.
  const [syncOpen, setSyncOpen] = useState(false);
  const [SyncPanel, setSyncPanel] = useState<ComponentType<{ onClose?: () => void }> | null>(null);
  const openSync = useCallback(async () => {
    if (!SyncPanel) {
      const mod = await import('../components/SyncSettings');
      setSyncPanel(() => mod.SyncSettings);
    }
    setSyncOpen(true);
  }, [SyncPanel]);

  // Painel de sync aberto → substitui a tela Sobre (com voltar). O painel vive num chunk async.
  if (syncOpen && SyncPanel) {
    return <SyncPanel onClose={() => setSyncOpen(false)} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        {t('about.title')}
      </Text>
      <Text style={styles.intro}>{t('about.intro')}</Text>

      {/* Fontes de dados embarcadas + licença de cada uma (4 fontes). */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('about.sourcesTitle')}
        </Text>

        <Text style={styles.sourceName}>{t('about.kjvTitle')}</Text>
        <Text style={styles.license}>{t('about.publicDomain')}</Text>

        <Text style={[styles.sourceName, styles.sourceGap]}>{t('about.almeidaTitle')}</Text>
        <Text style={styles.license}>{t('about.publicDomain')}</Text>

        {/* Rodada 3 (ADR-0012): 2ª versão EN (BSB, domínio público) + 2ª versão PT (BLIVRE, CC-BY). */}
        <Text style={[styles.sourceName, styles.sourceGap]}>{t('about.bsbTitle')}</Text>
        <Text style={styles.license}>{t('about.publicDomain')}</Text>

        <Text style={[styles.sourceName, styles.sourceGap]}>{t('about.blivreTitle')}</Text>
        {/* Atribuição CC-BY VERBATIM (Bíblia Livre) — idêntica em pt/en; requisito de licença. */}
        <Text style={styles.attribution}>{t('about.blivreAttribution')}</Text>

        <Text style={[styles.sourceName, styles.sourceGap]}>{t('about.xrefTitle')}</Text>
        {/* Atribuição CC-BY VERBATIM (OpenBible) — idêntica em pt/en; requisito de licença. */}
        <Text style={styles.attribution}>{t('about.xrefAttribution')}</Text>

        <Text style={[styles.sourceName, styles.sourceGap]}>{t('about.stepTitle')}</Text>
        {/* Atribuição CC BY 4.0 VERBATIM (STEP/Tyndale) — idêntica em pt/en; requisito de licença. */}
        <Text style={styles.attribution}>{t('about.stepAttribution')}</Text>
      </View>

      {/* Princípios inegociáveis: offline-first · BYOK · anti-alucinação. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('about.principlesTitle')}
        </Text>
        <Text style={styles.body}>{t('about.offlineFirst')}</Text>
        <Text style={styles.body}>{t('about.byok')}</Text>
        <Text style={styles.body}>{t('about.antiHallucination')}</Text>
      </View>

      {/* F5.37: distinção EXPLÍCITA offline-vs-IA — o que funciona 100% offline (sem conta/chave)
          vs. o que usa IA e precisa de um provedor (BYOK). Deixa claro que o app NÃO está
          "quebrado" quando um recurso de IA pede configuração. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('about.aiVsOfflineTitle')}
        </Text>
        <Text style={styles.body}>{t('about.offlineFeatures')}</Text>
        <Text style={styles.body}>{t('about.aiFeatures')}</Text>
      </View>

      {/* Provedores de IA BYOK (opcional): Claude, GPT, Gemini, Ollama. */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('about.providersTitle')}
        </Text>
        <Text style={styles.body}>{t('about.providers')}</Text>
      </View>

      {/* Backup/export: REUSA `SyncSettings` (opt-in; 100% offline sem isto). */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {t('about.backupTitle')}
        </Text>
        <Text style={styles.hint}>{t('about.backupHint')}</Text>
        <Button
          title={t('home.syncBackup')}
          variant="secondary"
          onPress={openSync}
          testID="about-open-sync"
          accessibilityLabel={t('a11y.openSync')}
          style={styles.link}
        />
      </View>
    </ScrollView>
  );
}

// Estilos derivados dos TOKENS de tema (zero hex). Botão de backup via <Button> do kit.
function makeStyles({ colors, type, space }: ThemeContextValue) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: space.xl, gap: space.lg },
    title: { ...type.title, color: colors.text },
    intro: { ...type.body, color: colors.text },
    section: {
      gap: space.xs,
      paddingTop: space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    sectionTitle: { ...type.heading, color: colors.text },
    sourceName: { ...type.body, fontWeight: '600', color: colors.text },
    sourceGap: { marginTop: space.sm },
    license: { ...type.body, fontSize: 14, color: colors.muted, lineHeight: 20 },
    // Atribuição de licença (verbatim): mesmo tratamento visual dos rodapés dos painéis.
    attribution: { ...type.caption, color: colors.muted, lineHeight: 19 },
    body: { ...type.body, fontSize: 14, color: colors.text, lineHeight: 21 },
    hint: { ...type.caption, color: colors.muted, lineHeight: 19 },
    link: { marginTop: space.xs, alignSelf: 'flex-start' },
  });
}
