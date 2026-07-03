'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/web-compress.cjs — F5.17
//
// Fonte ÚNICA da verdade da PRÉ-COMPRESSÃO dos assets web (gzip/brotli). Usada por
// `scripts/compress-web-assets.sh` (emite os `.gz`/`.br` no `dist` + prova zero-drift)
// e por `scripts/measure-web-bundle.sh` (grava os tamanhos de TRANSFER no budget).
// Manter os parâmetros aqui, num só lugar, garante que o número medido no baseline é
// EXATAMENTE o do arquivo emitido (mesmo algoritmo/nível).
//
// brotli é BUILT-IN do Node (`zlib`, desde 11.7) — NENHUMA dependência do CLI externo
// `brotli`: portátil, offline, determinístico. gzip -9 do Node grava mtime=0 e sem
// filename no header → bytes byte-estáveis (reprodutível). Ambos são LOSSLESS: o
// helper `emitVariantsVerified` DESCOMPRIME cada variante e compara byte-a-byte com a
// origem (zero-drift; joga se divergir).
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('node:fs');
const zlib = require('node:zlib');

// gzip -9 determinístico (mtime=0, sem filename no header).
function gzip(buf) {
  return zlib.gzipSync(buf, { level: 9 });
}

// brotli qualidade 11 (máxima) + size-hint = tamanho da entrada. Determinístico p/ uma
// dada entrada. Estes parâmetros DEVEM ser os mesmos em toda medição/emissão (por isso
// ficam AQUI, centralizados).
function brotli(buf) {
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY, // 11
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
}

const gzipBytes = (buf) => gzip(buf).length;
const brotliBytes = (buf) => brotli(buf).length;

// Emite `<absPath>.gz` + `<absPath>.br` ao lado da origem e PROVA a losslessness
// (zero-drift): descomprime cada variante e exige igualdade byte-a-byte com `buf`.
// Retorna { bytes, gzipBytes, brotliBytes }. JOGA se qualquer round-trip divergir.
function emitVariantsVerified(absPath, buf) {
  const gz = gzip(buf);
  const br = brotli(buf);
  if (!zlib.gunzipSync(gz).equals(buf)) {
    throw new Error('ZERO-DRIFT FAIL: gzip não descomprime byte-idêntico: ' + absPath);
  }
  if (!zlib.brotliDecompressSync(br).equals(buf)) {
    throw new Error('ZERO-DRIFT FAIL: brotli não descomprime byte-idêntico: ' + absPath);
  }
  fs.writeFileSync(absPath + '.gz', gz);
  fs.writeFileSync(absPath + '.br', br);
  return { bytes: buf.length, gzipBytes: gz.length, brotliBytes: br.length };
}

module.exports = { gzip, brotli, gzipBytes, brotliBytes, emitVariantsVerified };
