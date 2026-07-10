// app/lib/keystore.web.ts — F2.4 (ADR-0023, D3) · política web = F2.7b (ADR-0025) · deepening ADR-0073 (leaf WEB)
//
// Backend WEB do keystore: cofre de SESSÃO in-memory. No BROWSER não existe Keychain/Keystore e
// persistir segredo em storage do navegador é inseguro (ADR-0023/D3; login-de-conta OAuth REJEITADO na
// pesquisa) — então a política web (ADR-0025) é **session-only / in-memory**: a chave vive só num `Map`
// de MÓDULO (a aba/sessão atual) e é **perdida no reload**. A LÓGICA (validação/namespacing/não-vazamento
// — o módulo profundo) vive em `keystore.shared.ts` e é re-exportada aqui; este arquivo traz SÓ o backend
// de sessão + o keystore ligado + os wrappers. O Metro escolhe este `.web.ts` e mantém `expo-secure-store`
// FORA do bundle web.
//
// Anti-vazamento (LEI, ADR-0023/D3/ADR-0025): a chave NUNCA vai a storage persistente nem a git/log.
export * from './keystore.shared';

import { createKeystore, type SecureBackend } from './keystore.shared';

/**
 * Cofre de SESSÃO in-memory (ADR-0025): um `Map` de MÓDULO. Vive só na aba/sessão atual e é **perdido no
 * reload** — NUNCA qualquer storage persistente do navegador. Par exato de `defaultSecureBackend` do nativo.
 */
const sessionVault = new Map<string, string>();

export const sessionSecureBackend: SecureBackend = {
  async getItemAsync(key) {
    return sessionVault.has(key) ? (sessionVault.get(key) as string) : null;
  },
  async setItemAsync(key, value) {
    sessionVault.set(key, value);
  },
  async deleteItemAsync(key) {
    sessionVault.delete(key);
  },
};

// Keystore padrão do app WEB (cofre de sessão) + funções ligadas a ele, para a UI compartilhada consumir
// `import { setKey, getKey, ... } from '../lib/keystore'` — o Metro resolve este `.web.ts` no web.
const defaultKeystore = createKeystore(sessionSecureBackend);

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
