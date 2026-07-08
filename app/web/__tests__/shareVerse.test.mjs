// shareVerse.test.mjs — Rodada 4 (engajamento): prova o texto PURO de compartilhar um versículo.
//
// `lib/shareVerseMessage.ts` é puro/sem plataforma (o mesmo texto no nativo e no web). Aqui provamos
// o formato: Escritura entre aspas + referência (+ versão quando houver), e que o TEXTO é preservado
// VERBATIM (o compartilhamento nunca reescreve a Escritura). O envio em si (Share/navigator) é do SO.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(__dirname, '..', '..', 'lib', 'shareVerseMessage.ts');

async function load() {
  const outfile = join(tmpdir(), `share-${randomBytes(6).toString('hex')}.mjs`);
  await build({ entryPoints: [ENTRY], outfile, bundle: true, format: 'esm', platform: 'node', target: 'node18', logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
}

async function main() {
  const { buildShareMessage } = await load();

  const text = 'No princípio criou Deus os céus e a terra.';
  const msg = buildShareMessage(text, 'Gênesis 1:1', 'Almeida 1911');
  assert.ok(msg.includes(text), 'texto da Escritura preservado VERBATIM');
  assert.ok(msg.includes('Gênesis 1:1'), 'referência presente');
  assert.ok(msg.includes('Almeida 1911'), 'versão presente');
  assert.match(msg, /^"/, 'abre com aspas (Escritura citada)');
  assert.ok(msg.indexOf(text) < msg.indexOf('Gênesis 1:1'), 'texto vem antes da referência');

  // Sem versão → só a referência, sem separador pendurado.
  const noTr = buildShareMessage('x', 'João 3:16', '');
  assert.ok(noTr.includes('João 3:16') && !noTr.includes('·'), 'sem versão → sem separador " · "');

  console.log('PASS — shareVerse: texto verbatim + referência (+versão), formato citado.');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
