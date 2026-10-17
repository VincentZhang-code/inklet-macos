import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editor = path.resolve(process.env.INKLET_EDITOR_ROOT || path.join(project, '../inklet'));
const appRoot = path.join(editor, 'app');
const require = createRequire(path.join(appRoot, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
if (process.argv.length > 2) throw new Error('The macOS editor build does not accept edition options.');
const output = path.join(project, 'web');
const normalize = value => value.replaceAll('\\', '/').split('?')[0];
const mainFile = normalize(path.join(appRoot, 'src/inklet.js'));
const exportFile = normalize(path.join(appRoot, 'src/export-document.js'));
const renderersFile = normalize(path.join(appRoot, 'src/renderers.js'));
const shortcutFile = normalize(path.join(editor, 'core/shortcuts.mjs'));
const usedSources = new Map();
function replaceRequired(source, before, after) { if (!source.includes(before)) throw new Error('Shared editor changed; inspect Mac adaptation: ' + before); return source.replace(before, after); }

await build({
  root: appRoot, configFile: path.join(appRoot, 'vite.config.js'), mode: 'production',
  plugins: [{
    name: 'inklet-mac-desktop', enforce: 'pre',
    resolveId(id, importer) { if (id === './bridge.js' && importer && normalize(importer) === mainFile) return path.join(project, 'web-src/bridge.js'); },
    transform(source, id) {
      const file = normalize(id);
      if (file.startsWith(normalize(editor) + '/') && !file.includes('/node_modules/')) usedSources.set(path.relative(editor, file).replaceAll('\\', '/'), createHash('sha256').update(source).digest('hex'));
      if (file === shortcutFile) return source.replaceAll('Ctrl', 'Cmd').replace('event.ctrlKey || event.metaKey', 'event.metaKey');
      if (file === renderersFile) {
        const normalized = source.replaceAll('\r\n', '\n');
        return replaceRequired(
          normalized,
          "  const observer = new IntersectionObserver(entries => {\n    if (!entries.some(entry => entry.isIntersecting)) return;\n    observer.disconnect();\n    const render = async () => {\n      if (!element.isConnected || element.dataset.renderKey !== key) return;\n      try {\n        const svg = await renderMarkup(kind, value, theme);\n        if (element.isConnected && element.dataset.renderKey === key) {\n          element.innerHTML = svg;\n          element.dataset.rendered = 'true';\n        }\n      } catch (error) {\n        cache.delete(key);\n        if (element.dataset.renderKey === key) {\n          element.textContent = value + '\\n\\n' + error.message;\n          element.dataset.rendered = 'error';\n        }\n      }\n    };\n    if ('requestIdleCallback' in window) requestIdleCallback(render, { timeout: 400 });\n    else setTimeout(render, 0);\n  }, { rootMargin: '160px' });\n  observer.observe(element);\n  return () => observer.disconnect();",
          "  let started = false;\n  let disposed = false;\n  const render = async () => {\n    if (disposed || !element.isConnected || element.dataset.renderKey !== key) return;\n    try {\n      const svg = await renderMarkup(kind, value, theme);\n      if (!disposed && element.isConnected && element.dataset.renderKey === key) { element.innerHTML = svg; element.dataset.rendered = 'true'; }\n    } catch (error) {\n      cache.delete(key);\n      if (!disposed && element.dataset.renderKey === key) { element.textContent = value + '\\n\\n' + error.message; element.dataset.rendered = 'error'; }\n    }\n  };\n  const begin = () => {\n    if (started || disposed || !element.isConnected || element.dataset.renderKey !== key || element.dataset.rendered !== 'pending') return;\n    started = true; observer.disconnect(); setTimeout(render, 0);\n  };\n  const checkVisible = () => {\n    const rect = element.getBoundingClientRect();\n    if (rect.bottom >= -240 && rect.top <= (window.innerHeight || 900) + 240) begin();\n  };\n  const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) begin(); }, { rootMargin: '240px' });\n  observer.observe(element);\n  requestAnimationFrame(checkVisible);\n  const timer = setTimeout(checkVisible, 80);\n  window.addEventListener('scroll', checkVisible, true);\n  return () => { disposed = true; clearTimeout(timer); window.removeEventListener('scroll', checkVisible, true); observer.disconnect(); };"
        );
      }
      if (file === exportFile) {
        source = replaceRequired(source, "const body = document.createElement('main');", "const inertDocument = document.implementation.createHTMLDocument('');\n  const body = inertDocument.createElement('main');");
        return replaceRequired(source, 'serializeFragment(parsed.doc.content)', 'serializeFragment(parsed.doc.content, { document: inertDocument })');
      }
      if (file !== mainFile) return null;
      source = replaceRequired(source, "toast('\u5df2\u6253\u5f00 Windows \u9ed8\u8ba4\u5e94\u7528\u8bbe\u7f6e')", "toast('\u9ed8\u8ba4\u6253\u5f00\u65b9\u5f0f\u7531 Finder \u7ba1\u7406')");
      source = source.replaceAll("'Microsoft YaHei'", "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei'");
      source = replaceRequired(source, "if (!event.ctrlKey || event.altKey || event.metaKey || !event.deltaY", "if (!(event.metaKey || event.ctrlKey) || event.altKey || !event.deltaY");
      source += `\nwindow.addEventListener('inklet:command', event => {\n  const command = event.detail?.command;\n  if (['undo', 'redo'].includes(command) && document.activeElement?.matches('input,textarea')) { document.execCommand(command); return; }\n  if (document.querySelector('dialog[open]') || workspaceBusy || closingWorkspace) return;\n  if (command === 'close-document') closeDocuments([recoveryDocumentId]).catch(showError);\n  else action(command).catch(showError);\n});\n`;
      return { code: source, map: null };
    },
  }],
  build: { outDir: output, emptyOutDir: true, target: 'es2022' },
});
const manifest = { version: JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8')).version, sharedVersion: JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8')).version, variant: 'standard', createdAt: new Date().toISOString(), sources: Object.fromEntries([...usedSources].sort()) };
await fs.writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ result: 'BUILT', ...manifest, sources: Object.keys(manifest.sources).length, output }));