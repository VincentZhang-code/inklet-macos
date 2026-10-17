import { TableView, TableMap, columnResizingPluginKey } from 'prosemirror-tables';
import { tableColumnWidths } from './table-layout.js';

export class TableViewport {
  constructor(editor) {
    this.editor = editor;
    this.visible = new WeakSet();
    this.heights = new WeakMap();
    this.entries = new Map();
    this.frame = null;
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const item = this.entries.get(entry.target);
        if (item?.tableView) this.fitColumns(item);
      }
    });
    this.observer = new IntersectionObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const item = this.entries.get(entry.target);
        if (!item) continue;
        if (entry.isIntersecting && !this.visible.has(item.node)) { this.visible.add(item.node); changed = true; }
        if (!entry.isIntersecting && this.visible.has(item.node) && !this.selected(item)) {
          if (item.active) this.heights.set(item.node, item.dom.getBoundingClientRect().height);
          this.visible.delete(item.node); changed = true;
        }
      }
      if (changed && this.frame === null) this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (!this.editor.view.isDestroyed) this.editor.refresh();
      });
    }, { root: editor.container, rootMargin: '700px 0px' });
  }

  selected(item, view = this.editor.view) {
    const position = item.getPos();
    const selection = view?.state.selection;
    if (position == null || !selection) return false;
    return [selection.anchor, selection.head].some(value => value > position && value < position + item.node.nodeSize);
  }

  active(item, view = this.editor.view) { return this.editor.parsed.doc.content.size < 200000 || this.visible.has(item.node) || this.selected(item, view); }

  fitColumns(item, force = false) {
    const width = item.dom.clientWidth;
    if (!width || columnResizingPluginKey.getState(this.editor.view?.state)?.dragging) return;
    const fontSize = parseFloat(getComputedStyle(item.tableView.table).fontSize) || 14;
    if (!force && item.fittedNode === item.node && item.fittedWidth === width && item.fittedFont === fontSize) return;
    const widths = tableColumnWidths(item.node, width, fontSize);
    for (const [index, column] of [...item.tableView.colgroup.children].entries()) column.style.width = widths[index] + 'px';
    const total = widths.reduce((sum, value) => sum + value, 0);
    item.tableView.table.style.width = total + 'px';
    item.tableView.table.style.minWidth = total + 'px';
    item.fittedNode = item.node; item.fittedWidth = width; item.fittedFont = fontSize;
  }

  create(node, view, getPos) {
    const item = { node, getPos };
    item.active = this.active(item, view);
    const tableView = item.active ? new TableView(node, node.attrs.format === 'html' ? 120 : 80) : null;
    item.tableView = tableView;
    const dom = tableView?.dom || document.createElement('div');
    item.dom = dom;
    dom.classList.add('inklet-table');
    dom.dataset.tableFormat = node.attrs.format;
    dom.dataset.tableLoaded = String(item.active);
    if (!item.active) {
      dom.classList.add('table-placeholder');
      dom.contentEditable = 'false';
      dom.style.height = Math.max(100, this.heights.get(node) || node.childCount * 66) + 'px';
      const label = document.createElement('button');
      label.type = 'button'; label.className = 'table-load-button';
      label.textContent = `${node.childCount.toLocaleString()} 行 · ${TableMap.get(node).width} 列`;
      label.title = '显示表格';
      label.addEventListener('click', () => { this.visible.add(item.node); this.editor.refresh(); });
      dom.append(label);
    }
    this.entries.set(dom, item);
    this.observer.observe(dom);
    if (tableView) this.resizeObserver.observe(dom);
    return {
      dom, contentDOM: tableView?.contentDOM,
      update: next => {
        if (next.type !== item.node.type) return false;
        if (next !== item.node && this.visible.has(item.node)) this.visible.add(next);
        item.node = next;
        if (this.active(item) !== item.active) return false;
        if (!tableView) return true;
        const updated = tableView.update(next);
        if (updated) this.fitColumns(item, true);
        return updated;
      },
      ignoreMutation: mutation => tableView ? tableView.ignoreMutation(mutation) : mutation.type !== 'selection',
      stopEvent: event => !item.active && event.target.closest('button'),
      destroy: () => { this.observer.unobserve(dom); this.resizeObserver.unobserve(dom); this.entries.delete(dom); },
    };
  }

  ensure(position) {
    let changed = false;
    for (const item of this.entries.values()) {
      const start = item.getPos();
      if (start != null && position >= start && position <= start + item.node.nodeSize && !item.active) {
        this.visible.add(item.node); changed = true;
      }
    }
    if (changed) this.editor.refresh();
  }

  destroy() { this.observer.disconnect(); this.resizeObserver.disconnect(); if (this.frame !== null) cancelAnimationFrame(this.frame); }
}