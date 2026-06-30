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

// Trata .wasm como asset (e não como módulo de código-fonte).
config.resolver.assetExts.push('wasm');

module.exports = config;
