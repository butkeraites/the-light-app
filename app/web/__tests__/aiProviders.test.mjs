// aiProviders.test.mjs — deepening (ADR-0059; molde keystore.test.mjs)
//
// PROVA HEADLESS (node, SEM device e SEM chave real) dos helpers PUROS compartilhados pelos 4
// painéis de IA (`app/lib/aiProviders.ts` + `app/lib/errMessage.ts`). Injeta um `getKey` FAKE
// e assere a LÓGICA determinística de resolução de chave BYOK, o ANTI-VAZAMENTO (o valor da
// chave só aparece em `kind:'key'`; `mock` NÃO chama `getKey` — offline, sem rede), as ORDENS
// do seletor, e a coerção de erro. Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'aiProviders-headless-entry.ts');

// Placeholder — NÃO é uma chave real; só uma asserção deste teste (vive em memória).
const PLACEHOLDER = 'PLACEHOLDER_test_key_do_not_use';

async function loadBundle() {
  const outfile = join(tmpdir(), `aiproviders-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    // `aiProviders` → `keystore`, cujo backend padrão importa `expo-secure-store` de forma
    // lazy; a prova nunca o aciona (injeta um `getKey` fake) — external evita puxar o nativo.
    external: ['expo-secure-store'],
  });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const {
    MOCK_PROVIDER,
    PROVIDER_OPTIONS_MOCK_FIRST,
    PROVIDER_OPTIONS_MOCK_LAST,
    isMockProvider,
    resolveProviderKey,
    keyArg,
    errMessage,
    SUPPORTED_PROVIDERS,
  } = await loadBundle();

  // ── isMockProvider ────────────────────────────────────────────────────────────────
  assert.equal(isMockProvider(MOCK_PROVIDER), true, 'isMockProvider(mock) === true');
  assert.equal(isMockProvider('anthropic'), false, 'isMockProvider(anthropic) === false');

  // ── ordens do seletor ─────────────────────────────────────────────────────────────
  assert.equal(PROVIDER_OPTIONS_MOCK_FIRST[0], 'mock', 'MOCK_FIRST começa com mock');
  assert.equal(PROVIDER_OPTIONS_MOCK_LAST.at(-1), 'mock', 'MOCK_LAST termina com mock');
  for (const p of SUPPORTED_PROVIDERS) {
    assert.ok(PROVIDER_OPTIONS_MOCK_FIRST.includes(p), `MOCK_FIRST contém ${p}`);
    assert.ok(PROVIDER_OPTIONS_MOCK_LAST.includes(p), `MOCK_LAST contém ${p}`);
  }
  assert.equal(
    PROVIDER_OPTIONS_MOCK_FIRST.length,
    SUPPORTED_PROVIDERS.length + 1,
    'MOCK_FIRST = todos os provedores + mock',
  );

  // ── resolveProviderKey: mock NÃO chama getKey (offline, sem rede/chave) ─────────────
  let getKeyCalls = 0;
  const spyGetKey = async (p) => {
    getKeyCalls += 1;
    return p === 'anthropic' ? PLACEHOLDER : null;
  };

  const mockRes = await resolveProviderKey(MOCK_PROVIDER, spyGetKey);
  assert.deepEqual(mockRes, { kind: 'mock' }, 'mock → {kind:mock}');
  assert.equal(getKeyCalls, 0, 'mock NÃO deve chamar getKey (offline, sem rede)');

  // ── resolveProviderKey: real sem chave → no-key (sem lançar) ────────────────────────
  const noKeyRes = await resolveProviderKey('openai', spyGetKey);
  assert.deepEqual(noKeyRes, { kind: 'no-key' }, 'real sem chave → {kind:no-key}');
  assert.equal(getKeyCalls, 1, 'real consulta o cofre 1×');

  // ── resolveProviderKey: real com chave → {kind:key,key} ─────────────────────────────
  const keyRes = await resolveProviderKey('anthropic', spyGetKey);
  assert.deepEqual(keyRes, { kind: 'key', key: PLACEHOLDER }, 'real com chave → {kind:key,key}');

  // ── keyArg: undefined p/ mock/no-key; o valor só p/ key ─────────────────────────────
  assert.equal(keyArg({ kind: 'mock' }), undefined, 'keyArg(mock) === undefined');
  assert.equal(keyArg({ kind: 'no-key' }), undefined, 'keyArg(no-key) === undefined');
  assert.equal(keyArg({ kind: 'key', key: PLACEHOLDER }), PLACEHOLDER, 'keyArg(key) === o valor');

  // ── ANTI-VAZAMENTO: o valor da chave só aparece sob kind:'key' ──────────────────────
  assert.ok(!JSON.stringify(mockRes).includes(PLACEHOLDER), 'mock não vaza chave');
  assert.ok(!JSON.stringify(noKeyRes).includes(PLACEHOLDER), 'no-key não vaza chave');
  assert.ok(
    JSON.stringify(keyRes).includes(PLACEHOLDER),
    'só a resolução kind:key carrega o valor',
  );
  assert.equal(keyArg(mockRes), undefined, 'keyArg(mockRes) não expõe valor');
  assert.equal(keyArg(noKeyRes), undefined, 'keyArg(noKeyRes) não expõe valor');

  // ── errMessage: Error.message | String(err) ─────────────────────────────────────────
  assert.equal(errMessage(new Error('boom')), 'boom', 'errMessage(Error) === message');
  assert.equal(errMessage('plain'), 'plain', 'errMessage(string) === a própria string');
  assert.equal(errMessage(null), 'null', 'errMessage(null) === "null"');
  assert.equal(errMessage(42), '42', 'errMessage(number) === String(number)');

  console.log('PASS — aiProviders/errMessage (helpers puros, getKey fake, sem device/chave real):');
  console.log('  isMockProvider + ordens do seletor (MOCK_FIRST/MOCK_LAST): OK');
  console.log('  resolveProviderKey: mock (0 getKey) / no-key / key: OK');
  console.log('  keyArg: undefined p/ mock+no-key, valor só p/ key: OK');
  console.log('  anti-vazamento: o valor da chave só sob kind:key: OK');
  console.log('  errMessage: Error.message | String(err): OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
