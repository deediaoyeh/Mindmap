/**
 * Bi-directional Outliner Mode (XMind Outliner parity).
 * Supports inline typing, Enter (sibling), Tab (indent), Shift+Tab (outdent),
 * collapse/expand, to-do toggles, notes preview, and instant sync with the Mind Map.
 */

import { store } from '../core/store.js';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class OutlinerView {
  constructor(container) {
    this.container = container;
  }

  render() {
    if (store.viewMode !== 'outliner') return;
    const sheet = store.getActiveSheet();
    if (!sheet) return;
    const matched = store.getMatchedNodeIds(sheet);

    const rowsHtml = [];
    const walk = (node, depth) => {
      const hiddenByFilter = matched && !matched.has(node.id);
      const isSelected = store.selectedNodeId === node.id;
      const hasKids = node.children && node.children.length > 0;
      const indentPx = depth * 24;

      rowsHtml.push(`
        <div class="outliner-row depth-${Math.min(depth, 3)}${isSelected ? ' selected' : ''}" data-oid="${node.id}" style="margin-left:${indentPx}px;${hiddenByFilter ? 'opacity:0.25;' : ''}">
          <button class="outliner-toggle" data-otoggle="${node.id}" title="收合 / 展開" style="${hasKids ? '' : 'visibility:hidden'}">
            ${node.collapsed ? '▸' : '▾'}
          </button>
          ${node.todo ? `<input type="checkbox" data-otodo="${node.id}" ${node.todo.checked ? 'checked' : ''} style="margin-top:6px;cursor:pointer;" />` : `<span class="outliner-bullet" style="${depth === 0 ? 'width:10px;height:10px;margin-top:11px;' : ''}"></span>`}
          <div style="flex:1;min-width:0;">
            <input class="outliner-input" data-oinput="${node.id}" value="${esc(node.title)}" style="${node.todo?.checked ? 'text-decoration:line-through;opacity:0.65;' : ''}" />
            ${(node.labels?.length || node.link || node.task) ? `
              <div class="outliner-meta">
                ${(node.labels || []).map(l => `<span class="tag-pill">${esc(l)}</span>`).join('')}
                ${node.link ? `<a href="${esc(node.link)}" target="_blank" rel="noopener" style="font-size:11.5px;color:var(--accent);">🔗 連結</a>` : ''}
                ${node.task ? `<span style="font-size:11px;color:var(--ui-text-muted);">📅 ${esc(node.task.start || '')} ~ ${esc(node.task.end || '')} (${node.task.progress || 0}%)</span>` : ''}
              </div>
            ` : ''}
            ${node.notes ? `<div class="outliner-note-preview">📝 ${esc(node.notes)}</div>` : ''}
          </div>
          <button class="btn btn-sm" data-oadd="${node.id}" title="新增子主題" style="opacity:0.65;">＋</button>
        </div>
      `);

      if (!node.collapsed && hasKids) {
        for (const c of node.children) walk(c, depth + 1);
      }
    };

    walk(sheet.root, 0);

    this.container.innerHTML = `
      <div class="outliner-container">
        <div class="outliner-paper">
          <div class="outliner-header">
            <div>
              <strong style="font-size:15px;">大綱模式 · ${esc(sheet.title)}</strong>
              <div style="font-size:12px;color:var(--ui-text-muted);margin-top:2px;">Enter 新增同層｜Tab 縮排｜Shift+Tab 凸排｜與心智圖即時雙向同步</div>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm" id="ol-expand-all">全部展開</button>
              <button class="btn btn-sm" id="ol-collapse-all">全部收合</button>
            </div>
          </div>
          <div class="outliner-tree">${rowsHtml.join('')}</div>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    this.container.querySelector('#ol-expand-all')?.addEventListener('click', () => store.setAllCollapsed(false));
    this.container.querySelector('#ol-collapse-all')?.addEventListener('click', () => store.setAllCollapsed(true));

    this.container.querySelectorAll('[data-otoggle]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        store.toggleCollapse(btn.dataset.otoggle);
      });
    });

    this.container.querySelectorAll('[data-otodo]').forEach(cb => {
      cb.addEventListener('change', () => {
        store.updateNode(cb.dataset.otodo, { todo: { checked: cb.checked } });
      });
    });

    this.container.querySelectorAll('[data-oadd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const created = store.addChild(btn.dataset.oadd, '新主題', false);
        if (created) this._focusNode(created.id);
      });
    });

    this.container.querySelectorAll('[data-oinput]').forEach(input => {
      const id = input.dataset.oinput;
      input.addEventListener('focus', () => {
        if (store.selectedNodeId !== id) store.selectNode(id, false);
      });
      input.addEventListener('change', () => {
        const val = input.value.trim() || '未命名主題';
        const n = store.findNode(id);
        if (n && n.title !== val) store.updateNode(id, { title: val });
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = input.value.trim() || '未命名主題';
          const n = store.findNode(id);
          if (n && n.title !== val) store.updateNode(id, { title: val });
          const created = store.addSibling(id, '', false);
          if (created) this._focusNode(created.id);
        } else if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          if (store.indentNode(id)) this._focusNode(id);
        } else if (e.key === 'Tab' && e.shiftKey) {
          e.preventDefault();
          if (store.outdentNode(id)) this._focusNode(id);
        } else if (e.key === 'Backspace' && input.value === '') {
          e.preventDefault();
          store.deleteNode(id);
        }
      });
    });
  }

  _focusNode(id) {
    requestAnimationFrame(() => {
      const el = this.container.querySelector(`[data-oinput="${id}"]`);
      if (el) {
        el.focus();
        el.select();
      }
    });
  }
}
