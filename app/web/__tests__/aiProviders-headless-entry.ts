// aiProviders-headless-entry.ts — deepening (ADR-0059)
//
// Ponto de entrada VERSIONADO da prova headless dos helpers PUROS de provedor/BYOK. É
// empacotado (esbuild) por `aiProviders.test.mjs` num único `.mjs` e executado em node SEM
// device. Reexporta a superfície pura de `../../lib/aiProviders` + `../../lib/errMessage`. O
// `aiProviders` importa `SUPPORTED_PROVIDERS` de `../../lib/keystore`, cujo backend padrão
// importa `expo-secure-store` de forma lazy — marcado `external` no bundle e NUNCA acionado
// (a prova injeta um `getKey` fake). Nenhuma lógica nova aqui.
import {
  MOCK_PROVIDER,
  PROVIDER_OPTIONS_MOCK_FIRST,
  PROVIDER_OPTIONS_MOCK_LAST,
  isMockProvider,
  resolveProviderKey,
  keyArg,
} from '../../lib/aiProviders';
import { errMessage } from '../../lib/errMessage';
import { SUPPORTED_PROVIDERS } from '../../lib/keystore';

export {
  MOCK_PROVIDER,
  PROVIDER_OPTIONS_MOCK_FIRST,
  PROVIDER_OPTIONS_MOCK_LAST,
  isMockProvider,
  resolveProviderKey,
  keyArg,
  errMessage,
  SUPPORTED_PROVIDERS,
};
