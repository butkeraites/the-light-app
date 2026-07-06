// app/lib/searchSynonyms.ts — ADR-0064 (busca inteligente)
//
// Mapa de EQUIVALÊNCIA de termos, CURADO à mão (semente pequena, pensada para CRESCER). Serve
// a dois casos que a busca AND palavra-a-palavra não cobre:
//   • SINÔNIMO de termo: "espírito" ~ "alma"; "graça" ~ "favor".
//   • CONCEITO/frase: "armadura do espírito" (como o usuário lembra) → "armadura de Deus" (como
//     Almeida/KJV realmente escrevem, Efésios 6:11).
// Alimenta o "did you mean" (as sugestões são PROVADAS contra o store antes de aparecer, então
// uma entrada que não casa nada simplesmente não é exibida — sem risco de sugestão morta).
//
// PURO. Chaves na forma DOBRADA (`fold`); os valores são a grafia de EXIBIÇÃO (com acento).
// ANTI-ALUCINAÇÃO: isto expande a CONSULTA do usuário — nunca reescreve/inventa texto bíblico.
// Locale-aware: PT e EN têm mapas próprios (o vocabulário difere por tradução/idioma).

import { fold } from './searchNormalize';

export type SearchLocale = 'pt' | 'en';

// Sinônimos de TERMO (chave dobrada → grafias equivalentes de exibição). Semente enxuta.
const SYNONYMS: Record<SearchLocale, Record<string, string[]>> = {
  pt: {
    espirito: ['Espírito', 'alma'],
    alma: ['alma', 'Espírito'],
    graca: ['graça', 'favor'],
    amor: ['amor', 'caridade'],
    caridade: ['caridade', 'amor'],
    fe: ['fé', 'crença'],
    pecado: ['pecado', 'transgressão', 'iniquidade'],
    salvacao: ['salvação', 'redenção'],
    alegria: ['alegria', 'gozo', 'júbilo'],
    armadura: ['armadura', 'couraça'],
    trevas: ['trevas', 'escuridão'],
    luz: ['luz', 'lâmpada'],
  },
  en: {
    spirit: ['Spirit', 'soul'],
    soul: ['soul', 'Spirit'],
    grace: ['grace', 'favour'],
    love: ['love', 'charity'],
    charity: ['charity', 'love'],
    faith: ['faith', 'belief'],
    sin: ['sin', 'transgression', 'iniquity'],
    salvation: ['salvation', 'redemption'],
    joy: ['joy', 'gladness', 'rejoicing'],
    armour: ['armour', 'armor'],
    armor: ['armor', 'armour'],
    darkness: ['darkness'],
    light: ['light', 'lamp'],
  },
};

// EQUIVALÊNCIA de CONCEITO/frase (consulta dobrada inteira → termos de busca sugeridos). É onde
// mora o caso "armadura do espírito" → "armadura de Deus" (frase que o usuário lembra ≠ texto).
const CONCEPTS: Record<SearchLocale, Record<string, string[]>> = {
  pt: {
    'armadura do espirito': ['armadura de Deus'],
    'armadura de deus': ['armadura de Deus'],
    'espada do espirito': ['espada do Espírito'],
    'fruto do espirito': ['fruto do Espírito'],
    'reino dos ceus': ['reino dos céus', 'reino de Deus'],
    'reino de deus': ['reino de Deus', 'reino dos céus'],
  },
  en: {
    'armor of the spirit': ['armour of God'],
    'armour of god': ['armour of God'],
    'sword of the spirit': ['sword of the Spirit'],
    'fruit of the spirit': ['fruit of the Spirit'],
    'kingdom of heaven': ['kingdom of heaven', 'kingdom of God'],
    'kingdom of god': ['kingdom of God', 'kingdom of heaven'],
  },
};

/** Sinônimos de exibição de um termo (exclui o próprio termo, por forma dobrada). */
export function synonymsFor(term: string, locale: SearchLocale): string[] {
  const key = fold(term);
  const list = SYNONYMS[locale][key] ?? [];
  return list.filter((w) => fold(w) !== key);
}

/** Termos sugeridos por EQUIVALÊNCIA de conceito para a consulta INTEIRA (ou `[]`). */
export function conceptExpansions(query: string, locale: SearchLocale): string[] {
  const key = fold(query).replace(/\s+/g, ' ');
  return CONCEPTS[locale][key] ?? [];
}
