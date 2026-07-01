// app/lib/keystore.ts — F2.4 (ADR-0023, D3)
//
// Serviço app-side de chave BYOK NATIVO sobre `expo-secure-store` (Keychain no iOS /
// Keystore no Android). Salva / lê / apaga a API key do usuário POR PROVEDOR
// (`anthropic`/`openai`/`gemini`/`ollama`), guardada APENAS no cofre seguro do
// device. A chave NUNCA é logada/impressa, NUNCA vai ao git, e só é lida SOB DEMANDA
// para ser passada à fronteira `ask_anchored(..., key)` — quem a USA de fato é a F2.6.
//
// Anti-vazamento (LEI, ADR-0023/D3): nenhuma chamada de log toca o valor da chave; o
// nome da entrada no cofre é `tla.apikey.<provider>` (o provedor, nunca o valor). Offline-
// first: o secure-store é I/O local no device — nenhuma rede nesta camada.
//
// Resolução por extensão do Metro: este `.ts` vale no NATIVO; no web vale
// `keystore.web.ts` (stub — política de chave web = F2.7), que NÃO arrasta
// `expo-secure-store` ao bundle web. Por isso, o backend padrão importa
// `expo-secure-store` de forma LAZY (dynamic import), só quando um método é de fato
// invocado — o que também mantém o serviço testável headless com um backend injetado.

// Provedores suportados (paridade com o core: providers.rs + Gemini via F2.3).
export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama'] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];

// Namespace da entrada no cofre: contém o PROVEDOR, nunca o valor da chave.
const KEY_PREFIX = 'tla.apikey.';

/** Id da entrada no secure-store para um provedor (ex.: `tla.apikey.gemini`). */
export function keyIdFor(provider: string): string {
  return `${KEY_PREFIX}${provider}`;
}

/** True se `provider` é um provedor suportado. */
export function isSupportedProvider(provider: string): provider is Provider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

function assertProvider(provider: string): asserts provider is Provider {
  if (!isSupportedProvider(provider)) {
    // Mensagem cita o PROVEDOR (não-secreto) e a lista — NUNCA a chave.
    throw new Error(
      `Provedor BYOK não suportado: "${provider}". Suportados: ${SUPPORTED_PROVIDERS.join(', ')}.`,
    );
  }
}

/**
 * Backend mínimo de cofre seguro (subconjunto de `expo-secure-store`). Injetável
 * para testar a LÓGICA do serviço headless, sem device e sem chave real.
 */
export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Backend padrão: `expo-secure-store` (Keychain/Keystore). O import é LAZY para
 * (1) manter `expo-secure-store` FORA de qualquer bundle que não o use e (2) permitir
 * que o teste headless injete um backend fake sem carregar o módulo nativo.
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

/** Superfície pública do serviço de chave BYOK (idêntica no nativo e no stub web). */
export interface Keystore {
  /** Salva a API key do provedor no cofre (trim; rejeita vazia). */
  setKey(provider: string, key: string): Promise<void>;
  /** Lê a API key do provedor (ou `null` se ausente). */
  getKey(provider: string): Promise<string | null>;
  /** Apaga a API key do provedor (idempotente). */
  deleteKey(provider: string): Promise<void>;
  /** Nomes dos provedores que TÊM chave — NUNCA os valores. */
  listProviders(): Promise<string[]>;
}

/**
 * Cria um keystore sobre um `SecureBackend`. Por padrão usa `expo-secure-store`; o
 * teste headless injeta um backend fake em memória para provar a lógica sem device.
 */
export function createKeystore(backend: SecureBackend = defaultSecureBackend): Keystore {
  return {
    async setKey(provider, key) {
      assertProvider(provider);
      const trimmed = key.trim();
      if (trimmed.length === 0) {
        // Não inclui a chave na mensagem (mesmo vazia) — invariante de não-vazamento.
        throw new Error(`API key vazia para o provedor "${provider}".`);
      }
      await backend.setItemAsync(keyIdFor(provider), trimmed);
    },

    async getKey(provider) {
      assertProvider(provider);
      return backend.getItemAsync(keyIdFor(provider));
    },

    async deleteKey(provider) {
      assertProvider(provider);
      await backend.deleteItemAsync(keyIdFor(provider));
    },

    async listProviders() {
      // `expo-secure-store` não enumera; iteramos os provedores suportados e
      // devolvemos APENAS os NOMES daqueles com valor presente (nunca o valor).
      const withKey: string[] = [];
      for (const provider of SUPPORTED_PROVIDERS) {
        const value = await backend.getItemAsync(keyIdFor(provider));
        if (value != null && value.length > 0) {
          withKey.push(provider);
        }
      }
      return withKey;
    },
  };
}

// Keystore padrão do app (sobre `expo-secure-store`) + funções ligadas a ele, para a
// UI da F2.5 consumir diretamente `import { setKey, getKey, ... } from '../lib/keystore'`.
const defaultKeystore = createKeystore();

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
