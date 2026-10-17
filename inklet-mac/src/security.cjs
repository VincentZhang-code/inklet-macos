'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const APP_URL = 'inklet://app/index.html';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
function trustedPage(value) { try { const url = new URL(value); return url.protocol === 'inklet:' && url.hostname === 'app' && url.pathname === '/index.html' && !url.username && !url.password && !url.port && !url.search; } catch { return false; } }
function allowedResource(value, host = 'app') { try { const url = new URL(value); return ['data:', 'blob:'].includes(url.protocol) || url.protocol === 'inklet:' && url.hostname === host && !url.username && !url.password && !url.port; } catch { return false; } }
async function resourceFile(directory, value) {
  const url = new URL(value); if (url.protocol !== 'inklet:' || url.hostname !== 'app' || url.username || url.password || url.port) throw new Error('Untrusted resource origin.');
  const relative = decodeURIComponent(url.pathname).replace(/^\//, ''); if (relative.includes('\0') || relative.includes('\\') || relative.includes(':')) throw new Error('Invalid resource path.');
  const root = await fs.realpath(directory); const file = await fs.realpath(path.resolve(root, relative)); const within = path.relative(root, file);
  if (!within || within === '..' || within.startsWith('..' + path.sep) || path.isAbsolute(within)) throw new Error('Resource is outside the application.');
  if (!(await fs.stat(file)).isFile()) throw new Error('Resource is not a regular file.'); return file;
}
module.exports = { APP_URL, CSP, trustedPage, allowedResource, resourceFile };