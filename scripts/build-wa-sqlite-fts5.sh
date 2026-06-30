#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/build-wa-sqlite-fts5.sh — F1.14 (ADR-0020; detalha ADR-0011/0012)
#
# Constrói, de forma REPRODUZÍVEL e OFFLINE-FIRST, um `wa-sqlite` (build SÍNCRONO)
# COM a extensão FTS5 habilitada (`-DSQLITE_ENABLE_FTS5`) — necessária para a
# BUSCA web (F1.14), que espelha o `MATCH`/`bm25()`/`highlight()` do core
# (the-light-core::search). O `wa-sqlite@1.0.0` do npm NÃO compila o FTS5
# (probe: `CREATE VIRTUAL TABLE … USING fts5` → "no such module: fts5"), então
# geramos nosso próprio par `.mjs`+`.wasm` a partir da FONTE do wa-sqlite, via
# Emscripten dentro do `docker` (o ambiente não tem `emcc` no PATH; rede de
# dev/build é permitida — ADR-0001 — mas o ARTEFATO é um asset LOCAL: zero rede
# em runtime, sem SharedArrayBuffer/COOP-COEP).
#
# Por que FTS5 já funciona só com a flag: a amalgamação canônica do SQLite
# (`sqlite3.c`) JÁ contém o código-fonte do FTS5, compilado-fora por padrão e
# ATIVADO ao definir `SQLITE_ENABLE_FTS5`. Mantemos o build SÍNCRONO (só o módulo
# `dist/wa-sqlite.mjs`, sem Asyncify/JSPI) — paridade com o backend da F1.13.
#
# Saída (VERSIONADA como asset local, consumida por reading E busca + provas):
#   app/web/vendor/wa-sqlite-fts5/wa-sqlite.mjs
#   app/web/vendor/wa-sqlite-fts5/wa-sqlite.wasm
#
# Reprodutibilidade: pinamos o ref do wa-sqlite e a imagem do Emscripten. A versão
# do SQLite vem pinada do próprio Makefile do wa-sqlite (SQLITE_VERSION).
set -euo pipefail

# ── Pinos (reprodutibilidade) ────────────────────────────────────────────────
WA_SQLITE_REPO="https://github.com/rhashimoto/wa-sqlite.git"
# COMMIT EXATO do release npm `wa-sqlite@1.0.0` (`npm view wa-sqlite@1.0.0 gitHead`).
# CRÍTICO: NÃO usar o tag `v1.0.0` — ele é mais novo que o release npm e RENOMEOU a
# API JS (`registerVFS` → `vfs_register`), incompatível com o `src/sqlite-api.js` que
# o npm `1.0.0` (em node_modules) usa. Buildamos do MESMO commit do npm p/ que o
# `.mjs` exponha `registerVFS` (casando o `src/sqlite-api.js` que MANTEMOS do npm).
WA_SQLITE_REF="${WA_SQLITE_REF:-514745479b0a4706793efa0a361c10d899166acd}"
EMSDK_IMAGE="${EMSDK_IMAGE:-emscripten/emsdk:3.1.61}"
FTS5_DEFINES="-DSQLITE_ENABLE_FTS5"               # ativa FTS5 (MATCH/bm25/highlight/unicode61)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/app/web/vendor/wa-sqlite-fts5"

echo "build-wa-sqlite-fts5: ref=${WA_SQLITE_REF} image=${EMSDK_IMAGE} defines='${FTS5_DEFINES}'"
mkdir -p "${OUT_DIR}"

# Build dentro do container Emscripten (root, p/ apt-get das deps de amalgamação).
# A amalgamação do SQLite é gerada pelo próprio Makefile do wa-sqlite
# (curl do tarball + configure --enable-all && make sqlite3.c → precisa de tcl +
# um compilador nativo p/ o configure; o emcc compila o wasm).
docker run --rm \
  --user 0 \
  -v "${OUT_DIR}:/out" \
  -e "WA_SQLITE_REF=${WA_SQLITE_REF}" \
  -e "FTS5_DEFINES=${FTS5_DEFINES}" \
  -e "WA_SQLITE_REPO=${WA_SQLITE_REPO}" \
  "${EMSDK_IMAGE}" \
  bash -euo pipefail -c '
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git make curl tcl build-essential openssl unzip >/dev/null
    # Fetch do COMMIT EXATO por SHA (GitHub permite want-by-sha): garante o mesmo
    # código-fonte que gerou o release npm `1.0.0` (API `registerVFS`).
    mkdir -p /src && cd /src
    git init -q
    git remote add origin "${WA_SQLITE_REPO}"
    git fetch -q --depth 1 origin "${WA_SQLITE_REF}"
    git checkout -q FETCH_HEAD
    # `make` PURO (NÃO `emmake`): a amalgamação do SQLite é gerada na fase de
    # `configure`/`make sqlite3.c`, que roda NATIVAMENTE (precisa do `gcc` do host;
    # `emmake` forçaria CC=emcc e o configure falharia em "cannot run C compiled
    # programs"). Os passos wasm do Makefile do wa-sqlite já usam `$(EMCC)` (emcc,
    # presente no PATH da imagem emsdk) explicitamente.
    # SÓ o alvo SÍNCRONO (dist/wa-sqlite.mjs → também emite dist/wa-sqlite.wasm),
    # com o FTS5 ligado via o hook de defines extra do Makefile do wa-sqlite.
    make dist/wa-sqlite.mjs WASQLITE_EXTRA_DEFINES="${FTS5_DEFINES}"
    cp dist/wa-sqlite.mjs  /out/wa-sqlite.mjs
    cp dist/wa-sqlite.wasm /out/wa-sqlite.wasm
    echo "OK: copiados wa-sqlite.mjs + wa-sqlite.wasm (FTS5) para /out"
  '

echo "build-wa-sqlite-fts5: artefatos em ${OUT_DIR}:"
ls -la "${OUT_DIR}"
