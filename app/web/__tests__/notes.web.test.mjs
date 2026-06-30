// notes.web.test.mjs — F1.16 (ADR-0022; molde xref.web.test.mjs F1.15)
//
// PROVA HEADLESS (node, sem browser/Expo) do USERDATA web (notas/marcações + export).
// Exercita o MESMO glue de PRODUÇÃO (`../userdata-fs.web`) que as telas da F1.11
// usam no browser, sobre um `UserDataDir` EM MEMÓRIA (mock do OPFS — `Map<path,
// content>`), com a referência canonicalizada pelo wasm (`parseReference`) e o nome
// EN do livro de `listBooks()` — EXATAMENTE como `reading.web.ts` faz. Em runtime no
// browser o backend é OPFS (`../userdata-opfs.web.ts`); aqui node injeta o mesmo
// `UserDataDir` em memória, rodando as MESMAS funções de produção (mesmo isolamento
// da F1.13/F1.15: OPFS é browser-only).
//
// O FORMATO (slug `notes/<slug>.md`, `.md` só-corpo, `highlights.json` array
// `{ref,color,tag?}` pretty/2-espaços, notas ordenadas × highlights por inserção)
// ESPELHA `the_light_core::userdata::{notes,highlights}` (rev `8f66004`) — nenhuma
// lógica de domínio é reimplementada; a referência/cânon vêm do wasm.
//
// Anti-alucinação: as constantes verbatim abaixo existem SÓ na ASSERÇÃO do teste —
// nunca no código de produto. O corpo da nota é dado livre do usuário; a referência
// é canônica (wasm). PARIDADE com o `TLA_NOTES` nativo (F1.11): mesmo slug
// `John_3.16.md`, mesmo export agregado dos Records.
//
// Sai 0 se tudo bater; ≠0 caso contrário.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = join(__dirname, 'notes-headless-entry.ts');
const FRONTIER_WASM = join(__dirname, '..', 'generated', 'wasm-bindgen', 'index_bg.wasm');

async function loadBundle() {
  const outfile = join(tmpdir(), `notes-headless-${randomBytes(6).toString('hex')}.mjs`);
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

// `UserDataDir` EM MEMÓRIA — mock do OPFS para a prova node. Backing store é um
// `Map<relPath, content>` COMPARTILHÁVEL: reabrir um novo handle sobre o MESMO Map
// prova persistência (≡ reload do browser relendo o OPFS). Implementa a MESMA
// interface que `userdata-opfs.web.ts` (readFile/writeFile/deleteFile/listDir).
function makeMemoryDir(store) {
  return {
    async readFile(relPath) {
      return store.has(relPath) ? store.get(relPath) : null;
    },
    async writeFile(relPath, content) {
      store.set(relPath, content);
    },
    async deleteFile(relPath) {
      return store.delete(relPath);
    },
    async listDir(relDir) {
      const prefix = relDir.endsWith('/') ? relDir : `${relDir}/`;
      const names = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          if (!rest.includes('/')) {
            names.push(rest);
          }
        }
      }
      return names;
    },
  };
}

async function main() {
  const {
    init,
    mod,
    listBooks,
    parseReference,
    putNoteFs,
    getNoteFs,
    deleteNoteFs,
    listNotesFs,
    addHighlightFs,
    removeHighlightFs,
    listHighlightsFs,
    slugForNote,
    buildNotesExport,
  } = await loadBundle();

  // (1) Fronteira Rust no wasm — p/ `parseReference` + nome EN do livro (listBooks).
  const frontierBytes = await readFile(FRONTIER_WASM);
  await init({ module_or_path: frontierBytes });
  mod.initialize();

  const bookNameEn = (book) => listBooks().find((b) => b.number === book)?.nameEn ?? '?';

  // Backing store COMPARTILHÁVEL (≡ o OPFS subjacente).
  const store = new Map();
  const dir = makeMemoryDir(store);

  // Atalhos que ESPELHAM a assinatura pública de `reading.web.ts` (resolve a
  // referência por `parseReference` ANTES do I/O — exatamente como o produto faz).
  const putNote = (ref, body) => putNoteFs(dir, parseReference(ref), body);
  const getNote = (ref) => getNoteFs(dir, parseReference(ref));
  const deleteNote = (ref) => deleteNoteFs(dir, parseReference(ref));
  const listNotes = () => listNotesFs(dir);
  const addHighlight = (ref, color, tag) => addHighlightFs(dir, parseReference(ref), color, tag);
  const removeHighlight = (ref) => removeHighlightFs(dir, parseReference(ref));
  const listHighlights = () => listHighlightsFs(dir);

  // (2a) putNote → getNote round-trip (body VERBATIM, reference canônica do wasm).
  const NOTE_BODY = '# corpo\n\nNota de teste do João 3:16.';
  await putNote('John 3:16', NOTE_BODY);
  const got = await getNote('John 3:16');
  assert.ok(got, 'getNote deve achar a nota gravada');
  assert.equal(got.body, NOTE_BODY, 'body deve ser VERBATIM (sem título/front-matter injetado)');
  assert.equal(got.reference.book, 43, 'reference.book = 43 (João)');
  assert.equal(got.reference.chapter, 3, 'reference.chapter = 3');
  assert.equal(got.reference.verses.tag, 'Single', 'reference.verses = Single');
  assert.equal(got.reference.verses.inner.verse, 16, 'reference.verses.inner.verse = 16');

  // (2b) O arquivo gravado é EXATAMENTE `notes/John_3.16.md` (slug == nativo, F1.11).
  const NATIVE_SLUG = 'John_3.16.md';
  assert.equal(slugForNote(parseReference('John 3:16')), NATIVE_SLUG, 'slug == John_3.16.md (nativo)');
  assert.ok(store.has(`notes/${NATIVE_SLUG}`), 'arquivo gravado em notes/John_3.16.md');
  assert.equal(store.get(`notes/${NATIVE_SLUG}`), NOTE_BODY, 'conteúdo do .md = só o corpo');
  // Formato espelhado p/ outras formas (Range/WholeChapter): `-` preservado, sem `:`.
  assert.equal(slugForNote(parseReference('Genesis 1:1-3')), 'Genesis_1.1-3.md', 'Range slug');
  assert.equal(slugForNote(parseReference('Psalms 23')), 'Psalms_23.md', 'WholeChapter slug');

  // (2c) listNotes ORDENADO por referência: Genesis (1) ANTES de John (43).
  await putNote('Genesis 1:1', 'No princípio…');
  const notes = await listNotes();
  assert.equal(notes.length, 2, `listNotes deve ter 2 notas, veio ${notes.length}`);
  assert.equal(notes[0].reference.book, 1, 'ordenação canônica: Genesis (1) primeiro');
  assert.equal(notes[1].reference.book, 43, 'ordenação canônica: John (43) depois');

  // (2d) addHighlight (tag undefined) → `highlights.json` com {ref,color} SEM `tag`.
  await addHighlight('John 3:16', 'yellow', undefined);
  const rawJson = store.get('highlights.json');
  assert.ok(rawJson != null, 'highlights.json deve existir');
  const parsedJson = JSON.parse(rawJson);
  assert.deepEqual(
    parsedJson,
    [{ ref: 'John 3:16', color: 'yellow' }],
    'highlights.json = [{ref:"John 3:16",color:"yellow"}] SEM chave tag',
  );
  assert.ok(!('tag' in parsedJson[0]), 'chave `tag` OMITIDA quando ausente');
  // pretty 2 espaços (espelha to_string_pretty): a 2ª linha começa com 2 espaços.
  assert.match(rawJson, /^\[\n {2}\{\n {4}"ref":/, 'JSON pretty com 2 espaços de indentação');

  let highlights = await listHighlights();
  assert.equal(highlights.length, 1, 'listHighlights = 1');
  assert.equal(highlights[0].color, 'yellow', 'cor = yellow');
  assert.equal(highlights[0].tag, undefined, 'tag ausente = undefined');
  assert.equal(highlights[0].reference.book, 43, 'highlight reference canônica (João)');

  // (2e) re-add MESMA referência com outra cor → substitui (ainda 1, cor nova).
  await addHighlight('John 3:16', 'green', undefined);
  highlights = await listHighlights();
  assert.equal(highlights.length, 1, 'add MESMA ref substitui (não duplica)');
  assert.equal(highlights[0].color, 'green', 'cor substituída = green');

  // (2f) removeHighlight idempotente: 1, depois 0.
  assert.equal(await removeHighlight('John 3:16'), 1, 'removeHighlight = 1');
  assert.equal(await removeHighlight('John 3:16'), 0, 'removeHighlight de novo = 0 (idempotente)');
  assert.deepEqual(await listHighlights(), [], 'sem highlights após remover');

  // (2g) deleteNote idempotente.
  assert.equal(await deleteNote('Genesis 1:1'), true, 'deleteNote existente = true');
  assert.equal(await deleteNote('Genesis 1:1'), false, 'deleteNote ausente = false');

  // (3) PERSISTÊNCIA: 2ª leitura INDEPENDENTE do MESMO backing store (novo handle)
  //     reencontra a nota + um highlight re-gravado (≡ reload do browser via OPFS).
  await addHighlight('John 3:16', 'blue', 'salvação'); // agora COM tag
  const dir2 = makeMemoryDir(store); // novo handle sobre o MESMO Map
  const notesReopened = await listNotesFs(dir2);
  const highlightsReopened = await listHighlightsFs(dir2);
  const persisted =
    notesReopened.some((n) => n.reference.book === 43 && n.reference.chapter === 3) &&
    highlightsReopened.length === 1 &&
    highlightsReopened[0].color === 'blue' &&
    highlightsReopened[0].tag === 'salvação';
  assert.ok(persisted, 'persistência: nota + highlight reencontrados num novo handle');
  // tag presente → re-serializada (skip_serializing_if só omite quando ausente).
  assert.match(store.get('highlights.json'), /"tag": "salvação"/, 'tag re-serializada quando presente');

  // (4) EXPORT = agregado PURO dos Records (buildNotesExport — IDÊNTICO ao nativo).
  const exportText = buildNotesExport(notesReopened, highlightsReopened, bookNameEn);
  const exportOk =
    exportText.includes('John 3:16') &&
    exportText.includes(NOTE_BODY) &&
    exportText.includes('blue');
  assert.ok(exportOk, 'export agrega o rótulo João 3:16 + corpo + highlight');

  // (5) Marcador determinístico (paralelo ao `TLA_NOTES` nativo da F1.11) — do
  //     RETORNO REAL, nada hardcoded no produto.
  const noteRef = 'John 3:16';
  const noteLen = notesReopened.find((n) => n.reference.book === 43)?.body.length ?? 0;
  const hCount = highlightsReopened.length;
  const marker = `WEB_NOTES note_ref="${noteRef}" note_len=${noteLen} highlights=${hCount} persisted=${persisted} export_ok=${exportOk}`;

  console.log('PASS — userdata web (UserDataDir em memória, formato ESPELHANDO o core):');
  console.log(`  putNote/getNote round-trip   -> body verbatim, ref book=43 chapter=3 Single 16`);
  console.log(`  slug do arquivo              -> notes/${NATIVE_SLUG}  (== nativo, F1.11)`);
  console.log(`  listNotes ordenado           -> Genesis(1) antes de John(43)`);
  console.log(`  highlights.json              -> [{ref:"John 3:16",color:"yellow"}] (tag omitido, pretty 2sp)`);
  console.log(`  add re-add MESMA ref         -> substitui (yellow -> green), ainda 1`);
  console.log(`  removeHighlight idempotente  -> 1, depois 0`);
  console.log(`  PERSISTÊNCIA (novo handle)   -> nota + highlight reencontrados`);
  console.log(`  export agregado dos Records  -> contém "John 3:16" + corpo + cor`);
  console.log(`  ${marker}`);
  console.log(
    '  PARIDADE: slug `John_3.16.md` e export agregado IDÊNTICOS ao nativo ' +
      '(F1.11: TLA_NOTES; mesmo formato em disco do core).',
  );

  // Asserções finais do marcador (do retorno real).
  assert.match(marker, /persisted=true/, 'marcador deve provar persisted=true');
  assert.match(marker, /export_ok=true/, 'marcador deve provar export_ok=true');
  assert.ok(noteLen > 0, 'note_len > 0 (do retorno real)');
  assert.equal(hCount, 1, 'highlights=1 no fim');
}

main().catch((err) => {
  console.error('FAIL —', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
