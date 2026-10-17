import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.inklet-prose')).toBeVisible();
  await page.waitForFunction(() => !!window.inkletTest);
});

test('navigation sidebar resizes from its default minimum and keeps its width after collapse and reload', async ({ page }) => {
  const source = '# A long document heading that benefits from a wider navigation panel\n\nUnchanged document body.';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const sidebar = page.locator('.sidebar');
  const handle = page.locator('#sidebar-resizer');
  const minimum = (await sidebar.boundingBox()).width;
  const start = await handle.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + 160);
  await page.mouse.down(); await page.mouse.move(start.x + start.width / 2 + 180, start.y + 160, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBeCloseTo(minimum + 180, 0);
  await expect(handle).toHaveAttribute('aria-valuenow', String(minimum + 180));
  await page.locator('.sidebar-heading [data-action="sidebar"]').click();
  await expect(sidebar).toBeHidden();
  await page.locator('.toolbar [data-action="sidebar"]').click();
  expect((await sidebar.boundingBox()).width).toBeCloseTo(minimum + 180, 0);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await page.reload(); await expect(page.locator('.inklet-prose')).toBeVisible();
  expect((await sidebar.boundingBox()).width).toBeCloseTo(minimum + 180, 0);
  await handle.focus(); await page.keyboard.press('Home');
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBe(minimum);
  await page.keyboard.press('ArrowLeft');
  expect((await sidebar.boundingBox()).width).toBe(minimum);
  await page.setViewportSize({ width: 820, height: 860 });
  await handle.focus(); await page.keyboard.press('End');
  expect((await page.locator('.main-area').boundingBox()).width).toBeGreaterThanOrEqual(399);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('navigation sidebar handles right placement, cancelled resize and mobile bounds', async ({ page }, testInfo) => {
  await page.locator('[data-action="settings"]').click();
  await page.locator('#outline-side-input').selectOption('right'); await page.keyboard.press('Escape');
  const sidebar = page.locator('.sidebar'); const handle = page.locator('#sidebar-resizer');
  const minimum = (await sidebar.boundingBox()).width;
  let box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 170); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 150, box.y + 170, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBe(minimum + 150);
  const width = (await sidebar.boundingBox()).width;
  box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 170); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + 170, { steps: 4 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await sidebar.boundingBox()).width).toBe(width);
  await page.screenshot({ path: testInfo.outputPath('navigation-right-resized.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  expect((await sidebar.boundingBox()).width).toBe(218);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect.poll(async () => (await sidebar.boundingBox()).width).toBe(width);
});

test('navigation outline follows the reading chapter without scrolling the document from the sidebar', async ({ page }) => {
  const source = Array.from({ length: 80 }, (_, index) => '## Chapter ' + String(index).padStart(3, '0') + '\n\n' + ('A paragraph in chapter ' + index + ' with readable text. ').repeat(12) + '\n\n').join('');
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('.view-tools [data-action="source"]').click();
  await page.locator('[data-action="settings"]').click();
  await page.locator('#sync-input').uncheck(); await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.navigationBaseline = { parsed: window.inkletTest.richEditor.parsed, item: document.querySelector('.outline-item') };
    const pane = document.querySelector('#rich-editor');
    const heading = document.querySelectorAll('.inklet-prose h2')[55];
    pane.scrollTop += heading.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
  });
  const active = page.locator('.outline-item[aria-current="location"]');
  await expect.poll(async () => {
    const expected = await page.evaluate(() => {
      const top = document.querySelector('#rich-editor').getBoundingClientRect().top + 32;
      return [...document.querySelectorAll('.inklet-prose h2')].filter(heading => heading.getBoundingClientRect().top <= top).at(-1)?.textContent;
    });
    return expected && (await active.textContent()) === expected;
  }).toBe(true);
  expect(Number(await active.getAttribute('data-outline-from'))).toBeGreaterThan(source.indexOf('## Chapter 040'));
  const nav = page.locator('#outline');
  await expect.poll(() => nav.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  const target = await active.boundingBox(); const viewport = await nav.boundingBox();
  expect(target.y).toBeGreaterThanOrEqual(viewport.y);
  expect(target.y + target.height).toBeLessThanOrEqual(viewport.y + viewport.height);
  const before = await page.locator('#rich-editor').evaluate(element => element.scrollTop);
  await nav.evaluate(element => { element.scrollTop = 0; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator('#rich-editor').evaluate(element => element.scrollTop)).toBe(before);
  await page.locator('.outline-item').filter({ hasText: /^Chapter 010$/ }).click();
  await expect(active).toHaveText('Chapter 010');
  await page.locator('#rich-editor').hover(); await page.mouse.wheel(0, 1200);
  await expect(active).not.toHaveText('Chapter 010');
  expect(await page.evaluate(() => window.navigationBaseline.parsed === window.inkletTest.richEditor.parsed && window.navigationBaseline.item === document.querySelector('.outline-item'))).toBe(true);
  await page.locator('[data-tab="marks"]').click();
  await expect(async () => {
    await page.locator('#rich-editor').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.locator('#rich-editor').evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  }).toPass({ timeout: 5000 });
  await expect(page.locator('#marks-list')).toBeVisible();
  await page.locator('[data-tab="outline"]').click();
  await expect(active).toHaveText('Chapter 079');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await page.evaluate(() => window.inkletTest.add({ id: 'outline-other', name: 'Other.md', text: '# Other document\n\nBody.' }));
  await page.locator('[data-tab="outline"]').click();
  await expect(active).toHaveText('Other document');
});

test('navigation outline refreshes after delayed content layout without a new user scroll', async ({ page }) => {
  const source = Array.from({ length: 60 }, (_, index) => '## Delayed ' + index + '\n\n' + 'Content for a layout change. '.repeat(10) + '\n\n').join('');
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('.view-tools [data-action="source"]').click();
  await page.addStyleTag({ content: '.inklet-prose > * { content-visibility: visible !important; }' });
  await page.evaluate(() => {
    const pane = document.querySelector('#rich-editor'); pane.style.overflowAnchor = 'none';
    const heading = document.querySelectorAll('.inklet-prose h2')[35];
    pane.scrollTop += heading.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
  });
  const active = page.locator('.outline-item[aria-current="location"]');
  await expect(active).toContainText('Delayed');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await active.textContent();
  const scrollTop = await page.locator('#rich-editor').evaluate(element => element.scrollTop);
  await page.addStyleTag({ content: '.inklet-prose > p:first-of-type { height: 1600px !important; }' });
  await expect.poll(() => page.locator('.inklet-prose > p').first().evaluate(element => element.getBoundingClientRect().height)).toBe(1600);
  await expect.poll(async () => {
    const expected = await page.evaluate(() => {
      const top = document.querySelector('#rich-editor').getBoundingClientRect().top + 32;
      return [...document.querySelectorAll('.inklet-prose h2')].filter(heading => heading.getBoundingClientRect().top <= top).at(-1)?.textContent;
    });
    return (await active.textContent()) === expected && expected !== before;
  }).toBe(true);
  expect(await page.locator('#rich-editor').evaluate(element => element.scrollTop)).toBe(scrollTop);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('relative image URLs preserve parent paths and special characters inside the document scope', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        let result = true;
        if (message.command === 'hello') result = { document: { id: 'image-owner', name: 'Images.md', text: '# Images' }, settings: {} };
        queueMicrotask(() => handlers.forEach(handler => handler({ data: { id: message.id, result } })));
      },
    };
  });
  await page.reload(); await page.waitForFunction(() => !!window.inkletTest);
  const result = await page.evaluate(async () => {
    const { assetUrl } = await import('/src/bridge.js');
    const reference = '../../images/P02%20%23100%25%20%E4%B8%AD.svg';
    const url = new URL(assetUrl(reference, 'image-owner'));
    return { pathname: url.pathname, document: url.searchParams.get('document'), reference: url.searchParams.get('path'), expected: reference };
  });
  expect(result.pathname).toBe('/image');
  expect(result.document).toBe('image-owner');
  expect(result.reference).toBe(result.expected);
});

test('relative images load immediately without authorization or rewriting their source', async ({ page }) => {
  await page.route('https://inklet-files.local/**', route => {
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="green"/></svg>' });
  });
  await page.addInitScript(() => {
    const handlers = [];
    window.imageFixture = '# Images\n\n![Parent](../../images/P02.svg)';
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        let result = true;
        if (message.command === 'hello') result = { document: { id: 'relative-owner', name: 'Images.md', text: window.imageFixture }, settings: {} };
        queueMicrotask(() => handlers.forEach(handler => handler({ data: { id: message.id, result } })));
      },
    };
  });
  await page.reload(); await page.waitForFunction(() => !!window.inkletTest);
  const image = page.locator('.inklet-prose img:not(.ProseMirror-separator)');
  await image.scrollIntoViewIfNeeded();
  await expect(page.locator('[data-action="authorize-images"]')).toHaveCount(0);
  await expect.poll(() => image.evaluate(image => image.complete && image.naturalWidth === 80)).toBe(true);
  await expect(page.locator('#image-access')).toBeHidden();
  await expect(page.locator('#dirty-dot')).toBeHidden();
  expect(await page.evaluate(() => window.inkletTest.source === window.imageFixture)).toBe(true);
});

test('embedded saving requires consent, preserves cancellation and writes portable Markdown', async ({ page }) => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  await page.addInitScript(png => {
    const handlers = [];
    window.savedImageMarkdown = null; window.cancelImageSave = true;
    window.imageFixture = '# Embedded\n\n![Original](../assets/example.png)\n\nUnchanged paragraph.';
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        let result = true;
        if (message.command === 'hello') result = { workspace: true, document: { id: 'embed-save', name: 'Embed.md', path: 'C:\\docs\\Embed.md', text: window.imageFixture }, settings: JSON.parse(localStorage.getItem('embed-settings') || '{}') };
        if (message.command === 'settings') localStorage.setItem('embed-settings', JSON.stringify(message.args));
        if (message.command === 'readAsset') result = { mime: 'image/png', data: png };
        if (message.command === 'draft' || message.command === 'draftDelta') result = { persisted: true, documentId: message.args.documentId, revision: message.args.revision };
        if (message.command === 'save') {
          if (window.cancelImageSave) result = null;
          else { window.savedImageMarkdown = message.args.text; result = { name: 'Embed.md', path: 'C:\\docs\\Embed.md', hash: 'saved' }; }
        }
        const error = message.command === 'readAsset' && window.missingEmbedImage ? 'Missing image fixture' : undefined;
        queueMicrotask(() => handlers.forEach(handler => handler({ data: { id: message.id, result, error } })));
      },
    };
  }, png);
  await page.reload(); await page.waitForFunction(() => !!window.inkletTest);
  await page.locator('[data-action="settings"]').click();
  const toggle = page.locator('#embed-images-input');
  await expect(toggle).not.toBeChecked(); await toggle.click();
  const warning = page.locator('#embed-warning-dialog');
  await expect(warning).toBeVisible(); await expect(warning).toContainText('三分之一'); await expect(warning).toContainText('GitHub');
  await warning.locator('button[value="cancel"]').last().click(); await expect(toggle).not.toBeChecked();
  await toggle.click(); await warning.locator('button[value="enable"]').click(); await expect(toggle).toBeChecked();
  await page.keyboard.press('Escape');
  await page.locator('.header-actions [data-action="save"]').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#workspace').inert)).toBe(false);
  expect(await page.evaluate(() => window.inkletTest.source === window.imageFixture)).toBe(true);
  expect(await page.evaluate(() => window.savedImageMarkdown)).toBeNull();
  await page.evaluate(() => { window.missingEmbedImage = true; window.cancelImageSave = false; });
  await page.locator('.header-actions [data-action="save"]').click();
  await expect(page.locator('#toast')).toContainText('Missing image fixture');
  expect(await page.evaluate(() => window.inkletTest.source === window.imageFixture)).toBe(true);
  expect(await page.evaluate(() => window.savedImageMarkdown)).toBeNull();
  await expect(page.locator('#workspace')).toHaveJSProperty('inert', false);
  await page.evaluate(() => { window.missingEmbedImage = false; });
  await page.evaluate(() => { window.cancelImageSave = false; });
  await page.evaluate(() => window.inkletTest.select(window.inkletTest.source.length, window.inkletTest.source.length));
  await page.locator('.header-actions [data-action="save"]').click();
  await expect.poll(() => page.evaluate(() => window.savedImageMarkdown)).toContain('data:image/png;base64,');
  expect(await page.evaluate(() => window.inkletTest.source === window.savedImageMarkdown)).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.sourceEditor.view.state.selection.main.head)).toBe((await page.evaluate(() => window.savedImageMarkdown)).length);
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await page.locator('[data-action="undo"]').click();
  expect(await page.evaluate(() => window.inkletTest.source === window.imageFixture)).toBe(true);
  await page.reload(); await page.locator('[data-action="settings"]').click();
  await expect(toggle).toBeChecked();
});

test('embedded SVG conversion preserves its intrinsic display size', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { prepareEmbeddedAsset } = await import('/src/export-document.js');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="green"/></svg>';
    const asset = await prepareEmbeddedAsset({ mime: 'image/svg+xml', data: btoa(svg) });
    const image = new Image(); image.src = 'data:' + asset.mime + ';base64,' + asset.data; await image.decode();
    return { mime: asset.mime, width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(result).toEqual({ mime: 'image/png', width: 160, height: 80 });
});

test('workspace keeps independent documents, undo, outline and marks while switching', async ({ page }) => {
  await page.evaluate(() => window.inkletTest.add({ id: 'alpha', name: 'Alpha.md', text: '# Alpha\n\nAlpha body.' }));
  await page.evaluate(() => window.inkletTest.select(9, 14));
  await page.locator('[data-color="blue"]').first().click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' extra');
  await page.evaluate(() => window.inkletTest.add({ id: 'beta', name: 'Beta.md', text: '# Beta\n\nBeta body.' }));
  await expect(page.locator('#workspace-count')).toHaveText('3');
  await expect(page.locator('.workspace-file')).toHaveCount(3);
  await expect(page.locator('.workspace-file[data-document-id="alpha"] .workspace-dirty')).toBeVisible();
  await page.locator('[data-tab="outline"]').click();
  await expect(page.locator('#outline')).toContainText('Beta');
  await expect(page.locator('#outline')).not.toContainText('Alpha');
  await page.locator('[data-tab="marks"]').click();
  await expect(page.locator('#mark-count')).toHaveText('0');
  await page.locator('[data-tab="workspace"]').click();
  await page.locator('[data-document-open="alpha"]').click();
  await expect(page.locator('.inklet-prose')).toContainText('extra');
  await expect(page.locator('#mark-count')).toHaveText('1');
  await page.locator('[data-tab="outline"]').click();
  await expect(page.locator('#outline')).toContainText('Alpha');
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator('.inklet-prose')).not.toContainText('extra');
  expect(await page.evaluate(() => window.inkletTest.workspace.entries.get('beta').state.session.source)).toBe('# Beta\n\nBeta body.');
  await expect(page.locator('.cm-editor')).toHaveCount(1);
  await expect(page.locator('.inklet-prose')).toHaveCount(1);
});

test('workspace closes individual and all files only after explicit unsaved decisions', async ({ page }) => {
  await page.evaluate(() => window.inkletTest.add({ id: 'first-close', name: 'First.md', text: '# First' }));
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' dirty');
  await page.evaluate(() => window.inkletTest.add({ id: 'second-close', name: 'Second.md', text: '# Second' }));
  await page.locator('[data-document-close="first-close"]').click();
  await expect(page.locator('#workspace-close-dialog')).toBeVisible();
  await expect(page.locator('.workspace-close-row select')).toHaveCSS('font-size', '13px');
  await expect(page.locator('.workspace-close-row select option').last()).toHaveCSS('font-size', '13px');
  await expect(page.locator('.workspace-close-row select')).toHaveCSS('height', '34px');
  await page.locator('[data-close-choice="cancel"]').click();
  await expect(page.locator('.workspace-file[data-document-id="first-close"]')).toBeVisible();
  await page.locator('[data-document-close="first-close"]').click();
  await page.locator('[data-close-choice="discard"]').click();
  await expect(page.locator('.workspace-file[data-document-id="first-close"]')).toHaveCount(0);
  await expect(page.locator('#file-name')).toHaveText('Second.md');
  await page.locator('[data-action="close-workspace"]').click();
  await expect(page.locator('#workspace-count')).toHaveText('0');
  await expect(page.locator('.inklet-prose')).toHaveText('');
  await page.locator('.cm-content').click(); await page.keyboard.insertText('new draft');
  await expect(page.locator('#workspace-count')).toHaveText('1');
});

test('workspace restores cold sessions without creating extra editors and fits narrow sidebars', async ({ page }, testInfo) => {
  for (let index = 0; index < 7; index++) await page.evaluate(index => window.inkletTest.add({ id: 'cold-' + index, name: 'File-' + index + '.md', text: '# Heading ' + index + '\n\nBody ' + index }), index);
  expect(await page.evaluate(() => [...window.inkletTest.workspace.entries.values()].filter(entry => entry.state).length)).toBeLessThanOrEqual(3);
  await page.locator('[data-document-open="cold-0"]').click();
  await expect(page.locator('.inklet-prose')).toContainText('Heading 0');
  await page.locator('[data-action="settings"]').click();
  await page.locator('#interface-family-input').selectOption('dark'); await page.keyboard.press('Escape');
  const contrast = await page.locator('.workspace-file.active').evaluate(element => {
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const context = canvas.getContext('2d');
    const luminance = color => {
      context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    const background = luminance(getComputedStyle(element).backgroundColor);
    const foreground = luminance(getComputedStyle(element.querySelector('.workspace-file-name')).color);
    return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
  });
  expect(contrast).toBeGreaterThan(4.5);
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 860 });
    const tabs = page.locator('.workspace-tabs');
    expect(await tabs.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('workspace-' + width + '.png') });
  }
  await expect(page.locator('.cm-editor')).toHaveCount(1);
});

test('workspace waits for composition and does not discard files on save cancellation', async ({ page }) => {
  await page.evaluate(() => window.inkletTest.add({ id: 'compose-first', name: 'First.md', text: '# First' }));
  await page.evaluate(() => window.inkletTest.add({ id: 'compose-second', name: 'Second.md', text: '# Second' }));
  await page.evaluate(() => document.querySelector('.cm-content').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.locator('[data-document-open="compose-first"]').click();
  await expect(page.locator('#file-name')).toHaveText('Second.md');
  await page.evaluate(() => document.querySelector('.cm-content').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(page.locator('#file-name')).toHaveText('First.md');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' unsaved');
  await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
  await page.locator('[data-action="close-workspace"]').click();
  await page.locator('[data-close-choice="save"]').click();
  await expect(page.locator('#workspace-close-dialog')).toBeHidden();
  await expect(page.locator('#workspace-count')).toHaveText('3');
  await expect(page.locator('.inklet-prose')).toContainText('unsaved');
  await expect(page.locator('#dirty-dot')).toBeVisible();
});

test('workspace native recovery callbacks never overwrite the newly selected session', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        let result = true;
        if (message.command === 'hello') result = { workspace: true, document: { id: 'native-first', name: 'First.md', text: '# First' }, settings: {} };
        if (message.command === 'draft' || message.command === 'draftDelta') result = { persisted: true, documentId: message.args.documentId, revision: message.args.revision };
        queueMicrotask(() => handlers.forEach(handler => handler({ data: { id: message.id, result } })));
      },
    };
  });
  await page.reload();
  await expect(page.locator('.inklet-prose')).toContainText('First');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' draft');
  await expect(page.locator('#save-state')).toHaveAttribute('data-recovery', 'protected');
  await page.evaluate(() => window.inkletTest.add({ id: 'native-second', name: 'Second.md', text: '# Second' }));
  await expect(page.locator('#file-name')).toHaveText('Second.md');
  await expect(page.locator('.inklet-prose')).toHaveText('Second');
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await page.locator('[data-document-open="native-first"]').click();
  await expect(page.locator('.inklet-prose')).toContainText('First draft');
  await expect(page.locator('#dirty-dot')).toBeVisible();
});

test('window mode persists and a failed detach keeps the source until acknowledgement', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = [];
    window.windowRequests = []; window.failDetach = true;
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        window.windowRequests.push(message.command);
        let result = true; let error;
        if (message.command === 'hello') result = { workspace: true, multipleWindows: true, document: { id: 'window-source', name: 'Source.md', text: '# Source\n\nBody.' }, settings: JSON.parse(localStorage.getItem('window-settings') || '{}') };
        if (message.command === 'settings') localStorage.setItem('window-settings', JSON.stringify(message.args));
        if (message.command === 'draft' || message.command === 'draftDelta') result = { persisted: true, documentId: message.args.documentId, revision: message.args.revision };
        if (message.command === 'detachDocument') {
          window.capturedTransfer = message.args;
          if (window.failDetach) error = 'Target could not start'; else result = { pending: true, token: message.args.token };
        }
        if (message.command === 'commitDetach') result = { moved: true, documentId: window.capturedTransfer.documentId };
        queueMicrotask(() => handlers.forEach(handler => handler({ data: { id: message.id, result, error } })));
      },
    };
  });
  await page.reload();
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#separate-windows-input')).not.toBeChecked();
  await page.locator('#separate-windows-input').check(); await page.keyboard.press('Escape');
  await page.reload(); await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#separate-windows-input')).toBeChecked();
  await page.locator('#separate-windows-input').uncheck(); await page.keyboard.press('Escape');
  await page.evaluate(() => window.inkletTest.add({ id: 'window-other', name: 'Other.md', text: '# Other' }));
  await page.locator('[data-document-open="window-source"]').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' unsaved');
  await page.locator('[data-action="detach-file"]').click();
  await expect(page.locator('#toast')).toContainText('Target could not start');
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
  await expect(page.locator('#workspace-count')).toHaveText('2');
  await expect(page.locator('.cm-content')).toContainText('unsaved');
  expect(await page.evaluate(() => window.capturedTransfer.snapshot.session.past.length)).toBeGreaterThan(0);
  await page.evaluate(() => { window.failDetach = false; });
  await page.locator('[data-action="detach-file"]').click();
  await expect(page.locator('#app')).toHaveJSProperty('inert', true);
  await expect(page.locator('#workspace-count')).toHaveText('2');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('inklet:detachReady', { detail: { token: window.capturedTransfer.token } })));
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
  await expect(page.locator('#workspace-count')).toHaveText('1');
  await expect(page.locator('#file-name')).toHaveText('Other.md');
  expect(await page.evaluate(() => window.windowRequests.includes('closeDocuments'))).toBe(false);
});

test('incoming window restores unsaved state and remains read only until transfer commits', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = [];
    const before = '# Moved\n\n' + 'A paragraph for the restored reading position.\n\n'.repeat(50);
    const marks = [{ from: 2, to: 7, color: 'blue', opacity: .3 }];
    window.transferBase = before;
    const session = { source: before + 'tail', highlights: marks, unresolved: [], past: [{ change: { from: before.length, to: before.length, insert: 'tail' }, inverse: { from: before.length, to: before.length + 4, insert: '' }, beforeMarks: marks, afterMarks: marks }], future: [], revision: 1 };
    const snapshot = { version: 1, documentId: 'incoming-file', session, info: { name: 'Moved.md', path: null, hash: null }, savedRevision: 0, selection: { from: 10, to: 18 }, view: { sourceTop: 120, richTop: 160, activePane: 'source' }, search: { query: '', replacement: '' } };
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        let result = true;
        if (message.command === 'hello') result = { workspace: true, multipleWindows: true, session: snapshot, transfer: 'incoming-token', settings: {} };
        if (message.command === 'draft' || message.command === 'draftDelta') result = { persisted: true, documentId: message.args.documentId, revision: message.args.revision };
        queueMicrotask(() => handlers.forEach(handler => handler({ data: { id: message.id, result } })));
      },
    };
  });
  await page.reload();
  await page.waitForFunction(() => performance.getEntriesByName('inklet-ready').length > 0);
  await expect(page.locator('#app')).toHaveJSProperty('inert', true);
  expect(await page.evaluate(() => window.inkletTest.source === window.transferBase + 'tail')).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.marks.length)).toBe(1);
  expect(await page.evaluate(() => window.inkletTest.sourceEditor.view.state.selection.main.to)).toBe(18);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('inklet:detachCommitted')));
  await expect(page.locator('#app')).toHaveJSProperty('inert', false);
  await expect(page.locator('#dirty-dot')).toBeVisible();
  await page.locator('[data-action="undo"]').click();
  expect(await page.evaluate(() => window.inkletTest.source === window.transferBase)).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.marks.length)).toBe(1);
});

test('external disk changes refresh clean views but preserve edits and read races', async ({ page }) => {
  await page.addInitScript(() => {
    const handlers = [];
    window.externalDisk = { path: 'C:\\Documents\\external.md', name: 'external.md', text: '# Initial\n\nOriginal text.\n', hash: 'initial', stamp: 'initial' };
    window.acceptedStamp = 'initial'; window.externalDelay = 0; window.externalReadStarted = false; window.externalWrites = 0;
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      addEventListener: (name, handler) => { if (name === 'message') handlers.push(handler); },
      postMessage: message => {
        let result = true;
        if (message.command === 'hello') result = { document: { ...window.externalDisk }, settings: {}, recovery: sessionStorage.getItem('external-recovery') ? { text: 'Pending recovery draft', name: 'external.md', path: window.externalDisk.path } : null };
        if (message.command === 'readExternal') { window.externalReadStarted = true; result = window.externalDisk.stamp === window.acceptedStamp ? null : { ...window.externalDisk }; }
        if (message.command === 'acceptExternal') window.acceptedStamp = message.args.stamp;
        if (message.command === 'save') window.externalWrites++;
        if (message.command === 'draft' || message.command === 'draftDelta') result = { persisted: true, documentId: message.args.documentId, revision: message.args.revision };
        setTimeout(() => handlers.forEach(handler => handler({ data: { id: message.id, result } })), message.command === 'readExternal' ? window.externalDelay : 0);
      },
    };
    window.changeDisk = text => {
      window.externalDisk = { ...window.externalDisk, text, stamp: crypto.randomUUID(), hash: crypto.randomUUID() };
      window.dispatchEvent(new CustomEvent('inklet:externalChange', { detail: { path: window.externalDisk.path } }));
    };
  });
  await page.reload();
  await expect(page.locator('.inklet-prose')).toContainText('Original text.');
  await page.evaluate(() => window.changeDisk('# Updated\n\nWritten by another editor.\n'));
  await expect(page.locator('.inklet-prose')).toContainText('Written by another editor.');
  await expect(page.locator('.cm-content')).toContainText('Written by another editor.');
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Local draft');
  await page.evaluate(() => window.changeDisk('# External conflict\n\nDisk version remains separate.\n'));
  await expect(page.locator('#external-change')).toBeVisible();
  const banner = await page.locator('#external-change').boundingBox();
  const workspace = await page.locator('#workspace').boundingBox();
  expect(Math.abs(banner.width - workspace.width)).toBeLessThan(2);
  expect(workspace.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
  await expect(page.locator('.cm-content')).toContainText('Local draft');
  await page.locator('[data-action="external-view"]').click();
  await expect(page.locator('#external-preview')).toHaveValue('# External conflict\n\nDisk version remains separate.\n');
  await page.locator('#external-dialog .small-command').click();
  await expect(page.locator('.cm-content')).toContainText('Local draft');
  await page.locator('[data-action="external-view"]').click();
  await page.locator('[data-action="external-adopt"]').click();
  await expect(page.locator('.inklet-prose')).toContainText('Disk version remains separate.');
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.acceptedStamp === window.externalDisk.stamp)).toBe(true);
  await page.evaluate(() => { window.externalDelay = 900; window.externalReadStarted = false; window.changeDisk('# Racing write\n\nNew disk contents.'); });
  await expect.poll(() => page.evaluate(() => window.externalReadStarted)).toBe(true);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(' Typed during read');
  await expect(page.locator('#external-change')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Typed during read');
  await expect(page.locator('.inklet-prose')).not.toContainText('New disk contents.');
  expect(await page.evaluate(() => window.externalWrites)).toBe(0);
  await page.evaluate(() => sessionStorage.setItem('external-recovery', 'yes'));
  await page.reload();
  await expect(page.locator('#recovery-name')).toBeVisible();
  await page.locator('[data-action="edit-close"]').first().click();
  await page.evaluate(() => window.changeDisk('# Disk changed while recovery is pending'));
  await expect(page.locator('#external-change')).toContainText('恢复草稿');
  await expect(page.locator('.inklet-prose')).toContainText('Original text.');
  expect(await page.evaluate(() => window.acceptedStamp)).toBe('initial');
});

test('manual column resizing remains authoritative after adaptive layout', async ({ page }) => {
  const source = '| ID | Notes |\n| --- | --- |\n| 1 | A longer explanatory field with multiple words and useful details. |';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const first = page.locator('.inklet-table th').first();
  await expect.poll(() => first.evaluate(element => element.getBoundingClientRect().width / element.nextElementSibling.getBoundingClientRect().width)).toBeLessThan(.7);
  const before = await first.boundingBox();
  await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width + 45, before.y + before.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => first.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(before.width + 20);
  const manual = await first.evaluate(element => element.getBoundingClientRect().width);
  await page.setViewportSize({ width: 1500, height: 960 });
  await expect.poll(() => first.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(manual, 0);
});

test('theme families keep dark panels readable and independent with neutral exports', async ({ page }, testInfo) => {
  const source = '# Reading desk\n\nText **emphasis** and [link](https://example.org).\n\n> A note to review.\n\n| Field | Notes |\n|---|---|\n| ID | A readable table |\n\n```python\ndef hello():\n    return "Inklet"\n```\n\n$$\nx^2 + y^2 = 1\n$$\n\n```mermaid\nflowchart LR\n A[Read] --> B[Edit]\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('[data-action="settings"]').click();
  const defaults = await page.locator('.source-pane,.rich-pane').evaluateAll(panes => panes.map(pane => getComputedStyle(pane).backgroundColor));
  for (const family of ['dark', 'candy', 'morandi', 'clear']) {
    await page.locator('#interface-family-input').selectOption(family);
    const choices = page.locator('.interface-theme:visible');
    expect(await choices.count()).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < await choices.count(); index++) {
      await choices.nth(index).click();
      const contrast = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const luminance = color => {
          const values = color.match(/[a-f\d]{2}/gi).map(part => parseInt(part, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
          return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
        };
        const first = luminance(root.getPropertyValue('--ui-ink')); const second = luminance(root.getPropertyValue('--ui-base'));
        return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
      });
      expect(contrast).toBeGreaterThan(4.5);
    }
    expect(await page.locator('.source-pane,.rich-pane').evaluateAll(panes => panes.map(pane => getComputedStyle(pane).backgroundColor))).toEqual(defaults);
    await page.screenshot({ path: testInfo.outputPath('family-' + family + '.png') });
  }
  await page.locator('#interface-family-input').selectOption('dark');
  await page.locator('#source-family-input').selectOption('dark');
  await page.locator('[data-theme-side="leftTheme"][data-theme="pine"]').click();
  await page.locator('#reader-family-input').selectOption('dark');
  await page.locator('[data-theme-side="rightTheme"][data-theme="graphite"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(28, 40, 37)');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(32, 35, 38)');
  await expect(page.locator('.inklet-prose')).toHaveCSS('color', 'rgb(224, 229, 232)');
  await expect(page.locator('.header-actions [data-action="save-as"]')).toHaveCSS('color', 'rgb(165, 212, 196)');
  await expect(page.locator('.inklet-prose .hljs-keyword').first()).toHaveCSS('color', 'rgb(231, 169, 196)');
  const graphic = page.locator('.diagram-block'); await graphic.scrollIntoViewIfNeeded();
  await expect(graphic).toHaveAttribute('data-rendered', 'true');
  expect(await graphic.getAttribute('data-render-key')).toContain(':dark:');
  await graphic.click();
  await expect(page.locator('#diagram-viewport')).toHaveAttribute('data-paper-mode', 'dark');
  await expect(page.locator('#diagram-stage > svg')).toBeVisible();
  await page.keyboard.press('Escape');
  const colors = await page.evaluate(async () => {
    const { captureReadingTypography, prepareExport } = await import('/src/export-document.js');
    const typography = await captureReadingTypography(document.querySelector('.inklet-prose'));
    return { body: typography.body.color, html: (await prepareExport('# Export\n\nBody.')).html };
  });
  expect(colors.body).toBe('303831');
  expect(colors.html).toContain('background:white');
  await page.locator('#rich-editor').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('dark-desktop.png') });
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-ui-mode', 'dark');
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(28, 40, 37)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#interface-family-input')).toHaveValue('dark');
  expect(await page.locator('#settings-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dark-settings-narrow.png') });
});

test('first single-character search remains usable in a large table document', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('Renderer crashed'));
  const row = '| Field | ' + 'Readable field description. '.repeat(2) + 'Value text \u7684 |\n';
  const source = Array.from({ length: 590 }, (_, section) => '## Section ' + section + '\n\n| Field | Description |\n| --- | --- |\n' + row.repeat(Math.min(30, 17682 - section * 30)) + '\n').join('');
  expect(source.length).toBeGreaterThan(1400000);
  await page.evaluate(text => window.inkletTest.load(text), source);
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const before = await client.send('Performance.getMetrics');
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('\u7684');
  await expect(page.locator('#search-count')).toContainText('17,682');
  await expect(page.locator('[data-action="replace-all"]')).toBeDisabled();
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('#search-count')).toHaveText('1 / 17,682');
  await page.locator('#search-input').fill('Value text \u7684');
  await expect(page.locator('#search-count')).toContainText('17,682');
  await page.locator('[data-action="search-close"]').click();
  await expect(page.locator('#search-panel')).toBeHidden();
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await expect(page.locator('#dirty-dot')).toBeHidden();
  expect(errors).toEqual([]);
  const after = await client.send('Performance.getMetrics');
  await testInfo.attach('first-search-metrics', { body: JSON.stringify({ characters: source.length, matches: 17682, before, after }), contentType: 'application/json' });
});

test('search next reveals matches with source hidden and stays stable in both panes', async ({ page }) => {
  const source = '# First\n\nneedle first\n\n' + 'Filler paragraph for scrolling.\n\n'.repeat(65) + '## Middle\n\nneedle second\n\n' + 'More filler paragraph.\n\n'.repeat(65) + '## Last\n\nneedle third\n';
  for (const readerOnly of [true, false]) {
    await page.evaluate(text => window.inkletTest.load(text), source);
    const sourceButton = page.locator('.view-tools [data-action="source"]');
    if ((await sourceButton.getAttribute('aria-pressed') === 'true') === readerOnly) await sourceButton.click();
    await page.locator('[data-action="search"]').click();
    await page.locator('#search-input').fill('needle');
    await expect(page.locator('#search-count')).toHaveText('3 处');
    for (let index = 0; index < 3; index++) {
      await page.locator('[data-action="next"]').click();
      await expect(page.locator('#search-count')).toHaveText((index + 1) + ' / 3');
      await expect.poll(() => page.locator('.inklet-prose .search-match').nth(index).evaluate(element => {
        const target = element.getBoundingClientRect();
        const viewport = document.querySelector('#rich-editor').getBoundingClientRect();
        return target.top >= viewport.top - 2 && target.bottom <= viewport.bottom + 2;
      }), { timeout: 4000 }).toBe(true);
      const drift = await page.evaluate(async () => {
        const values = [];
        for (let frame = 0; frame < 12; frame++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          values.push(document.querySelector('#rich-editor').scrollTop);
        }
        const settled = values.slice(-4);
        return Math.max(...settled) - Math.min(...settled);
      });
      expect(drift).toBeLessThan(2);
    }
    await page.locator('[data-action="search-close"]').click();
    expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  }
});

test('optional search results show nearest headings, navigate and refresh after replacement', async ({ page }, testInfo) => {
  const source = '# Parent\n\nneedle one and needle two.\n\n' + 'Filler text.\n\n'.repeat(60) + '## Child\n\nneedle child.\n\n# Parent\n\nneedle last.\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('4 处');
  await expect(page.locator('#search-results-panel')).toBeHidden();
  await page.locator('[data-action="settings"]').click();
  await page.locator('#search-results-input').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-results-panel')).toBeVisible();
  await expect(page.locator('.search-result-title')).toHaveText(['Parent', 'Child', 'Parent']);
  await expect(page.locator('.search-result-count')).toHaveText(['2', '1', '1']);
  await page.locator('.search-result-heading').nth(1).click();
  await expect(page.locator('#search-count')).toHaveText('3 / 4');
  await expect(page.locator('.search-result-heading').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => page.locator('.inklet-prose .search-match').nth(2).evaluate(element => {
    const target = element.getBoundingClientRect(); const viewport = document.querySelector('#rich-editor').getBoundingClientRect();
    return target.top >= viewport.top - 2 && target.bottom <= viewport.bottom;
  })).toBe(true);
  await page.locator('#replace-input').fill('changed');
  await page.locator('[data-action="replace"]').click();
  await expect(page.locator('#search-count')).toHaveText('3 处');
  await expect(page.locator('.search-result-title')).toHaveText(['Parent', 'Parent']);
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('changed child.');
  await page.screenshot({ path: testInfo.outputPath('search-results-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.locator('.sidebar').isVisible()) await page.locator('.sidebar-heading [data-action="sidebar"]').click();
  await expect(page.locator('.search-result-title').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('search-results-narrow.png') });
  await page.reload();
  await page.waitForFunction(() => !!window.inkletTest);
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#search-results-input')).toBeChecked();
  await page.keyboard.press('Escape');
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('unmatched-query-123');
  await expect(page.locator('.search-results-empty')).toHaveText('暂无匹配');
  await page.locator('[data-action="search-results-close"]').click();
  await expect(page.locator('#search-results-panel')).toBeHidden();
});

test('explicit search navigation works with sync disabled and source-only mode', async ({ page }) => {
  const source = '# Start\n\n' + 'A long paragraph for spacing.\n\n'.repeat(90) + '## Destination\n\nneedle target\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('[data-action="settings"]').click();
  await page.locator('#sync-input').uncheck();
  await page.keyboard.press('Escape');
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('1 处');
  await page.locator('[data-action="next"]').click();
  await expect.poll(() => page.locator('.inklet-prose .search-match').evaluate(element => {
    const target = element.getBoundingClientRect(); const viewport = document.querySelector('#rich-editor').getBoundingClientRect();
    return target.top >= viewport.top - 2 && target.bottom <= viewport.bottom;
  })).toBe(true);
  await page.locator('.view-tools [data-action="rich"]').click();
  await page.evaluate(() => { window.inkletTest.sourceEditor.view.scrollDOM.scrollTop = 0; });
  await page.locator('[data-action="next"]').click();
  await expect.poll(() => page.evaluate(() => {
    const editor = window.inkletTest.sourceEditor;
    const target = editor.view.coordsAtPos(editor.view.state.selection.main.from);
    const viewport = editor.view.scrollDOM.getBoundingClientRect();
    return target.top >= viewport.top - 2 && target.bottom <= viewport.bottom;
  })).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('tall Mermaid fills reading width instead of shrinking to a fixed height', async ({ page }, testInfo) => {
  const code = 'flowchart TD\n' + Array.from({ length: 16 }, (_, index) => ` Step${index}[Stage ${index} - Confirm order] --> Step${index + 1}[Stage ${index + 1} - Confirm order]`).join('\n');
  await page.evaluate(text => window.inkletTest.load('```mermaid\n' + text + '\n```\n'), code);
  const diagram = page.locator('.diagram-block');
  await expect(diagram).toHaveAttribute('data-rendered', 'true');
  const sizing = await diagram.evaluate(element => {
    const svg = element.querySelector('svg');
    const box = svg.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: box.width, height: box.height, available: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), ratio: svg.viewBox.baseVal.height / svg.viewBox.baseVal.width };
  });
  expect(sizing.width).toBeGreaterThan(sizing.available * .95);
  expect(sizing.height).toBeGreaterThan(460);
  expect(Math.abs(sizing.height / sizing.width - sizing.ratio)).toBeLessThan(.05);
  await page.screenshot({ path: testInfo.outputPath('readable-tall-mermaid.png') });
});

test('Mermaid click opens a zoomable width-fitted viewer while source editing is explicit', async ({ page }, testInfo) => {
  const source = '# Readable diagram\n\n```mermaid\nflowchart TD\n A[Start] --> B[Review] --> C[Done]\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await expect(page.locator('.diagram-block')).toHaveAttribute('data-rendered', 'true');
  await page.locator('.diagram-block > svg').click();
  await expect(page.locator('#diagram-dialog')).toBeVisible();
  await expect(page.locator('#edit-dialog')).toBeHidden();
  await expect(page.locator('#diagram-stage > svg')).toBeVisible();
  const before = await page.locator('#diagram-stage').evaluate(element => element.getBoundingClientRect().width);
  await page.locator('[data-action="diagram-zoom-in"]').click();
  expect(await page.locator('#diagram-stage').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(before);
  await expect(page.locator('#diagram-zoom')).toHaveText('125%');
  await page.locator('[data-action="diagram-fit"]').click();
  await expect(page.locator('#diagram-zoom')).toHaveText('100%');
  await page.screenshot({ path: testInfo.outputPath('diagram-viewer.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await page.locator('.diagram-view-controls').boundingBox();
  expect(controls.x + controls.width).toBeLessThanOrEqual(390);
  await page.locator('[data-action="diagram-source"]').click();
  await expect(page.locator('#diagram-dialog')).toBeHidden();
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await expect(page.locator('#block-input')).toHaveValue(/flowchart TD/);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('Mermaid renders legacy parenthesized flowchart labels without changing source', async ({ page }, testInfo) => {
  const code = 'flowchart TD\n G[CreateProductionOrder<br/>Server validation] --> H[GenerateNumber order/process(+reservation)]\n H --> I{Continue (yes)?}\n I -->|yes| J[Done]';
  const source = '# Legacy flowchart\n\n```mermaid\n' + code + '\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const diagram = page.locator('.diagram-block');
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveAttribute('data-rendered', 'true');
  await expect(diagram.locator(':scope > svg')).toHaveAttribute('data-inklet-label-compat', 'quoted');
  await expect(diagram).toContainText('order/process(+reservation)');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await expect(diagram.locator('svg .node')).toHaveCount(4);
  await expect(diagram.locator('svg .flowchart-link')).toHaveCount(3);
  const html = await page.evaluate(async text => (await (await import('/src/export-document.js')).prepareExport(text)).html, source);
  expect(html).toContain('data:image/png;base64,');
  await page.screenshot({ path: testInfo.outputPath('compatible-mermaid.png') });
});

test('Mermaid preserves valid labels and still reports unrelated syntax errors', async ({ page }) => {
  const valid = 'flowchart LR\n A["Order (already quoted)"] --> B[Done]';
  await page.evaluate(text => window.inkletTest.load('```mermaid\n' + text + '\n```\n'), valid);
  await expect(page.locator('.diagram-block')).toHaveAttribute('data-rendered', 'true');
  expect(await page.locator('.diagram-block > svg').getAttribute('data-inklet-label-compat')).toBeNull();
  const broken = '```mermaid\nflowchart LR\n A[unfinished (label)\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), broken);
  await expect(page.locator('.diagram-block')).toHaveAttribute('data-rendered', 'error');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(broken);
});

test('completed Mermaid stays rendered when editor node views are recreated', async ({ page }) => {
  const source = '# Diagram\n\n```mermaid\nflowchart LR\n A[Start] --> B[End]\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await expect(page.locator('.diagram-block')).toHaveAttribute('data-rendered', 'true');
  const rebuilt = await page.evaluate(() => {
    const view = window.inkletTest.richEditor.view;
    const previous = document.querySelector('.diagram-block');
    const nodeViews = view.props.nodeViews;
    const original = nodeViews.mermaid;
    view.setProps({ nodeViews: { ...nodeViews, mermaid: (...args) => original(...args) } });
    const current = document.querySelector('.diagram-block');
    return { replaced: current !== previous, rendered: current.dataset.rendered, svg: !!current.querySelector('svg') };
  });
  expect(rebuilt).toEqual({ replaced: true, rendered: 'true', svg: true });
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('note blocks have a readable filled surface without changing Markdown', async ({ page }, testInfo) => {
  const source = '# Notes\n\nNormal paragraph.\n\n> **Important:** Search conditions must be confirmed before continuing.\n>\n> Keep the current document and all entered values.\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const note = page.locator('.inklet-prose blockquote');
  await expect(note).toHaveCSS('background-color', 'rgb(237, 244, 246)');
  await expect(note).toHaveCSS('border-left-width', '3px');
  await expect(note).toHaveCSS('font-family', /Manrope/);
  const size = await note.evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const bodySize = await page.locator('.inklet-prose').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeLessThan(bodySize);
  expect(size).toBeGreaterThanOrEqual(14);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.screenshot({ path: testInfo.outputPath('note-block-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await note.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('note-block-narrow.png') });
  const html = await page.evaluate(async text => (await (await import('/src/export-document.js')).prepareExport(text)).html, source);
  const preview = await page.context().newPage();
  await preview.setContent(html);
  await expect(preview.locator('blockquote')).toHaveCSS('background-color', 'rgb(237, 244, 246)');
  await preview.close();
});

test('header and software information use the same transparent logo without a white matte', async ({ page }, testInfo) => {
  await page.locator('[data-action="about"]').click();
  for (const selector of ['.brand-logo', '.about-product img']) {
    const image = page.locator(selector);
    const alpha = await image.evaluate(async element => {
      await element.decode();
      const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(element, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = 0; let visible = 0; let white = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] === 0) transparent++;
        else { visible++; if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 240) white++; }
      }
      return { transparent, visible, white, cornerAlpha: pixels[3] };
    });
    expect(alpha.transparent).toBeGreaterThan(32768);
    expect(alpha.visible).toBeGreaterThan(1000);
    expect(alpha.white).toBe(0);
    expect(alpha.cornerAlpha).toBe(0);
  }
  expect(await page.locator('.brand-logo').getAttribute('src')).toBe(await page.locator('.about-product img').getAttribute('src'));
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /transparent-20261009/);
  await page.screenshot({ path: testInfo.outputPath('transparent-logo-about.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: testInfo.outputPath('transparent-logo-header.png') });
});

test('brand slogan sits below the name without crowding header controls', async ({ page }, testInfo) => {
  for (const width of [1440, 1166, 820]) {
    await page.setViewportSize({ width, height: 860 });
    await expect(page.locator('.brand-tagline')).toHaveText('轻快落笔，顺手成文。');
    await expect(page.locator('.brand-tagline')).toBeVisible();
    const name = await page.locator('.brand-name').boundingBox();
    const tagline = await page.locator('.brand-tagline').boundingBox();
    const brand = await page.locator('.brand').boundingBox();
    const file = await page.locator('.file-heading').boundingBox();
    const actions = await page.locator('.header-actions').boundingBox();
    expect(tagline.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(Math.abs(tagline.x - name.x)).toBeLessThan(1);
    expect(tagline.x + tagline.width).toBeLessThanOrEqual(brand.x + brand.width + 1);
    expect(file.x).toBeGreaterThanOrEqual(brand.x + brand.width - 1);
    expect(actions.x + actions.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('brand-slogan-' + width + '.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.brand-tagline')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('centered HTML cover paragraphs and cell overrides match their source', async ({ page }, testInfo) => {
  const source = '<table style="text-align:center"><tr><td align="center"><h2 align="center">xFUSION</h2><p style="text-align:center"><strong>Company name</strong></p><p>All rights reserved</p><p style="text-align:left">Local left</p></td></tr></table>\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const paragraphs = page.locator('.inklet-prose td p');
  for (const index of [0, 1, 2]) await expect(paragraphs.nth(index)).toHaveCSS('text-align', 'center');
  await expect(paragraphs.nth(3)).toHaveCSS('text-align', 'left');
  await paragraphs.nth(1).click(); await page.keyboard.press('End'); await page.keyboard.insertText(' edited');
  await expect(paragraphs.nth(1)).toHaveCSS('text-align', 'center');
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('text-align:center');
  await page.keyboard.press('Control+Z');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.screenshot({ path: testInfo.outputPath('centered-cover.png') });
});

test('document TOC renders links, navigates duplicate headings and updates after editing', async ({ page }, testInfo) => {
  const source = '[toc]\n\n<!-- pagebreak -->\n\n# First\n\n' + 'Paragraph text.\n\n'.repeat(40) + '## Repeated\n\nMiddle.\n\n## Repeated\n\nLast.\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const links = page.locator('.document-toc a');
  await expect(links).toHaveCount(3);
  await expect(page.locator('.document-pagebreak')).toHaveCount(1);
  await expect(page.locator('.inklet-prose')).not.toContainText('[toc]');
  await expect(page.locator('.inklet-prose')).not.toContainText('<!-- pagebreak -->');
  const anchors = await links.evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(new Set(anchors).size).toBe(3);
  await page.screenshot({ path: testInfo.outputPath('document-toc.png') });
  await links.last().click();
  await expect.poll(() => page.locator('.inklet-prose h2').last().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const container = document.querySelector('#rich-editor').getBoundingClientRect();
    return bounds.top >= container.top - 10 && bounds.bottom <= container.bottom;
  })).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.evaluate(() => {
    const editor = window.inkletTest.sourceEditor.view;
    const from = window.inkletTest.source.lastIndexOf('Repeated');
    editor.dispatch({ changes: { from, to: from + 8, insert: 'Renamed' } });
  });
  await expect(links.last()).toHaveText('Renamed');
  await page.locator('.cm-content').press('Control+Z');
  await expect(links.last()).toHaveText('Repeated');
});

test('exported contents preserve heading targets, alignment and page-break styling', async ({ page }) => {
  const source = '<table><tr><td align="center"><p>Company</p></td></tr></table>\n\n[TOC]\n\n<!-- pagebreak -->\n\n# First\n\n## Child\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const html = await page.evaluate(async text => (await (await import('/src/export-document.js')).prepareExport(text)).html, source);
  const preview = await page.context().newPage();
  await preview.setContent(html);
  await expect(preview.locator('td p')).toHaveCSS('text-align', 'center');
  await expect(preview.locator('.document-toc a')).toHaveCount(2);
  expect(await preview.locator('.document-toc a').evaluateAll(links => links.every(link => document.getElementById(link.hash.slice(1))))).toBe(true);
  await expect(preview.locator('.document-pagebreak')).toHaveCSS('break-after', 'page');
  expect(await preview.locator('body').textContent()).not.toContain('[TOC]');
  await preview.close();
});

test('save-as is available in the header and word count follows parsed text in both panes', async ({ page }, testInfo) => {
  await expect(page.locator('.header-actions [data-action="save-as"]')).toBeVisible();
  await expect(page.locator('.header-actions [data-action="save-as"]')).toHaveAttribute('title', '另存为');
  const source = '# 中文 ABC 123\n\n[链接](https://example.com/path) **de**\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await expect(page.locator('#word-count')).toHaveText('12 字');
  await expect(page.locator('#word-count')).toHaveAttribute('title', '汉字 4 · 字母 5 · 数字 3');
  await page.evaluate(() => {
    const view = window.inkletTest.sourceEditor.view;
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n汉9!?\n' } });
  });
  await expect(page.locator('#word-count')).toHaveText('14 字');
  await page.locator('.inklet-prose p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' Z');
  await expect(page.locator('#word-count')).toHaveText('15 字');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('#word-count')).toHaveText('14 字');
  await page.screenshot({ path: testInfo.outputPath('word-count-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.header-actions [data-action="save-as"]')).toBeVisible();
  const headerBounds = await page.locator('.header-actions').boundingBox();
  expect(headerBounds.x + headerBounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('word-count-narrow.png') });
});

test('desktop startup uses an empty document or the restored file instead of the sample', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = [];
    window.chrome.webview = {
      addEventListener: (_, listener) => listeners.push(listener),
      postMessage: request => queueMicrotask(() => listeners.forEach(listener => listener({ data: {
        id: request.id,
        result: request.command === 'hello' ? JSON.parse(sessionStorage.getItem('startup-fixture')) : true,
      } }))),
    };
  });
  for (const startup of [
    { settings: {} },
    { settings: {}, document: { name: 'Last closed.md', path: 'C:\\Notes\\Last closed.md', text: '# Last closed document' } },
    { settings: {}, startupWarning: { message: '原地址无该文件。', path: 'C:\\Notes\\Moved.md' } },
  ]) {
    await page.evaluate(value => sessionStorage.setItem('startup-fixture', JSON.stringify(value)), startup);
    await page.reload();
    await page.waitForFunction(() => !!window.inkletTest);
    await expect(page.locator('#file-name')).toHaveText(startup.document?.name || '未命名.md');
    expect(await page.evaluate(() => window.inkletTest.source)).toBe(startup.document?.text || '');
    await expect(page.locator('#dirty-dot')).toBeHidden();
    if (startup.startupWarning) {
      await expect(page.locator('#history-error-dialog')).toBeVisible();
      await expect(page.locator('#history-error-message')).toHaveText('原地址无该文件。');
      await expect(page.locator('#history-error-path')).toHaveText(startup.startupWarning.path);
    }
  }
});

test('history lists original paths and dates, protects edits and reports missing files', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const listeners = [];
    window.historyOpened = [];
    window.chrome.webview = {
      addEventListener: (_, listener) => listeners.push(listener),
      postMessage: request => {
        let result = true;
        if (request.command === 'hello') result = { settings: { sidebar: false }, document: { name: 'Current.md', text: '# Current document' } };
        if (request.command === 'history') result = [
          { Id: 'present', Name: 'Previous.md', Path: 'C:\\Documents\\Previous.md', OpenedAt: '2026-10-08T01:02:03.0000000+00:00' },
          { Id: 'missing', Name: 'Moved.md', Path: 'C:\\Documents\\Moved.md', OpenedAt: '2026-10-07T01:02:03.0000000+00:00' },
        ];
        if (request.command === 'openHistory') {
          window.historyOpened.push(request.args.id);
          result = request.args.id === 'missing' ? { missing: true, path: 'C:\\Documents\\Moved.md' } : { name: 'Previous.md', path: 'C:\\Documents\\Previous.md', text: '# Previous document' };
        }
        if (request.command === 'draft' || request.command === 'draftDelta') result = { persisted: true, documentId: request.args.documentId, revision: request.args.revision };
        queueMicrotask(() => listeners.forEach(listener => listener({ data: { id: request.id, result } })));
      },
    };
  });
  await page.reload();
  await expect(page.locator('.inklet-prose')).toBeVisible();
  await page.locator('[data-action="open-history"]').click();
  await expect(page.locator('.history-entry')).toHaveCount(2);
  await expect(page.locator('.history-entry').first()).toContainText('C:\\Documents\\Previous.md');
  await expect(page.locator('.history-entry time').first()).toHaveAttribute('datetime', /2026-10-08T01:02:03/);
  await page.locator('.history-entry').last().click();
  await expect(page.locator('#history-error-dialog')).toBeVisible();
  await expect(page.locator('#history-error-message')).toHaveText('原地址无该文件。');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe('# Current document');
  await page.locator('#history-error-dialog .primary-command').click();
  await page.locator('.history-entry').first().click();
  await expect(page.locator('#history-dialog')).not.toBeVisible();
  await expect(page.locator('#file-name')).toHaveText('Previous.md');
  await page.evaluate(() => window.inkletTest.sourceEditor.view.dispatch({ changes: { from: 0, insert: 'Unsaved\n\n' } }));
  await page.locator('[data-action="open-history"]').click();
  await page.locator('.history-entry').first().click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.historyOpened.length)).toBe(2);
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('Unsaved');
  await page.screenshot({ path: testInfo.outputPath('history-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('history-narrow.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await page.locator('#history-dialog').boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('search invalidates stale navigation and replacement across edits, marks and documents', async ({ page }) => {
  const source = '# Search state\n\n\u0130 before needle and NEEDLE.\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('2 处');
  await page.locator('#replace-input').fill('REPLACEMENT');
  const pending = await page.evaluate(() => {
    const input = document.querySelector('#search-input');
    input.value = 'absent'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const actions = ['next', 'previous', 'replace', 'replace-all'].map(action => document.querySelector(`#search-panel [data-action="${action}"]`));
    actions.forEach(button => button.click());
    return { disabled: actions.every(button => button.disabled), source: window.inkletTest.source };
  });
  expect(pending).toEqual({ disabled: true, source });
  await expect(page.locator('#search-count')).toHaveText('0 处');
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('2 处');
  await page.evaluate(() => window.inkletTest.select(2, 8));
  await page.locator('[data-color="yellow"]').click();
  await expect(page.locator('#search-count')).toHaveText('2 处');
  await expect(page.locator('[data-action="next"]')).toBeEnabled();
  const shortened = await page.evaluate(() => {
    const view = window.inkletTest.sourceEditor.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'short' } });
    const replace = document.querySelector('[data-action="replace"]');
    replace.click();
    return { disabled: replace.disabled, source: window.inkletTest.source };
  });
  expect(shortened).toEqual({ disabled: true, source: 'short' });
  await expect(page.locator('#search-count')).toHaveText('0 处');
  await page.evaluate(() => window.inkletTest.load('needle in another document'));
  await expect(page.locator('#search-count')).toHaveText('1 处');
  await page.evaluate(() => {
    const input = document.querySelector('#search-input');
    input.value = 'document'; input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="search-close"]').click();
  });
  await expect(page.locator('#search-panel')).toBeHidden();
  await page.locator('[data-action="search"]').click();
  await expect(page.locator('#search-count')).toHaveText('1 处');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe('needle in another document');
});

test('search worker errors disable actions and rebuild once on the next request', async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.searchWorkerCount = 0;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('search-worker')) { window.searchWorkerFixture = this; window.searchWorkerCount++; }
      }
    };
  });
  await page.reload();
  await page.waitForFunction(() => !!window.inkletTest);
  await page.evaluate(() => window.inkletTest.load('needle needle replacement'));
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('2 处');
  await page.evaluate(() => window.searchWorkerFixture.dispatchEvent(new ErrorEvent('error', { cancelable: true })));
  await expect(page.locator('#search-count')).toHaveText('查找暂不可用');
  await expect(page.locator('[data-action="replace"]')).toBeDisabled();
  expect(await page.evaluate(() => window.searchWorkerCount)).toBe(1);
  await page.locator('#search-input').fill('replacement');
  await expect(page.locator('#search-count')).toHaveText('1 处');
  expect(await page.evaluate(() => window.searchWorkerCount)).toBe(2);
  await page.evaluate(() => window.searchWorkerFixture.dispatchEvent(new MessageEvent('messageerror', { cancelable: true })));
  await expect(page.locator('[data-action="next"]')).toBeDisabled();
  await page.locator('#search-input').fill('needle');
  await expect(page.locator('#search-count')).toHaveText('2 处');
  expect(await page.evaluate(() => window.searchWorkerCount)).toBe(3);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe('needle needle replacement');
});

test('search remains usable during dense matches and repeated long-document jumps', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('crash', () => failures.push('renderer crashed'));
  const source = Array.from({ length: 180 }, (_, index) => `## Target-${String(index).padStart(3, '0')}\n\n${'needle common \u67e5\u627e '.repeat(70)}\n\n\`\`\`js\nconst value = ${index};\n\`\`\`\n\n`).join('');
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('[data-action="search"]').click();
  for (let index = 0; index < 12; index++) {
    await page.locator('#search-input').fill('needle');
    await expect(page.locator('#search-count')).toContainText('12,600');
    await expect(page.locator('[data-action="replace-all"]')).toBeDisabled();
    await page.locator('[data-action="next"]').click();
    await page.locator('#search-input').fill('Target-' + String(179 - index * 13).padStart(3, '0'));
    await expect(page.locator('#search-count')).toHaveText('1 处');
    await page.locator('[data-action="next"]').click();
    await page.locator('[data-action="previous"]').click();
  }
  await page.locator('[data-action="search-close"]').click();
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  expect(failures).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('search-stress.png') });
});

test('source scroll anchor uses the visible line rather than the prefetched viewport', async ({ page }) => {
  const source = Array.from({ length: 120 }, (_, index) => `## Section ${index}\n\nParagraph ${index}: ${'Some text for a longer document. '.repeat(4)}\n`).join('\n');
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.evaluate(() => { window.inkletTest.sourceEditor.view.scrollDOM.scrollTop = 2500; });
  await expect.poll(() => page.evaluate(() => {
    const editor = window.inkletTest.sourceEditor;
    const position = editor.topPosition;
    const coordinates = editor.view.coordsAtPos(position);
    return { afterPrefetch: position > editor.view.viewport.from, offset: coordinates ? Math.abs(coordinates.top - editor.view.scrollDOM.getBoundingClientRect().top) : 9999 };
  })).toMatchObject({ afterPrefetch: true });
  expect(await page.evaluate(() => {
    const editor = window.inkletTest.sourceEditor;
    return Math.abs(editor.view.coordsAtPos(editor.topPosition).top - editor.view.scrollDOM.getBoundingClientRect().top);
  })).toBeLessThan(40);
});

test('scroll sync aligns matching headings in both directions without changing selection', async ({ page }, testInfo) => {
  await page.route('**/samples/sync-image.png', route => route.fulfill({ path: new URL('../../assets/inklet.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), contentType: 'image/png' }));
  const source = Array.from({ length: 45 }, (_, index) => `## Scroll section ${index}\n\n${'A paragraph with different wrapping in the two editing panes. '.repeat(5)}\n\n| Name | Value |\n| --- | --- |\n| Item | ${index} |\n\n${index % 3 === 0 ? '![image](/samples/sync-image.png)\n\n' : ''}`).join('');
  await page.evaluate(text => window.inkletTest.load(text), source);
  const align = async (pane, section) => {
    const locator = page.locator(pane === 'source' ? '.cm-scroller' : '#rich-editor');
    await locator.hover();
    const beforeScroll = await locator.evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => locator.evaluate(element => element.scrollTop)).not.toBe(beforeScroll);
    await page.evaluate(({ pane, section }) => {
      const { sourceEditor, richEditor } = window.inkletTest;
      const offset = window.inkletTest.source.indexOf('## Scroll section ' + section + '\n');
      if (pane === 'source') {
        const container = sourceEditor.view.scrollDOM;
        container.scrollTop += sourceEditor.view.documentTop + sourceEditor.view.lineBlockAt(offset).top - container.getBoundingClientRect().top;
      } else {
        const range = richEditor.parsed.ranges.find(item => item.from === offset);
        richEditor.container.scrollTop += richEditor.view.nodeDOM(range.position).getBoundingClientRect().top - richEditor.container.getBoundingClientRect().top;
      }
    }, { pane, section });
    await expect.poll(() => page.evaluate(section => {
      const { sourceEditor, richEditor } = window.inkletTest;
      const offset = window.inkletTest.source.indexOf('## Scroll section ' + section + '\n');
      const range = richEditor.parsed.ranges.find(item => item.from === offset);
      const sourceTop = sourceEditor.view.documentTop + sourceEditor.view.lineBlockAt(offset).top - sourceEditor.view.scrollDOM.getBoundingClientRect().top;
      const richTop = richEditor.view.nodeDOM(range.position).getBoundingClientRect().top - richEditor.container.getBoundingClientRect().top;
      return Math.abs(sourceTop - richTop);
    }, section)).toBeLessThan(30);
  };
  const original = await page.evaluate(() => ({ source: window.inkletTest.source, selection: window.inkletTest.sourceEditor.selection.toJSON() }));
  await align('source', 28);
  await align('rich', 16);
  await align('source', 35);
  await align('rich', 8);
  expect(await page.evaluate(() => ({ source: window.inkletTest.source, selection: window.inkletTest.sourceEditor.selection.toJSON() }))).toEqual(original);
  await page.locator('.outline-item').filter({ hasText: /^Scroll section 33$/ }).click();
  await expect.poll(() => page.evaluate(() => {
    const { sourceEditor, richEditor } = window.inkletTest;
    const offset = window.inkletTest.source.indexOf('## Scroll section 33\n');
    const range = richEditor.parsed.ranges.find(item => item.from === offset);
    const sourceBounds = sourceEditor.view.scrollDOM.getBoundingClientRect();
    const richBounds = richEditor.container.getBoundingClientRect();
    const sourceTop = sourceEditor.view.documentTop + sourceEditor.view.lineBlockAt(offset).top;
    const richTop = richEditor.view.nodeDOM(range.position).getBoundingClientRect().top;
    return sourceTop >= sourceBounds.top - 30 && sourceTop < sourceBounds.bottom && richTop >= richBounds.top - 30 && richTop < richBounds.bottom;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('synchronized-headings.png') });
});

test('scroll sync follows text positions inside long wrapped paragraphs', async ({ page }) => {
  const paragraph = Array.from({ length: 1800 }, (_, index) => `word${String(index).padStart(4, '0')}`).join(' ');
  const source = '# Long paragraph\n\n' + paragraph + '\n\n## After paragraph\n\n' + 'Following paragraph.\n\n'.repeat(80);
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('.cm-scroller').hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => page.evaluate(() => {
    const { sourceEditor, richEditor } = window.inkletTest;
    const offset = sourceEditor.topPosition;
    const run = richEditor.parsed.runs.find(item => offset >= item.from && offset <= item.to);
    if (!run) return 9999;
    const point = richEditor.view.coordsAtPos(run.position + offset - run.from);
    return Math.abs(point.top - richEditor.container.getBoundingClientRect().top);
  })).toBeLessThan(45);
  await page.locator('#rich-editor').hover();
  await page.mouse.wheel(0, 1400);
  await expect.poll(() => page.evaluate(() => {
    const { sourceEditor, richEditor } = window.inkletTest;
    const bounds = richEditor.container.getBoundingClientRect();
    const point = richEditor.view.posAtCoords({ left: richEditor.view.dom.getBoundingClientRect().left + 4, top: bounds.top + 2 });
    if (!point) return 9999;
    const run = richEditor.parsed.runs.find(item => point.pos >= item.position && point.pos <= item.position + item.text.length);
    if (!run) return 9999;
    const sourcePoint = sourceEditor.view.coordsAtPos(run.from + point.pos - run.position);
    return sourcePoint ? Math.abs(sourcePoint.top - sourceEditor.view.scrollDOM.getBoundingClientRect().top) : 9999;
  })).toBeLessThan(45);
});

test('scroll sync realigns after image layout changes and respects its switch', async ({ page }) => {
  await page.route('**/samples/resize-image.png', route => route.fulfill({ path: new URL('../../assets/inklet.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), contentType: 'image/png' }));
  const source = '# Images\n\n![image](/samples/resize-image.png)\n\n## Target paragraph\n\n' + 'Following text with some content.\n\n'.repeat(160);
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.locator('.cm-scroller').hover();
  const initialTop = await page.locator('.cm-scroller').evaluate(element => element.scrollTop);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).not.toBe(initialTop);
  await page.evaluate(() => {
    const editor = window.inkletTest.sourceEditor;
    const offset = window.inkletTest.source.indexOf('## Target paragraph');
    editor.view.scrollDOM.scrollTop += editor.view.documentTop + editor.view.lineBlockAt(offset).top - editor.view.scrollDOM.getBoundingClientRect().top;
  });
  const alignment = () => page.locator('.inklet-prose h2').evaluate(element => Math.abs(element.getBoundingClientRect().top - document.querySelector('#rich-editor').getBoundingClientRect().top));
  await expect.poll(alignment).toBeLessThan(30);
  await page.locator('.inklet-prose img:not(.ProseMirror-separator)').evaluate(image => { image.style.height = '750px'; image.style.width = '100%'; });
  await expect.poll(alignment).toBeLessThan(30);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('#sync-input').uncheck();
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  const originalTop = await page.locator('.cm-scroller').evaluate(element => element.scrollTop);
  await page.locator('#rich-editor').hover();
  await page.mouse.wheel(0, 500);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBe(originalTop);
});

test('outline position switches independently and persists', async ({ page }) => {
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('#outline-side-input').selectOption('right');
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  const main = await page.locator('.main-area').boundingBox();
  const sidebar = await page.locator('.sidebar').boundingBox();
  expect(sidebar.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
  await page.reload();
  await expect(page.locator('.app-body')).toHaveAttribute('data-outline-side', 'right');
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('#outline-side-input').selectOption('left');
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  const restored = await page.locator('.sidebar').boundingBox();
  const contentLeft = await page.locator('.app-body').evaluate(element => element.getBoundingClientRect().left + parseFloat(getComputedStyle(element).paddingLeft));
  expect(restored.x).toBe(contentLeft);
});

test('custom shortcut replaces the original in source and rich editing', async ({ page }) => {
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('[data-action="shortcuts"]').click();
  await page.locator('[data-shortcut-command="search"]').press('Control+Alt+f');
  await page.locator('[data-action="shortcuts-save"]').click();
  await expect(page.locator('#shortcuts-dialog')).toBeHidden();
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('#search-panel')).toBeHidden();
  await page.keyboard.press('Control+Alt+f');
  await expect(page.locator('#search-panel')).toBeVisible();
  await page.locator('[data-action="search-close"]').click();
  await page.locator('.inklet-prose h1').click();
  await page.keyboard.press('Control+Alt+f');
  await expect(page.locator('#search-panel')).toBeVisible();
  await page.reload();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Alt+f');
  await expect(page.locator('#search-panel')).toBeVisible();
});

test('code language selection and keyword colors apply to both panes', async ({ page }) => {
  const markdown = '# Code\n\n```javascript\nconst answer = 42;\n```\n\n```python\ndef hello():\n    return "yes"\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), markdown);
  await expect(page.locator('.inklet-prose .hljs-keyword').filter({ hasText: 'const' })).toBeVisible();
  await expect(page.locator('.cm-content .hljs-keyword').filter({ hasText: 'const' })).toBeVisible();
  await page.locator('.code-block-toolbar select').first().selectOption('typescript');
  await expect.poll(() => page.evaluate(() => window.inkletTest.source)).toContain('```typescript');
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('#code-color-language').selectOption('python');
  await page.locator('[data-code-color="keyword"]').evaluate(input => { input.value = '#aa2255'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  await expect(page.locator('.inklet-prose .hljs-keyword').filter({ hasText: 'def' })).toHaveCSS('color', 'rgb(170, 34, 85)');
  await expect(page.locator('.cm-content .hljs-keyword').filter({ hasText: 'def' })).toHaveCSS('color', 'rgb(170, 34, 85)');
  await page.reload();
  await page.evaluate(text => window.inkletTest.load(text), markdown);
  await expect(page.locator('.inklet-prose .hljs-keyword').filter({ hasText: 'def' })).toHaveCSS('color', 'rgb(170, 34, 85)');
});

async function captureBrowserExports(page) {
  await page.evaluate(() => {
    window.exportedFiles = {};
    window.showSaveFilePicker = async options => ({
      name: options.suggestedName,
      createWritable: async () => ({
        write: async blob => {
          const buffer = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (const byte of buffer) binary += String.fromCharCode(byte);
          window.exportedFiles[options.suggestedName] = { type: blob.type, data: btoa(binary), text: blob.type === 'text/html' ? await blob.text() : null };
        }, close: async () => {}, abort: async () => {},
      }),
    });
  });
}

test('HTML and Word export embed complete offscreen diagrams and preserve the source', async ({ page }, testInfo) => {
  await captureBrowserExports(page);
  const source = '# Export test\n\nText **bold**.\n\n<table><tr><th colspan="2">Group</th></tr><tr><td rowspan="2">Shared</td><td>A</td></tr><tr><td>B</td></tr></table>\n\n```python\ndef hello():\n    return 1\n```\n\n$$\nE=mc^2\n$$\n\n```mermaid\nflowchart LR\n A[Start]-->B[Done]\n```\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.getByRole('button', { name: '\u5bfc\u51fa\u6587\u6863', exact: true }).click();
  await page.locator('#export-format').selectOption('html');
  await page.locator('#export-submit').click();
  await expect.poll(() => page.evaluate(() => !!window.exportedFiles['test.html']), { timeout: 30000 }).toBe(true);
  const html = await page.evaluate(() => window.exportedFiles['test.html'].text);
  expect(html).not.toContain('inklet-files.local');
  expect(html).not.toContain('seveniear_7');
  expect(html).not.toContain('contenteditable');
  const preview = await page.context().newPage();
  await preview.setContent(html);
  await expect(preview.locator('table')).toBeVisible();
  await expect(preview.locator('th')).toHaveAttribute('colspan', '2');
  await expect(preview.locator('td').first()).toHaveAttribute('rowspan', '2');
  await expect(preview.locator('img')).toHaveCount(2);
  expect(await preview.locator('img').evaluateAll(images => images.every(image => image.src.startsWith('data:image/png;base64,')))).toBe(true);
  await expect.poll(() => preview.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  await preview.screenshot({ path: testInfo.outputPath('export-html.png'), fullPage: true });
  await preview.close();
  await page.getByRole('button', { name: '\u5bfc\u51fa\u6587\u6863', exact: true }).click();
  await page.locator('#export-format').selectOption('docx');
  await page.locator('#export-submit').click();
  await expect.poll(() => page.evaluate(() => !!window.exportedFiles['test.docx']), { timeout: 30000 }).toBe(true);
  const bytes = Buffer.from(await page.evaluate(() => window.exportedFiles['test.docx'].data), 'base64');
  const archive = await JSZip.loadAsync(bytes);
  expect(archive.file('word/document.xml')).toBeTruthy();
  expect(Object.keys(archive.files).filter(name => name.startsWith('word/media/') && name.endsWith('.png')).length).toBe(2);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('image export reports readable missing paths and can retain valid images', async ({ page }) => {
  const source = '# Images\n\n![Flow](<images/流程 示意.png>)\n\n![Cover](<占位：MD转Word时由模板封面带入>)\n\n![Missing](missing.png)\n\nDocument ending.\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const result = await page.evaluate(async text => {
    const { prepareExport, createWord } = await import('/src/export-document.js');
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 900;
    const context = canvas.getContext('2d'); context.fillStyle = '#347f91'; context.fillRect(0, 0, 1800, 900);
    const readAsset = async path => {
      if (decodeURIComponent(path) === 'images/流程 示意.png') return { mime: 'image/png', data: canvas.toDataURL().split(',')[1] };
      throw new Error('图片文件不存在。');
    };
    let failure;
    try { await prepareExport(text, { readAsset }); }
    catch (error) { failure = { name: error.name, message: error.message, count: error.issues?.length }; }
    if (failure?.name !== 'ImageExportError') return { failure };
    const snapshot = await prepareExport(text, { readAsset, allowMissingImages: true });
    return { failure, html: snapshot.html, word: await createWord(snapshot) };
  }, source);
  expect(result.failure?.name).toBe('ImageExportError');
  expect(result.failure.count).toBe(2);
  expect(result.failure.message).toContain('占位：MD转Word时由模板封面带入');
  expect(result.failure.message).not.toContain('%E5%');
  const preview = await page.context().newPage();
  await preview.setContent(result.html);
  await expect(preview.locator('img')).toHaveCount(1);
  await expect(preview.locator('.export-missing-image')).toHaveCount(2);
  await expect.poll(() => preview.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(preview.locator('main')).toContainText('Document ending.');
  await preview.close();
  const archive = await JSZip.loadAsync(Buffer.from(result.word, 'base64'));
  expect(Object.keys(archive.files).filter(name => name.startsWith('word/media/') && name.endsWith('.png')).length).toBe(1);
  expect(await archive.file('word/document.xml').async('string')).toContain('占位：MD转Word时由模板封面带入');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('image export dialog continues after confirmation and resets for each export', async ({ page }, testInfo) => {
  await captureBrowserExports(page);
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 800;
    const context = canvas.getContext('2d'); context.fillStyle = '#347f91'; context.fillRect(0, 0, 1600, 800);
    return canvas.toDataURL().split(',')[1];
  });
  await page.route('**/samples/export-image.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(data, 'base64') }));
  const source = '# Images\n\n![Valid](/samples/export-image.png)\n\n![Cover](<占位：MD转Word时由模板封面带入>)\n\n![Missing](missing.png)\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  for (const format of ['html', 'docx']) {
    await page.getByRole('button', { name: '导出文档', exact: true }).click();
    await expect(page.locator('#export-submit')).toHaveText('导出');
    await page.locator('#export-format').selectOption(format);
    await page.locator('#export-submit').click();
    await expect(page.locator('#export-submit')).toHaveText('继续导出');
    await expect(page.locator('#export-status')).toContainText('2 张图片无法读取');
    await expect(page.locator('#export-status')).toContainText('占位：MD转Word时由模板封面带入');
    expect(await page.evaluate(type => !!window.exportedFiles['test.' + type], format)).toBe(false);
    if (format === 'html') {
      await page.locator('#export-format').selectOption('docx');
      await expect(page.locator('#export-submit')).toHaveText('导出');
      await page.locator('#export-format').selectOption('html');
      await page.locator('#export-submit').click();
      await expect(page.locator('#export-submit')).toHaveText('继续导出');
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator('#export-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.locator('#export-submit')).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('missing-images-dialog-narrow.png') });
    }
    await page.locator('#export-submit').click();
    await expect.poll(() => page.evaluate(type => !!window.exportedFiles['test.' + type], format)).toBe(true);
    await expect(page.locator('#export-dialog')).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 960 });
  }
  const html = await page.evaluate(() => window.exportedFiles['test.html'].text);
  expect(html).toContain('data:image/png;base64,');
  expect(html).toContain('export-missing-image');
  const archive = await JSZip.loadAsync(Buffer.from(await page.evaluate(() => window.exportedFiles['test.docx'].data), 'base64'));
  expect(Object.keys(archive.files).filter(name => name.startsWith('word/media/') && name.endsWith('.png')).length).toBe(1);
  expect(await archive.file('word/document.xml').async('string')).toContain('图片未导出');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.evaluate(() => window.inkletTest.load('# Valid only\n\n![Valid](/samples/export-image.png)'));
  await page.getByRole('button', { name: '导出文档', exact: true }).click();
  await expect(page.locator('#export-submit')).toHaveText('导出');
  await page.locator('#export-submit').click();
  await expect(page.locator('#export-dialog')).toBeHidden();
});

test('image export fits wide and tall images to HTML width without losing their original pixels', async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const { prepareExport } = await import('/src/export-document.js');
    const pictures = new Map();
    for (const [name, width, height] of [['wide.png', 1800, 900], ['tall.png', 1000, 5000]]) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      for (let top = 0; top < height; top += 200) { context.fillStyle = top % 400 ? '#e9ac55' : '#347f91'; context.fillRect(0, top, width, 200); }
      pictures.set(name, { mime: 'image/png', data: canvas.toDataURL().split(',')[1] });
    }
    const snapshot = await prepareExport('![Wide](wide.png)\n\n![Tall](tall.png)\n\n| Image | Description |\n|---|---|\n| ![Cell](wide.png) | Table image |', { readAsset: async path => pictures.get(path) });
    return { html: snapshot.html, tallPixels: snapshot.images.get('tall.png').data, original: pictures.get('tall.png').data };
  });
  expect(result.html).toContain(result.original);
  const preview = await page.context().newPage();
  for (const width of [1440, 390]) {
    await preview.setViewportSize({ width, height: 844 });
    await preview.setContent(result.html);
    await expect.poll(() => preview.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    const geometry = await preview.locator('img').evaluateAll(images => images.map(image => ({
      width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height,
      parentWidth: image.parentElement.getBoundingClientRect().width, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
    })));
    expect(geometry.every(image => image.width <= image.parentWidth + 1)).toBe(true);
    expect(geometry[0].width / geometry[0].height).toBeCloseTo(2, 1);
    expect(geometry[1].width / geometry[1].height).toBeCloseTo(.2, 2);
    expect(geometry[1].naturalWidth).toBe(1000);
    expect(geometry[1].naturalHeight).toBe(5000);
    expect(geometry[1].height).toBeGreaterThan(1000);
    expect(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await preview.screenshot({ path: testInfo.outputPath('image-width-' + width + '.png'), fullPage: true });
  }
  const ratio = await preview.evaluate(async data => {
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    return image.naturalWidth / image.naturalHeight;
  }, result.tallPixels);
  expect(ratio).toBeCloseTo(.2, 2);
  await preview.close();
});

test('software information is accessible and never changes the document', async ({ page }, testInfo) => {
  const original = await page.evaluate(() => ({ source: window.inkletTest.source, revision: window.inkletTest.revision }));
  const entry = page.getByRole('button', { name: '\u8f6f\u4ef6\u8bf4\u660e', exact: true });
  const dialog = page.getByRole('dialog', { name: '\u8f6f\u4ef6\u8bf4\u660e', exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(entry).toBeVisible();
    await entry.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('\u8f6f\u4ef6\u7f16\u5199\u4f5c\u8005');
    await expect(dialog).toContainText('\u8fbe\u82ac\u5947Vincent');
    await expect(dialog).toContainText('seveniear_7');
    await expect(dialog).not.toContainText('软件付费及维护');
    await expect(dialog.locator('.release-version').first()).toHaveText('0.10.0');
    await expect(dialog.locator('.release-date').first()).toHaveText('2026-10-14');
    await expect(dialog.locator('.release-table th')).toHaveText(['版本', '更新内容', '日期']);
    expect(await dialog.locator('.release-summary').evaluateAll(items => items.every(item => item.textContent.length >= 16 && item.textContent.length <= 26))).toBe(true);
    const notes = dialog.locator('.release-notes');
    expect(await notes.evaluate(element => element.offsetHeight === 144 && element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds.height).toBeLessThanOrEqual(560);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(width === 1440 ? 'about-desktop.png' : 'about-mobile.png') });
    await notes.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.locator('.release-version').last()).toBeInViewport();
    await notes.evaluate(element => { element.scrollTop = 0; element.scrollLeft = element.scrollWidth; });
    await expect(dialog.locator('.release-date').first()).toBeInViewport();
    expect(await notes.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath(width === 1440 ? 'about-dates-desktop.png' : 'about-dates-mobile.png') });
    expect((await dialog.boundingBox()).height).toBe(bounds.height);
    if (width === 1440) await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: '\u5173\u95ed', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(entry).toBeFocused();
  }
  expect(await page.evaluate(() => ({ source: window.inkletTest.source, revision: window.inkletTest.revision }))).toEqual(original);
  await entry.click();
  await page.emulateMedia({ media: 'print' });
  await expect(dialog).toBeHidden();
});

test('copyright stays visible below the editor and is excluded from document printing', async ({ page }, testInfo) => {
  const footer = page.locator('.copyright-notice');
  const logo = page.locator('.brand-logo');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate(image => image.complete && image.naturalWidth === 256 && image.naturalHeight === 256)).toBe(true);
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await expect(footer).toContainText('\u6cf0\u5b89\u5e02\u5cb1\u5cb3\u533a\u6e05\u4e91\u667a\u6570\u4f01\u4e1a\u7ba1\u7406\u54a8\u8be2\u5de5\u4f5c\u5ba4');
  await expect(footer).toContainText('\u7248\u6743\u6240\u6709');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(footer).toBeVisible();
    const bounds = await footer.boundingBox();
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(logo).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(width === 1440 ? 'branding-desktop.png' : 'branding-mobile.png') });
  }
  await page.emulateMedia({ media: 'print' });
  await expect(footer).toBeHidden();
});

test('source and rich edits synchronize and share undo history', async ({ page }) => {
  await page.evaluate(() => window.inkletTest.load('# Title\n\n_Keep this_\n\nEdit me\n'));
  await page.locator('.cm-content').click();
  await page.locator('.cm-content').press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Source addition');
  await expect(page.locator('.inklet-prose')).toContainText('Source addition');
  const paragraph = page.locator('.inklet-prose p').filter({ hasText: 'Edit me' });
  await expect(paragraph).toHaveText('Edit me');
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' rich addition');
  await expect.poll(() => page.evaluate(() => window.inkletTest.source)).toContain('Edit me rich addition');
  await expect.poll(() => page.evaluate(() => window.inkletTest.source)).toContain('_Keep this_');
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.inkletTest.source)).not.toContain('rich addition');
  await expect.poll(() => page.evaluate(() => window.inkletTest.source)).toContain('Source addition');
});

test('selection highlights recolor, clear and survive text insertion', async ({ page }) => {
  await page.evaluate(() => window.inkletTest.load('First paragraph\n\nHighlight these words.\n'));
  await page.evaluate(() => { const from = window.inkletTest.source.indexOf('these'); window.inkletTest.select(from, from + 5); });
  await page.getByRole('button', { name: '\u5929\u84dd\u9ad8\u4eae', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.inkletTest.marks.length)).toBe(1);
  await expect(page.locator('.inklet-prose .reading-highlight')).toHaveText('these');
  await page.locator('.cm-content').press('Control+Home');
  await page.keyboard.insertText('NEW ');
  await expect(page.locator('.inklet-prose .reading-highlight')).toHaveText('these');
  await page.evaluate(() => { const from = window.inkletTest.source.indexOf('these'); window.inkletTest.select(from, from + 5); });
  await page.getByRole('button', { name: '\u6e05\u9664\u9ad8\u4eae', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.inkletTest.marks.length)).toBe(0);
  await page.getByRole('button', { name: '\u64a4\u9500', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.inkletTest.marks.length)).toBe(1);
});

test('theme settings are independent and pane switches remain accessible', async ({ page }) => {
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.source-pane')).toHaveCSS('background-image', 'none');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-image', 'none');
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await expect(page.locator('[data-theme-side="leftTheme"]:visible')).toHaveCount(6);
  await expect(page.locator('[data-theme-side="rightTheme"]:visible')).toHaveCount(6);
  const choices = await page.locator('[data-theme-side="leftTheme"]:visible').evaluateAll(elements => elements.map(element => ({ key: element.dataset.theme, name: element.textContent, color: element.firstElementChild.style.backgroundColor })));
  expect(await page.locator('[data-theme-side="rightTheme"]:visible').allTextContents()).toEqual(choices.map(choice => choice.name));
  for (const choice of choices) {
    await page.locator(`[data-theme-side="leftTheme"][data-theme="${choice.key}"]`).click();
    await expect(page.locator('.source-pane')).toHaveCSS('background-color', choice.color);
    await page.locator(`[data-theme-side="rightTheme"][data-theme="${choice.key}"]`).click();
    await expect(page.locator('.rich-pane')).toHaveCSS('background-color', choice.color);
    expect(await page.locator('.source-pane').evaluate(element => getComputedStyle(element).backgroundImage)).toBe(await page.locator('.rich-pane').evaluate(element => getComputedStyle(element).backgroundImage));
    await page.locator('[data-theme-side="leftTheme"][data-theme="white"]').click();
    await expect(page.locator('.rich-pane')).toHaveCSS('background-color', choice.color);
  }
  await page.locator('[data-action="unify-theme"]').click();
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(229, 233, 231)');
  await page.locator('[data-theme-side="rightTheme"][data-theme="gray"]').click();
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(229, 233, 231)');
  await page.locator('[data-theme-side="leftTheme"][data-theme="ink"]').click();
  await page.locator('[data-theme-side="rightTheme"][data-theme="gray"]').click();
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(238, 241, 245)');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(243, 244, 246)');
  await page.getByRole('button', { name: '\u5173\u95ed\u6e90\u7801\u89c6\u56fe', exact: true }).click();
  await expect(page.locator('.source-pane')).toBeHidden();
  await page.getByRole('button', { name: '\u5173\u95ed\u9605\u8bfb\u89c6\u56fe', exact: true }).click();
  await expect(page.locator('#empty-workspace')).toBeVisible();
  await page.getByRole('button', { name: '\u9605\u8bfb\u7f16\u8f91\u89c6\u56fe', exact: true }).click();
  await expect(page.locator('.rich-pane')).toBeVisible();
  await page.reload();
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(243, 244, 246)');
});

test('legacy background choices migrate without resetting typography or linking panes', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('inklet.settings', JSON.stringify({ leftTheme: 'cyan', rightTheme: 'ink', unifiedPaper: true, fontSize: 20, lineHeight: 1.9 })));
  await page.reload();
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(229, 233, 231)');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(229, 233, 231)');
  await expect(page.locator('.inklet-prose')).toHaveCSS('font-size', '20px');
  await expect(page.locator('.inklet-prose')).toHaveCSS('line-height', '38px');
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('[data-theme-side="rightTheme"][data-theme="white"]').click();
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(229, 233, 231)');
  await page.reload();
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-image', 'none');
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(229, 233, 231)');
});

test('paper and typography controls persist without shrinking the first paragraph', async ({ page }, testInfo) => {
  const firstParagraph = page.locator('.inklet-prose h1 + p');
  await expect(firstParagraph).toHaveCSS('font-size', '18px');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-image', 'none');
  const grain = await page.request.get('/paper-grain.png');
  expect(grain.ok()).toBe(true);
  expect((await grain.body()).subarray(1, 4).toString()).toBe('PNG');
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('[data-theme-side="rightTheme"][data-theme="cyan"]').click();
  await expect(page.locator('.rich-pane')).toHaveCSS('background-image', /paper-grain/);
  await page.locator('#reading-font-input').selectOption('sans');
  await page.locator('#line-height-input').focus();
  await page.keyboard.press('End');
  await page.locator('#reading-width-input').focus();
  await page.keyboard.press('End');
  await page.locator('#paper-input').uncheck();
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  await expect(page.locator('.inklet-prose')).toHaveCSS('line-height', '46.8px');
  await expect(page.locator('.inklet-prose')).toHaveCSS('max-width', '960px');
  await expect(page.locator('.inklet-prose')).toHaveCSS('font-family', /Noto Sans SC/);
  await expect(page.locator('.rich-pane')).toHaveCSS('background-image', 'none');
  await page.reload();
  await expect(page.locator('.inklet-prose')).toHaveCSS('line-height', '46.8px');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-image', 'none');
  await page.getByRole('button', { name: '\u9605\u8bfb\u8bbe\u7f6e', exact: true }).click();
  await page.locator('#reading-font-input').selectOption('book');
  await page.locator('#paper-input').check();
  await page.screenshot({ path: testInfo.outputPath('reading-settings.png') });
  await page.getByRole('button', { name: '\u5b8c\u6210', exact: true }).click();
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.inklet-prose h1 + p' });
  const fonts = await client.send('CSS.getPlatformFontsForNode', { nodeId });
  expect(fonts.fonts.some(font => font.glyphCount > 0)).toBe(true);
  await testInfo.attach('platform-fonts.json', { body: JSON.stringify(fonts), contentType: 'application/json' });
});

test('real MathJax SVG and Mermaid SVG render without duplicate identifiers', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.math-block').scrollIntoViewIfNeeded();
  await expect(page.locator('.math-block svg')).toBeVisible();
  await page.locator('.diagram-block').scrollIntoViewIfNeeded();
  await expect(page.locator('.diagram-block > svg')).toBeVisible();
  const duplicates = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('.inklet-prose [id]')].map(element => element.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  });
  expect(duplicates).toEqual([]);
  expect(errors).toEqual([]);
});

test('hundred-thousand-character document remains searchable with bounded highlighting', async ({ page }, testInfo) => {
  const text = '# Large document\n\n' + '\u58a8\u70b9\u9605\u8bfb\u7b14\u8bb0\u3002 '.repeat(15000) + '\n\nUNIQUE_NEEDLE';
  const start = Date.now();
  await page.evaluate(text => window.inkletTest.load(text), text);
  const loaded = Date.now();
  await page.getByRole('button', { name: '\u67e5\u627e\u4e0e\u66ff\u6362', exact: true }).click();
  await page.getByRole('textbox', { name: '\u67e5\u627e\u5185\u5bb9', exact: true }).fill('UNIQUE_NEEDLE');
  await expect(page.locator('#search-count')).toContainText('1');
  const searched = Date.now();
  await page.locator('#search-input').fill('\u58a8\u70b9');
  await expect(page.locator('#search-count')).toContainText('15,000');
  expect(await page.locator('.cm-content .search-match').count()).toBeLessThan(5001);
  await testInfo.attach('performance.json', { body: JSON.stringify({ characters: text.length, openMs: loaded - start, searchUiMs: searched - loaded, workerTime: await page.locator('#search-time').textContent() }), contentType: 'application/json' });
});

test('desktop and mobile layouts have no page overflow and controls are visible', async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.rich-pane')).toBeVisible();
  await expect(page.locator('.source-pane')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile.png') });
});

test('glass chrome keeps paper panes independent and controls readable across window sizes', async ({ page }, testInfo) => {
  await expect(page.locator('.app-header')).toHaveCSS('backdrop-filter', /blur/);
  await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('glass-desktop.png') });
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#settings-dialog')).toHaveCSS('backdrop-filter', /blur/);
  await page.screenshot({ path: testInfo.outputPath('glass-settings.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  const lastControl = await page.locator('.header-actions [data-action="about"]').boundingBox();
  expect(lastControl.x + lastControl.width).toBeLessThanOrEqual(390);
  await expect(page.locator('[data-action="save-as"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('glass-narrow.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.header-actions [data-action="save"]')).toHaveCSS('transition-duration', '0s');
});

test('HTML tables display merged cells, remain editable and reject active HTML', async ({ page }) => {
  const source = '# Merged table\n\n<table onclick="window.tableAttack=1"><tr><th colspan="2">Group</th></tr><tr><td rowspan="2">Shared</td><td><strong>Value</strong></td></tr><tr><td><script>window.tableAttack=1</script>Last</td></tr></table>\n\nKeep this paragraph.\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  await expect(page.locator('.inklet-prose table')).toHaveCount(1);
  await expect(page.locator('.inklet-prose th')).toHaveAttribute('colspan', '2');
  await expect(page.locator('.inklet-prose td').first()).toHaveAttribute('rowspan', '2');
  await expect(page.locator('.inklet-prose script')).toHaveCount(0);
  expect(await page.evaluate(() => window.tableAttack)).toBeUndefined();
  await page.locator('.inklet-prose td').last().click();
  await page.keyboard.press('End'); await page.keyboard.insertText(' edited');
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('rowspan="2"');
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('Last edited');
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('Keep this paragraph.');
  await page.keyboard.press('Control+Z');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
});

test('tables inside notes hydrate in large documents and remain editable', async ({ page }, testInfo) => {
  const source = '# Quoted tables\n\n> **Field confirmation**\n>\n> | Field | SAP source | Meaning | Status |\n> | --- | --- | --- | --- |\n> | settlement_receiver | COBRB-KONTY | Receiver | Pending |\n> | actual_start_time | AFKO-ISDZ | Start time | Pending |\n\n> > <table><tr><th colspan="2">Nested HTML</th></tr><tr><td>Nested value</td><td>Present</td></tr></table>\n\n## Long content\n\n' + 'Long document content. '.repeat(11000) + '\n';
  await page.evaluate(text => window.inkletTest.load(text), source);
  expect(await page.evaluate(() => window.inkletTest.richEditor.parsed.doc.content.size)).toBeGreaterThan(200000);
  const note = page.locator('.inklet-prose > blockquote').first();
  await expect(note.locator('.inklet-table')).toHaveCount(1);
  await expect(note.locator('table')).toBeVisible();
  await expect(note.locator('tr')).toHaveCount(3);
  await expect(note.locator('td')).toHaveCount(8);
  await expect(note.locator('.table-placeholder')).toHaveCount(0);
  await expect(note).toHaveCSS('background-color', 'rgb(237, 244, 246)');
  const nested = page.locator('.inklet-prose > blockquote').nth(1);
  await nested.scrollIntoViewIfNeeded();
  await expect(nested.locator('table')).toBeVisible();
  await expect(nested.locator('th')).toHaveAttribute('colspan', '2');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await note.locator('td').filter({ hasText: /^Receiver$/ }).click();
  await page.keyboard.press('End'); await page.keyboard.insertText(' edited');
  await expect(note.locator('td').filter({ hasText: /^Receiver edited$/ })).toBeVisible();
  expect(await page.evaluate(() => window.inkletTest.source)).toContain('Receiver edited');
  await page.keyboard.press('Control+Z');
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await page.screenshot({ path: testInfo.outputPath('note-tables.png') });
});

test('large HTML table documents hydrate only nearby tables and can navigate to the end', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const source = Array.from({ length: 80 }, (_, index) => `${index ? '## Sheet ' + index + '\n\n' : ''}<table><tr><th colspan="8">Sheet ${index}</th></tr>${Array.from({ length: 60 }, (_, row) => '<tr>' + Array.from({ length: 8 }, (_, column) => `<td>Cell ${index}-${row}-${column}</td>`).join('') + '</tr>').join('')}</table>\n\n`).join('');
  await page.evaluate(text => window.inkletTest.load(text), source);
  await expect(page.locator('.inklet-table')).toHaveCount(80);
  await expect.poll(() => page.locator('.inklet-table table').count()).toBeGreaterThan(0);
  expect(await page.locator('.inklet-table table').count()).toBeLessThan(8);
  await page.locator('.outline-item').filter({ hasText: /^Sheet 79$/ }).click();
  await expect(page.locator('.inklet-table').last().locator('table')).toBeVisible();
  await expect(page.locator('.inklet-table').last().locator('th')).toHaveAttribute('colspan', '8');
  await page.locator('[data-action="search"]').click();
  await page.locator('#search-input').fill('Cell 40-10-3');
  await expect(page.locator('#search-count')).toHaveText('1 处');
  await page.locator('[data-action="next"]').click();
  await expect(page.locator('.inklet-table').nth(40).locator('td').filter({ hasText: /^Cell 40-10-3$/ })).toBeVisible();
  await page.locator('[data-action="search-close"]').click();
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  await expect(page.locator('#dirty-dot')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('large-html-tables.png') });
});

test('TOC navigation survives a pending editor flush and outline navigation survives a redraw', async ({ page }) => {
  const source = '# Start\n\n[toc]\n\n' + 'A paragraph before the destination.\n\n'.repeat(80) + '## Destination\n\nFinal text.\n';
  const visibleTarget = () => page.locator('.inklet-prose h2').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const viewport = document.querySelector('#rich-editor').getBoundingClientRect();
    return bounds.top >= viewport.top - 20 && bounds.bottom <= viewport.bottom;
  });
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.evaluate(() => {
    window.inkletTest.sourceEditor.view.dispatch({ changes: { from: 0, insert: 'A new introduction.\n\n' } });
    const link = [...document.querySelectorAll('.document-toc a')].find(element => element.textContent === 'Destination');
    link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
  await expect.poll(visibleTarget).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe('A new introduction.\n\n' + source);
  await page.evaluate(text => window.inkletTest.load(text), source);
  await page.evaluate(() => {
    window.inkletTest.sourceEditor.view.dispatch({ changes: { from: 0, insert: 'A pending introduction.\n\n' } });
    window.oldOutlineButton = [...document.querySelectorAll('.outline-item')].find(element => element.textContent === 'Destination');
    window.oldOutlineButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  });
  await page.waitForFunction(() => !window.oldOutlineButton.isConnected);
  await page.evaluate(() => window.oldOutlineButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
  await expect.poll(visibleTarget).toBe(true);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe('A pending introduction.\n\n' + source);
});

test('Word typography capture matches current reading controls and heading levels', async ({ page }) => {
  await page.evaluate(() => window.inkletTest.load('# First\n\n## Second\n\n### Third\n\n#### Fourth\n\nBody paragraph.'));
  await page.locator('[data-action="settings"]').click();
  await page.locator('#reading-font-input').selectOption('sans');
  for (const [selector, value] of [['#font-input', '20'], ['#line-height-input', '2.3'], ['#paragraph-gap-input', '1.2']]) {
    await page.locator(selector).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  }
  await page.keyboard.press('Escape');
  const captured = await page.evaluate(async () => {
    const module = await import('/src/export-document.js');
    const editor = window.inkletTest.richEditor.view.dom;
    const typography = await module.captureReadingTypography(editor);
    const paragraph = getComputedStyle(editor.querySelector('p'));
    const heading = getComputedStyle(editor.querySelector('h4'));
    const encoded = await module.createWord({ title: 'Current styles', doc: window.inkletTest.richEditor.parsed.doc, images: new Map(), graphics: new Map(), colors: {}, typography });
    return { typography, bodySize: parseFloat(paragraph.fontSize), bodyGap: parseFloat(paragraph.marginBottom), headingSize: parseFloat(heading.fontSize), encoded };
  });
  expect(captured.typography.body.fontSize).toBe(captured.bodySize);
  expect(captured.typography.body.marginBottom).toBe(captured.bodyGap);
  expect(captured.typography.headings[4].fontSize).toBe(captured.headingSize);
  expect(captured.typography.body.lineHeight).toBeCloseTo(2.3);
  const archive = await JSZip.loadAsync(Buffer.from(captured.encoded, 'base64'));
  const styles = await archive.file('word/styles.xml').async('string');
  expect(styles).toContain('w:val="30"');
  expect(styles).toContain('w:after="360"');
  expect(styles).toContain('w:line="552"');
});

test('adaptive tables give descriptions more width without changing Markdown', async ({ page }, testInfo) => {
  const source = '| ID | Type | Description |\n| --- | --- | --- |\n| 1 | date | This column contains a detailed explanation about validation, business rules and user responsibilities. |\n| 2 | time | Another longer explanation with substantially more text than the identifier and type columns. |';
  await page.evaluate(text => window.inkletTest.load(text), source);
  const widths = () => page.locator('.inklet-table col').evaluateAll(columns => columns.map(column => parseFloat(column.style.width)));
  await expect.poll(async () => { const values = await widths(); return values[2] / values[0]; }).toBeGreaterThan(1.5);
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(source);
  const html = await page.evaluate(async text => (await (await import('/src/export-document.js')).prepareExport(text)).html, source);
  const exported = await page.context().newPage(); await exported.setContent(html);
  const exportWidths = await exported.locator('col').evaluateAll(columns => columns.map(column => parseFloat(column.style.width)));
  expect(exportWidths[2]).toBeGreaterThan(exportWidths[0] * 1.5);
  await exported.close();
  await page.screenshot({ path: testInfo.outputPath('adaptive-columns.png') });
});

test('Ctrl wheel changes reading size and five shell themes keep paper backgrounds', async ({ page }, testInfo) => {
  const original = await page.evaluate(() => window.inkletTest.source);
  const originalSize = Number(await page.locator('#font-size').textContent());
  const handled = await page.locator('#rich-editor').evaluate(element => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(handled).toBe(true);
  await expect(page.locator('#font-size')).toHaveText(String(originalSize + 1));
  expect(await page.evaluate(() => window.inkletTest.source)).toBe(original);
  await page.locator('#rich-editor').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await expect(page.locator('#font-size')).toHaveText(String(originalSize));
  await page.locator('[data-action="settings"]').click();
  await page.locator('#ctrl-wheel-input').uncheck();
  await expect(page.locator('.interface-theme:visible')).toHaveCount(4);
  for (const theme of ['white', 'orange', 'blue', 'candy', 'jade']) {
    await page.locator('#interface-family-input').selectOption(theme === 'candy' ? 'candy' : 'clear');
    await page.locator('.interface-theme[data-interface-theme="' + theme + '"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-interface-theme', theme);
    await expect(page.locator('.source-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.rich-pane')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.app-header')).toHaveCSS('backdrop-filter', /blur/);
    await page.screenshot({ path: testInfo.outputPath('theme-' + theme + '.png') });
  }
  await page.locator('#interface-family-input').selectOption('candy');
  await page.locator('.interface-theme[data-interface-theme="candy"]').click();
  await page.keyboard.press('Escape');
  const blocked = await page.locator('#rich-editor').evaluate(element => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(blocked).toBe(false);
  await page.reload(); await page.waitForFunction(() => !!window.inkletTest);
  await expect(page.locator('html')).toHaveAttribute('data-interface-theme', 'candy');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#ctrl-wheel-input')).not.toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('#settings-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});