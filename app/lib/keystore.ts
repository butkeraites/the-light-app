// app/lib/keystore.ts — F2.4 (ADR-0023, D3) · deepening ADR-0073 (leaf NATIVO)
//
// Backend NATIVO do keystore: `expo-secure-store` (Keychain no iOS / Keystore no Android). A LÓGICA
// (validação/namespacing/trim/rejeição/listProviders — o módulo profundo) vive em `keystore.shared.ts`
// e é re-exportada aqui; este arquivo traz SÓ o `SecureBackend` do device + o keystore ligado + os
// wrappers. Resolução por extensão do Metro: `.ts` no NATIVO, `keystore.web.ts` no web (não arrasta
// `expo-secure-store` ao bundle web). O import de `expo-secure-store` é LAZY (dynamic import) — fora de
// qualquer bundle que não o use, e testável headless com um backend injetado.
//
// Anti-vazamento (LEI, ADR-0023/D3): a chave NUNCA é logada; o nome da entrada é `tla.apikey.<provider>`.
export * from './keystore.shared';

import { createKeystore, type SecureBackend } from './keystore.shared';

/**
 * Backend padrão NATIVO: `expo-secure-store` (Keychain/Keystore). Import LAZY para (1) manter
 * `expo-secure-store` FORA de qualquer bundle que não o use e (2) permitir que o teste headless injete
 * um backend fake sem carregar o módulo nativo.
 */
export const defaultSecureBackend: SecureBackend = {
  async getItemAsync(key) {
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  async setItemAsync(key, value) {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItemAsync(key) {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  },
};

// Keystore padrão do app (sobre `expo-secure-store`) + funções ligadas a ele, para a UI consumir
// diretamente `import { setKey, getKey, ... } from '../lib/keystore'`.
const defaultKeystore = createKeystore(defaultSecureBackend);

export function setKey(provider: string, key: string): Promise<void> {
  return defaultKeystore.setKey(provider, key);
}
export function getKey(provider: string): Promise<string | null> {
  return defaultKeystore.getKey(provider);
}
export function deleteKey(provider: string): Promise<void> {
  return defaultKeystore.deleteKey(provider);
}
export function listProviders(): Promise<string[]> {
  return defaultKeystore.listProviders();
}
