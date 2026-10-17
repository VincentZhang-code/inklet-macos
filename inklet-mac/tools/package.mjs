import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { downloadArtifact } from '@electron/get';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const editor = path.resolve(process.env.INKLET_EDITOR_ROOT || path.join(root, '../inklet'));
const JSZip = require('jszip');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const variant = 'standard';
if (process.platform !== 'darwin' && !process.argv.includes('--prepare-only')) throw new Error('Create final macOS apps on a Mac. This Windows host cannot create framework symbolic links; no elevation or security bypass is attempted.');
const archArgument = process.argv.find(argument => argument.startsWith('--arch='));
const architecture = archArgument ? archArgument.slice(7) : 'arm64';
if (!['arm64', 'x64'].includes(architecture)) throw new Error('Use --arch=arm64 or --arch=x64.');
for (const argument of process.argv.slice(2)) if (argument !== '--prepare-only' && argument !== '--arch=arm64' && argument !== '--arch=x64') throw new Error('Unsupported packaging option: ' + argument);
const web = path.join(root, 'web');
const manifest = JSON.parse(await fs.readFile(path.join(web, 'build-manifest.json'), 'utf8'));
if (manifest.version !== metadata.version || manifest.sharedVersion !== metadata.version || manifest.variant !== variant) throw new Error('Editor version or edition differs from the requested package.');
const staging = path.join(root, 'build', 'stage-' + variant);
await fs.rm(staging, { recursive: true, force: true }); await fs.mkdir(staging, { recursive: true });
await fs.cp(path.join(root, 'src'), path.join(staging, 'src'), { recursive: true });
await fs.cp(web, path.join(staging, 'web'), { recursive: true });
const selfContained = await fs.stat(path.join(root, 'assets/inklet.png')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
await fs.cp(path.join(selfContained ? root : editor, 'licenses'), path.join(staging, 'licenses'), { recursive: true });
await fs.copyFile(path.join(root, 'node_modules/electron/LICENSE'), path.join(staging, 'licenses/Electron-LICENSE.txt'));
await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify({ name: metadata.name, productName: metadata.productName, version: metadata.version, main: metadata.main, license: metadata.license }, null, 2));
const icons = path.join(root, 'build/icons'); await fs.mkdir(icons, { recursive: true });
async function createIcns(source, destination) {
  const png = await fs.readFile(source);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) throw new Error('Brand icon must be the verified 256px PNG.');
  const header = Buffer.alloc(16); header.write('icns', 0); header.writeUInt32BE(png.length + 16, 4); header.write('ic08', 8); header.writeUInt32BE(png.length + 8, 12);
  await fs.writeFile(destination, Buffer.concat([header, png]));
}
await createIcns(path.join(selfContained ? root : editor, 'assets/inklet.png'), path.join(icons, 'Inklet.icns'));
await createIcns(path.join(selfContained ? root : editor, 'assets/markdown-document.png'), path.join(icons, 'Markdown.icns'));
const info = {
  CFBundleDisplayName: 'Inklet', LSMinimumSystemVersion: '13.0', NSHighResolutionCapable: true,
  CFBundleDocumentTypes: [{ CFBundleTypeName: 'Markdown document', CFBundleTypeRole: 'Editor', LSHandlerRank: 'Alternate', CFBundleTypeExtensions: ['md', 'markdown'], LSItemContentTypes: ['net.daringfireball.markdown'], CFBundleTypeIconFile: 'Markdown.icns' }],
  UTImportedTypeDeclarations: [{ UTTypeIdentifier: 'net.daringfireball.markdown', UTTypeDescription: 'Markdown document', UTTypeConformsTo: ['public.plain-text'], UTTypeTagSpecification: { 'public.filename-extension': ['md', 'markdown'], 'public.mime-type': ['text/markdown'] } }],
};
const plan = { version: metadata.version, electron: metadata.devDependencies.electron, architecture, variant, macOSMinimum: '13.0', appBundleId: process.env.INKLET_BUNDLE_ID || 'local.inklet.desktop', info, sourceManifest: manifest, nativeMacValidation: false };
await fs.writeFile(path.join(staging, 'package-plan.json'), JSON.stringify(plan, null, 2));
if (process.argv.includes('--prepare-only')) { console.log(JSON.stringify({ result: 'PREPARED', staging, ...plan, sourceManifest: undefined })); process.exit(0); }
const buildId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.join(root, 'build', 'package-' + variant + '-' + architecture + '-' + buildId);
const archiveName = 'electron-v' + metadata.devDependencies.electron + '-darwin-' + architecture + '.zip';
const offlineArchive = path.join(root, 'runtime', archiveName);
const hasOffline = await fs.stat(offlineArchive).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const officialArchive = hasOffline ? offlineArchive : await downloadArtifact({ version: metadata.devDependencies.electron, platform: 'darwin', arch: architecture, artifactName: 'electron', checksums: require('electron/checksums.json'), quiet: true });
const runtimeHash = createHash('sha256'); for await (const chunk of createReadStream(officialArchive)) runtimeHash.update(chunk);
if (runtimeHash.digest('hex') !== require('electron/checksums.json')[archiveName]) throw new Error('Official Electron runtime checksum mismatch.');
const signingIdentity = process.platform === 'darwin' ? process.env.INKLET_SIGN_IDENTITY : null;
const notarizationProfile = process.platform === 'darwin' ? process.env.INKLET_NOTARY_PROFILE : null;
if (notarizationProfile && !signingIdentity) throw new Error('Notarization requires an authorized Developer ID signing identity.');
const macSign = signingIdentity ? { identity: signingIdentity, continueOnError: false } : {
  identity: '-', identityValidation: false, continueOnError: false,
  preAutoEntitlements: false, preEmbedProvisioningProfile: false,
  optionsForFile: () => ({ timestamp: 'none' }),
};
const packages = await packager({
  dir: staging, out: output, name: 'Inklet', executableName: 'Inklet', platform: 'darwin', arch: architecture,
  electronVersion: metadata.devDependencies.electron, appVersion: metadata.version, buildVersion: metadata.version,
  appBundleId: plan.appBundleId, appCategoryType: 'public.app-category.productivity',
  icon: path.join(icons, 'Inklet.icns'), extraResource: [path.join(icons, 'Markdown.icns')], extendInfo: info,
  asar: true, prune: false, overwrite: false, darwinDarkModeSupport: true,
  download: { checksums: require('electron/checksums.json'), quiet: true },
  ...(hasOffline ? { electronZipDir: path.dirname(offlineArchive) } : {}),
  ...(process.platform === 'darwin' ? { osxSign: macSign } : {}),
  ...(notarizationProfile ? { osxNotarize: { keychainProfile: notarizationProfile } } : {}),
});
if (!packages.length) throw new Error('The official packager did not create an application. Use a Mac for final packaging.');
const bundle = path.join(packages[0], 'Inklet.app');
if (process.platform === 'darwin') {
  const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  if (verified.status !== 0) throw new Error('macOS code signature verification failed.');
}
const release = path.join(root, 'release'); await fs.mkdir(release, { recursive: true });
const label = 'Inklet-' + metadata.version + '-mac-' + architecture + (notarizationProfile ? '' : '-unsigned');
const zipPath = path.join(release, label + '.zip');
if (await fs.stat(zipPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Release already exists; archive it explicitly before rebuilding this version.');
if (process.platform === 'darwin') {
  const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zipPath], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('macOS ZIP creation failed.');
} else {
  const zip = new JSZip();
  async function add(directory, prefix) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name); const relative = prefix + '/' + entry.name; const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) zip.file(relative, await fs.readlink(file), { unixPermissions: 0o120777 });
      else if (stat.isDirectory()) { zip.file(relative + '/', null, { dir: true, unixPermissions: 0o40755 }); await add(file, relative); }
      else {
        const handle = await fs.open(file, 'r'); const magic = Buffer.alloc(4); await handle.read(magic, 0, 4, 0); await handle.close();
        const executable = ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(magic.toString('hex')) || relative.includes('/Contents/MacOS/');
        zip.file(relative, createReadStream(file), { binary: true, unixPermissions: executable ? 0o100755 : 0o100644 });
      }
    }
  }
  await add(bundle, 'Inklet.app');
  const official = await JSZip.loadAsync(await fs.readFile(officialArchive));
  for (const entry of Object.values(official.files)) {
    if ((Number(entry.unixPermissions) & 0o170000) === 0o120000 && entry.name.startsWith('Electron.app/')) {
      const name = entry.name.replace(/^Electron\.app\//, 'Inklet.app/');
      if (!zip.file(name)) zip.file(name, await entry.async('nodebuffer'), { binary: true, unixPermissions: entry.unixPermissions });
    } else if (!entry.dir && !entry.name.startsWith('Electron.app/') && /(^|\/)(LICENSE[^/]*|LICENSES[^/]*)$/i.test(entry.name)) {
      zip.file('Inklet.app/Contents/Resources/licenses/' + path.posix.basename(entry.name), await entry.async('nodebuffer'), { binary: true, unixPermissions: 0o100644 });
    }
  }
  await pipeline(zip.generateNodeStream({ platform: 'UNIX', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }), createWriteStream(zipPath, { flags: 'wx' }));
}
const digest = createHash('sha256'); for await (const chunk of createReadStream(zipPath)) digest.update(chunk);
const report = { ...plan, sourceManifest: undefined, bundle, archive: zipPath, bytes: (await fs.stat(zipPath)).size, sha256: digest.digest('hex'), builtOn: process.platform, signing: notarizationProfile ? 'developer-id-notarized' : signingIdentity ? 'developer-id-not-notarized' : process.platform === 'darwin' ? 'ad-hoc' : 'unsigned', macHardwareVerified: false };
await fs.writeFile(zipPath + '.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: 'PACKAGED', ...report }));