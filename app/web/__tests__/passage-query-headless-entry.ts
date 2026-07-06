// passage-query-headless-entry.ts — ADR-0065 (molde search-smart-headless-entry)
//
// Ponto de entrada VERSIONADO da prova headless do lookup de passagem (ranges + listas).
// Reexporta a superfície PURA/testável: o classificador (`passageQuery`) e o resolvedor
// (`passageResolve`, com DEPS injetadas). NÃO importa a tela nem `react-native`.
import { classifyItem, parsePassageQuery } from '../../lib/passageQuery';
import { resolvePassageQuery } from '../../lib/passageResolve';

export { classifyItem, parsePassageQuery, resolvePassageQuery };
