// app/lib/keystore.shared.ts — F2.4 (ADR-0023, D3) · deepening ADR-0073
//
// MÓDULO PROFUNDO do serviço de chave BYOK, agnóstico de plataforma: a validação de provedor, o
// namespacing (`tla.apikey.<provider>`, nunca o valor), o `trim`/rejeição-de-vazia e o `listProviders`
// (só NOMES). Era copiado BYTE-A-BYTE em `keystore.ts` (nativo) e `keystore.web.ts` (web) — só o
// BACKEND diferia (cofre do device vs. `Map` de sessão), e a cópia web nunca era testada. Aqui a
// lógica vive UMA vez; cada leaf (`keystore.ts`/`keystore.web.ts`) traz só o seu `SecureBackend` +
// `createKeystore(backend)` ligado + os wrappers. Molde: `snapshotStore.shared.ts`.
//
// Anti-vazamento (LEI, ADR-0023/D3/ADR-0025): a chave NUNCA é logada/impressa/vai a git; as mensagens
// citam só o PROVEDOR (não-secreto). Offline-first: sem rede nesta camada.

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
 * Backend mínimo de cofre seguro (subconjunto de `expo-secure-store`). Injetável para testar a LÓGICA
 * headless, sem device e sem chave real; é o ÚNICO ponto que difere entre nativo (secure-store) e web
 * (cofre de sessão in-memory).
 */
export interface SecureBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** Superfície pública do serviço de chave BYOK (idêntica no nativo e no web). */
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
 * Cria um keystore sobre um `SecureBackend`. O backend é OBRIGATÓRIO — cada plataforma injeta o seu
 * (nativo: `expo-secure-store`; web: sessão in-memory; teste: fake). Toda a validação/namespacing/
 * não-vazamento vive AQUI (uma fonte só), não duplicada nos leaves.
 */
export function createKeystore(backend: SecureBackend): Keystore {
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
      // O cofre não enumera; iteramos os provedores suportados e devolvemos APENAS os NOMES daqueles
      // com valor presente (nunca o valor).
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
