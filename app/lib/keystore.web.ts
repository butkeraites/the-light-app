// app/lib/keystore.web.ts — F2.4 (ADR-0023, D3) · política de chave web = F2.7b (ADR-0025)
//
// COFRE DE SESSÃO in-memory para a chave BYOK no BROWSER. No NATIVO, `keystore.ts`
// guarda a API key no cofre do device (Keychain/Keystore via `expo-secure-store`). No
// BROWSER não existe Keychain/Keystore, e persistir segredo em storage do navegador
// (Local/Session Storage, IndexedDB) é inseguro (superfície de exfiltração +
// login-de-conta OAuth REJEITADO na pesquisa, ADR-0023/D3). Por isso a política web
// (ADR-0025) é **session-only / in-memory**: a chave vive só num `Map` de MÓDULO (a
// aba/sessão atual) e é **perdida no reload** — o usuário a re-insere a cada visita. A
// superfície (`Keystore`/`SecureBackend`/`createKeystore` + as funções `setKey`/
// `getKey`/`deleteKey`/`listProviders`) é IDÊNTICA ao nativo (paridade de tipos), então
// a UI compartilhada (`ReaderAskPanel`) funciona nos dois alvos sem ramificar.
//
// Anti-vazamento (LEI, ADR-0023/D3/ADR-0025): a chave NUNCA vai a nenhum storage
// persistente do navegador nem a git/log; NUNCA é impressa. O nome da entrada é
// `tla.apikey.<provider>` (o provedor, nunca o valor). Offline-first: o cofre é memória
// pura — nenhuma rede nesta camada (a IA web só faz rede no `fetch`, opt-in, com a chave
// lida sob demanda). O Metro escolhe este `.web.ts` no web e mantém `expo-secure-store`
// FORA do bundle web.

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'gemini', 'ollama'] as const;
export type Provider = (typeof SUPPORTED_PROVIDERS)[number];

// Namespace da entrada no cofre: contém o PROVEDOR, nunca o valor da chave.
const KEY_PREFIX = 'tla.apikey.';

/** Id da entrada (paridade com o nativo) — nunca contém o valor da chave. */
export function keyIdFor(provider: string): string {
  return `${KEY_PREFIX}${provider}`;
}

/** True se `provider` é um provedor suportado (paridade com o nativo). */
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

/** Backend mínimo de cofre (paridade de tipo com o nativo). */
export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Cofre de SESSÃO in-memory (ADR-0025): um `Map` de MÓDULO. Vive só na aba/sessão
 * atual e é **perdido no reload** — NUNCA qualquer storage persistente do navegador
 * (sem superfície persistente de exfiltração de segredo). É o backend padrão do
 * `createKeystore` web (par exato de `defaultSecureBackend` do nativo).
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

/** Superfície pública do serviço de chave BYOK (idêntica no nativo e no web). */
export interface Keystore {
  /** Salva a API key do provedor na sessão (trim; rejeita vazia). */
  setKey(provider: string, key: string): Promise<void>;
  /** Lê a API key do provedor na sessão (ou `null` se ausente). */
  getKey(provider: string): Promise<string | null>;
  /** Apaga a API key do provedor da sessão (idempotente). */
  deleteKey(provider: string): Promise<void>;
  /** Nomes dos provedores que TÊM chave na sessão — NUNCA os valores. */
  listProviders(): Promise<string[]>;
}

/**
 * Cria um keystore sobre um `SecureBackend`. Por padrão usa o cofre de SESSÃO
 * in-memory (ADR-0025); o teste headless injeta um backend fake para provar a lógica.
 * A LÓGICA (validação de provedor, `trim`, rejeição de vazia, `listProviders` só com
 * nomes) é IDÊNTICA à do nativo — só o backend muda (sessão vs. secure-store).
 */
export function createKeystore(backend: SecureBackend = sessionSecureBackend): Keystore {
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
      // Iteramos os provedores suportados e devolvemos APENAS os NOMES daqueles com
      // valor presente na sessão (nunca o valor).
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

// Keystore padrão do app WEB (cofre de sessão) + funções ligadas a ele, para a UI
// compartilhada consumir `import { setKey, getKey, ... } from '../lib/keystore'` — o
// Metro resolve este `.web.ts` no web.
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
