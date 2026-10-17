'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { WorkspaceStore, Preferences, identifier, info } = require('./workspace-store.cjs');

const COMMANDS = Object.freeze(['hello', 'settings', 'workspaceList', 'loadDocument', 'activateDocument', 'storeSession', 'readSession', 'releaseDocument', 'closeDocuments', 'finishClose', 'cancelClose', 'new', 'open', 'save', 'recover', 'history', 'openHistory', 'readReadingPosition', 'saveReadingPosition', 'state', 'searchState', 'draft', 'draftDelta', 'importImage', 'readAsset', 'readExternal', 'acceptExternal', 'registerDefault', 'export', 'external', 'dragDocument', 'detachDocument', 'commitDetach', 'cancelDetach', 'windowBounds', 'ready', 'openRequested', 'dismissOpen']);
class HostController {
  constructor(directory, shell) { this.directory = directory; this.shell = shell; this.windows = new Map(); this.queue = Promise.resolve(); this.timers = new Map(); }
  async initialize() { this.workspace = await new WorkspaceStore(this.directory).initialize(); this.preferences = await new Preferences(this.directory).initialize(); return this; }
  newWindow(options = {}) {
    const state = { id: identifier(), active: null, initialized: false, ready: false, closing: false, requests: new Map(), ...options };
    if (!state.incomingToken && ![...this.windows.values()].some(window => !window.incomingToken)) this.workspace.claimRecovered(state.id);
    this.windows.set(state.id, state);
    try { this.shell.createWindow(state); } catch (error) { this.windows.delete(state.id); throw error; }
    return state;
  }
  send(id, event, data = {}) { if (this.windows.has(id)) this.shell.send(id, event, data); }
  async openPaths(state, files) {
    const documents = []; const warnings = [];
    for (const file of files) try {
      const existing = await this.workspace.findPath(file);
      if (existing) {
        if (existing.owner === state.id) documents.push(info(existing));
        else { this.shell.focus(existing.owner); this.send(existing.owner, 'selectDocument', { documentId: existing.id }); }
      } else if (this.preferences.settings.separateWindows) this.newWindow({ startupFile: file });
      else documents.push(info(await this.workspace.add(state.id, file)));
    } catch (error) { warnings.push(path.basename(file) + ': ' + error.message); }
    this.shell.watch(); return { documents, warnings };
  }
  queueOpen(state, file) { const id = identifier(); state.requests.set(id, file); if (state.ready) this.send(state.id, 'openRequest', { id }); }
  requestClose(id) {
    const state = this.windows.get(id); if (!state || state.closing) return;
    for (const [token, transfer] of this.workspace.transfers) if (transfer.source === id || transfer.target === id) this.cancelTransfer(token);
    if (!this.windows.has(id)) return;
    if (!state.ready) { this.shell.closeWindow(id); this.windows.delete(id); return; }
    state.closing = true; this.send(id, 'closeWorkspace');
  }
  cancelTransfer(token) {
    const transfer = this.workspace.cancel(token); if (!transfer) return;
    clearTimeout(this.timers.get(token)); this.timers.delete(token);
    this.shell.closeWindow(transfer.target); this.windows.delete(transfer.target);
    this.send(transfer.source, 'detachCancelled', { token, message: '\u7a97\u53e3\u79fb\u4ea4\u672a\u5b8c\u6210\uff0c\u539f\u6587\u6863\u5df2\u4fdd\u7559\u3002' });
  }
  handle(windowId, command, args = {}) {
    const operation = this.queue.then(async () => {
      const state = this.windows.get(windowId);
      if (!state || !COMMANDS.includes(command) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid desktop request.');
      return this.dispatch(state, command, args);
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async dispatch(state, command, args) {
    const owner = state.id; const id = args.documentId || state.active;
    const item = writable => this.workspace.get(owner, id, writable);
    if (command === 'hello') {
      let document = null; let startupWarning = null;
      if (!state.initialized) {
        state.initialized = true;
        if (state.incomingSnapshot) state.active = state.incomingSnapshot.documentId;
        else if (state.startupFile) try { state.active = (await this.workspace.add(owner, state.startupFile)).id; } catch (error) { startupWarning = { message: error.message, path: state.startupFile }; }
        state.active ||= this.workspace.list(owner)[0]?.id;
        const placeholder = !state.active;
        if (placeholder) state.active = (await this.workspace.add(owner)).id;
        document = state.incomingSnapshot ? { ...state.incomingSnapshot.info, id: state.active } : await this.workspace.load(owner, state.active);
        document.placeholder = placeholder;
        if (document.path && !document.restored) await this.preferences.recordOpen(document.path);
        this.shell.watch();
      }
      return { settings: this.preferences.settings, document, documents: this.workspace.list(owner), session: state.incomingSnapshot || null, transfer: state.incomingToken || null, workspace: true, multipleWindows: true, windowId: owner, recovery: null, startupWarning };
    }
    if (command === 'settings') { await this.preferences.saveSettings(args); for (const window of this.windows.values()) if (window.id !== owner) this.send(window.id, 'settingsChanged', this.preferences.settings); this.shell.updateMenu(); return true; }
    if (command === 'workspaceList') return this.workspace.list(owner);
    if (command === 'loadDocument') { const loaded = await this.workspace.load(owner, id); if (loaded.path && !loaded.restored) await this.preferences.recordOpen(loaded.path); this.shell.watch(); return loaded; }
    if (command === 'activateDocument') { item(); state.active = id; return true; }
    if (command === 'storeSession') return this.workspace.storeSession(owner, id, args.snapshot);
    if (command === 'readSession') return this.workspace.readSession(owner, id);
    if (command === 'releaseDocument') { const store = item().store; store.recoveryState = null; store.pendingExternal = null; return true; }
    if (command === 'closeDocuments') { if (!Array.isArray(args.ids)) throw new Error('Document identities are required.'); await this.workspace.close(owner, args.ids, args.discard === true); if (args.ids.includes(state.active)) state.active = null; this.shell.watch(); return true; }
    if (command === 'finishClose') { await this.workspace.close(owner, this.workspace.list(owner).map(document => document.id), false); this.windows.delete(owner); this.shell.closeWindow(owner); this.shell.watch(); return true; }
    if (command === 'cancelClose') { state.closing = false; this.shell.cancelQuit(); return true; }
    if (command === 'ready') {
      state.ready = true;
      if (state.incomingToken) { const transfer = this.workspace.ready(owner, state.incomingToken); this.send(transfer.source, 'detachReady', { token: state.incomingToken, documentId: transfer.id }); }
      for (const id of state.requests.keys()) this.send(owner, 'openRequest', { id });
      return true;
    }
    if (command === 'new') { const created = await this.workspace.add(owner); return { ...await this.workspace.load(owner, created.id), placeholder: args.placeholder === true }; }
    if (command === 'open') { const files = await this.shell.chooseOpen(owner); return files ? this.openPaths(state, files) : null; }
    if (command === 'openRequested') { const file = state.requests.get(args.id); if (!file) throw new Error('Open request has expired.'); state.requests.delete(args.id); return this.openPaths(state, [file]); }
    if (command === 'dismissOpen') { state.requests.delete(args.id); return true; }
    if (command === 'history') return this.preferences.history();
    if (command === 'openHistory') {
      const entry = (await this.preferences.history()).find(entry => entry.Id === args.id); if (!entry) throw new Error('History entry has expired.');
      try { await fs.access(entry.Path); } catch (error) { if (error.code === 'ENOENT') return { missing: true, path: entry.Path }; throw error; }
      return this.openPaths(state, [entry.Path]);
    }
    if (command === 'readReadingPosition') return this.preferences.reading(item().path);
    if (command === 'saveReadingPosition') { await this.preferences.saveReading(item().path, args.position); return true; }
    if (command === 'state') { if (state.incomingToken) return true; await this.workspace.markDirty(owner, id, args.dirty === true); if (id === state.active) this.shell.title(owner, (args.dirty ? '* ' : '') + String(args.name || 'Untitled.md').slice(0, 300) + ' - Inklet'); return true; }
    if (command === 'searchState') return true;
    if (command === 'draft') { await item(true).store.saveRecovery({ ...args, documentId: id }); await this.workspace.markDirty(owner, id, true); return { documentId: id, revision: args.revision, persisted: true }; }
    if (command === 'draftDelta') { const result = await item(true).store.appendRecovery({ ...args, documentId: id }); await this.workspace.markDirty(owner, id, true); return result; }
    if (command === 'recover') { const document = item(true); await document.store.recover(args); document.path = document.store.currentPath; this.shell.watch(); return { ...args, path: document.path }; }
    if (command === 'save') {
      const document = item(true); const destination = document.store.currentPath && !args.saveAs ? document.store.currentPath : await this.shell.chooseSave(owner, path.basename(args.name || 'Untitled.md'), 'md');
      if (!destination) return null;
      const saved = await this.workspace.save(owner, id, destination, args.text, args.annotations || {}, args.resources || []); this.shell.watch(); return saved;
    }
    if (command === 'importImage') return item(true).store.importImage(args.data, args.mime);
    if (command === 'readAsset') return item().store.readImage(args.path);
    if (command === 'readExternal') return item().store.readExternal(args.path);
    if (command === 'acceptExternal') { const accepted = await item(true).store.acceptExternal(args.path, args.stamp); if (accepted) await this.workspace.markDirty(owner, id, false); return accepted; }
    if (command === 'export') { const document = item(); return this.shell.exportFile(owner, document.store, args); }
    if (command === 'external') { const url = new URL(args.url); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) links can be opened.'); await this.shell.external(url.href); return true; }
    if (command === 'registerDefault') { await this.shell.registerDefault(owner); return true; }
    if (command === 'windowBounds') return this.shell.bounds(owner);
    if (command === 'dragDocument') { item(true); return this.shell.drag(owner); }
    if (command === 'detachDocument') {
      item(true); await this.workspace.storeSession(owner, id, args.snapshot);
      const target = this.newWindow({ incomingSnapshot: args.snapshot, incomingToken: args.token, dropPoint: args.dropPoint });
      try { this.workspace.stageMove(owner, id, target.id, args.token); }
      catch (error) { this.windows.delete(target.id); this.shell.closeWindow(target.id); throw error; }
      this.timers.set(args.token, setTimeout(() => this.cancelTransfer(args.token), 45000));
      return { token: args.token, documentId: id, pending: true, targetWindowId: target.id };
    }
    if (command === 'commitDetach') {
      const transfer = this.workspace.commit(owner, args.token); clearTimeout(this.timers.get(args.token)); this.timers.delete(args.token);
      const target = this.windows.get(transfer.target); target.incomingToken = null; target.incomingSnapshot = null;
      this.send(target.id, 'detachCommitted'); this.shell.watch(); return { moved: true, documentId: transfer.id, targetWindowId: target.id };
    }
    if (command === 'cancelDetach') { for (const [token, transfer] of this.workspace.transfers) if (transfer.source === owner || transfer.target === owner) this.cancelTransfer(token); return true; }
    throw new Error('Unknown desktop operation.');
  }
}
module.exports = { HostController, COMMANDS };