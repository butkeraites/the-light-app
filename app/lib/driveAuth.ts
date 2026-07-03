// app/lib/driveAuth.ts — F5.24 (ADR-0052 / ADR-0036, reconcilia ADR-0023)
//
// FLUXO DE AUTORIZAÇÃO do Google Drive no WEB — OAuth 2.0 com PKCE (S256) CLIENT-SIDE,
// SEM servidor do app. É a 2ª etapa da trilha de sync (ADR-0036): habilita a F5.25 a
// gravar/ler o SNAPSHOT da F5.23 (`userdataSnapshot.ts`) na pasta APP-PRIVATE do Drive
// do PRÓPRIO usuário. Esta camada entrega SÓ o link/unlink + gestão de token; push/pull
// do snapshot é a F5.25; a UI opt-in é a F5.26; a validação com conta REAL é a F5.27.
//
// MOTOR PURO / INJEÇÃO DE DEPENDÊNCIAS (molde `userdataSnapshot.ts` / `keystore.ts`):
// nada de rede/crypto/relógio embutidos. O chamador injeta `fetch`, `crypto` (Web Crypto),
// `redirectUri`, `clientId`, um `TokenStore` (get/set/clear) e opcionalmente `now`. Isso
// mantém o módulo FORA do entry graph eager do web (perf-budget) e testável headless com
// mocks de `fetch`+`crypto` (a F5.27 valida com conta/Drive REAIS — nunca pelo loop).
//
// OFFLINE-FIRST (base): o app é 100% funcional com ZERO conta/rede; isto é estritamente
// OPT-IN e ADITIVO. Nada essencial passa a exigir Google.
//
// RECONCILIAÇÃO COM ADR-0023 ("OAuth banido"): o ADR-0023 baniu OAuth p/ as CHAVES BYOK
// de IA (login-de-conta arriscava banir a conta do usuário). Aqui é caso DISTINTO: acesso
// ao ARMAZENAMENTO do próprio usuário, na conta DELE, onde o Google EXIGE OAuth e o PKCE
// client-side (client-id PÚBLICO, SEM client-secret) é o padrão seguro para clientes
// públicos. Não há infra/servidor/segredo do app.
//
// SEGREDOS: client-id é PÚBLICO (pode ficar em config); NUNCA há client-secret (cliente
// público + PKCE). O access token / refresh token / code_verifier / code_challenge são
// SENSÍVEIS e NUNCA são logados/impressos (este arquivo não faz NENHUMA chamada de log). O
// token vive só no `TokenStore` injetado (memória de sessão / secure storage do alvo),
// jamais em git/log.
//
// ESCOPO MÍNIMO: `drive.appdata` — SÓ a pasta oculta app-private (não lê o Drive do
// usuário, não toca outros arquivos dele).

// ── Endpoints e escopo (constantes públicas — nada secreto) ──────────────────
/** Endpoint de AUTORIZAÇÃO do Google (onde o usuário consente). */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth' as const;
/** Endpoint de TOKEN do Google (troca do authorization code por access token). */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token' as const;
/** Escopo MÍNIMO: apenas a pasta oculta app-private do Drive (não o Drive inteiro). */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata' as const;

// ── BASE64URL sem padding (portável: sem `Buffer`/`btoa`) ─────────────────────
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Codifica bytes em BASE64URL (RFC 4648 §5, SEM padding `=`) — determinístico e portável
 * (não depende de `Buffer` do node nem de `btoa` do browser), p/ que o PKCE seja idêntico
 * nos dois ambientes e comparável a vetores de teste (RFC 7636 Apêndice B).
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (!hasB1) {
      break;
    }
    out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (!hasB2) {
      break;
    }
    out += B64URL[b2 & 0x3f];
  }
  return out;
}

// ── PKCE (S256) ──────────────────────────────────────────────────────────────
/** Subconjunto MÍNIMO da Web Crypto injetado p/ o PKCE (random + SHA-256). */
export interface PkceCrypto {
  getRandomValues(array: Uint8Array): Uint8Array;
  subtle: {
    digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  };
}

/** Par PKCE: o `codeVerifier` (segredo efêmero) + o `codeChallenge` (público). */
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Gera um par PKCE (S256): `codeVerifier` = BASE64URL de 32 bytes aleatórios (43 chars,
 * dentro de 43–128 da RFC 7636) e `codeChallenge` = BASE64URL(SHA-256(codeVerifier)). O
 * `crypto` é INJETADO (Web Crypto no runtime; mock determinístico na prova). NUNCA loga o
 * verifier/challenge. Determinístico p/ um `getRandomValues` fixo (testável por vetor).
 */
export async function generatePkce(crypto: PkceCrypto): Promise<PkcePair> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const codeVerifier = base64UrlEncode(random);
  const encoded = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

// ── URL de autorização ───────────────────────────────────────────────────────
/** Parâmetros p/ montar a URL de autorização (todos PÚBLICOS — nenhum segredo). */
export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  state: string;
}

/**
 * Monta a URL de AUTORIZAÇÃO do Google (`response_type=code`, `code_challenge_method=S256`,
 * `access_type=offline`, `prompt=consent`) — para onde o usuário é enviado a consentir.
 * Só campos públicos (client-id público + code_challenge + state); NENHUM segredo/token.
 */
export function buildAuthUrl(params: AuthUrlParams): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', params.state);
  return url.toString();
}

// ── Troca do code por token (PKCE, SEM client-secret) ─────────────────────────
/** Response mínima que `exchangeCode` consome do `fetch` injetado. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** `fetch` injetável (subconjunto do WHATWG fetch usado aqui). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<FetchResponseLike>;

/** Parâmetros da troca do authorization code por token (cliente público + PKCE). */
export interface ExchangeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  fetch: FetchLike;
  /** Relógio injetável (default `Date.now`) p/ calcular `expiresAt` de forma testável. */
  now?: () => number;
}

/** Resultado da troca: access token + expiração absoluta (epoch ms) + refresh opcional. */
export interface TokenResult {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) {
    throw new Error('resposta do token não é um objeto JSON');
  }
  return v as Record<string, unknown>;
}

/**
 * Troca o `authorization_code` por token no endpoint do Google, com PKCE e SEM
 * client-secret (cliente público): POST `application/x-www-form-urlencoded` com
 * `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `redirect_uri`.
 * O `fetch` é INJETADO (mock na prova; real na F5.26/F5.27). NUNCA loga o corpo/token.
 * Lança em HTTP != 2xx ou resposta sem `access_token`. `expiresAt` = `now()` + `expires_in`.
 */
export async function exchangeCode(params: ExchangeParams): Promise<TokenResult> {
  const now = params.now ?? (() => Date.now());
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
  }).toString();

  const resp = await params.fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    // Mensagem cita só o status HTTP (não-secreto) — NUNCA o corpo/token.
    throw new Error(`troca de code falhou: HTTP ${resp.status}`);
  }

  const data = asRecord(await resp.json());
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new Error('resposta do token sem access_token');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const result: TokenResult = {
    accessToken: data.access_token,
    expiresAt: now() + expiresIn * 1000,
  };
  if (typeof data.refresh_token === 'string' && data.refresh_token.length > 0) {
    result.refreshToken = data.refresh_token;
  }
  return result;
}

// ── Estado de link + TokenStore + serviço ────────────────────────────────────
/** Token PERSISTIDO no `TokenStore` (memória de sessão / secure storage do alvo). */
export interface StoredToken {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  email?: string;
}

/**
 * Contrato mínimo de armazenamento de token, INJETADO pelo alvo. No web = memória de
 * sessão (a F5.26 liga); em secure storage no nativo. O motor NUNCA importa o backend
 * diretamente (pureza/injeção; molde `keystore`/`SnapshotStore`). O token é SENSÍVEL:
 * nunca em git/log.
 */
export interface TokenStore {
  get(): Promise<StoredToken | null>;
  set(token: StoredToken): Promise<void>;
  clear(): Promise<void>;
}

/** Estado do link (o que a UI da F5.26 renderiza): linkado (com expiração) ou não. */
export type LinkState =
  | { status: 'linked'; email?: string; expiresAt: number }
  | { status: 'unlinked' };

/** Dependências injetadas do serviço de autorização (nada de rede/crypto/relógio embutido). */
export interface DriveAuthDeps {
  clientId: string;
  redirectUri: string;
  tokenStore: TokenStore;
  fetch: FetchLike;
  crypto: PkceCrypto;
  /** Escopo (default `drive.appdata` — o mínimo app-private). */
  scope?: string;
  /** Relógio injetável (default `Date.now`) p/ a checagem de expiração. */
  now?: () => number;
}

/** O que o serviço `beginLink` devolve: a URL de consentimento + o verifier a guardar. */
export interface BeginLinkResult {
  url: string;
  codeVerifier: string;
  state: string;
}

/** Superfície pública do serviço de autorização do Drive. */
export interface DriveAuth {
  /** Passo 1: gera PKCE + monta a URL de consentimento (o `codeVerifier` deve ser guardado). */
  beginLink(state: string): Promise<BeginLinkResult>;
  /** Passo 2: troca o code por token (com o verifier do passo 1) e grava no TokenStore. */
  completeLink(code: string, codeVerifier: string, email?: string): Promise<LinkState>;
  /** Grava um token já obtido no TokenStore (link direto — molde da prova). */
  link(token: TokenResult, email?: string): Promise<LinkState>;
  /** Limpa o TokenStore (deslinca). Idempotente. */
  unlink(): Promise<void>;
  /** True se há uma conta linkada (token presente no store), independente de expiração. */
  isLinked(): Promise<boolean>;
  /** Access token VÁLIDO (não expirado) ou `null` (expirado/ausente → refresh é F5.25). */
  currentToken(): Promise<string | null>;
  /** Estado atual do link (p/ a UI). */
  getLinkState(): Promise<LinkState>;
}

function linkedStateOf(token: StoredToken): LinkState {
  return {
    status: 'linked',
    ...(token.email != null ? { email: token.email } : {}),
    expiresAt: token.expiresAt,
  };
}

/**
 * Cria o serviço de autorização do Drive sobre dependências INJETADAS (fetch/crypto/
 * tokenStore/clientId/redirectUri). Puro/testável: a prova injeta mocks; a UI (F5.26)
 * injeta `globalThis.fetch`/`globalThis.crypto` + um TokenStore real. NUNCA loga token/
 * verifier/challenge (nenhuma chamada de log neste módulo).
 */
export function createDriveAuth(deps: DriveAuthDeps): DriveAuth {
  const scope = deps.scope ?? DRIVE_APPDATA_SCOPE;
  const now = deps.now ?? (() => Date.now());

  async function link(token: TokenResult, email?: string): Promise<LinkState> {
    const stored: StoredToken = {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      ...(token.refreshToken != null ? { refreshToken: token.refreshToken } : {}),
      ...(email != null ? { email } : {}),
    };
    await deps.tokenStore.set(stored);
    return linkedStateOf(stored);
  }

  return {
    async beginLink(state) {
      const { codeVerifier, codeChallenge } = await generatePkce(deps.crypto);
      const url = buildAuthUrl({
        clientId: deps.clientId,
        redirectUri: deps.redirectUri,
        scope,
        codeChallenge,
        state,
      });
      return { url, codeVerifier, state };
    },

    async completeLink(code, codeVerifier, email) {
      const token = await exchangeCode({
        code,
        codeVerifier,
        clientId: deps.clientId,
        redirectUri: deps.redirectUri,
        fetch: deps.fetch,
        now,
      });
      return link(token, email);
    },

    link,

    async unlink() {
      await deps.tokenStore.clear();
    },

    async isLinked() {
      return (await deps.tokenStore.get()) != null;
    },

    async currentToken() {
      const token = await deps.tokenStore.get();
      if (token == null) {
        return null;
      }
      if (now() >= token.expiresAt) {
        return null; // expirado → refresh (F5.25); NÃO é access token válido.
      }
      return token.accessToken;
    },

    async getLinkState() {
      const token = await deps.tokenStore.get();
      return token != null ? linkedStateOf(token) : { status: 'unlinked' };
    },
  };
}
