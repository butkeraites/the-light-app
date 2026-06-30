#!/usr/bin/env sh
# gen-sample-db.sh — (re)gera assets/data/sample.sqlite de forma REPRODUTÍVEL.
#
# F0.9: o sample é um subset KJV de domínio público (1 tradução + 1 livro +
# João 3:16 verbatim). O SCHEMA vem das migrações do the-light-core (uma fonte da
# verdade) via Store::open — nada de SQL de schema à mão. Ver ADR-0010.
#
# Offline-first: a única rede é em dev/build (cargo resolve deps). Nenhum segredo.
#
# Uso: ./scripts/gen-sample-db.sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/data/sample.sqlite"

mkdir -p "$ROOT/assets/data"

# Gerador nativo (host = embedded ligado): the_light_core::store::Store migra o
# schema e o exemplo insere as linhas de dado público (KJV verbatim).
( cd "$ROOT/core" && cargo run --quiet --example gen_sample_db -- "$OUT" )

echo "OK: $OUT"
