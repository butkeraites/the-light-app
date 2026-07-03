// driveAuth.web.test.mjs — F5.24 (molde snapshot.web.test.mjs F5.23 / keystore.test.mjs F2.4)
//
// PROVA HEADLESS (node, SEM browser/Expo/rede/CONTA/chave) do FLUXO DE AUTORIZAÇÃO do
// Google Drive (OAuth 2.0 PKCE client-side, escopo `drive.appdata`). Exercita o MESMO
// código de PRODUÇÃO que a UI de sync (F5.26) vai injetar com `globalThis.fetch`/
// `globalThis.crypto` — mas aqui `fetch` e `crypto` são MOCKS (NENHUMA chamada real ao
// Google; a validação com conta REAL é a F5.27, gate humano, e conta/token NUNCA transitam
// pelo loop).
//
// PROVA: (1) `generatePkce` DETERMINÍSTICO com o vetor OFICIAL RFC 7636 Apêndice B
// (getRandomValues fixo → verifier conhecido → challenge = BASE64URL(SHA-256(verifier)));
// (2) `buildAuthUrl` traz scope `drive.appdata`, `code_challenge_method=S256`,
// `response_type=code`, `access_type=offline`, `prompt=consent`, o state e o redirect (e
// NÃO vaza o verifier); (3) `exchangeCode` faz POST ao token endpoint com
// `grant_type=authorization_code`+`code_verifier` (SEM client_secret; mock retorna token)
// → `link()` grava no TokenStore → `isLinked()==true` → `currentToken()` devolve o access
// token → expiração checada → `unlink()` limpa → `isLinked()==false`; (4) INVARIANTE DE
// NÃO-VAZAMENTO: nenhum token/verifier aparece no output nem há `console.*` no fonte de
// `driveAuth.ts`. Marcador `DRIVE_AUTH pkce=ok url=ok exchange=ok link=ok unlink=ok
// notoken=ok`. Sai 0 se tudo bater; !=0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'driveAuth-headless-entry.ts');
const DRIVEAUTH_TS = join(__dirname, '..', '..', 'lib', 'driveAuth.ts');

// ── Vetor de teste OFICIAL do PKCE (RFC 7636 Apêndice B) ─────────────────────
// verifier (BASE64URL de 32 octetos aleatórios) → challenge = BASE64URL(SHA-256(verifier)).
// Os 32 octetos são DERIVADOS do verifier oficial (decode BASE64URL) e usados como o
// `getRandomValues` mockado: assim `base64UrlEncode(octetos)` deve reproduzir o verifier
// (prova o encoder) e a SHA-256 REAL do verifier deve bater com o challenge oficial.
const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const RFC7636_OCTETS = new Uint8Array(
  Buffer.from(RFC7636_VERIFIER.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
);

// ── Valores MOCK (NÃO reais) — asserções deste teste; nunca vão a git/log/rede ──
// O client-id é PÚBLICO (não é segredo). O access/refresh token e o verifier são
// SENSÍVEIS: a prova prova que eles NUNCA aparecem no output (notoken=ok).
const MOCK_CLIENT_ID = '1234567890-mockpublicclient.apps.googleusercontent.com';
const MOCK_REDIRECT_URI = 'https://localhost:8081/oauth2/drive';
const MOCK_AUTH_CODE = 'MOCK_AUTH_CODE_not_real';
const MOCK_ACCESS_TOKEN = 'MOCK_ACCESS_TOKEN_not_real_do_not_use';
const MOCK_REFRESH_TOKEN = 'MOCK_REFRESH_TOKEN_not_real_do_not_use';
const MOCK_STATE = 'state-xyz-123';
// Strings que NUNCA podem vazar no output da prova (tokens + verifier PKCE).
const SECRETS = [MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN, RFC7636_VERIFIER];

async function loadBundle() {
  const outfile = join(tmpdir(), `driveauth-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

// `crypto` MOCK: getRandomValues DETERMINÍSTICO (octetos do vetor RFC) + SHA-256 REAL
// (webcrypto do node) — prova que o challenge é o SHA-256 verdadeiro do verifier.
const mockCrypto = {
  getRandomValues(buf) {
    buf.set(RFC7636_OCTETS.subarray(0, buf.length));
    return buf;
  },
  subtle: {
    digest: (algorithm, data) => webcrypto.subtle.digest(algorithm, data),
  },
};

// TokenStore EM MEMÓRIA — o backend injetável que a F5.26 ligaria a session/secure storage.
function makeMemoryTokenStore() {
  let current = null;
  return {
    async get() {
      return current;
    },
    async set(token) {
      current = token;
    },
    async clear() {
      current = null;
    },
    peek() {
      return current;
    },
  };
}

// Espiona console.* p/ a INVARIANTE de não-vazamento (token/verifier nunca logados).
function spyConsole() {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const captured = [];
  const originals = {};
  for (const m of methods) {
    originals[m] = console[m];
    console[m] = (...args) => {
      captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  }
  return {
    captured,
    restore() {
      for (const m of methods) console[m] = originals[m];
    },
  };
}

function assertNoSecretIn(text, where) {
  for (const s of SECRETS) {
    assert.ok(!String(text).includes(s), `${where} NÃO deve conter segredo (token/verifier)`);
  }
}

async function main() {
  const {
    generatePkce,
    buildAuthUrl,
    exchangeCode,
    createDriveAuth,
    DRIVE_APPDATA_SCOPE,
    GOOGLE_AUTH_ENDPOINT,
    GOOGLE_TOKEN_ENDPOINT,
  } = await loadBundle();

  // Relógio INJETADO (fixo) p/ tornar a expiração determinística.
  let clock = 1_000_000_000_000;
  const now = () => clock;

  // `fetch` MOCK: valida a requisição de troca (PKCE, SEM client_secret) e retorna token.
  let capturedTokenRequest = null;
  const mockFetch = async (url, init) => {
    capturedTokenRequest = { url, method: init.method };
    assert.equal(url, GOOGLE_TOKEN_ENDPOINT, 'exchangeCode: POST ao token endpoint do Google');
    assert.equal(init.method, 'POST', 'exchangeCode: método POST');
    assert.equal(
      init.headers['Content-Type'],
      'application/x-www-form-urlencoded',
      'exchangeCode: content-type form-urlencoded',
    );
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('grant_type'), 'authorization_code', 'grant_type=authorization_code');
    assert.equal(params.get('code'), MOCK_AUTH_CODE, 'code enviado');
    assert.equal(params.get('code_verifier'), RFC7636_VERIFIER, 'code_verifier (PKCE) enviado');
    assert.equal(params.get('client_id'), MOCK_CLIENT_ID, 'client_id enviado');
    assert.equal(params.get('redirect_uri'), MOCK_REDIRECT_URI, 'redirect_uri enviado');
    assert.equal(params.get('client_secret'), null, 'NENHUM client_secret (cliente público + PKCE)');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          access_token: MOCK_ACCESS_TOKEN,
          expires_in: 3600,
          refresh_token: MOCK_REFRESH_TOKEN,
          token_type: 'Bearer',
          scope: DRIVE_APPDATA_SCOPE,
        };
      },
    };
  };

  const spy = spyConsole();
  try {
    // ── (1) PKCE DETERMINÍSTICO → vetor OFICIAL RFC 7636 Apêndice B ───────────
    const pkce = await generatePkce(mockCrypto);
    assert.equal(pkce.codeVerifier, RFC7636_VERIFIER, 'PKCE verifier == vetor RFC 7636 B');
    assert.equal(
      pkce.codeChallenge,
      RFC7636_CHALLENGE,
      'PKCE challenge == BASE64URL(SHA-256(verifier)) do vetor RFC 7636 B',
    );
    assert.ok(
      pkce.codeVerifier.length >= 43 && pkce.codeVerifier.length <= 128,
      'verifier no intervalo 43–128 chars (RFC 7636)',
    );

    // ── (2) buildAuthUrl — campos exigidos, escopo appdata, SEM vazar o verifier ─
    const authUrl = buildAuthUrl({
      clientId: MOCK_CLIENT_ID,
      redirectUri: MOCK_REDIRECT_URI,
      scope: DRIVE_APPDATA_SCOPE,
      codeChallenge: pkce.codeChallenge,
      state: MOCK_STATE,
    });
    const u = new URL(authUrl);
    assert.equal(u.origin + u.pathname, GOOGLE_AUTH_ENDPOINT, 'URL aponta ao endpoint de auth do Google');
    assert.equal(u.searchParams.get('response_type'), 'code', 'response_type=code');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256', 'code_challenge_method=S256');
    assert.equal(u.searchParams.get('code_challenge'), pkce.codeChallenge, 'code_challenge (público) na URL');
    assert.equal(u.searchParams.get('scope'), DRIVE_APPDATA_SCOPE, 'scope = drive.appdata');
    assert.ok(DRIVE_APPDATA_SCOPE.endsWith('/auth/drive.appdata'), 'escopo mínimo app-private (drive.appdata)');
    assert.equal(u.searchParams.get('state'), MOCK_STATE, 'state ecoado');
    assert.equal(u.searchParams.get('redirect_uri'), MOCK_REDIRECT_URI, 'redirect_uri na URL');
    assert.equal(u.searchParams.get('client_id'), MOCK_CLIENT_ID, 'client_id (público) na URL');
    assert.equal(u.searchParams.get('access_type'), 'offline', 'access_type=offline');
    assert.equal(u.searchParams.get('prompt'), 'consent', 'prompt=consent');
    assert.ok(!authUrl.includes(RFC7636_VERIFIER), 'a URL de auth NÃO contém o code_verifier (só o challenge)');

    // Serviço sobre deps INJETADAS (fetch/crypto/tokenStore/relógio mockados).
    const tokenStore = makeMemoryTokenStore();
    const auth = createDriveAuth({
      clientId: MOCK_CLIENT_ID,
      redirectUri: MOCK_REDIRECT_URI,
      tokenStore,
      fetch: mockFetch,
      crypto: mockCrypto,
      now,
    });

    // beginLink combina PKCE + URL (mesmo crypto determinístico).
    const begin = await auth.beginLink(MOCK_STATE);
    assert.equal(begin.codeVerifier, RFC7636_VERIFIER, 'beginLink devolve o verifier a guardar');
    assert.equal(begin.state, MOCK_STATE, 'beginLink ecoa o state');
    assert.ok(begin.url.includes('code_challenge_method=S256'), 'beginLink monta a URL S256');

    // Estado inicial: DESLINKADO.
    assert.equal(await auth.isLinked(), false, 'começa deslinkado');
    assert.equal((await auth.getLinkState()).status, 'unlinked', 'linkState inicial = unlinked');
    assert.equal(await auth.currentToken(), null, 'sem token → currentToken null');

    // ── (3) exchangeCode → token; link() grava; isLinked; currentToken ───────
    const token = await exchangeCode({
      code: MOCK_AUTH_CODE,
      codeVerifier: pkce.codeVerifier,
      clientId: MOCK_CLIENT_ID,
      redirectUri: MOCK_REDIRECT_URI,
      fetch: mockFetch,
      now,
    });
    assert.ok(capturedTokenRequest, 'fetch foi chamado no token endpoint');
    assert.equal(token.accessToken, MOCK_ACCESS_TOKEN, 'exchangeCode extrai o access_token');
    assert.equal(token.refreshToken, MOCK_REFRESH_TOKEN, 'exchangeCode extrai o refresh_token');
    assert.equal(token.expiresAt, clock + 3600 * 1000, 'expiresAt = now + expires_in');

    const linked = await auth.link(token, 'user@example.com');
    assert.equal(linked.status, 'linked', 'link() → estado linked');
    assert.equal(linked.email, 'user@example.com', 'link() guarda o email');
    assert.equal(linked.expiresAt, token.expiresAt, 'link() ecoa a expiração');
    assert.equal(await auth.isLinked(), true, 'após link() → isLinked true');
    assert.equal((await auth.getLinkState()).status, 'linked', 'getLinkState → linked');
    assert.equal(await auth.currentToken(), MOCK_ACCESS_TOKEN, 'currentToken devolve o access token válido');
    // O TokenStore guardou o token (nunca em git/log; só neste Map em memória).
    assert.equal(tokenStore.peek().accessToken, MOCK_ACCESS_TOKEN, 'TokenStore guardou o access token');

    // Expiração: relógio além de expiresAt → currentToken null (refresh é F5.25), mas
    // o link permanece (há token/refresh no store).
    clock = token.expiresAt + 1;
    assert.equal(await auth.currentToken(), null, 'token expirado → currentToken null');
    assert.equal(await auth.isLinked(), true, 'expirado ainda conta como linkado (há refresh; F5.25)');
    clock = 1_000_000_000_000; // restaura o relógio

    // completeLink: exchange + gravar em um passo (mesmo mock fetch).
    const completed = await auth.completeLink(MOCK_AUTH_CODE, pkce.codeVerifier, 'user@example.com');
    assert.equal(completed.status, 'linked', 'completeLink → linked');
    assert.equal(await auth.currentToken(), MOCK_ACCESS_TOKEN, 'completeLink deixa o token válido no store');

    // ── (4) unlink() limpa o TokenStore ──────────────────────────────────────
    await auth.unlink();
    assert.equal(await auth.isLinked(), false, 'após unlink() → isLinked false');
    assert.equal((await auth.getLinkState()).status, 'unlinked', 'getLinkState → unlinked após unlink');
    assert.equal(await auth.currentToken(), null, 'sem token após unlink');
    assert.equal(tokenStore.peek(), null, 'TokenStore limpo após unlink');
    // unlink é idempotente.
    await auth.unlink();
    assert.equal(await auth.isLinked(), false, 'unlink idempotente');

    // Erro de rede/HTTP: exchangeCode rejeita em resposta != 2xx (sem vazar corpo).
    const failFetch = async () => ({
      ok: false,
      status: 400,
      async json() {
        return { error: 'invalid_grant' };
      },
    });
    await assert.rejects(
      () =>
        exchangeCode({
          code: MOCK_AUTH_CODE,
          codeVerifier: pkce.codeVerifier,
          clientId: MOCK_CLIENT_ID,
          redirectUri: MOCK_REDIRECT_URI,
          fetch: failFetch,
          now,
        }),
      /HTTP 400/,
      'exchangeCode rejeita HTTP != 2xx',
    );
  } finally {
    spy.restore();
  }

  // ── INVARIANTE DE NÃO-VAZAMENTO ─────────────────────────────────────────────
  // (a) Nada capturado do console durante a execução contém token/verifier.
  const joined = spy.captured.join('\n');
  assertNoSecretIn(joined, 'saída de console capturada da prova');
  // (b) O fonte de driveAuth.ts NÃO tem NENHUM console.* (token/verifier/challenge nunca logados).
  const src = await readFile(DRIVEAUTH_TS, 'utf8');
  assert.ok(
    !/\bconsole\s*\./.test(src),
    'driveAuth.ts NÃO deve conter nenhum console.* (token/verifier/challenge nunca logados)',
  );
  // (c) O fonte não envia client_secret na troca (cliente público + PKCE).
  assert.ok(!/client_secret/.test(src), 'driveAuth.ts NÃO envia client_secret (cliente público)');

  const marker = 'DRIVE_AUTH pkce=ok url=ok exchange=ok link=ok unlink=ok notoken=ok';
  assertNoSecretIn(marker, 'marcador final');

  console.log('PASS — drive auth web (OAuth 2.0 PKCE client-side, MOCK; dados/token só do usuário):');
  console.log('  (1) PKCE S256          -> generatePkce == vetor OFICIAL RFC 7636 Apêndice B (verifier+challenge)');
  console.log('  (2) buildAuthUrl       -> scope drive.appdata, response_type=code, S256, offline/consent, state+redirect');
  console.log('  (3) exchangeCode       -> POST token endpoint (grant_type=authorization_code + code_verifier, SEM client_secret)');
  console.log('  (4) link/currentToken  -> grava no TokenStore, currentToken válido, expiração checada');
  console.log('  (5) unlink             -> TokenStore limpo, isLinked=false (idempotente)');
  console.log('  MOCK apenas: NENHUMA chamada real ao Google; validação com conta REAL é a F5.27 (gate humano).');
  console.log('  NÃO-VAZAMENTO: nenhum token/verifier no output; nenhum console.* em driveAuth.ts; sem client_secret.');
  console.log(`  ${marker}`);

  assert.match(marker, /notoken=ok/, 'marcador prova a invariante de não-vazamento');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
