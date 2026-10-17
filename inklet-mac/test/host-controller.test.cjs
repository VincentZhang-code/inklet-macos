'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
const { HostController, COMMANDS } = require('../src/host-controller.cjs');
const { identifier } = require('../src/workspace-store.cjs');
async function fixture(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inklet-mac-host-')); context.after(() => fs.rm(root, { recursive: true, force: true }));
  const events = []; const closed = [];
  const shell = { createWindow() {}, send: (...event) => events.push(event), watch() {}, focus() {}, title() {}, updateMenu() {}, cancelQuit() {}, closeWindow: id => closed.push(id), chooseSave: async () => path.join(root, 'Saved.md'), chooseOpen: async () => null, exportFile: async () => null, external: async () => {}, registerDefault: async () => {}, bounds: () => ({ x: 0, y: 0, width: 100, height: 100 }), drag: async () => ({ outside: false }) };
  const host = await new HostController(path.join(root, 'profile'), shell).initialize(); context.after(() => { for (const timer of host.timers.values()) clearTimeout(timer); });
  const window = host.newWindow(); return { root, host, window, shell, events, closed };
}
test('all Windows desktop commands have explicit Mac handlers', async () => {
  const commands = JSON.parse(await fs.readFile(path.resolve(__dirname, 'windows-command-contract.json'), 'utf8'));
  assert.deepEqual([...new Set(commands)].sort(), [...COMMANDS].sort());
  const host = await fs.readFile(path.resolve(__dirname, '../src/host-controller.cjs'), 'utf8');
  assert.deepEqual([...new Set([...host.matchAll(/command === '([a-zA-Z]+)'/g)].map(match => match[1]))].sort(), [...COMMANDS].sort());
});
test('frontend startup, save, draft, history and safe close use full desktop contracts', async context => {
  const { host, window, root, events, closed } = await fixture(context);
  const hello = await host.handle(window.id, 'hello'); assert.equal(hello.multipleWindows, true); assert.equal(hello.document.placeholder, true);
  const documentId = hello.document.id; await host.handle(window.id, 'ready');
  await host.handle(window.id, 'draft', { documentId, text: '# Saved', revision: 1 });
  await assert.rejects(host.handle(window.id, 'finishClose'), /unsaved/);
  await host.handle(window.id, 'save', { documentId, text: '# Saved', name: 'Saved.md' }); assert.equal(await fs.readFile(path.join(root, 'Saved.md'), 'utf8'), '# Saved');
  host.requestClose(window.id); assert.equal(events.at(-1)[1], 'closeWorkspace');
  await host.handle(window.id, 'finishClose'); assert.deepEqual(closed, [window.id]);
});
test('two-phase detach retains the source until the target is ready and cancellation rolls back', async context => {
  const { host, window } = await fixture(context); const hello = await host.handle(window.id, 'hello'); const id = hello.document.id;
  const snapshot = { version: 1, documentId: id, savedRevision: 0, info: { path: null, name: 'Draft.md', hash: null }, session: { source: 'transfer', revision: 1 } };
  const token = identifier(); const transfer = await host.handle(window.id, 'detachDocument', { documentId: id, token, snapshot });
  await assert.rejects(host.handle(window.id, 'commitDetach', { token }), /acknowledged/);
  assert.equal((await host.handle(transfer.targetWindowId, 'hello')).session.session.source, 'transfer');
  await host.handle(transfer.targetWindowId, 'ready'); await host.handle(window.id, 'commitDetach', { token });
  await assert.rejects(host.handle(window.id, 'save', { documentId: id, text: 'wrong' }), /different window/);
  assert.equal(host.workspace.get(transfer.targetWindowId, id, true).owner, transfer.targetWindowId);
  const next = identifier(); await host.handle(transfer.targetWindowId, 'detachDocument', { documentId: id, token: next, snapshot });
  await host.handle(transfer.targetWindowId, 'cancelDetach'); assert.equal(host.workspace.get(transfer.targetWindowId, id, true).incomingOwner, null);
});
test('unknown senders, private URI schemes and foreign asset IDs are rejected', async context => {
  const { host, window } = await fixture(context); await host.handle(window.id, 'hello');
  await assert.rejects(host.handle(identifier(), 'hello'), /Invalid/);
  await assert.rejects(host.handle(window.id, 'execute', {}), /Invalid/);
  await assert.rejects(host.handle(window.id, 'external', { url: 'file:///etc/passwd' }), /HTTP/);
  await assert.rejects(host.handle(window.id, 'readAsset', { documentId: identifier(), path: '/etc/passwd' }), /different window/);
});