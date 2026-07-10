// prefs.test.mjs — deepening (ADR-0073)
//
// PROVA HEADLESS (node, SEM device) do KV de PREFERÊNCIAS (`createPrefs`/`prefIdFor`) — que ANTES não
// tinha teste (a lógica era copiada em prefs.ts/prefs.web.ts, cópia web nunca provada). Agora a lógica
// vive em `prefs.shared.ts`; aqui injetamos um BACKEND FAKE (Map) e provamos namespacing + round-trip.
// `expo-file-system/legacy` é `external` (o leaf nativo o importa lazy; o fake é o único usado).
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, 'prefs-headless-entry.ts');

async function load() {
  const outfile = join(tmpdir(), `prefs-${randomBytes(6).toString('hex')}.mjs`);
  await build({
    entryPoints: [ENTRY],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    logLevel: 'silent',
    external: ['expo-file-system/legacy'],
  });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const { createPrefs, prefIdFor } = await load();

  // Backend fake em memória (o único ponto de plataforma; a lógica é compartilhada).
  const store = new Map();
  const backend = {
    async getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) {
      store.set(k, v);
    },
    async removeItem(k) {
      store.delete(k);
    },
  };
  const prefs = createPrefs(backend);

  // Namespacing: prefixa `tla.pref.`
  assert.equal(prefIdFor('ui.locale'), 'tla.pref.ui.locale', 'prefIdFor prefixa tla.pref.');

  // Round-trip com a chave NAMESPACEADA no backend
  assert.equal(await prefs.getPref('ui.locale'), null, 'ausente → null');
  await prefs.setPref('ui.locale', 'pt');
  assert.equal(store.get('tla.pref.ui.locale'), 'pt', 'grava sob a chave namespaceada');
  assert.equal(await prefs.getPref('ui.locale'), 'pt', 'lê de volta');
  await prefs.removePref('ui.locale');
  assert.equal(await prefs.getPref('ui.locale'), null, 'removido → null');
  assert.equal(store.has('tla.pref.ui.locale'), false, 'removido do backend');

  console.log('PASS — createPrefs (KV de preferências, ADR-0073):');
  console.log('  namespacing `tla.pref.<key>` + round-trip get/set/remove sobre backend injetado: OK');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
