import { useEffect, useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseReference, type Reference } from '../web/reference';
import { getPassage, type Passage } from '../web/passage';
import { runReferenceSelfTest } from '../web/selftest';
import { useI18n, type TranslateFn } from '../lib/i18n';
import { useTheme, type ThemeColors } from '../lib/theme';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

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

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        {t('home.title')}
      </Text>

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

      <Text
        testID="result"
        style={styles.result}
        accessibilityRole="text"
        accessibilityLabel={t('a11y.result')}
      >
        {resultText}
      </Text>

      {/* F1.3: entrada para a UI de leitura nativa (livro → capítulo → texto +
          seletor de versão). Lê do store local no device pela fronteira nativa. */}
      {Platform.OS === 'web' ? null : (
        <Link
          href="/read"
          style={styles.readLink}
          testID="open-reader"
          accessibilityRole="link"
          accessibilityLabel={t('home.readBible')}
        >
          {t('home.readBible')}
        </Link>
      )}

      {/* F1.6: entrada para a BUSCA nativa (campo + resultados clicáveis). A busca
          lê pela fronteira `search` (F1.5 → JSI → core); web = stub (F1.14). */}
      {Platform.OS === 'web' ? null : (
        <Link
          href="/search"
          style={styles.readLink}
          testID="open-search"
          accessibilityRole="link"
          accessibilityLabel={t('home.searchBible')}
        >
          {t('home.searchBible')}
        </Link>
      )}

      {/* F5.7: entrada para os PLANOS de leitura nativos (lista → iniciar → dia de
          hoje → marcar). Orquestra a geração (F5.1) + o progresso (F5.4) via a
          fronteira nativa; native-first (paridade web = F5.10) → gateada p/ nativo. */}
      {Platform.OS === 'web' ? null : (
        <Link
          href="/plans"
          style={styles.readLink}
          testID="open-plans"
          accessibilityRole="link"
          accessibilityLabel={t('home.readingPlans')}
        >
          {t('home.readingPlans')}
        </Link>
      )}
    </View>
  );
}

// Estilos derivados dos TOKENS de tema (zero hex hardcoded — molde ReaderChapterView).
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      padding: 24,
      gap: 16,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.text,
    },
    hint: {
      fontSize: 12,
      color: colors.muted,
    },
    result: {
      fontSize: 16,
      color: colors.text,
    },
    readLink: {
      marginTop: 8,
      fontSize: 16,
      fontWeight: '600',
      color: colors.accent,
    },
  });
}
