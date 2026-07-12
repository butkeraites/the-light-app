#!/usr/bin/env sh
# gen-bible-db.sh — (re)gera assets/data/bible.sqlite (corpus COMPLETO: KJV + Almeida 1911 +
# BSB + Bíblia Livre, ADR-0012
# + referências cruzadas OpenBible/TSK + dados de LÉXICO STEPBible) de forma REPRODUTÍVEL
# e IDEMPOTENTE, rodando os IMPORTADORES CANÔNICOS (`xtask import` + `xtask import-xref` +
# `xtask import-scholarly`) do `the-light` no rev PINADO c8ecb2f (ADR-0002) — SEM
# modificar/forkar o `the-light`.
#
# Anti-alucinação: o texto bíblico vem SEMPRE do importador sobre fontes de DOMÍNIO
# PÚBLICO registradas no `SPECS` do xtask (kjv = scrollmapper KJV.json; alm1911 =
# damarals ALM1911.json) — NUNCA texto inventado/hardcoded nem versão protegida.
# As referências cruzadas vêm SEMPRE do `import-xref` sobre a fonte CC-BY fixada no
# xtask (OpenBible.info / TSK; XREF_URL = mirror raw do scrollmapper) — NUNCA xrefs
# inventados/hardcoded. CC-BY exige atribuição (ver ADR-0016).
# Os DADOS DE LÉXICO (tokens de língua original + glosas breves + números de Strong)
# vêm SEMPRE do `import-scholarly` sobre a fonte CC-BY fixada no core `scholarly.rs`
# (STEP Bible / STEPBible-Data: TAHOT/TAGNT/TBESH/TBESG; STEP_RAW = raw github do
# STEPBible-Data) — NUNCA léxico inventado/hardcoded, NUNCA fonte não-livre (a denylist
# do core recusa sblgnt/morphgnt/louwnida/bdag/halot). CC-BY exige atribuição, gravada
# na tabela `scholarly_sources.attribution` e registrada em ADR-0026 (só dados livres).
# Idempotência: `import_translation` apaga+reinsere as linhas de cada versão;
# `import-xref` faz DELETE+reinsert da tabela `cross_references`; `import-scholarly` faz
# DELETE+reinsert por conjunto (`original_tokens`/`lexicon` por `source_id`) e
# INSERT OR REPLACE em `scholarly_sources` (reimportar não duplica).
#
# Offline-first é regra de RUNTIME: a única rede é em DEV/BUILD (download dos datasets
# de domínio público + do TSV de xrefs ~8,3 MB + dos TSV STEP do léxico ~dezenas de MB
# para o seed-dir). O app em runtime NÃO faz rede. Nenhum segredo.
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
#   ./scripts/gen-bible-db.sh            # baixa (se preciso) e importa kjv + alm1911 + xrefs + léxico
#   ./scripts/gen-bible-db.sh --force    # re-baixa os datasets/xrefs/léxico mesmo se já em cache
#   ./scripts/gen-bible-db.sh --offline  # falha em vez de baixar (usa só o cache do seed)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/data/bible.sqlite"
SEED="$ROOT/.cache/seed"                   # datasets brutos JSON baixados — SEMPRE ignorado
SEED_SCHOLARLY="$ROOT/.cache/seed/scholarly" # TSV STEPBible brutos (léxico) — SEMPRE ignorado
TARGET="$ROOT/.cache/xtask-target"          # CARGO_TARGET_DIR fora do checkout — ignorado

# rev PINADO do the-light (mesmo consumido por core/Cargo.toml — ADR-0002). Alinhado a
# c8ecb2f (rev do app) p/ um pipeline único: verses + xref + léxico no MESMO rev pinado.
# `import`/`import-xref` são byte-idênticos a 8f66004; c8ecb2f acrescenta
# `import-scholarly` (dados de léxico STEP). Ver ADR-0026.
# Rodada 3 (ADR-0012): bump p/ 76636af — o rev que registra BSB + BLIVRE no SPECS do xtask,
# convergido com o pin do core/Cargo.toml (mesmo rev; the-light-core é byte-idêntico ao fb09631).
# Convergência ADR-0062 (fatia LÉXICO): quando `core/Cargo.toml` avança p/ um rev do the-light
# COMPATÍVEL byte-a-byte com o pipeline de importadores (verses/xref/scholarly), este REV segue
# junto — pipeline ÚNICO exige o MESMO checkout do cargo. Bump p/ 80aa1a7 (o rev consumido por
# `core/Cargo.toml` desde #49); `Swatinem/rust-cache` mascarou o drift enquanto o cache do rev
# antigo sobreviveu, mas cargo só baixa o rev que o `Cargo.toml` pede — sem realinhar aqui,
# `xtask/Cargo.toml` do rev antigo some do runner e o deploy falha (o que aconteceu no run #10).
REV="80aa1a7"
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

mkdir -p "$ROOT/assets/data" "$SEED" "$SEED_SCHOLARLY" "$TARGET"

# Roda o importador CANÔNICO do rev pinado. CARGO_TARGET_DIR fora do checkout +
# --locked → nenhum artefato/lock é escrito no source do the-light.
# (rede em build OK: baixa kjv ~8.4MB + alm1911 ~4MB para o seed-dir na 1ª vez.)
# RESILIÊNCIA (deploy confiável): os importadores baixam de raw.githubusercontent.com, que às vezes
# devolve 429 (Too Many Requests) em rajadas. Como cada download é CACHEADO no seed-dir, um retry
# com backoff só re-baixa o que faltou → transiente de rede não derruba o deploy. Falha REAL (dado
# incompleto, guarda de drift) ainda aborta (o xtask sai ≠0 e esgotamos as tentativas).
retry() {
  local n=1 max=4 delay=15
  while true; do
    if "$@"; then return 0; fi
    if [ "$n" -ge "$max" ]; then
      echo "gen-bible-db.sh: falhou após $max tentativas: $*" >&2
      return 1
    fi
    echo "gen-bible-db.sh: tentativa $n/$max falhou (provável 429/rede transiente); aguardando ${delay}s…" >&2
    sleep "$delay"
    n=$((n + 1))
    delay=$((delay * 2))
  done
}

# shellcheck disable=SC2086
retry env CARGO_TARGET_DIR="$TARGET" cargo run --quiet --locked \
  --manifest-path "$XTASK_MANIFEST" -- \
  import --version kjv,alm1911,bsb,blivre --db "$OUT" --seed-dir "$SEED" $EXTRA

# Pipeline ÚNICO: APÓS popular verses+FTS, popula `cross_references` no MESMO --db com o
# subcomando DEDICADO `import-xref` (≠ `import --xref`) do MESMO rev pinado. Mesmo padrão
# de isolamento (checkout do cargo + CARGO_TARGET_DIR fora + --locked → the-light intocado).
# Fonte CC-BY fixada no xtask (XREF_URL; OpenBible.info / TSK via mirror raw do scrollmapper):
# baixa cross_references.txt ~8,3 MB para o seed-dir na 1ª vez (ausente da F1.1) e o reusa
# depois (offline OK a partir da 2ª vez). xref é independente de tradução → SEM --version.
# O xtask aborta se < 300.000 linhas válidas (guarda de drift; esperado ~344.799).
# `import_rows` faz DELETE+reinsert → idempotente (reimportar mantém a contagem).
# shellcheck disable=SC2086
retry env CARGO_TARGET_DIR="$TARGET" cargo run --quiet --locked \
  --manifest-path "$XTASK_MANIFEST" -- \
  import-xref --db "$OUT" --seed-dir "$SEED" $EXTRA

# Pipeline ÚNICO (3ª etapa): APÓS verses+FTS+xrefs, popula os DADOS DE LÉXICO no MESMO
# --db com o subcomando DEDICADO `import-scholarly` do MESMO rev pinado. Mesmo padrão de
# isolamento (checkout do cargo + CARGO_TARGET_DIR fora + --locked → the-light intocado).
# Fonte CC-BY fixada no core `scholarly.rs` (STEP Bible / STEPBible-Data): SEM --version
# importa os QUATRO conjuntos default = tahot,tagnt,tbesh,tbesg → popula `original_tokens`
# (tokens OT+NT + Strong), `lexicon` (glosas breves TBESH/TBESG) e `scholarly_sources`
# (atribuição CC-BY verbatim). Baixa os TSV STEP (~dezenas de MB) p/ o seed-dir na 1ª vez
# e os reusa depois (offline OK a partir da 2ª vez). Guarda de drift no core: aborta se
# abaixo dos pisos (tahot≥300k, tagnt≥100k, tbesh|tbesg≥5k; "fonte incompleta?").
# `import` (no core) faz DELETE+reinsert por conjunto → idempotente (reimportar mantém as
# contagens). Seed-dir DEDICADO ($SEED_SCHOLARLY) p/ não misturar com os JSON de verses.
# shellcheck disable=SC2086
retry env CARGO_TARGET_DIR="$TARGET" cargo run --quiet --locked \
  --manifest-path "$XTASK_MANIFEST" -- \
  import-scholarly --db "$OUT" --seed-dir "$SEED_SCHOLARLY" $EXTRA

echo "OK: $OUT"
