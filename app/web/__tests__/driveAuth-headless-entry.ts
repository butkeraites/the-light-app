// driveAuth-headless-entry.ts — F5.24 (molde snapshot-headless-entry.ts F5.23)
//
// Ponto de entrada VERSIONADO da prova headless do FLUXO DE AUTORIZAÇÃO do Google Drive
// (OAuth 2.0 PKCE client-side). É empacotado (esbuild) por driveAuth.web.test.mjs num
// único .mjs e executado em node SEM browser/rede/conta. Reexporta EXATAMENTE as funções
// de PRODUÇÃO que a prova precisa (o MESMO código que a UI de sync da F5.26 vai injetar
// com `globalThis.fetch`/`globalThis.crypto`):
//   - `generatePkce`/`buildAuthUrl`/`exchangeCode`: as fns PURAS do PKCE/URL/troca.
//   - `createDriveAuth`: o serviço de link/unlink/isLinked/currentToken sobre um TokenStore
//     e `fetch`/`crypto` INJETADOS (a prova injeta mocks; NENHUMA chamada real ao Google).
//   - `base64UrlEncode` + constantes de endpoint/escopo p/ asserções do vetor de teste.
//
// Nenhuma lógica nova aqui — apenas reexporta. NÃO importa nada browser-only; o módulo é
// puro/injetável (fora do entry graph eager do web — perf-budget).
import {
  base64UrlEncode,
  buildAuthUrl,
  createDriveAuth,
  exchangeCode,
  generatePkce,
  DRIVE_APPDATA_SCOPE,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from '../../lib/driveAuth';

export {
  base64UrlEncode,
  buildAuthUrl,
  createDriveAuth,
  exchangeCode,
  generatePkce,
  DRIVE_APPDATA_SCOPE,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
};
