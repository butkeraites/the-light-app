#!/usr/bin/env sh
# gen-bible-db.sh — (re)gera assets/data/bible.sqlite (corpus COMPLETO: KJV + Almeida 1911)
# de forma REPRODUTÍVEL e IDEMPOTENTE, rodando o IMPORTADOR CANÔNICO (`xtask import`)
# do `the-light` no rev PINADO 8f66004 (ADR-0002) — SEM modificar/forkar o `the-light`.
#
# Anti-alucinação: o texto bíblico vem SEMPRE do importador sobre fontes de DOMÍNIO
# PÚBLICO registradas no `SPECS` do xtask (kjv = scrollmapper KJV.json; alm1911 =
# damarals ALM1911.json) — NUNCA texto inventado/hardcoded nem versão protegida.
# Idempotência: `import_translation` apaga+reinsere as linhas de cada versão.
#
# Offline-first é regra de RUNTIME: a única rede é em DEV/BUILD (download dos datasets
# de domínio público para o seed-dir). O app em runtime NÃO faz rede. Nenhum segredo.
#
# Como NÃO toca o `the-light` (ADR-0013): roda o member `xtask` do CHECKOUT PINADO do
# cargo (clone do GitHub gerenciado pelo cargo, independente do repo local protegido),
# com CARGO_TARGET_DIR APONTANDO PARA FORA do checkout (.cache/xtask-target, ignorado)
# e `--locked` (não reescreve o Cargo.lock do checkout). Nada é escrito no source dele.
#
# Armazenamento (ADR-0013): bible.sqlite é um ARTEFATO DE BUILD gerado por este script
# e IGNORADO no git (.gitignore); o seed-dir (datasets brutos) é SEMPRE ignorado.
#
# Uso:
#   ./scripts/gen-bible-db.sh            # baixa (se preciso) e importa kjv + alm1911
#   ./scripts/gen-bible-db.sh --force    # re-baixa os datasets mesmo se já em cache
#   ./scripts/gen-bible-db.sh --offline  # falha em vez de baixar (usa só o cache do seed)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/data/bible.sqlite"
SEED="$ROOT/.cache/seed"            # datasets brutos JSON baixados — SEMPRE ignorado
TARGET="$ROOT/.cache/xtask-target"  # CARGO_TARGET_DIR fora do checkout — ignorado

# rev PINADO do the-light (mesmo consumido por core/Cargo.toml — ADR-0002).
REV="8f66004"
XTASK_MANIFEST="$HOME/.cargo/git/checkouts/the-light-9eb8809a6d68281a/$REV/xtask/Cargo.toml"

# Repasse seletivo de flags conhecidas do `xtask import` (não aceita arbitrário).
EXTRA=""
for a in "$@"; do
  case "$a" in
    --offline | --force) EXTRA="$EXTRA $a" ;;
    *)
      echo "gen-bible-db.sh: flag desconhecida '$a' (aceitas: --offline, --force)" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$XTASK_MANIFEST" ]; then
  echo "gen-bible-db.sh: xtask do rev $REV não encontrado em:" >&2
  echo "  $XTASK_MANIFEST" >&2
  echo "  (resolva a git dep pinada: \`cargo fetch\` em core/ baixa o checkout 8f66004)" >&2
  exit 1
fi

mkdir -p "$ROOT/assets/data" "$SEED" "$TARGET"

# Roda o importador CANÔNICO do rev pinado. CARGO_TARGET_DIR fora do checkout +
# --locked → nenhum artefato/lock é escrito no source do the-light.
# (rede em build OK: baixa kjv ~8.4MB + alm1911 ~4MB para o seed-dir na 1ª vez.)
# shellcheck disable=SC2086
CARGO_TARGET_DIR="$TARGET" cargo run --quiet --locked \
  --manifest-path "$XTASK_MANIFEST" -- \
  import --version kjv,alm1911 --db "$OUT" --seed-dir "$SEED" $EXTRA

echo "OK: $OUT"
