'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { FileStore, readJson, backupPath, hash, MAX_DOCUMENT } = require('../src/file-store.cjs');

async function fixture(context) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inklet-mac-')); context.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('UTF-8 BOM and CRLF survive edits with atomic source and annotation backups', async context => {
  const root = await fixture(context); const file = path.join(root, 'Document.md');
  const original = Buffer.from('\ufeff# Original\r\n\r\nText.\r\n'); await fs.writeFile(file, original);
  const store = new FileStore(path.join(root, 'profile')); const opened = await store.open(file);
  assert.equal(opened.text, '# Original\n\nText.\n');
  await store.save(file, opened.text.replace('Text.', 'Changed.'), { marks: [] });
  assert.equal((await fs.readFile(file)).toString(), '\ufeff# Original\r\n\r\nChanged.\r\n');
  assert.deepEqual(await fs.readFile(backupPath(file)), original);
  assert.equal((await readJson(file + '.inklet.json')).textHash, (await store.snapshot(file)).hash);
});
test('external changes are never silently overwritten and accepting a preview uses its own stamp', async context => {
  const root = await fixture(context); const file = path.join(root, 'External.md'); await fs.writeFile(file, 'original');
  const store = new FileStore(path.join(root, 'profile')); await store.open(file);
  await fs.writeFile(file, 'external'); await assert.rejects(store.save(file, 'wrong'), /changed/);
  const external = await store.readExternal(file); assert.equal(external.text, 'external');
  assert.equal(await store.acceptExternal(file, 'wrong'), false);
  assert.equal(await store.acceptExternal(file, external.stamp), true);
  await fs.writeFile(file, 'newer'); await assert.rejects(store.save(file, 'wrong'), /changed/);
  assert.equal(await fs.readFile(file, 'utf8'), 'newer');
});
test('local parent, absolute and file URI images are supported without network or non-image access', async context => {
  const root = await fixture(context); await fs.mkdir(path.join(root, 'docs'));
  const file = path.join(root, 'docs', 'Images.md'); await fs.writeFile(file, 'images');
  const image = path.join(root, 'image.svg'); await fs.writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const store = new FileStore(path.join(root, 'profile')); await store.open(file);
  for (const reference of ['../image.svg', image, pathToFileURL(image).href]) assert.equal((await store.readImage(reference)).mime, 'image/svg+xml');
  await assert.rejects(store.readImage('https://example.com/image.png'), /local/);
  await assert.rejects(store.readImage('//server/image.png'), /Network/);
  await assert.rejects(store.readImage(file), /Unsupported/);
  await assert.rejects(store.save(path.join(root, 'copy.md'), 'images', {}, ['../image.svg']), /folder/);
});
test('draft images migrate on save and bad image bytes or oversized Markdown are rejected', async context => {
  const root = await fixture(context); const store = new FileStore(path.join(root, 'profile'));
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71]), Buffer.alloc(12)]);
  const imported = await store.importImage(bytes.toString('base64'), 'image/png');
  const file = path.join(root, 'saved', 'Draft.md'); await store.save(file, '![image](' + imported.path + ')', {}, [imported.path]);
  assert.equal(hash(await fs.readFile(path.join(path.dirname(file), imported.path))), hash(bytes));
  await assert.rejects(store.importImage(Buffer.alloc(16).toString('base64'), 'image/png'), /contents/);
  await assert.rejects(store.save(file, 'x'.repeat(MAX_DOCUMENT + 1)), /24 MiB/);
});
test('recovery snapshots and deltas survive restart and ignore a torn journal tail', async context => {
  const root = await fixture(context); const store = new FileStore(root);
  await store.saveRecovery({ documentId: 'first', revision: 1, text: 'abc', path: null, name: 'Draft.md', hash: null });
  assert.equal((await store.appendRecovery({ documentId: 'other', baseRevision: 1, revision: 2, change: { from: 0, to: 0, insert: 'bad' } })).needsSnapshot, true);
  assert.equal((await store.appendRecovery({ documentId: 'first', baseRevision: 1, revision: 2, change: { from: 3, to: 3, insert: 'd' } })).persisted, true);
  await fs.appendFile(path.join(root, 'recovery.jsonl'), '{torn');
  const recovered = await new FileStore(root).recovery(); assert.equal(recovered.text, 'abcd'); assert.equal(recovered.recoveredPartialJournal, true);
  await store.clearRecovery(); assert.equal(await new FileStore(root).recovery(), null);
});
test('corrupt snapshots fall back without overwriting the disk document', async context => {
  const root = await fixture(context); const store = new FileStore(root);
  await store.saveRecovery({ documentId: 'first', revision: 1, text: 'one' });
  await store.saveRecovery({ documentId: 'first', revision: 2, text: 'two' });
  await fs.writeFile(path.join(root, 'recovery.json'), '{bad');
  const recovered = await store.recovery(); assert.equal(recovered.text, 'one'); assert.equal(recovered.recoveredPreviousSnapshot, true);
});