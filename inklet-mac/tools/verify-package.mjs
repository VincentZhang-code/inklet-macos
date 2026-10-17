import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const JSZip = require('jszip');
const plist = require('plist');
const asar = require('@electron/asar');
const archive = path.resolve(process.argv[2] || '');
if (!archive.endsWith('.zip')) throw new Error('Provide the generated Mac ZIP path.');
const report = JSON.parse(await fs.readFile(archive + '.json', 'utf8'));
assert.equal(report.variant, 'standard');
const bytes = await fs.readFile(archive); assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'inklet-mac-package-'));
try {
  let fileCount = 0;
  let linkCount = 0;
  let packed;
  if (process.platform === 'darwin') {
    const extracted = path.join(temporary, 'extracted');
    await fs.mkdir(extracted, { recursive: true });
    const unpack = spawnSync('/usr/bin/ditto', ['-x', '-k', archive, extracted], { stdio: 'inherit' });
    assert.equal(unpack.status, 0, 'ditto extraction must succeed');
    const bundle = path.join(extracted, 'Inklet.app');
    const codesign = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
    assert.equal(codesign.status, 0, 'codesign verification must succeed on extracted app');
    const contents = path.join(bundle, 'Contents');
    const info = plist.parse(await fs.readFile(path.join(contents, 'Info.plist'), 'utf8'));
    assert.equal(info.CFBundleExecutable, 'Inklet'); assert.equal(info.CFBundleShortVersionString, report.version); assert.equal(info.LSMinimumSystemVersion, '13.0');
    assert.equal(info.CFBundleDocumentTypes[0].CFBundleTypeRole, 'Editor'); assert.deepEqual(info.CFBundleDocumentTypes[0].CFBundleTypeExtensions, ['md', 'markdown']);
    const executablePath = path.join(contents, 'MacOS/Inklet');
    const executableStat = await fs.stat(executablePath);
    assert.equal(executableStat.mode & 0o111, 0o111);
    const binary = await fs.readFile(executablePath);
    assert.equal(binary.readUInt32LE(0), 0xfeedfacf); assert.equal(binary.readUInt32LE(4), report.architecture === 'arm64' ? 0x0100000c : 0x01000007);
    async function walk(directory) {
      for (const entry of await fs.readdir(directory)) {
        const full = path.join(directory, entry);
        const stat = await fs.lstat(full);
        fileCount++;
        if (stat.isSymbolicLink()) {
          linkCount++;
          const target = path.resolve(path.dirname(full), await fs.readlink(full));
          assert.ok(target.startsWith(bundle + path.sep), 'Link must stay inside the app: ' + full);
          await fs.stat(target);
        } else if (stat.isDirectory()) await walk(full);
      }
    }
    await walk(bundle);
    assert.ok(linkCount > 0, 'macOS framework symbolic links must be preserved');
    await fs.stat(path.join(contents, 'Resources/Markdown.icns'));
    packed = path.join(contents, 'Resources/app.asar');
  } else {
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const prefix = 'Inklet.app/Contents/';
    const info = plist.parse(await zip.file(prefix + 'Info.plist').async('string'));
    assert.equal(info.CFBundleExecutable, 'Inklet'); assert.equal(info.CFBundleShortVersionString, report.version); assert.equal(info.LSMinimumSystemVersion, '13.0');
    assert.equal(info.CFBundleDocumentTypes[0].CFBundleTypeRole, 'Editor'); assert.deepEqual(info.CFBundleDocumentTypes[0].CFBundleTypeExtensions, ['md', 'markdown']);
    const executable = zip.file(prefix + 'MacOS/Inklet'); assert.ok(executable); assert.equal(Number(executable.unixPermissions) & 0o111, 0o111);
    const binary = await executable.async('nodebuffer'); assert.equal(binary.readUInt32LE(0), 0xfeedfacf); assert.equal(binary.readUInt32LE(4), report.architecture === 'arm64' ? 0x0100000c : 0x01000007);
    const links = Object.values(zip.files).filter(entry => (Number(entry.unixPermissions) & 0o170000) === 0o120000);
    assert.ok(links.length > 0, 'macOS framework symbolic links must not be lost on Windows');
    for (const entry of links) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(entry.name), await entry.async('string')));
      assert.ok(target.startsWith('Inklet.app/'), 'Link must stay inside the app: ' + entry.name);
      assert.ok(zip.files[target] || zip.files[target + '/'], 'Broken framework link: ' + entry.name);
    }
    assert.ok(zip.file(prefix + 'Resources/Markdown.icns'));
    fileCount = Object.keys(zip.files).length;
    linkCount = links.length;
    packed = path.join(temporary, 'app.asar'); await fs.writeFile(packed, await zip.file(prefix + 'Resources/app.asar').async('nodebuffer'));
  }
  const files = asar.listPackage(packed); assert.ok(files.includes('/src/main.cjs')); assert.ok(files.includes('/web/index.html')); assert.ok(!files.some(file => file.startsWith('/node_modules')));
  for (const name of ['main.cjs', 'preload.cjs', 'file-store.cjs', 'workspace-store.cjs', 'host-controller.cjs', 'security.cjs']) assert.deepEqual(asar.extractFile(packed, 'src/' + name), await fs.readFile(path.join(root, 'src', name)));
  const manifest = JSON.parse(asar.extractFile(packed, 'web/build-manifest.json').toString()); assert.equal(manifest.variant, report.variant); assert.equal(manifest.sharedVersion, report.version);
  const scripts = files.filter(file => file.startsWith('/web/') && file.endsWith('.js')).map(file => asar.extractFile(packed, file.slice(1)).toString());
  assert.ok(scripts.some(source => source.includes('inkletNative')));
  assert.equal(scripts.some(source => source.includes('\u8f6f\u4ef6\u514d\u8d39\u4f7f\u7528\uff0c\u6253\u8d4f\u5b8c\u5168\u81ea\u613f')), false);
  const result = { result: 'STRUCTURE-VERIFIED', archive, architecture: report.architecture, variant: report.variant, files: fileCount, frameworkLinks: linkCount, asarEntries: files.length, sha256: report.sha256, macHardwareVerified: process.platform === 'darwin' };
  await fs.writeFile(archive + '.verification.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await fs.rm(temporary, { recursive: true, force: true }); }