#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/gen-bindings-android.sh — F0.8 (ADR-0009)
#
# Constrói o módulo NATIVO Android da fronteira UniFFI `the-light-app-core` (core/)
# pelo CAMINHO Android do uniffi-bindgen-react-native (`ubrn build android`, versão
# FIXADA `0.31.0-3`). Produz, de forma reprodutível:
#   - jniLibs/<abi>/libthe_light_app_core.a — staticlib Rust por ABI (via
#     cargo-ndk), com a UniFFI scaffolding; arrasta a feature `embedded` do core no
#     nativo (rusqlite SQLite-C + reqwest), mas só `parse_reference` é exercitado.
#   - a glue do Turbo Module ANDROID (módulo Gradle da library na raiz): android/
#     (build.gradle, CMakeLists.txt, cpp-adapter.cpp, src/main/AndroidManifest.xml,
#     src/main/java/<packageName>/{...Module.kt, ...Package.kt}, android/generated).
#   - a glue C++/TS COMPARTILHADA com iOS: cpp/ (C++ JSI), src/ (NativeXxx.ts +
#     index.tsx) e os bindings TS em bindings/ (mesmo destino do host JSI — ADR-0004).
#
# NÃO é o caminho iOS (`ubrn build ios` = scripts/gen-bindings-ios.sh, intacto),
# nem o web (`ubrn build web` = scripts/gen-bindings-web.sh), nem a geração
# host-only (`ubrn generate jsi bindings` = scripts/gen-bindings.sh).
#
# Comando central:
#   ubrn build android --and-generate --targets aarch64-linux-android --config <cfg>
#     --targets aarch64-linux-android  → só o ABI arm64-v8a (AVD thelight_avd) —
#                                        suficiente p/ a prova no emulador arm64.
#     --and-generate                   → após o cargo-ndk, gera bindings + a glue do TM.
#
# Caminhos de saída vêm de ubrn.config.yaml (blocos android:/turboModule:/bindings:),
# a fonte da verdade. Tudo é GERADO e IGNORADO pelo git (ver .gitignore). Rede é
# permitida em dev/build (resolver deps de cargo, compilar SQLite-C); offline-first
# é regra de RUNTIME. Nenhum segredo é lido/gravado.
#
# Saída: 0 em sucesso, ≠0 em qualquer erro.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# ── Ambiente Android (defensivo; herdado de ~/.zshrc OU fallback Homebrew) ────
# A sessão pode não herdar o ~/.zshrc (bloco "The Light App"); se as variáveis
# estiverem vazias, caímos nos caminhos do android-commandlinetools instalado via
# Homebrew (mesma instalação documentada no ADR-0009 / tabela de ambiente).
: "${ANDROID_HOME:=/opt/homebrew/share/android-commandlinetools}"
: "${ANDROID_NDK_HOME:=$ANDROID_HOME/ndk/27.1.12297006}"
: "${JAVA_HOME:=/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME ANDROID_NDK_HOME JAVA_HOME
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_NDK_HOME:$PATH"

CONFIG="$ROOT/ubrn.config.yaml"
UBRN="$ROOT/node_modules/.bin/ubrn"
PKG_NS="com.thelight.core"           # android.packageName em ubrn.config.yaml
RUST_LIB="libthe_light_app_core.a"   # staticlib (useSharedLibrary: false)

[ -f "$CONFIG" ] || { echo "ERRO: ubrn.config.yaml ausente em $CONFIG" >&2; exit 1; }
[ -x "$UBRN" ] || {
  echo "ERRO: ubrn não encontrado em $UBRN — rode 'npm ci' (ou 'npm install') primeiro." >&2
  exit 1
}

# ── Ambiente Android (determinístico) ────────────────────────────────────────
[ -d "$ANDROID_NDK_HOME" ] || { echo "ERRO: ANDROID_NDK_HOME inválido: $ANDROID_NDK_HOME" >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "ERRO: cargo ausente." >&2; exit 1; }
cargo ndk --version >/dev/null 2>&1 || { echo "ERRO: cargo-ndk ausente (cargo install cargo-ndk)." >&2; exit 1; }
if command -v rustup >/dev/null 2>&1; then
  rustup target list --installed 2>/dev/null | grep -qx aarch64-linux-android \
    || rustup target add aarch64-linux-android
fi

# ── Limpeza determinística do que é GERADO ───────────────────────────────────
# android/ (módulo Gradle + jniLibs + CMake + Kotlin) e a glue compartilhada
# (cpp/ src/) são regenerados pelo --and-generate. bindings/ idem (preserva .gitkeep).
echo "==> Limpando saídas geradas Android (android/ cpp/ src/)"
rm -rf "$ROOT/android" "$ROOT/cpp" "$ROOT/src"
if [ -d "$ROOT/bindings" ]; then
  find "$ROOT/bindings" -mindepth 1 ! -name '.gitkeep' -delete
fi

# ── Build Android (cargo-ndk → jniLibs) + geração da glue do Turbo Module ─────
echo "==> ubrn build android --and-generate --targets aarch64-linux-android"
"$UBRN" build android --and-generate --targets aarch64-linux-android --config "$CONFIG"

# ── Conferência dos artefatos esperados ──────────────────────────────────────
JNILIBS="$ROOT/android/src/main/jniLibs/arm64-v8a/$RUST_LIB"
[ -f "$JNILIBS" ] || { echo "ERRO: staticlib Rust não gerado em $JNILIBS" >&2; exit 1; }
[ -f "$ROOT/android/CMakeLists.txt" ] || { echo "ERRO: android/CMakeLists.txt não gerado" >&2; exit 1; }
[ -f "$ROOT/android/build.gradle" ] || { echo "ERRO: android/build.gradle não gerado" >&2; exit 1; }
[ -f "$ROOT/android/cpp-adapter.cpp" ] || { echo "ERRO: android/cpp-adapter.cpp não gerado" >&2; exit 1; }
[ -f "$ROOT/android/src/main/AndroidManifest.xml" ] || { echo "ERRO: AndroidManifest.xml não gerado" >&2; exit 1; }
KT_PKG_DIR="$ROOT/android/src/main/java/${PKG_NS//.//}"
[ -d "$KT_PKG_DIR" ] || { echo "ERRO: pacote Kotlin não gerado em $KT_PKG_DIR" >&2; exit 1; }
[ -f "$ROOT/src/index.tsx" ] || { echo "ERRO: entrypoint src/index.tsx não gerado" >&2; exit 1; }
[ -f "$ROOT/bindings/the_light_app_core.ts" ] || { echo "ERRO: bindings TS não gerados" >&2; exit 1; }

# ── Patch do template do ubrn 0.31.0-3: AndroidManifestNew.xml ───────────────
# O build.gradle gerado, sob AGP >= 7.3 (supportsNamespace), aponta o
# `manifest.srcFile` p/ `src/main/AndroidManifestNew.xml` E define `namespace`,
# mas o ubrn só emite `AndroidManifest.xml` (com atributo `package`, que conflita
# com `namespace` no AGP 8). Emitimos o manifest "new" SEM `package` (convenção do
# create-react-native-library que o template do ubrn pressupõe). Arquivo GERADO,
# sob android/ (ignorado). Ver ADR-0009.
cat > "$ROOT/android/src/main/AndroidManifestNew.xml" <<'XML'
<!-- Gerado por gen-bindings-android.sh (patch F0.8/ADR-0009) — manifest sem
     atributo `package` p/ casar com `namespace` do build.gradle (AGP 8). -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
</manifest>
XML

# ── Patch do template do ubrn 0.31.0-3: resolução do runtime C++ sob Node >= 20 ──
# O CMakeLists.txt gerado localiza os headers C++ do runtime
# (uniffi-bindgen-react-native/cpp/includes, ex.: UniffiCallInvoker.h) via
#   node -p "require.resolve('uniffi-bindgen-react-native/package.json')"
# Mas o pacote define um campo `exports` que NÃO expõe `./package.json`; o Node
# moderno (>=20, aqui v25) bloqueia o subpath (ERR_PACKAGE_PATH_NOT_EXPORTED), o
# que deixa UNIFFI_BINDGEN_PATH VAZIO → include `-I/cpp/includes` inválido → erro
# de compilação "'UniffiCallInvoker.h' file not found". Reescrevemos o comando node
# p/ resolver o ENTRYPOINT exportado (`require.resolve('uniffi-bindgen-react-native')`,
# permitido) e subir até a raiz do pacote — saída idêntica (.../package.json), de
# onde o get_filename_component(DIRECTORY) extrai a raiz. Arquivo GERADO, sob
# android/ (ignorado). Ver ADR-0009.
CMAKE_FILE="$ROOT/android/CMakeLists.txt" node <<'NODE'
const fs = require('fs');
const f = process.env.CMAKE_FILE;
let s = fs.readFileSync(f, 'utf8');
const oldCmd = "COMMAND node -p \"require.resolve('uniffi-bindgen-react-native/package.json')\"";
const newCmd =
  "COMMAND node -e \"const path=require('path');" +
  "let d=path.dirname(require.resolve('uniffi-bindgen-react-native'));" +
  "while(path.basename(d)!=='uniffi-bindgen-react-native'&&d!=='/')d=path.dirname(d);" +
  "process.stdout.write(path.join(d,'package.json'))\"";
if (!s.includes(oldCmd)) {
  console.error('ERRO: linha de resolução node do CMakeLists não encontrada (template ubrn mudou?)');
  process.exit(1);
}
fs.writeFileSync(f, s.split(oldCmd).join(newCmd));
console.log('==> CMakeLists.txt: resolução do runtime C++ tornada Node>=20-safe');
NODE

# ── Copiar a glue JS p/ dentro de app/ (resolução local do Metro/tsc) ─────────
# Idêntico ao gen-bindings-ios.sh (ADR-0008): o barrel (src/index.tsx) + os
# bindings TS são GERADOS na raiz, mas Metro/tsc do app resolvem melhor DENTRO do
# projectRoot (app/). Espelhamos a estrutura (src/ ao lado de bindings/) p/ o import
# relativo interno do barrel valer. Destino IGNORADO (.gitignore). É a MESMA glue JS
# da iOS (mesmo Turbo Module compartilhado) — idempotente.
NATIVE_JS_DIR="$ROOT/app/web/native-generated"
echo "==> Copiando glue JS p/ $NATIVE_JS_DIR (Metro/tsc local)"
rm -rf "$NATIVE_JS_DIR"
mkdir -p "$NATIVE_JS_DIR/src" "$NATIVE_JS_DIR/bindings"
cp "$ROOT/src/"*.tsx "$ROOT/src/"*.ts "$NATIVE_JS_DIR/src/" 2>/dev/null || true
cp "$ROOT/bindings/"*.ts "$NATIVE_JS_DIR/bindings/"
[ -f "$NATIVE_JS_DIR/src/index.tsx" ] || { echo "ERRO: cópia do barrel falhou" >&2; exit 1; }
[ -f "$NATIVE_JS_DIR/bindings/the_light_app_core.ts" ] || { echo "ERRO: cópia dos bindings falhou" >&2; exit 1; }

echo "==> OK — módulo nativo Android gerado:"
{
  echo "$JNILIBS"
  find "$ROOT/android" -maxdepth 2 -type f \
    \( -name 'build.gradle' -o -name 'CMakeLists.txt' -o -name 'cpp-adapter.cpp' -o -name 'AndroidManifest.xml' \)
  find "$ROOT/android/src/main/java" -name '*.kt' 2>/dev/null
} | sort | sed "s#^$ROOT/#      #"
