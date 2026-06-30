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

if [ ! -f "$SRC" ]; then
  echo "gen-reading-sample-db.sh: corpus de origem ausente em $SRC" >&2
  echo "  rode ./scripts/gen-bible-db.sh primeiro (ADR-0013)." >&2
  exit 1
fi

mkdir -p "$ROOT/assets/data"

# Gerador nativo (host = embedded ligado): Store::open migra o schema; o exemplo
# anexa o bible.sqlite e copia os livros do subset (texto verbatim do store).
( cd "$ROOT/core" && cargo run --quiet --example gen_reading_sample_db -- "$OUT" "$SRC" )

echo "OK: $OUT"
