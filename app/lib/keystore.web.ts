// app/lib/keystore.web.ts — F2.4 (ADR-0023, D3) · política de chave web = F2.7
//
// STUB web do serviço de chave BYOK. No NATIVO, `keystore.ts` guarda a API key no
// cofre do device (Keychain/Keystore via `expo-secure-store`). No BROWSER não existe
// Keychain/Keystore, e a política de chave web é decidida SÓ na F2.7 — então na
// Fase 2 o web NÃO persiste chave. Este stub espelha a assinatura do nativo (paridade
// de tipos/superfície) e, deliberadamente, NÃO importa `expo-secure-store` — o Metro
// escolhe este `.web.ts` no web, mantendo o módulo nativo FORA do bundle web.
//
// Anti-vazamento: nunca usa `localStorage`/`IndexedDB` para a chave (secure-store é
// só do device). `getKey` → `null`, `listProviders` → `[]`; `setKey`/`deleteKey`
// sinalizam claramente que a chave web só chega na F2.7. Offline-first: sem rede.

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama'] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];

const KEY_PREFIX = 'tla.apikey.';

const WEB_UNSUPPORTED = 'BYOK key não suportada no web na Fase 2 (política = F2.7).';

/** Id da entrada (paridade com o nativo) — nunca contém o valor da chave. */
export function keyIdFor(provider: string): string {
  return `${KEY_PREFIX}${provider}`;
}

/** True se `provider` é um provedor suportado (paridade com o nativo). */
export function isSupportedProvider(provider: string): provider is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

/** Backend mínimo de cofre (paridade de tipo com o nativo; sem impl no web). */
export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Superfície pública do serviço (idêntica ao nativo). */
export interface Keystore {
  setKey(provider: string, key: string): Promise<void>;
  getKey(provider: string): Promise<string | null>;
  deleteKey(provider: string): Promise<void>;
  listProviders(): Promise<string[]>;
}

/**
 * Cria um keystore web — no-op de persistência na Fase 2 (política = F2.7). O
 * parâmetro `_backend` existe só para paridade de assinatura com o nativo.
 */
export function createKeystore(_backend?: SecureBackend): Keystore {
  return {
    async setKey(_provider, _key) {
      throw new Error(WEB_UNSUPPORTED);
    },
    async getKey(_provider) {
      return null;
    },
    async deleteKey(_provider) {
      // No web não há chave persistida — apagar é no-op idempotente.
    },
    async listProviders() {
      return [];
    },
  };
}

export function setKey(_provider: string, _key: string): Promise<void> {
  throw new Error(WEB_UNSUPPORTED);
}
export function getKey(_provider: string): Promise<string | null> {
  return Promise.resolve(null);
}
export function deleteKey(_provider: string): Promise<void> {
  return Promise.resolve();
}
export function listProviders(): Promise<string[]> {
  return Promise.resolve([]);
}
