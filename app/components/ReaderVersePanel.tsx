// app/components/ReaderVersePanel.tsx — F1.11 (ADR-0017 / ADR-0015 tema / ADR-0016 xref)
//
// Painel por-versículo (bottom sheet, molde do `ReaderXrefPanel` da F1.9) aberto pelo
// MESMO gesto de seleção de versículo. Reúne, numa só folha, as ações da referência
// selecionada:
//   • NOTA: `TextInput` multiline (carrega a nota existente via `getNote`), Salvar
//     (`putNote`) / Remover (`deleteNote`);
//   • MARCAÇÃO: chips de cor (paleta nomeada) → `addHighlight`; Remover →
//     `removeHighlight`;
//   • REFERÊNCIAS CRUZADAS (F1.9): lista `CrossRef[]` JÁ ordenada pela fronteira +
//     atribuição CC-BY obrigatória (ADR-0016);
//   • EXPORTAR: `Share` (react-native) com o agregado montado dos Records
//     (`buildNotesExport`) — sem reimplementar a serialização do store.
//
// A UI SÓ chama a fronteira `userdata` (F1.10) e APRESENTA os Records — nenhum I/O de
// arquivo de userdata, slug ou ordenação em TS (uma fonte da verdade). Cores via
// TOKENS de tema (`useTheme`); as cores de highlight (dado do usuário) vêm da paleta
// nomeada (`highlightColors.ts`). Anti-alucinação: a referência é canônica via o core;
// o corpo da nota é texto livre do usuário.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { HIGHLIGHT_COLORS, resolveHighlightColor } from '../lib/highlightColors';
import { useI18n } from '../lib/i18n';
import { buildNotesExport } from '../lib/notesExport';
import { useTheme, type ThemeContextValue } from '../lib/theme';
import {
  addHighlight,
  deleteNote,
  getNote,
  listHighlights,
  listNotes,
  putNote,
  removeHighlight,
  type CrossRef,
} from '../web/reading';
import { XREF_ATTRIBUTION } from './ReaderXrefPanel';
import { BottomSheet, Button, ListRow, SectionLabel } from './ui';

type XrefReference = CrossRef['reference'];

/** Formata o(s) versículo(s) de destino de uma xref (Single/Range). */
function formatVerses(verses: XrefReference['verses']): string {
  switch (verses.tag) {
    case 'Single':
      return String(verses.inner.verse);
    case 'Range':
      return `${verses.inner.start}-${verses.inner.end}`;
    default:
      return '';
  }
}

function keyOf(ref: XrefReference): string {
  return `${ref.book}-${ref.chapter}-${formatVerses(ref.verses) || 'ch'}`;
}

export function ReaderVersePanel({
  visible,
  sourceLabel,
  reference,
  dataDir,
  currentHighlight,
  refs,
  xrefLoading,
  xrefError,
  bookNameOf,
  onSelectXref,
  onAsk,
  onStudy,
  onChat,
  onCompare,
  onChanged,
  onClose,
}: {
  visible: boolean;
  /** Rótulo legível do versículo selecionado (ex.: "João 3:16"), só p/ o cabeçalho. */
  sourceLabel: string;
  /** Referência CANÔNICA p/ a fronteira (ex.: "John 3:16"); o core a parseia. */
  reference: string;
  /** Diretório de userdata gravável (`ensureUserDataDir()`); `null` enquanto carrega. */
  dataDir: string | null;
  /** Cor do highlight atual deste versículo (nome), ou `null` se não há. */
  currentHighlight: string | null;
  /** Xrefs do versículo (F1.9), já ordenadas pela fronteira. */
  refs: CrossRef[];
  xrefLoading: boolean;
  xrefError: string | null;
  /** Nome do livro (p/ rótulos de xref e do export). */
  bookNameOf: (book: number) => string;
  onSelectXref: (ref: XrefReference) => void;
  /** Abre o estudo assistido (IA) ancorado nesta passagem (F2.5). Opcional. */
  onAsk?: () => void;
  /** Abre o estudo profundo (IA) ancorado nesta passagem (F3.5). Opcional. */
  onStudy?: () => void;
  /** Abre a conversa/follow-up (IA) ancorada nesta passagem (F3.6). Opcional. */
  onChat?: () => void;
  /** Abre a comparação multi-IA (N provedores lado a lado) desta passagem (F3.7). Opcional. */
  onCompare?: () => void;
  /** Avisa a tela após criar/editar/remover nota ou highlight (re-lista indicadores). */
  onChanged: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { colors, isDark } = theme;
  // F5.16: só o CROMO (seções, botões, placeholders, a11y) passa por `t()`. O
  // `{sourceLabel}` e os nomes de livro (`bookNameOf`) vêm do STORE; o corpo da NOTA é
  // texto livre do usuário; a atribuição CC-BY é VERBATIM — nada disso via `t()`
  // (anti-alucinação). `{color}` = rótulo da paleta de marcação (dado da app).
  const { t } = useI18n();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [body, setBody] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Carrega a nota existente da referência ao abrir (round-trip via a fronteira).
  useEffect(() => {
    if (!visible || !dataDir) {
      return;
    }
    let alive = true;
    setNoteLoading(true);
    setActionError(null);
    (async () => {
      try {
        const note = await getNote(dataDir, reference);
        if (alive) {
          setBody(note?.body ?? '');
          setNoteLoading(false);
        }
      } catch (err) {
        if (alive) {
          setActionError(err instanceof Error ? err.message : String(err));
          setNoteLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, dataDir, reference]);

  async function withBusy(fn: () => Promise<void>) {
    if (!dataDir) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onSaveNote() {
    void withBusy(async () => {
      await putNote(dataDir!, reference, body);
    });
  }

  function onDeleteNote() {
    void withBusy(async () => {
      await deleteNote(dataDir!, reference);
      setBody('');
    });
  }

  function onSetHighlight(color: string) {
    // `tag` opcional omitido nesta entrega (undefined). Mesma ref substitui a cor.
    void withBusy(async () => {
      await addHighlight(dataDir!, reference, color, undefined);
    });
  }

  function onRemoveHighlight() {
    void withBusy(async () => {
      await removeHighlight(dataDir!, reference);
    });
  }

  async function onExport() {
    if (!dataDir) {
      return;
    }
    setActionError(null);
    try {
      // EXPORT = agregado dos Records (apresentação) — não reescreve o store.
      const [notes, highlights] = await Promise.all([listNotes(dataDir), listHighlights(dataDir)]);
      const text = buildNotesExport(notes, highlights, bookNameOf);
      await Share.share({ message: text, title: t('versePanel.exportShareTitle') });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const noteEmpty = body.trim().length === 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={sourceLabel} testIDPrefix="verse-panel" maxHeightPercent={82}>
      {/* ── NOTA ─────────────────────────────────────────────────────── */}
      <SectionLabel>{t('versePanel.noteSection')}</SectionLabel>
      {noteLoading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <TextInput
          style={styles.noteInput}
          value={body}
          onChangeText={setBody}
          placeholder={t('versePanel.notePlaceholder')}
          placeholderTextColor={colors.muted}
          multiline
          editable={!busy}
          testID="note-input"
          accessibilityLabel={t('versePanel.noteEditorLabel')}
        />
      )}
      <View style={styles.row}>
        <Button title={t('versePanel.saveNote')} onPress={onSaveNote} disabled={noteEmpty || busy} testID="note-save" />
        <Button title={t('versePanel.deleteNote')} variant="ghost" onPress={onDeleteNote} disabled={busy} testID="note-delete" />
      </View>

      {/* ── MARCAÇÃO (highlight) ─────────────────────────────────────── */}
      <SectionLabel>{t('versePanel.highlightSection')}</SectionLabel>
      <View style={styles.swatches}>
        {HIGHLIGHT_COLORS.map((c) => {
          const active = currentHighlight === c.name;
          return (
            <Pressable
              key={c.name}
              style={[
                styles.swatch,
                { backgroundColor: resolveHighlightColor(c.name, isDark) },
                active ? styles.swatchActive : null,
              ]}
              onPress={() => onSetHighlight(c.name)}
              disabled={busy}
              testID={`highlight-${c.name}`}
              hitSlop={{ top: 8, bottom: 8, left: 5, right: 5 }}
              accessibilityRole="button"
              accessibilityLabel={t('versePanel.highlightWith', { color: t(`highlight.${c.name}`) })}
              accessibilityState={{ selected: active }}
            >
              {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
            </Pressable>
          );
        })}
      </View>
      <Button
        title={t('versePanel.unhighlight')}
        variant="ghost"
        onPress={onRemoveHighlight}
        disabled={busy || !currentHighlight}
        testID="highlight-remove"
        style={styles.inlineBtn}
      />

      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

      {/* ── AÇÕES DE IA (grade 2×2; Perguntar em destaque) ────────────── */}
      {onAsk || onStudy || onChat || onCompare ? (
        <>
          <SectionLabel>{t('versePanel.aiSection')}</SectionLabel>
          <View style={styles.aiGrid}>
            {onAsk ? (
              <View style={styles.aiCell}>
                <Button title={t('versePanel.askButton')} icon="ask" onPress={onAsk} testID="verse-ask" accessibilityLabel={t('versePanel.askLabel')} />
              </View>
            ) : null}
            {onStudy ? (
              <View style={styles.aiCell}>
                <Button title={t('versePanel.studyButton')} icon="study" variant="secondary" onPress={onStudy} testID="verse-study" accessibilityLabel={t('versePanel.studyLabel')} />
              </View>
            ) : null}
            {onChat ? (
              <View style={styles.aiCell}>
                <Button title={t('versePanel.chatButton')} icon="chat" variant="secondary" onPress={onChat} testID="verse-chat" accessibilityLabel={t('versePanel.chatLabel')} />
              </View>
            ) : null}
            {onCompare ? (
              <View style={styles.aiCell}>
                <Button title={t('versePanel.compareButton')} icon="compare" variant="secondary" onPress={onCompare} testID="verse-compare" accessibilityLabel={t('versePanel.compareLabel')} />
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {/* ── EXPORTAR ─────────────────────────────────────────────────── */}
      <Button
        title={t('versePanel.exportButton')}
        variant="ghost"
        icon="share"
        onPress={onExport}
        testID="notes-export"
        style={styles.inlineBtn}
      />

      {/* ── REFERÊNCIAS CRUZADAS (F1.9) ──────────────────────────────── */}
      <SectionLabel>{t('xref.section')}</SectionLabel>
      {xrefLoading ? (
        <ActivityIndicator color={colors.text} />
      ) : xrefError ? (
        <Text style={styles.error}>{xrefError}</Text>
      ) : refs.length === 0 ? (
        <Text style={styles.empty}>{t('xref.empty')}</Text>
      ) : (
        <View>
          {refs.map((cr) => {
            const verseLabel = formatVerses(cr.reference.verses);
            const label = `${bookNameOf(cr.reference.book)} ${cr.reference.chapter}${verseLabel ? `:${verseLabel}` : ''}`;
            return (
              <ListRow
                key={keyOf(cr.reference)}
                label={label}
                value={t('xref.votes', { count: String(cr.votes) })}
                onPress={() => onSelectXref(cr.reference)}
                testID={`xref-${keyOf(cr.reference)}`}
                accessibilityLabel={label}
              />
            );
          })}
          {/* Atribuição CC-BY OBRIGATÓRIA (ADR-0016) — string EXATA. */}
          <Text style={styles.attribution}>{XREF_ATTRIBUTION}</Text>
        </View>
      )}
    </BottomSheet>
  );
}

function makeStyles({ colors, type, space, radius }: ThemeContextValue) {
  return StyleSheet.create({
    noteInput: {
      minHeight: 90,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      padding: space.md,
      ...type.body,
      color: colors.verseText,
      textAlignVertical: 'top',
    },
    row: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
    inlineBtn: { alignSelf: 'flex-start', marginTop: space.sm },
    swatches: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchActive: { borderWidth: 2, borderColor: colors.accent },
    swatchCheck: { ...type.button, color: colors.text },
    aiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
    aiCell: { flexBasis: '47%', flexGrow: 1 },
    empty: { ...type.body, color: colors.muted },
    error: { ...type.body, color: colors.error, marginTop: space.sm },
    attribution: { ...type.caption, color: colors.muted, textAlign: 'center', paddingTop: space.md },
  });
}
