// app/lib/aiProviders.ts — deepening (ADR-0059): domínio PURO de provedor/BYOK dos painéis de IA
//
// Núcleo compartilhado pelos 4 painéis de IA (Perguntar/Conversa/Estudo/Comparar). Concentra o
// que era redefinido em cada painel: o provedor OFFLINE `mock`, as ORDENS do seletor, e — o
// principal — o bloco BYOK "lê a chave sob demanda e passa à fronteira" como um
// `resolveProviderKey` NEUTRO DE UX: nunca lança por falta de chave e nunca loga/retorna o valor
// exceto em `kind:'key'`. Assim a MESMA função serve o throw-shape (Ask/Chat/Study: no-key → erro)
// e o cell-shape do Compare (no-key → coluna "sem chave"). `getKey` é INJETADO (DI, no molde
// `create*(deps)` do repo) → testável em node com um cofre fake.
//
// OFFLINE-FIRST/BYOK (LEI): `mock` faz curto-circuito SEM chamar `getKey` (sem chave/rede); a
// chave real é lida sob demanda e NUNCA logada/persistida aqui. Este módulo desconhece `AiAnswer`
// — não toca texto bíblico nem interpretação (anti-alucinação intacta).
import { SUPPORTED_PROVIDERS } from './keystore';

/** Deterministic OFFLINE provider (no key, no network) — safe default + headless proof path. */
export const MOCK_PROVIDER = 'mock';

/** Selector order for the single-answer panels (Ask/Chat/Study): mock first, then BYOK reals. */
export const PROVIDER_OPTIONS_MOCK_FIRST: readonly string[] = [MOCK_PROVIDER, ...SUPPORTED_PROVIDERS];
/** Selector order for the compare fan-out: BYOK reals first, then mock. */
export const PROVIDER_OPTIONS_MOCK_LAST: readonly string[] = [...SUPPORTED_PROVIDERS, MOCK_PROVIDER];

/** True if `p` is the offline mock provider (no key / no network). */
export function isMockProvider(p: string): boolean {
  return p === MOCK_PROVIDER;
}

/** BYOK key resolution WITHOUT deciding UX: the caller turns no-key into a throw or a cell. */
export type KeyResolution =
  | { kind: 'mock' } //              offline provider — no key, no network
  | { kind: 'key'; key: string } //  real provider WITH a stored key
  | { kind: 'no-key' }; //           real provider, no key in the vault

/**
 * Resolve `provider`'s BYOK key via the injected `getKey` (keystore.getKey). PURE of UX:
 * never throws for a missing key, never logs, never returns the value except in kind:'key'.
 * For mock it short-circuits WITHOUT calling getKey (no key/network for the offline path).
 */
export async function resolveProviderKey(
  provider: string,
  getKey: (p: string) => Promise<string | null>,
): Promise<KeyResolution> {
  if (isMockProvider(provider)) {
    return { kind: 'mock' };
  }
  const stored = await getKey(provider);
  if (!stored) {
    return { kind: 'no-key' };
  }
  return { kind: 'key', key: stored };
}

/** The `key` argument to hand the frontier for a resolution (undefined for mock/no-key). */
export function keyArg(res: KeyResolution): string | undefined {
  return res.kind === 'key' ? res.key : undefined;
}
