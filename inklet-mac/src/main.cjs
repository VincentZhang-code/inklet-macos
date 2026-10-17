'use strict';
const { app, BrowserWindow, Menu, ipcMain, protocol, session, dialog, shell, screen } = require('electron');
const fs = require('node:fs');
const files = require('node:fs/promises');
const path = require('node:path');
const { HostController } = require('./host-controller.cjs');
const { atomicWrite, canonicalPath } = require('./file-store.cjs');
const { identifier } = require('./workspace-store.cjs');
const { APP_URL, CSP, trustedPage, allowedResource, resourceFile } = require('./security.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'inklet', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('Inklet');
const argumentsList = process.argv.slice(app.isPackaged ? 1 : 2);
const profileArgument = argumentsList.find(value => value.startsWith('--profile='));
if (profileArgument) app.setPath('userData', path.resolve(profileArgument.slice(10)));
const webRoot = path.resolve(__dirname, '../web');
const windows = new Map();
const pendingOpen = [];
const watchers = new Map();
let controller;
let quitting = false;
let allowQuit = false;
const initialFiles = argumentsList.filter(value => !value.startsWith('-') && /\.(md|markdown|txt)$/i.test(value)).map(value => path.resolve(value));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };
function record(event, data = {}) { files.appendFile(path.join(app.getPath('userData'), 'diagnostics.jsonl'), JSON.stringify({ time: new Date().toISOString(), event, ...data }) + '\n').catch(() => {}); }
function denyNetwork(target, host) {
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.setPermissionCheckHandler(() => false);
  target.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedResource(details.url, host) }));
  target.on('will-download', event => event.preventDefault());
}
function protectedContents(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('will-navigate', (event, url) => { if (!trustedPage(url)) event.preventDefault(); });
}
function frameFor(id) { const frame = windows.get(id); if (!frame || frame.window.isDestroyed()) throw new Error('Window has closed.'); return frame; }
function notify(id, event, data) { const frame = windows.get(id); if (frame && !frame.window.isDestroyed()) frame.window.webContents.send('inklet:event', { event, data }); }
function focusWindow(id) { const frame = windows.get(id); if (!frame) return; if (frame.window.isMinimized()) frame.window.restore(); frame.window.show(); frame.window.focus(); }
function activeState() { const focused = BrowserWindow.getFocusedWindow(); return controller?.windows.get([...windows.values()].find(frame => frame.window === focused)?.state.id) || [...controller?.windows.values() || []].find(state => !state.incomingToken); }
function openFile(file) { if (!controller) { pendingOpen.push(file); return; } const state = activeState(); if (state) { focusWindow(state.id); controller.queueOpen(state, file); } else controller.newWindow({ startupFile: file }); }
function closeNative(id) { const frame = windows.get(id); if (!frame) return; frame.allowClose = true; frame.window.close(); }
function makeWindow(state) {
  const partition = session.fromPartition('inklet-' + state.id); denyNetwork(partition, 'app');
  partition.protocol.handle('inklet', async request => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      const url = new URL(request.url);
      if (url.hostname === 'app' && url.pathname === '/image') {
        const item = controller.workspace.get(state.id, url.searchParams.get('document'));
        const image = await item.store.readImage(url.searchParams.get('path'));
        return new Response(Buffer.from(image.data, 'base64'), { headers: { 'Content-Type': image.mime, 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
      }
      const file = await resourceFile(webRoot, request.url);
      return new Response(request.method === 'HEAD' ? null : await files.readFile(file), { headers: { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Resource unavailable', { status: 404 }); }
  });
  const display = screen.getDisplayNearestPoint(state.dropPoint && Number.isFinite(state.dropPoint.x) && Number.isFinite(state.dropPoint.y) ? { x: Math.round(state.dropPoint.x), y: Math.round(state.dropPoint.y) } : screen.getCursorScreenPoint());
  const area = display.workArea; const width = Math.min(1380, area.width); const height = Math.min(900, area.height);
  const position = state.dropPoint ? { x: Math.max(area.x, Math.min(area.x + area.width - width, Math.round(state.dropPoint.x - width / 4))), y: Math.max(area.y, Math.min(area.y + area.height - height, Math.round(state.dropPoint.y - 36))) } : {};
  const window = new BrowserWindow({ width, height, minWidth: 760, minHeight: 540, ...position, title: 'Inklet', show: false, backgroundColor: '#f5f8f6', icon: path.join(webRoot, 'inklet.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), session: partition, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true, devTools: !app.isPackaged } });
  const frame = { state, window, allowClose: false }; windows.set(state.id, frame); protectedContents(window.webContents);
  window.once('ready-to-show', () => window.show());
  window.on('close', event => { if (!frame.allowClose) { event.preventDefault(); controller.requestClose(state.id); } });
  window.on('closed', () => {
    windows.delete(state.id);
    if (controller.windows.has(state.id)) {
      for (const [token, transfer] of controller.workspace.transfers) if (transfer.source === state.id || transfer.target === state.id) controller.cancelTransfer(token);
      controller.windows.delete(state.id);
      for (const item of controller.workspace.documents.values()) if (item.owner === state.id) { item.owner = null; item.recovered = item.dirty; item.loaded = false; }
    }
    refreshWatchers();
    if (!windows.size && quitting) { allowQuit = true; app.quit(); }
  });
  window.webContents.on('render-process-gone', (_event, detail) => { state.ready = false; record('renderer-exit', { reason: detail.reason, exitCode: detail.exitCode }); dialog.showErrorBox('Inklet', '\u7f16\u8f91\u9875\u9762\u610f\u5916\u9000\u51fa\u3002\u5df2\u6301\u4e45\u5316\u7684\u8349\u7a3f\u4fdd\u6301\u4e0d\u53d8\uff0c\u8bf7\u91cd\u542f Inklet \u6062\u590d\u3002'); });
  window.webContents.on('unresponsive', () => record('renderer-unresponsive'));
  window.loadURL(APP_URL).catch(error => { record('load-failed', { code: error.code || 'LOAD' }); dialog.showErrorBox('Inklet', '\u7f16\u8f91\u5668\u8d44\u6e90\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u5b89\u88c5\u5305\u5b8c\u6574\u6027\u3002'); });
}
function refreshWatchers() {
  for (const watcher of watchers.values()) { watcher.close(); clearTimeout(watcher.debounce); } watchers.clear();
  const directories = new Map();
  for (const item of controller?.workspace.documents.values() || []) if (item.path && item.owner) { const directory = path.dirname(item.path); if (!directories.has(directory)) directories.set(directory, []); directories.get(directory).push(item); }
  for (const [directory, items] of directories) try {
    const changed = () => { clearTimeout(watcher.debounce); watcher.debounce = setTimeout(() => { for (const item of items) notify(item.owner, 'externalChange', { documentId: item.id, path: item.path }); }, 250); };
    const watcher = fs.watch(directory, changed); watcher.on('error', changed); watchers.set(directory, watcher);
  } catch { for (const item of items) notify(item.owner, 'externalChange', { documentId: item.id, path: item.path }); }
}
async function chooseSave(owner, name, extension) { const result = await dialog.showSaveDialog(frameFor(owner).window, { title: extension === 'md' ? '\u4fdd\u5b58 Markdown' : '\u5bfc\u51fa ' + extension.toUpperCase(), defaultPath: path.basename(name), filters: [{ name: extension.toUpperCase(), extensions: [extension] }], properties: ['createDirectory', 'showOverwriteConfirmation'] }); return result.canceled ? null : result.filePath; }
async function printPdf(html) {
  const partition = session.fromPartition('inklet-print-' + identifier()); denyNetwork(partition, 'print');
  partition.protocol.handle('inklet', request => request.url === 'inklet://print/document.html' ? new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; object-src 'none'; script-src 'none'" } }) : new Response(null, { status: 404 }));
  const window = new BrowserWindow({ show: false, width: 940, height: 700, webPreferences: { session: partition, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault());
  let timer;
  try {
    return await Promise.race([(async () => { await window.loadURL('inklet://print/document.html'); await window.webContents.executeJavaScript('(async()=>{await document.fonts.ready; await Promise.all([...document.images].map(image=>image.decode())); return true;})()'); return window.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false }); })(), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('PDF layout exceeded 30 seconds.')), 30000); })]);
  } finally { clearTimeout(timer); if (!window.isDestroyed()) window.destroy(); }
}
async function exportFile(owner, store, args) {
  if (!['html', 'pdf', 'docx'].includes(args.format)) throw new Error('Unsupported export format.');
  const destination = await chooseSave(owner, path.basename(args.name || 'Document.md', path.extname(args.name || 'Document.md')) + '.' + args.format, args.format); if (!destination) return null;
  if (path.extname(destination).toLowerCase() !== '.' + args.format) throw new Error('Export extension must match its format.');
  if (await canonicalPath(destination) === store.currentPath || await controller.workspace.findPath(destination)) throw new Error('Export cannot overwrite an open document.');
  if ((args.html?.length || args.data?.length || 0) > 128 * 1024 * 1024) throw new Error('Export exceeds 128 MiB.');
  let bytes;
  if (args.format === 'docx') { if (typeof args.data !== 'string' || !/^[A-Za-z\d+/]*={0,2}$/.test(args.data)) throw new Error('Invalid Word data.'); bytes = Buffer.from(args.data, 'base64'); if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Word generation failed.'); }
  else { if (typeof args.html !== 'string') throw new Error('Export HTML is missing.'); bytes = args.format === 'pdf' ? await printPdf(args.html) : Buffer.from(args.html, 'utf8'); }
  if (args.format === 'pdf' && bytes.toString('ascii', 0, 5) !== '%PDF-') throw new Error('PDF generation failed.');
  await atomicWrite(destination, bytes, true); return { path: destination, format: args.format };
}
function updateMenu() {
  const trigger = command => { const state = activeState(); if (state) notify(state.id, 'command', { command }); };
  const shortcut = (command, fallback) => { const overrides = controller?.preferences.settings.shortcuts || {}; return (Object.hasOwn(overrides, command) ? overrides[command] : fallback)?.replace(/^(?:Ctrl|Cmd)\+/, 'CommandOrControl+') || undefined; };
  const commandItem = (label, command, fallback) => ({ label, accelerator: shortcut(command, fallback), click: () => trigger(command) });
  const application = { label: 'Inklet', submenu: [commandItem('\u5173\u4e8e Inklet', 'about', 'F1'), commandItem('\u8bbe\u7f6e...', 'settings', 'Ctrl+,'), { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { label: '\u9000\u51fa Inklet', accelerator: 'CommandOrControl+Q', click: () => app.quit() }] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === 'darwin' ? [application] : []), { label: '\u6587\u4ef6', submenu: [commandItem('\u65b0\u5efa', 'new', 'Ctrl+N'), commandItem('\u6253\u5f00...', 'open', 'Ctrl+O'), commandItem('\u4fdd\u5b58', 'save', 'Ctrl+S'), commandItem('\u53e6\u5b58\u4e3a...', 'save-as', 'Ctrl+Shift+S'), commandItem('\u5bfc\u51fa...', 'print', 'Ctrl+P'), { type: 'separator' }, { label: '\u65b0\u7a97\u53e3', click: () => controller.newWindow() }, commandItem('\u5173\u95ed\u6587\u6863', 'close-document', 'Ctrl+W'), { label: '\u5173\u95ed\u7a97\u53e3', accelerator: 'CommandOrControl+Shift+W', click: () => { const state = activeState(); if (state) controller.requestClose(state.id); } }] }, { label: '\u7f16\u8f91', submenu: [commandItem('\u64a4\u9500', 'undo', 'Ctrl+Z'), commandItem('\u91cd\u505a', 'redo', 'Ctrl+Shift+Z'), { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, commandItem('\u67e5\u627e\u4e0e\u66ff\u6362', 'search', 'Ctrl+F')] }, { label: '\u663e\u793a', submenu: [commandItem('\u76ee\u5f55', 'sidebar', 'Ctrl+Shift+O'), commandItem('\u4e13\u6ce8\u6a21\u5f0f', 'focus', 'F8'), commandItem('\u6253\u5b57\u673a\u6a21\u5f0f', 'typewriter', 'F9'), { type: 'separator' }, { role: 'togglefullscreen' }] }, { role: 'windowMenu' }, { label: '\u5e2e\u52a9', submenu: [commandItem('\u8f6f\u4ef6\u8bf4\u660e', 'about', 'F1'), commandItem('\u8bbe\u7f6e', 'settings')] }]));
}
const adapter = {
  createWindow: makeWindow, send: notify, focus: focusWindow, closeWindow: closeNative, watch: refreshWatchers, updateMenu,
  title: (id, title) => frameFor(id).window.setTitle(title), cancelQuit: () => { quitting = false; },
  chooseOpen: async id => { const result = await dialog.showOpenDialog(frameFor(id).window, { title: '\u6253\u5f00 Markdown', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }, { name: '\u6240\u6709\u6587\u4ef6', extensions: ['*'] }] }); return result.canceled ? null : result.filePaths; },
  chooseSave, exportFile, external: url => shell.openExternal(url),
  registerDefault: async id => { await dialog.showMessageBox(frameFor(id).window, { type: 'info', title: 'Markdown \u9ed8\u8ba4\u5e94\u7528', message: '\u5728 Finder \u9009\u62e9\u4e00\u4e2a .md \u6587\u4ef6\uff0c\u6253\u5f00\u201c\u663e\u793a\u7b80\u4ecb\u201d\uff0c\u5728\u201c\u6253\u5f00\u65b9\u5f0f\u201d\u4e2d\u9009\u62e9 Inklet\uff0c\u7136\u540e\u70b9\u51fb\u201c\u5168\u90e8\u66f4\u6539\u201d\u3002', detail: '\u5b89\u88c5\u540e\u7531 macOS \u7ba1\u7406\u6587\u4ef6\u5173\u8054\uff0cInklet \u4e0d\u4f1a\u5f3a\u884c\u4fee\u6539\u5176\u4ed6\u5e94\u7528\u7684\u9ed8\u8ba4\u8bbe\u7f6e\u3002' }); },
  bounds: id => { const window = frameFor(id).window; const bounds = window.getBounds(); return { ...window.getContentBounds(), left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height }; },
  drag: async id => { const bounds = frameFor(id).window.getBounds(); const cursor = screen.getCursorScreenPoint(); return { x: cursor.x, y: cursor.y, outside: cursor.x < bounds.x || cursor.x >= bounds.x + bounds.width || cursor.y < bounds.y || cursor.y >= bounds.y + bounds.height }; },
};
app.on('open-file', (event, file) => { event.preventDefault(); openFile(file); });
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', (_event, argv) => { const paths = argv.filter(value => /\.(md|markdown|txt)$/i.test(value)); if (paths.length) paths.forEach(openFile); else { const state = activeState(); if (state) focusWindow(state.id); } });
  app.on('before-quit', event => { if (allowQuit || !windows.size) return; event.preventDefault(); quitting = true; for (const id of [...windows.keys()]) controller.requestClose(id); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') { allowQuit = true; app.quit(); } });
  app.on('activate', () => { if (controller && !windows.size) controller.newWindow(); });
  app.whenReady().then(async () => {
    await files.mkdir(app.getPath('userData'), { recursive: true });
    controller = await new HostController(app.getPath('userData'), adapter).initialize();
    ipcMain.handle('inklet:call', (event, request) => {
      const frame = [...windows.values()].find(frame => frame.window.webContents === event.sender);
      if (!frame || event.senderFrame !== event.sender.mainFrame || !trustedPage(event.senderFrame.url) || typeof request?.command !== 'string') throw new Error('Untrusted IPC sender.');
      return controller.handle(frame.state.id, request.command, request.args || {});
    });
    updateMenu();
    const startup = [...pendingOpen.splice(0), ...initialFiles]; const window = controller.newWindow({ startupFile: startup.shift() }); for (const file of startup) controller.queueOpen(window, file);
  }).catch(error => { record('startup-failed', { code: error.code || 'STARTUP' }); dialog.showErrorBox('Inklet', error.message); allowQuit = true; app.quit(); });
}