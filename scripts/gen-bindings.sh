#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/gen-bindings.sh — F0.4 (ADR-0004)
#
# Gera os bindings TypeScript da fronteira UniFFI do crate `the-light-app-core`
# (core/) com `uniffi-bindgen-react-native` (CLI `ubrn`), versão FIXADA em
# package.json + package-lock.json (`0.31.0-3`). Escopo: SÓ a geração dos
# .ts/.cpp em bindings/ — NÃO liga o core a um app rodando (web/iOS/Android =
# F0.6/F0.7/F0.8).
#
# Comandos exatos do fluxo (host-only, modo *library* do UniFFI):
#   1) cargo build --manifest-path core/Cargo.toml
#        Compila a cdylib do host (core/target/debug/libthe_light_app_core.dylib)
#        de onde o ubrn extrai a metadata UniFFI (modo library). NÃO compila
#        wasm/iOS/Android (isso é F0.6/7/8).
#   2) node_modules/.bin/ubrn generate jsi bindings --library --no-format \
#        --ts-dir <bindings.ts> --cpp-dir <bindings.cpp> <cdylib>
#        Gera <mod>.ts + <mod>-ffi.ts (e C++ JSI em bindings/cpp/). Rodado a
#        partir de core/ para que `cargo metadata` resolva core/Cargo.toml.
#        `--no-format` evita depender de prettier/clang-format.
#
# Caminhos de saída vêm de ubrn.config.yaml (chaves bindings.ts / bindings.cpp),
# a fonte da verdade. Tudo sob bindings/, IGNORADO pelo git por design
# (.gitignore: /bindings/* + !/bindings/.gitkeep) — os .ts NÃO são versionados.
#
# Rede é permitida em dev/build (instalar ubrn / resolver deps de cargo);
# offline-first é regra de RUNTIME do produto. Nada de rede entra no código
# gerado. Nenhum segredo é lido/gravado.
#
# Saída: 0 em sucesso, ≠0 em qualquer erro.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

CONFIG="$ROOT/ubrn.config.yaml"
CRATE_MANIFEST="$ROOT/core/Cargo.toml"
UBRN="$ROOT/node_modules/.bin/ubrn"

[ -f "$CONFIG" ] || { echo "ERRO: ubrn.config.yaml ausente em $CONFIG"; exit 1; }
[ -x "$UBRN" ] || {
  echo "ERRO: ubrn não encontrado em $UBRN — rode 'npm ci' (ou 'npm install') primeiro." >&2
  exit 1
}

# ── Caminhos de saída a partir de ubrn.config.yaml (fonte da verdade) ─────────
# Extrai uma chave escalar de dentro do bloco top-level `bindings:`.
yaml_bindings_get() { # $1 = chave (ex.: ts | cpp)
  awk -v k="$1" '
    /^bindings:/ { inb = 1; next }
    inb && /^[^[:space:]]/ { inb = 0 }
    inb && $1 == k ":" { print $2; exit }
  ' "$CONFIG"
}
TS_REL="$(yaml_bindings_get ts)"
CPP_REL="$(yaml_bindings_get cpp)"
: "${TS_REL:?ubrn.config.yaml: chave bindings.ts ausente/ilegível}"
: "${CPP_REL:?ubrn.config.yaml: chave bindings.cpp ausente/ilegível}"
TS_DIR="$ROOT/$TS_REL"
CPP_DIR="$ROOT/$CPP_REL"

echo "==> Limpando $TS_DIR (preservando .gitkeep)"
if [ -d "$TS_DIR" ]; then
  find "$TS_DIR" -mindepth 1 ! -name '.gitkeep' -delete
fi
mkdir -p "$TS_DIR" "$CPP_DIR"

echo "==> [1/2] cargo build (cdylib do host p/ metadata UniFFI)"
cargo build --manifest-path "$CRATE_MANIFEST"

# Localiza a cdylib produzida (macOS .dylib; Linux .so como fallback).
LIB="$ROOT/core/target/debug/libthe_light_app_core.dylib"
[ -f "$LIB" ] || LIB="$ROOT/core/target/debug/libthe_light_app_core.so"
[ -f "$LIB" ] || { echo "ERRO: cdylib não encontrada em core/target/debug/"; exit 1; }

echo "==> [2/2] ubrn generate jsi bindings (modo library) -> $TS_DIR"
# Rodar a partir de core/ p/ que `cargo metadata` resolva core/Cargo.toml.
( cd "$ROOT/core" && "$UBRN" generate jsi bindings \
    --library --no-format \
    --ts-dir "$TS_DIR" \
    --cpp-dir "$CPP_DIR" \
    "$LIB" )

echo "==> OK — bindings TS gerados:"
find "$TS_DIR" -name '*.ts' -size +0c | sort | sed 's/^/      /'
