'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');

const MAX_DOCUMENT = 24 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const textHash = text => hash(Buffer.from(text, 'utf8'));
const exists = async file => { try { await fs.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const backupPath = file => path.join(path.dirname(file), '.inklet-backups', path.basename(file) + '.bak');
async function canonicalPath(file) {
  file = path.resolve(file);
  try { return await fs.realpath(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = await fs.realpath(path.dirname(file)).catch(parentError => { if (parentError.code === 'ENOENT') return path.dirname(file); throw parentError; });
    return path.join(parent, path.basename(file));
  }
}
async function atomicWrite(file, bytes, backup = false) {
  file = path.resolve(file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), '.inklet-' + randomUUID() + '.tmp');
  let handle;
  try {
    const previous = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error('Refusing to replace a non-regular file.');
    handle = await fs.open(temporary, 'wx', previous ? previous.mode & 0o777 : 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    if (previous && backup) await atomicWrite(backupPath(file), await fs.readFile(file));
    await fs.rename(temporary, file);
    if (process.platform !== 'win32') { const parent = await fs.open(path.dirname(file), 'r'); try { await parent.sync(); } finally { await parent.close(); } }
  } finally { await handle?.close(); await fs.rm(temporary, { force: true }); }
}
async function readJson(file, fallback = null, maximum = 2 * 1024 * 1024) {
  for (const candidate of [file, backupPath(file)]) {
    try { if ((await fs.stat(candidate)).size > maximum) continue; return JSON.parse(await fs.readFile(candidate, 'utf8')); }
    catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
  }
  return fallback;
}
async function stamp(file) { try { return hash(await fs.readFile(file)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function decodeDocument(bytes) {
  if (bytes.length > MAX_DOCUMENT) throw new Error('Markdown exceeds the 24 MiB limit.');
  const bom = bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom ? 3 : 0)); }
  catch { throw new Error('The document is not valid UTF-8.'); }
  if (text.includes('\0')) throw new Error('Binary content cannot be opened as Markdown.');
  return { text: text.replace(/\r\n/g, '\n'), ending: text.includes('\r\n') ? '\r\n' : '\n', bom, stamp: hash(bytes) };
}
function imagePath(reference, directory) {
  if (typeof reference !== 'string' || !reference.trim() || reference.includes('\0')) throw new Error('Invalid image path.');
  let resolved;
  if (/^file:/i.test(reference)) {
    const url = new URL(reference); if (url.hostname && url.hostname !== 'localhost') throw new Error('Network image paths are not opened automatically.');
    resolved = fileURLToPath(url);
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(reference) && !(process.platform === 'win32' && /^[a-z]:[\\/]/i.test(reference))) throw new Error('Only local image files are supported.');
    resolved = decodeURIComponent(reference);
    if (/^[\\/]{2}/.test(resolved) || resolved.includes('\0')) throw new Error('Network and device paths are not supported.');
    if (process.platform === 'win32') resolved = resolved.replaceAll('/', path.sep);
  }
  return path.resolve(directory, resolved);
}
async function assetDestination(directory, reference) {
  const relative = decodeURIComponent(reference);
  if (path.isAbsolute(relative) || relative.includes(':') || /^[\\/]{2}/.test(relative)) throw new Error('Image copies must remain inside the chosen document folder.');
  const destination = path.resolve(directory, relative);
  const within = path.relative(path.resolve(directory), destination);
  if (within === '..' || within.startsWith('..' + path.sep) || path.isAbsolute(within)) throw new Error('Image copies cannot leave the chosen document folder.');
  let current = destination;
  while (current !== path.dirname(directory) && current !== path.dirname(current)) {
    const info = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info?.isSymbolicLink()) throw new Error('Image copy paths cannot contain symbolic links.');
    if (current === path.resolve(directory)) break;
    current = path.dirname(current);
  }
  return destination;
}

class FileStore {
  constructor(directory) { this.directory = path.resolve(directory); this.draftDirectory = path.join(this.directory, 'draft'); this.currentPath = null; this.currentStamp = null; this.ending = '\n'; this.bom = false; this.pendingExternal = null; this.recoveryState = null; }
  get sourceDirectory() { return this.currentPath ? path.dirname(this.currentPath) : this.draftDirectory; }
  async snapshot(file) {
    file = await fs.realpath(path.resolve(file));
    const info = await fs.stat(file); if (!info.isFile() || info.size > MAX_DOCUMENT) throw new Error('Invalid or oversized Markdown file.');
    const snapshot = decodeDocument(await fs.readFile(file));
    return { ...snapshot, path: file, name: path.basename(file), hash: textHash(snapshot.text), annotations: await readJson(file + '.inklet.json', null, 8 * 1024 * 1024) };
  }
  adopt(snapshot) { this.currentPath = snapshot.path; this.currentStamp = snapshot.stamp; this.ending = snapshot.ending; this.bom = snapshot.bom; }
  async open(file) { const snapshot = await this.snapshot(file); this.adopt(snapshot); this.pendingExternal = null; return snapshot; }
  async readExternal(file) {
    if (await canonicalPath(file) !== this.currentPath) return null;
    const snapshot = await this.snapshot(file); if (snapshot.stamp === this.currentStamp) return null;
    this.pendingExternal = snapshot; return snapshot;
  }
  async acceptExternal(file, expected) {
    if (!this.pendingExternal || this.pendingExternal.path !== await canonicalPath(file) || this.pendingExternal.stamp !== expected) return false;
    this.adopt(this.pendingExternal); this.pendingExternal = null; await this.clearRecovery(); return true;
  }
  async readImage(reference) {
    const file = imagePath(reference, this.sourceDirectory); const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error('Unsupported image format: ' + reference);
    const info = await fs.stat(file); if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Image exceeds 32 MiB or is not a file.');
    return { mime, data: (await fs.readFile(file)).toString('base64') };
  }
  async importImage(data, mime) {
    const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp' };
    if (!extensions[mime] || typeof data !== 'string' || data.length > 36 * 1024 * 1024 || !/^[\w+/]*={0,2}$/.test(data)) throw new Error('Invalid image data.');
    const bytes = Buffer.from(data, 'base64');
    const valid = mime === 'image/png' ? bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : mime === 'image/gif' ? bytes.toString('ascii', 0, 3) === 'GIF' : mime === 'image/bmp' ? bytes.toString('ascii', 0, 2) === 'BM' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid || bytes.length < 12 || bytes.length > 25 * 1024 * 1024) throw new Error('Image contents do not match their declared type.');
    const relative = '.inklet-assets/' + hash(bytes).slice(0, 24) + extensions[mime];
    await atomicWrite(await assetDestination(this.sourceDirectory, relative), bytes); return { path: relative };
  }
  async save(file, text, annotations = {}, resources = []) {
    file = await canonicalPath(file);
    if (typeof text !== 'string' || text.includes('\0')) throw new Error('Invalid Markdown text.');
    const diskText = this.ending === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;
    const bytes = Buffer.concat([this.bom ? Buffer.from([239, 187, 191]) : Buffer.alloc(0), Buffer.from(diskText, 'utf8')]);
    if (bytes.length > MAX_DOCUMENT) throw new Error('Saved Markdown exceeds 24 MiB.');
    const expected = file === this.currentPath ? this.currentStamp : await stamp(file);
    if (file === this.currentPath && await stamp(file) !== expected) throw new Error('The disk file changed or was deleted. Save a copy instead.');
    const sourceDirectory = this.sourceDirectory;
    if (sourceDirectory !== path.dirname(file)) for (const reference of new Set(resources)) {
      if (!reference || /^(?:data:|https?:)/i.test(reference)) continue;
      const original = imagePath(reference, sourceDirectory); if (!await exists(original)) continue;
      let destination;
      try { destination = await assetDestination(path.dirname(file), reference); }
      catch (error) { if (imagePath(reference, path.dirname(file)) === original) continue; throw error; }
      const image = await fs.readFile(original);
      if (await exists(destination) && await stamp(destination) !== hash(image)) throw new Error('A different image already exists in the target folder.');
      if (!await exists(destination)) await atomicWrite(destination, image);
    }
    if (await stamp(file) !== expected) throw new Error('File changed before save; disk contents were not overwritten.');
    await atomicWrite(file, bytes, true); this.currentPath = file; this.currentStamp = hash(bytes);
    const result = { path: file, name: path.basename(file), hash: textHash(text) };
    await atomicWrite(file + '.inklet.json', Buffer.from(JSON.stringify({ ...annotations, textHash: result.hash })), true);
    await this.clearRecovery(); return result;
  }
  async saveRecovery(payload) {
    if (typeof payload.text !== 'string' || Buffer.byteLength(payload.text, 'utf8') > MAX_DOCUMENT || !Number.isInteger(payload.revision)) throw new Error('Invalid recovery snapshot.');
    const state = { ...payload, assetDirectory: this.sourceDirectory, lineEnding: this.ending, hasBom: this.bom };
    const data = JSON.stringify(state);
    await atomicWrite(path.join(this.directory, 'recovery.json'), Buffer.from(JSON.stringify({ format: 'InkletRecoveryV1', data, checksum: textHash(data) })), true);
    await fs.rm(path.join(this.directory, 'recovery.jsonl'), { force: true }); this.recoveryState = state;
  }
  async recovery() {
    let state = null;
    for (const file of [path.join(this.directory, 'recovery.json'), backupPath(path.join(this.directory, 'recovery.json'))]) {
      try {
        if ((await fs.stat(file)).size > 64 * 1024 * 1024) continue;
        const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
        if (envelope.format !== 'InkletRecoveryV1' || textHash(envelope.data) !== envelope.checksum) continue;
        state = JSON.parse(envelope.data); if (typeof state.text !== 'string' || !Number.isInteger(state.revision)) { state = null; continue; }
        if (file.endsWith('.bak')) state.recoveredPreviousSnapshot = true;
        break;
      } catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
    }
    if (!state) return null;
    const journal = await fs.readFile(path.join(this.directory, 'recovery.jsonl'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    for (const line of journal.split('\n').filter(Boolean)) {
      try {
        const envelope = JSON.parse(line); if (textHash(envelope.data) !== envelope.checksum) throw new Error('Invalid recovery checksum');
        const next = this.applyDelta(state, JSON.parse(envelope.data)); if (!next) throw new Error('Recovery sequence mismatch'); state = next;
      } catch { state.recoveredPartialJournal = true; break; }
    }
    return state;
  }
  applyDelta(state, delta) {
    const change = delta.change;
    if (!state || delta.documentId !== state.documentId || delta.baseRevision !== state.revision || !Number.isInteger(delta.revision) || delta.revision <= state.revision || !change || !Number.isInteger(change.from) || !Number.isInteger(change.to) || change.from < 0 || change.to < change.from || change.to > state.text.length || typeof change.insert !== 'string') return null;
    const text = state.text.slice(0, change.from) + change.insert + state.text.slice(change.to);
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT) return null;
    return { ...state, ...delta, text, assetDirectory: state.assetDirectory, lineEnding: state.lineEnding, hasBom: state.hasBom };
  }
  async appendRecovery(payload) {
    const previous = this.recoveryState || await this.recovery(); const next = this.applyDelta(previous, payload);
    if (!next) return { needsSnapshot: true };
    const journal = path.join(this.directory, 'recovery.jsonl');
    const info = await fs.stat(journal).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (previous.recoveredPartialJournal || info?.size > 4 * 1024 * 1024) await this.saveRecovery(next);
    else {
      const data = JSON.stringify(payload); await fs.mkdir(this.directory, { recursive: true });
      const handle = await fs.open(journal, 'a', 0o600);
      try { await handle.writeFile(JSON.stringify({ data, checksum: textHash(data) }) + '\n'); await handle.sync(); } finally { await handle.close(); }
      this.recoveryState = next;
    }
    return { documentId: payload.documentId, revision: payload.revision, persisted: true };
  }
  async recover(payload) {
    this.currentPath = payload.path ? await canonicalPath(payload.path) : null;
    if (typeof payload.assetDirectory === 'string' && (await fs.stat(payload.assetDirectory).catch(() => null))?.isDirectory()) this.draftDirectory = payload.assetDirectory;
    this.ending = payload.lineEnding === '\r\n' ? '\r\n' : '\n'; this.bom = payload.hasBom === true;
    this.currentStamp = null;
    if (this.currentPath) {
      const snapshot = await this.snapshot(this.currentPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (snapshot && snapshot.hash === payload.hash) this.currentStamp = snapshot.stamp;
      else this.currentPath = null;
    }
    return payload;
  }
  async clearRecovery() {
    for (const file of ['recovery.json', 'recovery.jsonl', '.inklet-backups/recovery.json.bak']) await fs.rm(path.join(this.directory, file), { force: true });
    this.recoveryState = null;
  }
}
module.exports = { FileStore, atomicWrite, readJson, backupPath, stamp, hash, textHash, imagePath, assetDestination, canonicalPath, MAX_DOCUMENT };