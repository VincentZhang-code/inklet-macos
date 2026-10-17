import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const editorRequire = createRequire(path.join(root, '../inklet/app/package.json'));
const { _electron: electron } = editorRequire('playwright');
const { expect } = editorRequire('@playwright/test');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'inklet-mac-desktop-'));
const reportDirectory = path.join(root, 'verification', 'desktop-' + new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-'));
await fs.mkdir(reportDirectory, { recursive: true });
const fixture = path.join(temporary, 'Article.md');
const image = path.join(temporary, 'diagram.svg');
const original = '# Inklet Desktop\n\nA complete Markdown document.\n\n## Table\n\n| Item | Value |\n| --- | --- |\n| One | 42 |\n\n## Mathematics\n\n$$x^2 + y^2 = z^2$$\n\n## Diagram\n\n```mermaid\nflowchart LR\n    Start --> End\n```\n\n![Local diagram](diagram.svg)\n\n## Last section\n\nRetained source.\n';
await fs.writeFile(fixture, '\ufeff' + original.replaceAll('\n', '\r\n'));
await fs.writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="90"><rect width="180" height="90" fill="#24876b"/><text x="20" y="50" fill="white">Inklet</text></svg>');
const checks = []; const errors = []; const network = [];
const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
let application;
let page;
async function check(name, action) { await action(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
async function settled(condition, argument) { await page.waitForFunction(condition, argument, { timeout: 20000 }); }
try {
  application = await electron.launch({ executablePath: require('electron'), args: [root, fixture, '--profile=' + path.join(temporary, 'profile')], env: environment, timeout: 30000 });
  page = await application.firstWindow(); page.setDefaultTimeout(15000);
  if (process.argv.includes('--compact-window')) await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 600));
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/i.test(request.url())) network.push(request.url()); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text() + ' @ ' + message.location().url); });
  await application.evaluate(({ dialog }, directory) => {
    globalThis.inkletTestOpen = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.inkletTestOpen });
    dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: directory + '/' + options.defaultPath });
  }, temporary);
  await check('isolated desktop boots the complete editor and correct document', async () => {
    await page.locator('.ProseMirror h1').filter({ hasText: 'Inklet Desktop' }).waitFor();
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
    const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.webSecurity, true);
    assert.equal(new URL(page.url()).protocol, 'inklet:');
  });
  await check('tables, MathJax, Mermaid and document-relative SVG render offline', async () => {
    await page.locator('.ProseMirror table').first().waitFor();
    for (const kind of ['math_block', 'mermaid']) {
      const graphic = page.locator('.ProseMirror [data-render-key^="' + kind + ':"]').first();
      await graphic.scrollIntoViewIfNeeded();
      await expect(graphic).toHaveAttribute('data-rendered', 'true', { timeout: 20000 });
      const svg = graphic.locator('svg').first(); await expect(svg).toBeVisible();
      const bounds = await svg.boundingBox(); assert.ok(bounds && bounds.width > 0 && bounds.height > 0, kind + ' must produce a nonblank graphic');
    }
    const localImage = page.locator('.ProseMirror img[data-image-source="diagram.svg"]');
    await localImage.scrollIntoViewIfNeeded();
    await expect.poll(() => localImage.evaluate(image => image.complete && image.naturalWidth === 180), { timeout: 20000 }).toBe(true);
    await page.locator('.ProseMirror h1').first().scrollIntoViewIfNeeded();
    assert.deepEqual(network, []);
  });
  await check('search and appearance controls remain functional', async () => {
    await application.evaluate(({ Menu }) => {
      const entries = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []);
      const search = entries.find(item => item.accelerator === 'CommandOrControl+F');
      if (!search) throw new Error('Find menu is missing.'); search.click();
    });
    await page.locator('#search-input').fill('Markdown');
    await settled(() => document.querySelectorAll('.cm-searchMatch, .search-hit, .search-result, [data-search-index]').length > 0 || document.querySelector('#search-count')?.textContent?.includes('1'));
    await page.locator('[data-action="search-close"]').click();
    await page.locator('#source-editor .cm-content').click(); await page.keyboard.press('Meta+f'); await page.locator('#search-input').waitFor({ state: 'visible' }); await page.locator('[data-action="search-close"]').click();
    await page.locator('[data-action="settings"]').click(); await page.locator('#restore-reading-input').check(); await page.locator('#settings-dialog button').filter({ hasText: '\u5b8c\u6210' }).click();
  });
  await check('save preserves original BOM and CRLF with a real disk edit', async () => {
    const lastLine = page.locator('#source-editor .cm-line').last(); await lastLine.scrollIntoViewIfNeeded(); await lastLine.click(); await page.keyboard.press('End'); await page.keyboard.insertText('\nMac host saved this.\n');
    await settled(async () => { const entries = await window.inkletNative.invoke('workspaceList', {}); return entries.length && entries[0].dirty; });
    await page.locator('[data-action="save"]').first().click();
    await page.waitForFunction(async () => { const entries = await window.inkletNative.invoke('workspaceList', {}); return entries.length && !entries[0].dirty; });
    await expect.poll(async () => (await fs.readFile(fixture, 'utf8')).includes('Mac host saved this'), { timeout: 15000 }).toBe(true);
    const bytes = await fs.readFile(fixture); assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf'); assert.match(bytes.toString(), /Mac host saved this/); assert.equal(bytes.toString().replaceAll('\r\n', '').includes('\n'), false);
    assert.ok((await fs.stat(path.join(temporary, '.inklet-backups/Article.md.bak'))).size > 0);
  });
  await check('HTML, PDF and Word exports contain generated documents', async () => {
    for (const format of ['html', 'pdf', 'docx']) {
      await page.locator('[data-action="print"]').first().click(); await page.locator('#export-format').selectOption(format); await page.locator('#export-submit').click();
      await settled(() => !document.querySelector('#export-dialog').open);
      const bytes = await fs.readFile(path.join(temporary, 'Article.' + format));
      assert.ok(bytes.length > 100);
      if (format === 'pdf') assert.equal(bytes.toString('ascii', 0, 5), '%PDF-');
      if (format === 'docx') assert.equal(bytes.toString('ascii', 0, 2), 'PK');
      if (format === 'html') { assert.match(bytes.toString(), /Inklet Desktop/); assert.match(bytes.toString(), /data:image/); }
    }
  });
  await check('multiple documents, open history and external changes stay isolated', async () => {
    const other = path.join(temporary, 'Second.md'); await fs.writeFile(other, '# Second\n\nIndependent document.\n');
    await application.evaluate((_electron, file) => { globalThis.inkletTestOpen = [file]; }, other);
    await page.locator('[data-action="open"]').first().click(); await page.locator('.ProseMirror h1').filter({ hasText: 'Second' }).waitFor();
    assert.equal((await page.evaluate(() => window.inkletNative.invoke('workspaceList', {}))).length, 2);
    assert.equal((await page.evaluate(() => window.inkletNative.invoke('history', {}))).length, 2);
    await fs.writeFile(other, '# Second\n\nExternally updated.\n');
    await settled(() => document.querySelector('.ProseMirror')?.textContent.includes('Externally updated.'));
    assert.match((await fs.readFile(fixture, 'utf8')), /Mac host saved this/);
  });
  await check('document transfer opens an independent fully initialized window', async () => {
    await page.locator('#detach-file-button').click();
    const next = await application.waitForEvent('window');
    await next.locator('.ProseMirror h1').filter({ hasText: 'Second' }).waitFor();
    await next.waitForFunction(() => !document.querySelector('#app').inert);
    assert.equal((await next.evaluate(() => window.inkletNative.invoke('workspaceList', {}))).length, 1);
    assert.equal((await page.evaluate(() => window.inkletNative.invoke('workspaceList', {}))).length, 1);
    await next.screenshot({ path: path.join(reportDirectory, 'transferred-window.png') });
  });
  await page.screenshot({ path: path.join(reportDirectory, 'desktop.png') });
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
} catch (error) {
  checks.push({ name: 'desktop regression', passed: false, error: error.stack }); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(reportDirectory, 'failure.png') }).catch(() => {});
  console.error(error.stack);
} finally {
  const rendering = page && !page.isClosed() ? await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    graphics: [...document.querySelectorAll('.ProseMirror [data-render-key]')].map(element => ({ kind: element.dataset.renderKey.split(':')[0], state: element.dataset.rendered, svgCount: element.querySelectorAll('svg').length, error: element.dataset.rendered === 'error' ? element.textContent.slice(0, 500) : null })),
    images: [...document.querySelectorAll('.ProseMirror img')].map(image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })),
  })).catch(() => null) : null;
  await fs.writeFile(path.join(reportDirectory, 'results.json'), JSON.stringify({ platform: process.platform, macHardwareVerified: process.platform === 'darwin' && !process.exitCode, checks, errors, network, rendering, passed: !process.exitCode, temporaryFiles: temporary }, null, 2));
  if (application) { await application.evaluate(({ BrowserWindow, app }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(0); }).catch(() => {}); await application.close().catch(() => {}); }
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  console.log('REPORT ' + path.join(reportDirectory, 'results.json'));
}