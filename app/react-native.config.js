// app/react-native.config.js — F0.7 (ADR-0008)
//
// Autolinking RN (consumido por `use_native_modules!` no Podfile gerado pelo
// `expo prebuild`) da RN turbo-module library da fronteira UniFFI. A library NÃO
// é um node_module publicado: é a RAIZ do repositório (`..`), porque o caminho
// iOS do `ubrn` ancora a podspec/xcframework/glue no project_root (= raiz, onde
// está o package.json que resolve `rust.directory: core`). Ver ADR-0008.
//
// O override `dependencies['the-light-app'].root` aponta o autolinking p/ a raiz,
// onde estão a podspec gerada (TheLightAppCore.podspec) e o package.json com
// `codegenConfig` (RN New Arch codegen → RNTheLightAppCoreSpec). O runtime C++/JSI
// (`uniffi-bindgen-react-native`) é dependência normal do app (em node_modules),
// autolinkada automaticamente. Tudo o que a library expõe em ios/cpp/src/bindings
// é GERADO/IGNORADO (scripts/gen-bindings-ios.sh).
const path = require('path');

module.exports = {
  dependencies: {
    'the-light-app': {
      root: path.resolve(__dirname, '..'),
    },
  },
};
