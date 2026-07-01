// keystore.test.mjs — F2.4 (ADR-0023, D3; molde F1.13 reading.web.test.mjs)
//
// PROVA HEADLESS (node, SEM device e SEM chave real) do serviço de chave BYOK
// (`app/lib/keystore.ts`). Como `expo-secure-store` é módulo nativo (não roda em node
// puro), injetamos um BACKEND FAKE em memória (um Map) em `createKeystore(backend)` e
// exercitamos a LÓGICA do serviço de forma determinística:
//   1) gravar → ler de volta → apagar uma key PLACEHOLDER por provedor;
//   2) `listProviders` devolve os NOMES dos provedores com chave, NUNCA os valores;
//   3) round-trip por MÚLTIPLOS provedores independentes (a key de um não vaza no outro);
//   4) INVARIANTE DE LOG: `console.*` é espionado — a string da key NUNCA aparece em
//      console; e um grep do fonte de `keystore.ts`/`keystore.web.ts` garante que não
//      há `console.*` algum (a chave nunca é logada/impressa);
//   5) validação: provedor inválido e key vazia/whitespace são rejeitados.
//
// A key PLACEHOLDER abaixo é uma STRING DE ASSERÇÃO deste teste — NÃO é uma chave real
// e vive só no Map em memória (nunca é escrita em arquivo versionado). O bloco de
// verificação da task faz `git grep` do placeholder e exige que ele NÃO apareça fora
// deste arquivo. Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'keystore-headless-entry.ts');
const KEYSTORE_TS = join(__dirname, '..', '..', 'lib', 'keystore.ts');
const KEYSTORE_WEB_TS = join(__dirname, '..', '..', 'lib', 'keystore.web.ts');

// Placeholders — NÃO são chaves reais; só asserções deste teste (Map em memória).
const PLACEHOLDER = 'PLACEHOLDER_test_key_do_not_use';
const PLACEHOLDER_ANTHROPIC = 'PLACEHOLDER_test_key_do_not_use_anthropic';
const PLACEHOLDER_OPENAI = 'PLACEHOLDER_test_key_do_not_use_openai';
const ALL_PLACEHOLDERS = [PLACEHOLDER, PLACEHOLDER_ANTHROPIC, PLACEHOLDER_OPENAI];

async function loadBundle() {
  const outfile = join(tmpdir(), `keystore-headless-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    // O backend padrão importa `expo-secure-store` de forma lazy; a prova injeta um
    // fake e nunca o aciona — mantê-lo EXTERNAL evita puxar o módulo nativo p/ node.
    external: ['expo-secure-store'],
  });
  return import(pathToFileURL(outfile).href);
}

// Backend FAKE em memória (subconjunto de `expo-secure-store`). Guarda os pares
// key-id → valor num Map; espelha `getItemAsync`/`setItemAsync`/`deleteItemAsync`.
function makeFakeBackend() {
  const store = new Map();
  return {
    store,
    async getItemAsync(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setItemAsync(k, v) {
      store.set(k, v);
    },
    async deleteItemAsync(k) {
      store.delete(k);
    },
  };
}

// Espiona console.* — captura toda saída para a INVARIANTE de não-vazamento da chave.
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

function assertNoPlaceholderIn(text, where) {
  for (const ph of ALL_PLACEHOLDERS) {
    assert.ok(!text.includes(ph), `${where} NÃO deve conter o valor da chave (${ph})`);
  }
}

async function main() {
  const { createKeystore, keyIdFor, isSupportedProvider, SUPPORTED_PROVIDERS } = await loadBundle();

  // Provedores esperados (paridade com o core + Gemini via F2.3).
  assert.deepEqual(
    [...SUPPORTED_PROVIDERS],
    ['anthropic', 'openai', 'gemini', 'ollama'],
    'SUPPORTED_PROVIDERS deve ser [anthropic, openai, gemini, ollama]',
  );

  // O id da entrada contém o PROVEDOR, nunca o valor da chave.
  assert.equal(keyIdFor('gemini'), 'tla.apikey.gemini', 'keyIdFor deve namespacear por provedor');
  assertNoPlaceholderIn(keyIdFor('gemini'), 'keyIdFor("gemini")');

  const backend = makeFakeBackend();
  const spy = spyConsole();
  let ks;
  try {
    ks = createKeystore(backend);

    // (1) gemini: gravar → ler de volta (== placeholder).
    assert.equal(await ks.getKey('gemini'), null, 'gemini começa sem chave');
    await ks.setKey('gemini', PLACEHOLDER);
    assert.equal(await ks.getKey('gemini'), PLACEHOLDER, 'getKey deve devolver a key gravada');

    // (2) listProviders devolve NOMES, nunca valores.
    let providers = await ks.listProviders();
    assert.ok(providers.includes('gemini'), 'listProviders deve incluir "gemini"');
    assertNoPlaceholderIn(JSON.stringify(providers), 'listProviders() (com gemini)');
    assert.deepEqual(providers, ['gemini'], 'só "gemini" tem chave neste ponto');

    // (3) múltiplos provedores independentes — a key de um não vaza no outro.
    await ks.setKey('anthropic', PLACEHOLDER_ANTHROPIC);
    await ks.setKey('openai', PLACEHOLDER_OPENAI);
    assert.equal(await ks.getKey('anthropic'), PLACEHOLDER_ANTHROPIC, 'anthropic isolado');
    assert.equal(await ks.getKey('openai'), PLACEHOLDER_OPENAI, 'openai isolado');
    assert.equal(await ks.getKey('gemini'), PLACEHOLDER, 'gemini inalterado');
    assert.equal(await ks.getKey('ollama'), null, 'ollama nunca teve chave');

    providers = await ks.listProviders();
    // Ordem = ordem de SUPPORTED_PROVIDERS (anthropic, openai, gemini).
    assert.deepEqual(
      providers,
      ['anthropic', 'openai', 'gemini'],
      'listProviders deve listar os 3 provedores com chave, na ordem canônica',
    );
    assertNoPlaceholderIn(JSON.stringify(providers), 'listProviders() (3 provedores)');

    // As CHAVES do Map são ids namespaceados; NENHUM valor aparece como id.
    for (const id of backend.store.keys()) {
      assert.ok(id.startsWith('tla.apikey.'), `id "${id}" deve ser namespaceado`);
      assertNoPlaceholderIn(id, `id do secure-store "${id}"`);
    }

    // (4) apagar → getKey null, listProviders sem o provedor.
    await ks.deleteKey('gemini');
    assert.equal(await ks.getKey('gemini'), null, 'após deleteKey, getKey deve ser null');
    providers = await ks.listProviders();
    assert.ok(!providers.includes('gemini'), 'listProviders não deve conter "gemini" após apagar');
    assert.deepEqual(providers, ['anthropic', 'openai'], 'restam anthropic e openai');

    // deleteKey é idempotente (apagar de novo não lança).
    await ks.deleteKey('gemini');
    assert.equal(await ks.getKey('gemini'), null, 'deleteKey idempotente');

    // (5) validação: provedor inválido rejeitado; a mensagem NÃO vaza chave.
    assert.equal(isSupportedProvider('nope'), false, 'isSupportedProvider("nope") === false');
    await assert.rejects(
      () => ks.setKey('nope', PLACEHOLDER),
      (err) => {
        assertNoPlaceholderIn(String(err && err.message), 'mensagem de provedor inválido');
        return /não suportado/.test(String(err && err.message));
      },
      'setKey com provedor inválido deve rejeitar sem vazar a chave',
    );
    await assert.rejects(() => ks.getKey('nope'), 'getKey com provedor inválido deve rejeitar');

    // key vazia / só whitespace é rejeitada; a mensagem não contém a "chave".
    await assert.rejects(
      () => ks.setKey('gemini', '   '),
      (err) => /vazia/.test(String(err && err.message)),
      'setKey com key só-whitespace deve rejeitar',
    );
    assert.equal(await ks.getKey('gemini'), null, 'key inválida não deve ter sido gravada');

    // trim: whitespace ao redor é removido ao salvar.
    await ks.setKey('ollama', `  ${PLACEHOLDER}  `);
    assert.equal(await ks.getKey('ollama'), PLACEHOLDER, 'setKey deve dar trim no valor salvo');
    await ks.deleteKey('ollama');
  } finally {
    spy.restore();
  }

  // (4b) INVARIANTE DE LOG: nenhuma linha de console capturada contém a chave.
  const consoleDump = spy.captured.join('\n');
  for (const ph of ALL_PLACEHOLDERS) {
    assert.ok(
      !consoleDump.includes(ph),
      `A chave (${ph}) NUNCA pode aparecer em console (espião capturou ${spy.captured.length} linha(s))`,
    );
  }

  // Grep do FONTE: o serviço não pode ter NENHUM `console.` (não loga a chave).
  const nativeSrc = await readFile(KEYSTORE_TS, 'utf8');
  const webSrc = await readFile(KEYSTORE_WEB_TS, 'utf8');
  assert.ok(!/console\./.test(nativeSrc), 'keystore.ts NÃO pode conter `console.` (não loga a chave)');
  assert.ok(!/console\./.test(webSrc), 'keystore.web.ts NÃO pode conter `console.` (não loga a chave)');

  console.log('PASS — keystore BYOK (backend fake em memória, sem device/sem chave real):');
  console.log('  setKey/getKey/deleteKey round-trip por provedor: OK (placeholder gravado, lido, apagado)');
  console.log('  listProviders devolve NOMES [anthropic, openai, gemini], nunca valores: OK');
  console.log('  múltiplos provedores independentes (sem cross-leak): OK');
  console.log('  validação (provedor inválido, key vazia/whitespace, trim): OK');
  console.log(`  a chave NUNCA aparece em console (${spy.captured.length} linha(s) espionada(s)): OK`);
  console.log('  fonte sem `console.*` (keystore.ts / keystore.web.ts): OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
