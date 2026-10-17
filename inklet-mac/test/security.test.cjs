'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
const { trustedPage, allowedResource, resourceFile } = require('../src/security.cjs');
test('IPC origins and offline resource requests are strictly scoped', () => {
  assert.equal(trustedPage('inklet://app/index.html'), true);
  for (const url of ['https://app/index.html', 'inklet://evil/index.html', 'inklet://app/assets/other.js', 'inklet://user@app/index.html', 'inklet://app:123/index.html', 'inklet://app/index.html?external=1', 'file:///tmp/test.html']) assert.equal(trustedPage(url), false, url);
  assert.equal(allowedResource('inklet://app/font.woff2'), true); assert.equal(allowedResource('https://example.com/'), false); assert.equal(allowedResource('file:///tmp/secret'), false);
});
test('static resources cannot escape the packaged application', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inklet-mac-origin-')); context.after(() => fs.rm(root, { recursive: true, force: true }));
  const web = path.join(root, 'web'); await fs.mkdir(web); await fs.writeFile(path.join(web, 'index.html'), 'app'); await fs.writeFile(path.join(root, 'secret'), 'secret');
  assert.equal(path.basename(await resourceFile(web, 'inklet://app/index.html')), 'index.html');
  await assert.rejects(resourceFile(web, 'inklet://app/..%2fsecret'), /outside/);
  await assert.rejects(resourceFile(web, 'inklet://app/..%5csecret'), /Invalid/);
  await assert.rejects(resourceFile(web, 'https://app/index.html'), /origin/);
});