// app/metro.config.js — F0.6b (ADR-0007)
//
// Ensina o Metro/Expo a tratar arquivos .wasm como ASSET binário (servidos como
// dado). O glue web (app/web/generated/index.web.ts) faz
// `import wasmPath from './wasm-bindgen/index_bg.wasm'` e instancia o módulo via
// `uniffiInitAsync()`; sem isto o Metro não resolve o .wasm e o bundle web quebra.
//
// O wasm é um ASSET LOCAL do app (empacotado no bundle, servido pela própria
// origem) — não é rede/serviço externo: offline-first preservado. Single-thread
// (uniffi `wasm-unstable-single-threaded`), então NÃO precisamos de
// SharedArrayBuffer nem dos headers COOP/COEP.
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Trata .wasm como asset (e não como módulo de código-fonte) — caminho web (F0.6b).
config.resolver.assetExts.push('wasm');

// F0.10 (ADR-0011/ADR-0012): trata .sqlite como asset binário. O store web
// (`app/web/sqlite-opfs.web.ts`) importa `app/assets/data/sample.sqlite` (um
// SYMLINK versionado para o `sample.sqlite` canônico em <repo>/assets/data — KJV
// domínio público) e o carrega em OPFS. O symlink mantém o asset DENTRO do
// projectRoot (Metro o empacota sem resolução cross-root) preservando a única
// fonte da verdade. Offline-first: asset local, sem rede.
config.resolver.assetExts.push('sqlite');

// F1.3 (ADR-0014): trata .db como asset binário também (paridade com .sqlite). O
// app nativo empacota `app/assets/data/reading-sample.sqlite` (SYMLINK versionado
// p/ o subset de leitura em <repo>/assets/data — KJV+Almeida domínio público) e o
// COPIA p/ FileSystem.documentDirectory no 1º boot (app/lib/db.ts), onde o rusqlite
// (core) o abre p/ ler capítulos. Offline-first: asset local, sem rede.
config.resolver.assetExts.push('db');

// Nota (F0.7/ADR-0008): a glue JS do Turbo Module nativo (barrel + bindings TS)
// é GERADA na raiz pelo `ubrn build ios`, mas o `scripts/gen-bindings-ios.sh` a
// COPIA para `app/web/native-generated/` (ignorada) — dentro do projectRoot.
// Assim o Metro e o tsc resolvem tudo localmente (inclusive `@ubjs/core` em
// app/node_modules), sem watchFolders/ancestral nem resolução cross-root.
module.exports = config;
