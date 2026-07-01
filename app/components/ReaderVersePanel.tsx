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

import { HIGHLIGHT_COLORS, resolveHighlightColor } from '../lib/highlightColors';
import { buildNotesExport } from '../lib/notesExport';
import { useTheme, type ThemeColors } from '../lib/theme';
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
  /** Avisa a tela após criar/editar/remover nota ou highlight (re-lista indicadores). */
  onChanged: () => void;
  onClose: () => void;
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
      await Share.share({ message: text, title: 'Minhas notas — The Light' });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const noteEmpty = body.trim().length === 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="verse-panel-backdrop" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{sourceLabel}</Text>
          <Pressable onPress={onClose} testID="verse-panel-close" accessibilityRole="button">
            <Text style={styles.close}>Fechar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ── NOTA ─────────────────────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Nota</Text>
          {noteLoading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <TextInput
              style={styles.noteInput}
              value={body}
              onChangeText={setBody}
              placeholder="Escreva uma nota (Markdown)…"
              placeholderTextColor={colors.muted}
              multiline
              editable={!busy}
              testID="note-input"
              accessibilityLabel="Editor de nota do versículo"
            />
          )}
          <View style={styles.row}>
            <Pressable
              style={[styles.btn, noteEmpty || busy ? styles.btnDisabled : styles.btnPrimary]}
              onPress={onSaveNote}
              disabled={noteEmpty || busy}
              testID="note-save"
              accessibilityRole="button"
            >
              <Text style={styles.btnText}>Salvar nota</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, busy ? styles.btnDisabled : styles.btnGhost]}
              onPress={onDeleteNote}
              disabled={busy}
              testID="note-delete"
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, styles.btnGhostText]}>Remover nota</Text>
            </Pressable>
          </View>

          {/* ── MARCAÇÃO (highlight) ─────────────────────────────────────── */}
          <Text style={styles.sectionTitle}>Marcação</Text>
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
                  accessibilityRole="button"
                  accessibilityLabel={`Marcar com ${c.label}`}
                  accessibilityState={{ selected: active }}
                >
                  {active ? <Text style={styles.swatchCheck}>✓</Text> : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.btn, busy || !currentHighlight ? styles.btnDisabled : styles.btnGhost]}
              onPress={onRemoveHighlight}
              disabled={busy || !currentHighlight}
              testID="highlight-remove"
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, styles.btnGhostText]}>Desmarcar</Text>
            </Pressable>
          </View>

          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

          {/* ── ESTUDO ASSISTIDO (IA) — F2.5 ─────────────────────────────── */}
          {onAsk ? (
            <Pressable
              style={[styles.btn, styles.btnAsk]}
              onPress={onAsk}
              testID="verse-ask"
              accessibilityRole="button"
              accessibilityLabel="Perguntar à IA sobre esta passagem"
            >
              <Text style={styles.btnText}>Perguntar (IA)</Text>
            </Pressable>
          ) : null}

          {/* ── ESTUDO PROFUNDO (IA) — F3.5 ──────────────────────────────── */}
          {onStudy ? (
            <Pressable
              style={[styles.btn, styles.btnAsk]}
              onPress={onStudy}
              testID="verse-study"
              accessibilityRole="button"
              accessibilityLabel="Estudo profundo (IA) desta passagem"
            >
              <Text style={styles.btnText}>Estudo (IA)</Text>
            </Pressable>
          ) : null}

          {/* ── EXPORTAR ─────────────────────────────────────────────────── */}
          <Pressable
            style={[styles.btn, styles.btnExport]}
            onPress={onExport}
            testID="notes-export"
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, styles.btnGhostText]}>Exportar minhas notas</Text>
          </Pressable>

          {/* ── REFERÊNCIAS CRUZADAS (F1.9) ──────────────────────────────── */}
          <Text style={styles.sectionTitle}>Referências cruzadas</Text>
          {xrefLoading ? (
            <ActivityIndicator color={colors.text} />
          ) : xrefError ? (
            <Text style={styles.error}>{xrefError}</Text>
          ) : refs.length === 0 ? (
            <Text style={styles.empty}>Sem referências cruzadas para este versículo.</Text>
          ) : (
            <View>
              {refs.map((cr) => {
                const verseLabel = formatVerses(cr.reference.verses);
                const label = `${bookNameOf(cr.reference.book)} ${cr.reference.chapter}${
                  verseLabel ? `:${verseLabel}` : ''
                }`;
                return (
                  <Pressable
                    key={keyOf(cr.reference)}
                    style={styles.xrefRow}
                    onPress={() => onSelectXref(cr.reference)}
                    testID={`xref-${keyOf(cr.reference)}`}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                  >
                    <Text style={styles.xrefRef}>{label}</Text>
                    <Text style={styles.xrefVotes}>{String(cr.votes)} votos</Text>
                  </Pressable>
                );
              })}
              {/* Atribuição CC-BY OBRIGATÓRIA (ADR-0016) — string EXATA. */}
              <Text style={styles.attribution}>{XREF_ATTRIBUTION}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
      maxHeight: '80%',
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
    noteInput: {
      minHeight: 90,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 15,
      color: colors.verseText,
      textAlignVertical: 'top',
    },
    row: { flexDirection: 'row', gap: 8, marginTop: 8 },
    btn: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnPrimary: { backgroundColor: colors.chipActiveBg },
    btnGhost: { borderWidth: 1, borderColor: colors.border },
    btnExport: { borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start', marginTop: 8 },
    btnAsk: { backgroundColor: colors.chipActiveBg, alignSelf: 'flex-start', marginTop: 12 },
    btnDisabled: { backgroundColor: colors.divider, opacity: 0.6 },
    btnText: { fontSize: 14, fontWeight: '600', color: colors.chipActiveText },
    btnGhostText: { color: colors.accent },
    swatches: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchActive: { borderWidth: 2, borderColor: colors.accent },
    swatchCheck: { fontSize: 16, fontWeight: '800', color: colors.text },
    xrefRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    xrefRef: { fontSize: 15, fontWeight: '600', color: colors.accent },
    xrefVotes: { fontSize: 13, color: colors.muted },
    empty: { fontSize: 14, color: colors.muted },
    error: { fontSize: 14, color: colors.error },
    attribution: { fontSize: 12, color: colors.muted, textAlign: 'center', paddingTop: 12 },
  });
}
