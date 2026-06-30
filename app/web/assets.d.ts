// app/web/assets.d.ts — F0.10 (ADR-0011/ADR-0012)
//
// Declarações de tipo para imports de ASSET tratados pelo Metro (servidos como
// dado local pela própria origem do app). No web, o import resolve para uma URI
// (string) que pode ser passada a `fetch`. Offline-first: são assets
// empacotados, não rede externa.
declare module 'wa-sqlite/dist/wa-sqlite.wasm' {
  const uri: string;
  export default uri;
}

declare module '*.sqlite' {
  const uri: string;
  export default uri;
}

// F1.14 (ADR-0020): artefato `wa-sqlite` COM FTS5 (build SÍNCRONO), VENDORADO como
// asset local em `app/web/vendor/wa-sqlite-fts5/` (gerado por
// `scripts/build-wa-sqlite-fts5.sh`). O `.wasm` resolve para uma URI (asset do
// Metro, servido pela própria origem — offline-first); o `.mjs` é o factory
// Emscripten (par do `dist/` do npm `1.0.0`, mesmo commit → API `registerVFS`).
// Wildcards (prefixo `*`) p/ casar o caminho relativo do import.
declare module '*wa-sqlite-fts5/wa-sqlite.wasm' {
  const uri: string;
  export default uri;
}

declare module '*wa-sqlite-fts5/wa-sqlite.mjs' {
  function ModuleFactory(config?: object): Promise<unknown>;
  export default ModuleFactory;
}
