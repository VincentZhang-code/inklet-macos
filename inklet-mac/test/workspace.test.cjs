'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
const { WorkspaceStore, Preferences, identifier } = require('../src/workspace-store.cjs');
async function fixture(context) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inklet-mac-workspace-')); context.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
test('workspace enforces window ownership and safe transfer rollback/commit', async context => {
  const root = await fixture(context); const workspace = await new WorkspaceStore(root).initialize();
  const owner = identifier(); const target = identifier(); const token = identifier(); const item = await workspace.add(owner);
  assert.throws(() => workspace.get(target, item.id), /different window/);
  workspace.stageMove(owner, item.id, target, token);
  assert.throws(() => workspace.get(target, item.id, true), /transferred/);
  assert.throws(() => workspace.commit(owner, token), /acknowledged/);
  workspace.cancel(token); assert.equal(workspace.get(owner, item.id, true).owner, owner);
  workspace.stageMove(owner, item.id, target, token); workspace.ready(target, token); workspace.commit(owner, token);
  assert.throws(() => workspace.get(owner, item.id), /different window/); assert.equal(workspace.list(target).length, 1);
});
test('only dirty acknowledged sessions survive restart, retaining independent undo state', async context => {
  const root = await fixture(context); const workspace = await new WorkspaceStore(root).initialize(); const owner = identifier();
  const item = await workspace.add(owner); await workspace.load(owner, item.id);
  const snapshot = { version: 1, documentId: item.id, savedRevision: 0, info: { name: 'Draft.md', path: null, hash: null }, session: { source: 'unsaved', revision: 2, past: [{ marker: 'undo' }], future: [] } };
  assert.equal((await workspace.storeSession(owner, item.id, snapshot)).persisted, true);
  assert.equal((await workspace.readSession(owner, item.id)).session.past[0].marker, 'undo');
  const restarted = await new WorkspaceStore(root).initialize(); const next = identifier(); restarted.claimRecovered(next);
  assert.equal((await restarted.load(next, item.id)).text, 'unsaved');
  await assert.rejects(restarted.close(next, [item.id], false), /unsaved/);
  await restarted.close(next, [item.id], true); assert.equal((await new WorkspaceStore(root).initialize()).documents.size, 0);
});
test('duplicate destinations and cross-document cold sessions cannot overwrite files', async context => {
  const root = await fixture(context); const file = path.join(root, 'first.md'); const other = path.join(root, 'other.md'); await fs.writeFile(file, 'first'); await fs.writeFile(other, 'other');
  const workspace = await new WorkspaceStore(path.join(root, 'profile')).initialize(); const owner = identifier();
  const first = await workspace.add(owner, file); const second = await workspace.add(owner, other); await workspace.load(owner, first.id);
  assert.equal((await workspace.add(owner, file)).id, first.id);
  await assert.rejects(workspace.save(owner, first.id, other, 'bad', {}, []), /already open/);
  await assert.rejects(workspace.storeSession(owner, first.id, { version: 1, documentId: second.id, session: { source: '', revision: 1 } }), /mismatch/);
  assert.equal(await fs.readFile(other, 'utf8'), 'other');
});
test('open history and per-file reading state are bounded, independent and persistent', async context => {
  const root = await fixture(context); const preferences = await new Preferences(root).initialize();
  const first = path.join(root, 'first.md'); const second = path.join(root, 'second.md'); await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
  await preferences.recordOpen(first); await preferences.recordOpen(second);
  await preferences.saveReading(first, { SourcePosition: 10, ActivePane: 'rich', Heading: 'First', HeadingLevel: 2 });
  await preferences.saveReading(second, { SourcePosition: 30, ActivePane: 'source', Heading: 'Second', HeadingLevel: 1 });
  await preferences.saveSettings({ restoreReadingPosition: true, documentId: 'not-a-setting' });
  const restarted = await new Preferences(root).initialize(); assert.equal(restarted.settings.restoreReadingPosition, true); assert.equal(restarted.settings.documentId, undefined);
  assert.equal((await restarted.reading(first)).SourcePosition, 10); assert.equal((await restarted.reading(second)).SourcePosition, 30); assert.equal((await restarted.history()).length, 2);
});