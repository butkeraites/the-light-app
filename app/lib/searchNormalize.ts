// app/lib/searchNormalize.ts — ADR-0064 (busca inteligente)
//
// Normalização PURA compartilhada pela camada de busca (sem `react-native`, sem I/O). `fold`
// reproduz a semântica de MATCHING do índice FTS do core (`unicode61 remove_diacritics 2`):
// minúsculas + sem acento — usada só para CHAVES/comparação (dedup, dicionário de sinônimos,
// stopwords, prefixo), NUNCA para exibição (o termo mostrado ao usuário preserva acento/caixa).
//
// ANTI-ALUCINAÇÃO: isto é ferramenta de BUSCA (normaliza consultas do usuário) — não toca
// texto bíblico; o resultado da busca segue vindo VERBATIM do store, via a fronteira `search`.

/**
 * Minúsculas + remoção de acentos — casa o matching acento-insensível do FTS. Decompõe (NFD) e
 * descarta os MARCADORES combinantes (`\p{M}`: acentos/til/cedilha viram a letra-base).
 */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

/** Remove pontuação nas BORDAS de um token, preservando letras/números internos (ex.: "d'água"). */
export function trimEdges(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
