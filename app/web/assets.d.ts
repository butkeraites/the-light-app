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
