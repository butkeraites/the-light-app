// translationResolve-headless-entry.ts — ADR-0070
//
// Barrel fino p/ o esbuild-bundle da guarda headless: re-exporta a superfície PURA da resolução de
// versão (`lib/translationDefault`) + os construtores de href de leitura (`lib/readingNav`). O import
// de tipo `Translation` é APAGADO na compilação → o bundle não boota wasm. Nenhuma lógica nova aqui.
export {
  resolveEffectiveTranslation,
  langForTranslation,
  defaultTranslationFor,
  FALLBACK_TRANSLATION,
} from '../../lib/translationDefault';
export { readingChapterHref, readingBookHref } from '../../lib/readingNav';
