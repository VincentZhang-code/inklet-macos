'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { FileStore, atomicWrite, readJson, textHash, canonicalPath, MAX_DOCUMENT } = require('./file-store.cjs');
const identifier = () => randomUUID().replaceAll('-', '');
const validId = value => typeof value === 'string' && /^[a-f\d]{32}$/.test(value);
const info = item => ({ id: item.id, name: item.name, path: item.path, dirty: item.dirty, recovered: item.recovered });

class WorkspaceStore {
  constructor(directory) { this.directory = path.resolve(directory); this.documents = new Map(); this.transfers = new Map(); }
  async initialize() {
    await fs.mkdir(path.join(this.directory, 'workspace'), { recursive: true });
    const index = await readJson(path.join(this.directory, 'workspace/index.json'), { version: 1, documents: [] });
    if (index.version !== 1 || !Array.isArray(index.documents)) throw new Error('Workspace index is unsupported; recovery data was not removed.');
    for (const entry of index.documents) {
      if (!validId(entry.id)) throw new Error('Workspace contains an invalid document identity.');
      const store = new FileStore(path.join(this.directory, 'workspace', entry.id));
      const recovery = await store.recovery();
      if (recovery) this.documents.set(entry.id, { id: entry.id, path: entry.path || null, name: entry.name || 'Untitled.md', owner: null, incomingOwner: null, dirty: true, recovered: true, loaded: false, store });
    }
    return this;
  }
  async persist() { await atomicWrite(path.join(this.directory, 'workspace/index.json'), Buffer.from(JSON.stringify({ version: 1, documents: [...this.documents.values()].map(info) })), true); }
  claimRecovered(owner) { for (const item of this.documents.values()) if (!item.owner) item.owner = owner; }
  list(owner) { return [...this.documents.values()].filter(item => item.owner === owner || item.incomingOwner === owner).map(info); }
  get(owner, id, writable = false) {
    const item = this.documents.get(id);
    if (!validId(id) || !item || (item.owner !== owner && item.incomingOwner !== owner)) throw new Error('Document is closed or belongs to a different window.');
    if (writable && (item.owner !== owner || item.incomingOwner)) throw new Error('Document is being transferred; its source remains protected.');
    return item;
  }
  async findPath(file) { const resolved = await canonicalPath(file); return [...this.documents.values()].find(item => item.path === resolved); }
  async add(owner, file = null) {
    if (file) {
      file = await canonicalPath(file);
      const existing = [...this.documents.values()].find(item => item.path === file);
      if (existing) { if (existing.owner !== owner) throw new Error('Document is open in another window.'); return existing; }
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > MAX_DOCUMENT) throw new Error('Document is missing or exceeds 24 MiB.');
    }
    const id = identifier(); const item = { id, path: file, name: file ? path.basename(file) : '\u672a\u547d\u540d.md', owner, incomingOwner: null, dirty: false, recovered: false, loaded: false, store: new FileStore(path.join(this.directory, 'workspace', id)) };
    this.documents.set(id, item);
    try { await this.persist(); } catch (error) { this.documents.delete(id); throw error; }
    return item;
  }
  async load(owner, id) {
    const item = this.get(owner, id);
    if (item.loaded && item.dirty && !item.recovered) throw new Error('Unsaved document must be restored from its existing session.');
    let result;
    if (item.recovered) {
      const recovery = await item.store.recovery(); if (!recovery) throw new Error('Recovery data is unavailable; the original was not changed.');
      await item.store.recover(recovery); item.path = item.store.currentPath;
      result = { ...recovery, path: item.path, restored: true };
    } else result = item.path ? await item.store.open(item.path) : { text: '', path: null, name: item.name };
    item.loaded = true; return { ...result, id };
  }
  async markDirty(owner, id, dirty) { const item = this.get(owner, id, true); if (item.dirty !== dirty) { item.dirty = dirty; await this.persist(); } }
  async save(owner, id, file, text, annotations, resources) {
    const item = this.get(owner, id, true); file = await canonicalPath(file);
    if ([...this.documents.values()].some(other => other.id !== id && other.path === file)) throw new Error('Destination is already open in the workspace.');
    const result = await item.store.save(file, text, annotations, resources);
    item.path = result.path; item.name = result.name; item.dirty = false; item.recovered = false;
    await this.persist(); return { ...result, documentId: id };
  }
  async storeSession(owner, id, snapshot) {
    const item = this.get(owner, id, true);
    if (snapshot?.version !== 1 || snapshot.documentId !== id || !snapshot.session || typeof snapshot.session.source !== 'string' || !Number.isInteger(snapshot.session.revision)) throw new Error('Session identity or revision mismatch.');
    const data = JSON.stringify(snapshot); const bytes = Buffer.from(JSON.stringify({ version: 1, data, checksum: textHash(data) }));
    if (bytes.length > 64 * 1024 * 1024) throw new Error('Session exceeds the 64 MiB protection limit.');
    let total = bytes.length;
    for (const other of this.documents.values()) if (other.id !== id) total += await fs.stat(path.join(other.store.directory, 'session.json')).then(stat => stat.size, error => { if (error.code === 'ENOENT') return 0; throw error; });
    if (total > 512 * 1024 * 1024) throw new Error('Workspace session cache exceeds 512 MiB; save and close some documents.');
    await atomicWrite(path.join(item.store.directory, 'session.json'), bytes);
    const dirty = snapshot.savedRevision !== snapshot.session.revision;
    if (dirty) await item.store.saveRecovery({ documentId: id, revision: snapshot.session.revision, text: snapshot.session.source, ...snapshot.info, annotations: snapshot.annotations });
    await this.markDirty(owner, id, dirty); item.store.recoveryState = null;
    return { documentId: id, revision: snapshot.session.revision, persisted: true };
  }
  async readSession(owner, id) {
    const item = this.get(owner, id); const envelope = await readJson(path.join(item.store.directory, 'session.json'), null, 64 * 1024 * 1024);
    if (!envelope || typeof envelope.data !== 'string' || textHash(envelope.data) !== envelope.checksum) throw new Error('Session checksum mismatch.');
    const snapshot = JSON.parse(envelope.data); if (snapshot.documentId !== id) throw new Error('Session belongs to another document.'); return snapshot;
  }
  stageMove(source, id, target, token) {
    const item = this.get(source, id, true);
    if (!validId(target) || !validId(token) || source === target || this.transfers.has(token)) throw new Error('Invalid window transfer.');
    item.incomingOwner = target; this.transfers.set(token, { source, target, id, ready: false });
  }
  ready(target, token) { const transfer = this.transfers.get(token); if (!transfer || transfer.target !== target) throw new Error('Transfer was cancelled.'); transfer.ready = true; return transfer; }
  commit(source, token) {
    const transfer = this.transfers.get(token); if (!transfer || transfer.source !== source || !transfer.ready) throw new Error('Receiving window has not acknowledged the document.');
    const item = this.get(source, transfer.id); item.owner = transfer.target; item.incomingOwner = null; this.transfers.delete(token); return transfer;
  }
  cancel(token) { const transfer = this.transfers.get(token); if (!transfer) return null; const item = this.documents.get(transfer.id); if (item) item.incomingOwner = null; this.transfers.delete(token); return transfer; }
  async close(owner, ids, discard) {
    const selected = ids.map(id => this.get(owner, id, true));
    if (!discard && selected.some(item => item.dirty)) throw new Error('There are unsaved documents.');
    for (const item of selected) this.documents.delete(item.id);
    try { await this.persist(); } catch (error) { for (const item of selected) this.documents.set(item.id, item); throw error; }
    for (const item of selected) await fs.rm(item.store.directory, { recursive: true, force: true });
  }
}

class Preferences {
  constructor(directory) { this.directory = directory; this.settings = {}; }
  async initialize() { this.settings = await readJson(path.join(this.directory, 'settings.json'), {}); return this; }
  async saveSettings(settings) { const next = { ...settings }; delete next.documentId; await atomicWrite(path.join(this.directory, 'settings.json'), Buffer.from(JSON.stringify(next)), true); this.settings = next; }
  async history() { const entries = await readJson(path.join(this.directory, 'open-history.json'), []); return Array.isArray(entries) ? entries.slice(0, 200) : []; }
  async recordOpen(file) { const entries = await this.history(); entries.unshift({ Id: identifier(), Path: file, Name: path.basename(file), OpenedAt: new Date().toISOString() }); await atomicWrite(path.join(this.directory, 'open-history.json'), Buffer.from(JSON.stringify(entries.slice(0, 200))), true); }
  async reading(file) { if (!file) return null; const canonical = await canonicalPath(file); const entries = await readJson(path.join(this.directory, 'reading-positions.json'), []); return entries.find(entry => entry.Path === canonical) || null; }
  async saveReading(file, point) {
    if (!file || !/\.(md|markdown)$/i.test(file) || !point || !Number.isInteger(point.SourcePosition) || point.SourcePosition < 0 || point.SourcePosition > MAX_DOCUMENT || !['source', 'rich'].includes(point.ActivePane)) throw new Error('Invalid reading location.');
    const canonical = await canonicalPath(file); const entries = await readJson(path.join(this.directory, 'reading-positions.json'), []);
    const entry = { Path: canonical, Hash: typeof point.Hash === 'string' && /^[a-f\d]{64}$/.test(point.Hash) ? point.Hash : null, SourcePosition: point.SourcePosition, Heading: String(point.Heading || '').slice(0, 512), HeadingLevel: Math.max(0, Math.min(6, Number(point.HeadingLevel) || 0)), HeadingOccurrence: Math.max(0, Math.floor(Number(point.HeadingOccurrence) || 0)), BlockProgress: Math.max(0, Math.min(1, Number(point.BlockProgress) || 0)), HasTextAnchor: point.HasTextAnchor === true, TextProgress: Math.max(0, Math.min(1, Number(point.TextProgress) || 0)), ActivePane: point.ActivePane, FallbackScrollTop: Math.max(0, Math.min(1e9, Number(point.FallbackScrollTop) || 0)), UpdatedAt: new Date().toISOString() };
    await atomicWrite(path.join(this.directory, 'reading-positions.json'), Buffer.from(JSON.stringify([entry, ...entries.filter(previous => previous.Path !== canonical)].slice(0, 500))), true);
  }
}
module.exports = { WorkspaceStore, Preferences, identifier, info, validId };