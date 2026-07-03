#!/usr/bin/env sh
# gen-reading-sample-db.sh — (re)gera assets/data/reading-sample.sqlite (subset de
# LEITURA: KJV + Almeida 1911, livros Gênesis/Salmos/João) de forma REPRODUTÍVEL.
#
# F1.3/ADR-0014: o app nativo empacota ESTE subset como asset (não o bible.sqlite
# completo de ~47 MB) e o copia p/ um caminho gravável no 1º boot, onde o rusqlite
# (core) o abre. O subset DEVE conter João KJV completo (21 capítulos) p/ as
# asserções do self-test de leitura valerem.
#
# Regra "uma fonte da verdade": o SCHEMA vem das migrações do the-light-core
# (Store::open) via o exemplo `gen_reading_sample_db`; o TEXTO é copiado verbatim
# do bible.sqlite (domínio público) — nada de schema/texto à mão (anti-alucinação).
#
# Pré-requisito: assets/data/bible.sqlite presente (gere com ./scripts/gen-bible-db.sh).
# Offline-first: a única rede é em dev/build (cargo resolve deps). Nenhum segredo.
#
# Armazenamento (ADR-0014): reading-sample.sqlite é ARTEFATO DE BUILD gerado por
# este script e IGNORADO no git (.gitignore), como o bible.sqlite (ADR-0013).
#
# Uso: ./scripts/gen-reading-sample-db.sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/data/reading-sample.sqlite"
SRC="$ROOT/assets/data/bible.sqlite"
# F5.15 (ADR-0044): subsets WEB derivados do combinado, para tirar o DADO do léxico
# (~9 MB) do caminho de LEITURA. `reading-lite` = leitura/busca/xref (SEM léxico);
# `lexicon-sample` = léxico STEP CC-BY (carregado ON-DEMAND só no estudo/léxico).
LITE="$ROOT/assets/data/reading-lite.sqlite"
LEX="$ROOT/assets/data/lexicon-sample.sqlite"

if [ ! -f "$SRC" ]; then
  echo "gen-reading-sample-db.sh: corpus de origem ausente em $SRC" >&2
  echo "  rode ./scripts/gen-bible-db.sh primeiro (ADR-0013)." >&2
  exit 1
fi

mkdir -p "$ROOT/assets/data"

# Gerador nativo (host = embedded ligado): Store::open migra o schema; o exemplo
# anexa o bible.sqlite e copia os livros do subset (texto verbatim do store).
# ESTE combinado (`reading-sample.sqlite`) segue sendo o asset do app NATIVO (F1.3/
# ADR-0014) e a FONTE dos subsets web abaixo — uma única fonte da verdade.
( cd "$ROOT/core" && cargo run --quiet --example gen_reading_sample_db -- "$OUT" "$SRC" )

echo "OK: $OUT"

# ── F5.15 (ADR-0044): split WEB — léxico fora do caminho de leitura ───────────
# O `reading-sample.sqlite` combinado tem ~14,4 MB, dos quais ~9 MB são LÉXICO
# (`original_tokens`/`lexicon`/`scholarly_sources`/`morph_legend`) usado SÓ pelo
# estudo/léxico (opt-in, IA). Leitores puros baixavam tudo. Derivamos, de forma
# REPRODUTÍVEL e app-side (sem tocar o core: nenhum schema é escrito à mão — só
# removemos tabelas do combinado, cujo schema veio das migrações do core, e
# compactamos), dois subsets para o WEB:
#   • reading-lite.sqlite  — leitura/busca/xref: translations/books/verses/
#     cross_references/verses_fts/versification_map. SEM tabelas de léxico
#     (removidas → o caminho de leitura NÃO pode nem consultar léxico por engano).
#   • lexicon-sample.sqlite — SÓ léxico STEP CC-BY: scholarly_sources/
#     original_tokens/lexicon/morph_legend (carregado ON-DEMAND ao abrir estudo/
#     léxico). A atribuição STEP CC-BY (ADR-0026) fica intacta neste arquivo.
# `VACUUM` compacta (remove as páginas liberadas) → tamanho reprodutível byte-a-byte.
# O NATIVO segue no combinado (`reading-sample.sqlite`); o split é WEB-scoped.
command -v sqlite3 >/dev/null 2>&1 || {
  echo "gen-reading-sample-db.sh: 'sqlite3' (CLI) ausente — necessário p/ o split web (F5.15)." >&2
  exit 1
}

# reading-lite: remove o LÉXICO (ordem filho→pai por causa das FKs para
# scholarly_sources) e compacta. Mantém `verses_fts` (busca FTS5 na leitura).
rm -f "$LITE" "$LITE-wal" "$LITE-shm" "$LITE-journal"
cp "$OUT" "$LITE"
sqlite3 "$LITE" \
  "DROP TABLE IF EXISTS original_tokens; \
   DROP TABLE IF EXISTS lexicon; \
   DROP TABLE IF EXISTS morph_legend; \
   DROP TABLE IF EXISTS scholarly_sources; \
   VACUUM;"

# lexicon-sample: remove as tabelas de LEITURA (inclui a virtual `verses_fts`) e
# compacta — sobra só o léxico (dado on-demand do estudo/léxico).
rm -f "$LEX" "$LEX-wal" "$LEX-shm" "$LEX-journal"
cp "$OUT" "$LEX"
sqlite3 "$LEX" \
  "DROP TABLE IF EXISTS verses_fts; \
   DROP TABLE IF EXISTS cross_references; \
   DROP TABLE IF EXISTS versification_map; \
   DROP TABLE IF EXISTS verses; \
   DROP TABLE IF EXISTS books; \
   DROP TABLE IF EXISTS translations; \
   VACUUM;"

echo "OK: $LITE ($(wc -c < "$LITE" | tr -d ' ') bytes) — leitura/busca/xref, SEM léxico"
echo "OK: $LEX ($(wc -c < "$LEX" | tr -d ' ') bytes) — léxico STEP CC-BY, on-demand"
