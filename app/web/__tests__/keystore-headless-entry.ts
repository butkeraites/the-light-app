// keystore-headless-entry.ts — F2.4 (ADR-0023, D3)
//
// Ponto de entrada VERSIONADO da prova headless do serviço de chave BYOK. É
// empacotado (esbuild) por `keystore.test.mjs` num único `.mjs` e executado em node
// SEM device. Reexporta APENAS a superfície pura de `../../lib/keystore` que a prova
// exercita com um backend FAKE em memória injetado — `createKeystore` nunca aciona o
// `expo-secure-store` (marcado como `external` no bundle e importado de forma lazy só
// pelo backend padrão, que a prova não usa). Nenhuma lógica nova aqui.
import {
  createKeystore,
  keyIdFor,
  isSupportedProvider,
  SUPPORTED_PROVIDERS,
} from '../../lib/keystore';
import type { SecureBackend } from '../../lib/keystore';

export { createKeystore, keyIdFor, isSupportedProvider, SUPPORTED_PROVIDERS };
export type { SecureBackend };
