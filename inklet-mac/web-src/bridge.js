export const desktop = true;
let activeDocumentId = null;
let pointer = null;
export function selectDocument(id) { activeDocumentId = id; }
export async function digest(text) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); }
window.inkletNative.onEvent(message => { if (typeof message.event === 'string') window.dispatchEvent(new CustomEvent('inklet:' + message.event, { detail: message.data })); });
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.target.closest('[data-document-open]')) return;
  pointer = { id: event.pointerId, target: event.target.closest('[data-document-open]') };
}, true);
async function finishDrag(args) {
  const captured = pointer; if (!captured) return { outside: false };
  try { captured.target.setPointerCapture(captured.id); } catch { return { outside: false }; }
  return new Promise((resolve, reject) => {
    let timeout;
    const complete = async event => {
      if (event && event.pointerId !== undefined && event.pointerId !== captured.id) return;
      document.removeEventListener('pointerup', complete, true); document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('keydown', escape, true); clearTimeout(timeout);
      if (captured.target.hasPointerCapture(captured.id)) captured.target.releasePointerCapture(captured.id);
      pointer = null;
      if (!event || event.type !== 'pointerup') { resolve({ outside: false }); return; }
      try { resolve(await window.inkletNative.invoke('dragDocument', args)); } catch (error) { reject(error); }
    };
    const cancel = event => complete(event);
    const escape = event => { if (event.key === 'Escape') complete(null); };
    document.addEventListener('pointerup', complete, true); document.addEventListener('pointercancel', cancel, true); document.addEventListener('keydown', escape, true);
    timeout = setTimeout(() => complete(null), 45000);
  });
}
export function call(command, args = {}) { const payload = { documentId: activeDocumentId, ...args }; return command === 'dragDocument' ? finishDrag(payload) : window.inkletNative.invoke(command, payload); }
export function assetUrl(source, documentId = activeDocumentId) {
  if (/^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(source)) return source;
  if (/^(https?:|javascript:|data:|\/\/|\\\\)/i.test(source)) return '';
  return 'inklet://app/image?' + new URLSearchParams({ document: documentId || '', path: source.replaceAll('\\', '/') });
}