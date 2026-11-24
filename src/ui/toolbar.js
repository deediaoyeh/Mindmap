/**
 * Top Toolbar, Left Drawer (My Works + Find/Replace/Filter), and Bottom Bar (Multi-Sheet + Zoom + Views).
 */

import { gdrive } from '../core/gdrive.js';
import { getStorageBadgeInfo } from '../core/localFile.js';
import { store } from '../core/store.js';
import { MARKER_GROUPS } from '../render/themes.js';
import { showToast } from './toast.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class StudioChrome {
  constructor({ canvas, pitch, modals, toggleZen }) {
    this.canvas = canvas;
    this.pitch = pitch;
    this.modals = modals;
    this.toggleZen = toggleZen;

    this.toolbarEl = document.getElementById('top-toolbar');
    this.drawerEl = document.getElementById('left-drawer');
    this.bottomEl = document.getElementById('bottom-bar');
    this.currentZoom = 1;

    this.canvas.onZoomChange = (scale) => {
      this.currentZoom = scale;
      const sel = this.bottomEl.querySelector('#zoom-select');
      if (sel) sel.title = `目前縮放 ${Math.round(scale * 100)}%`;
      const lbl = this.bottomEl.querySelector('#zoom-pct-label');
      if (lbl) lbl.textContent = `${Math.round(scale * 100)}%`;
    };
  }

  render() {
    this._renderToolbar();
    this._renderLeftDrawer();
    this._renderBottomBar();
  }

  _renderToolbar() {
    const doc = store.getActiveDoc();
    const hasSel = Boolean(store.selectedNodeId);

    this.toolbarEl.innerHTML = `
      <div class="tb-group">
        <button class="brand-chip" id="tb-works-btn" title="我的作品與所有檔案管理">
          <span class="brand-logo">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2">
              <circle cx="12" cy="12" r="3"/><path d="M9.5 10L5.5 6.5M14.5 10L18.5 6.5M9.5 14L5.5 17.5M14.5 14L18.5 17.5"/>
              <circle cx="4.5" cy="5.5" r="1.8"/><circle cx="19.5" cy="5.5" r="1.8"/><circle cx="4.5" cy="18.5" r="1.8"/><circle cx="19.5" cy="18.5" r="1.8"/>
            </svg>
          </span>
          <span>MindFlow</span>
        </button>
        <button class="tb-btn" id="tb-new-doc-btn" title="建立新心智圖檔案 (Alt+N)">📄<span class="tb-label-md">新檔案</span></button>
        <input id="doc-title-input" class="doc-title-input" value="${esc(doc.title)}" title="點擊重新命名文件" />
        <button class="storage-pill storage-${getStorageBadgeInfo(doc).type}" id="tb-storage-pill" title="${esc(getStorageBadgeInfo(doc).fullLabel)}">
          <span>${getStorageBadgeInfo(doc).icon}</span>
          <span class="storage-pill-text">${esc(getStorageBadgeInfo(doc).shortLabel)}</span>
        </button>
        <div class="tb-divider"></div>
        <button class="tb-btn icon-only" id="tb-undo" title="復原 (Cmd/Ctrl+Z)" ${store.canUndo() ? '' : 'disabled'}>↶</button>
        <button class="tb-btn icon-only" id="tb-redo" title="重做 (Cmd/Ctrl+Shift+Z)" ${store.canRedo() ? '' : 'disabled'}>↷</button>
      </div>

      <div class="tb-group">
        <button class="tb-btn" id="tb-add-sibling" title="新增同層主題 (Enter)" ${hasSel ? '' : 'disabled'}>＋<span class="tb-label-md">主題</span></button>
        <button class="tb-btn" id="tb-add-child" title="新增子主題 (Tab)" ${hasSel ? '' : 'disabled'}>↳<span class="tb-label-md">子主題</span></button>
        <button class="tb-btn ${store.connectingFromId ? 'active' : ''}" id="tb-rel" title="建立關聯線" ${hasSel ? '' : 'disabled'}>↗<span class="tb-label-md">關聯</span></button>
        <button class="tb-btn" id="tb-boundary" title="新增 / 移除外框" ${hasSel ? '' : 'disabled'}>▢<span class="tb-label-md">外框</span></button>
        <button class="tb-btn" id="tb-summary" title="新增 / 移除概要" ${hasSel ? '' : 'disabled'}>｝<span class="tb-label-md">概要</span></button>
        <button class="tb-btn" id="tb-callout" title="新增 / 移除標註" ${hasSel ? '' : 'disabled'}>💬<span class="tb-label-md">標註</span></button>
        <div class="tb-divider"></div>
        <button class="tb-btn tb-btn-nlm" id="tb-nlm-btn" title="從 Google NotebookLM / Gemini Notebook 匯入心智圖">✨ NotebookLM<span class="tb-label-md"> 匯入</span></button>
        <button class="tb-btn ${gdrive.isConnected() ? 'active' : ''}" id="tb-gdrive-btn" title="Google 雲端硬碟同步（存放心智圖原檔與節點附件／影片）">
          <span class="gdrive-status-dot ${gdrive.isConnected() ? 'connected' : 'offline'}"></span>
          ☁️<span class="tb-label-md">雲端硬碟</span>
        </button>
        <button class="tb-btn" id="tb-templates-btn" title="範本庫">📑<span class="tb-label-md">範本</span></button>
      </div>

      <div class="tb-group">
        <button class="tb-btn icon-only ${store.leftDrawer === 'search' ? 'active' : ''}" id="tb-search-btn" title="搜尋、取代與篩選 (Cmd/Ctrl+F)">🔍</button>
        <button class="tb-btn" id="tb-pitch-btn" title="演說簡報模式 (Pitch Mode)">🎬<span class="tb-label-md">演說</span></button>
        <button class="tb-btn" id="tb-zen-btn" title="ZEN 專注模式">🧘<span class="tb-label-md">ZEN</span></button>
        <button class="tb-btn tb-btn-primary" id="tb-export-btn" title="匯出與分享">📤<span class="tb-label-md"> 匯出/分享</span></button>
        <button class="tb-btn icon-only" id="tb-theme-ui" title="切換介面深淺模式">${store.uiTheme === 'dark' ? '☀️' : '🌙'}</button>
        <button class="tb-btn icon-only" id="tb-shortcuts-btn" title="快捷鍵速查">⌨️</button>
        <button class="tb-btn icon-only ${store.inspectorOpen ? 'active' : ''}" id="tb-inspector-btn" title="開關右側樣式面板">◧</button>
      </div>
    `;

    // Bind events
    this.toolbarEl.querySelector('#tb-works-btn').onclick = () => store.toggleLeftDrawer('works');
    this.toolbarEl.querySelector('#tb-new-doc-btn').onclick = () => this.modals.openNewFile();
    this.toolbarEl.querySelector('#tb-storage-pill').onclick = () => this.modals.openStorageSettings();
    const titleInput = this.toolbarEl.querySelector('#doc-title-input');
    titleInput.onchange = () => store.renameDocument(titleInput.value);
    titleInput.onkeydown = (e) => { if (e.key === 'Enter') titleInput.blur(); };

    this.toolbarEl.querySelector('#tb-undo').onclick = () => store.undo();
    this.toolbarEl.querySelector('#tb-redo').onclick = () => store.redo();
    this.toolbarEl.querySelector('#tb-add-sibling').onclick = () => store.addSibling();
    this.toolbarEl.querySelector('#tb-add-child').onclick = () => store.addChild();
    this.toolbarEl.querySelector('#tb-rel').onclick = () => {
      if (store.connectingFromId) store.setConnectingMode(null);
      else if (store.selectedNodeId) store.setConnectingMode(store.selectedNodeId);
    };
    this.toolbarEl.querySelector('#tb-boundary').onclick = () => store.toggleBoundary();
    this.toolbarEl.querySelector('#tb-summary').onclick = () => store.toggleSummary();
    this.toolbarEl.querySelector('#tb-callout').onclick = () => store.toggleCallout();

    this.toolbarEl.querySelector('#tb-nlm-btn').onclick = () => this.modals.openNotebookLM();
    this.toolbarEl.querySelector('#tb-gdrive-btn').onclick = () => this.modals.openGoogleDrive();
    this.toolbarEl.querySelector('#tb-templates-btn').onclick = () => this.modals.openTemplates();
    this.toolbarEl.querySelector('#tb-search-btn').onclick = () => store.toggleLeftDrawer('search');
    this.toolbarEl.querySelector('#tb-pitch-btn').onclick = () => this.pitch.start();
    this.toolbarEl.querySelector('#tb-zen-btn').onclick = () => this.toggleZen(true);
    this.toolbarEl.querySelector('#tb-export-btn').onclick = () => this.modals.openExport();
    this.toolbarEl.querySelector('#tb-theme-ui').onclick = () => store.setUiTheme(store.uiTheme === 'dark' ? 'light' : 'dark');
    this.toolbarEl.querySelector('#tb-shortcuts-btn').onclick = () => this.modals.openShortcuts();
    this.toolbarEl.querySelector('#tb-inspector-btn').onclick = () => store.toggleInspector();
  }

  _renderLeftDrawer() {
    if (!store.leftDrawer) {
      this.drawerEl.classList.add('hidden');
      return;
    }
    this.drawerEl.classList.remove('hidden');

    if (store.leftDrawer === 'works') {
      const itemsHtml = store.docs.map(d => {
        const badge = getStorageBadgeInfo(d);
        return `
        <div class="doc-item ${d.id === store.activeDocId ? 'active' : ''}" data-doc-id="${d.id}">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.title)}</div>
            <div style="font-size:11px;color:var(--ui-text-muted);margin-top:2px;">${badge.icon} ${esc(badge.shortLabel)} · ${d.sheets.length} 張畫布</div>
          </div>
          ${store.docs.length > 1 ? `<button class="btn btn-sm btn-danger" data-del-doc="${d.id}" title="刪除文件">✕</button>` : ''}
        </div>
      `;
      }).join('');

      this.drawerEl.innerHTML = `
        <div class="drawer-header">
          <span>📂 我的作品 (My Works)</span>
          <button class="btn btn-sm" id="drawer-close-btn">✕</button>
        </div>
        <div class="drawer-body">
          <div style="display:flex;gap:6px;margin-bottom:6px;">
            <button class="btn btn-primary btn-sm" id="new-doc-btn" style="flex:1;">＋ 新增空白文件</button>
            <button class="btn btn-sm" id="quick-import-file-btn">匯入檔案</button>
          </div>
          ${itemsHtml}
          <div style="margin-top:auto;padding-top:12px;border-top:1px solid var(--ui-border);font-size:11.5px;color:var(--ui-text-muted);line-height:1.5;">
            所有作品自動儲存於瀏覽器本機空間（LocalStorage），並可隨時匯出為 <code>.xmind</code> 或 <code>.json</code> 備份。
          </div>
        </div>
      `;

      this.drawerEl.querySelector('#drawer-close-btn').onclick = () => store.toggleLeftDrawer(null);
      this.drawerEl.querySelector('#new-doc-btn').onclick = () => {
        store.createNewDocument(`心智圖 ${store.docs.length + 1}`);
        showToast('已建立新心智圖文件', 'success');
      };
      this.drawerEl.querySelector('#quick-import-file-btn').onclick = () => {
        document.getElementById('global-file-input')?.click();
      };
      this.drawerEl.querySelectorAll('[data-doc-id]').forEach(el => {
        el.onclick = (e) => {
          if (e.target.closest('[data-del-doc]')) return;
          store.switchDocument(el.dataset.docId);
        };
      });
      this.drawerEl.querySelectorAll('[data-del-doc]').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          if (confirm('確定要刪除此心智圖文件嗎？')) {
            store.deleteDocument(btn.dataset.delDoc);
          }
        };
      });
      return;
    }

    if (store.leftDrawer === 'search') {
      const sheet = store.getActiveSheet();
      const allNodes = store.getAllNodes(sheet);
      const allLabels = [...new Set(allNodes.flatMap(x => x.node.labels || []))];
      const matchedIds = store.getMatchedNodeIds(sheet);
      const matchedNodes = matchedIds ? allNodes.filter(x => matchedIds.has(x.node.id)) : [];

      this.drawerEl.innerHTML = `
        <div class="drawer-header">
          <span>🔍 搜尋、取代與篩選</span>
          <button class="btn btn-sm" id="drawer-close-btn">✕</button>
        </div>
        <div class="drawer-body">
          <input id="sf-query" class="ui-input" placeholder="搜尋主題、筆記或標籤..." value="${esc(store.searchQuery)}" />
          <div style="display:flex;gap:6px;">
            <input id="sf-replace" class="ui-input" placeholder="取代文字..." />
            <button class="btn btn-sm" id="sf-replace-btn" style="white-space:nowrap;">全部取代</button>
          </div>

          <div class="insp-title" style="margin-top:6px;">依標籤篩選</div>
          <select id="sf-label" class="ui-select">
            <option value="">全部標籤</option>
            ${allLabels.map(l => `<option value="${esc(l)}" ${store.filterLabel === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>

          <div class="insp-title" style="margin-top:6px;">依標記篩選</div>
          <select id="sf-marker" class="ui-select">
            <option value="">全部標記</option>
            ${MARKER_GROUPS.flatMap(g => g.items).map(m => `<option value="${m.id}" ${store.filterMarker === m.id ? 'selected' : ''}>${m.label} ${m.title}</option>`).join('')}
          </select>

          <div class="insp-title" style="margin-top:6px;">依待辦與任務</div>
          <select id="sf-todo" class="ui-select">
            <option value="">不限</option>
            <option value="unchecked" ${store.filterTodo === 'unchecked' ? 'selected' : ''}>僅未完成待辦</option>
            <option value="checked" ${store.filterTodo === 'checked' ? 'selected' : ''}>僅已完成待辦</option>
            <option value="tasks" ${store.filterTodo === 'tasks' ? 'selected' : ''}>僅含排程任務</option>
          </select>

          ${store.hasActiveFilter() ? `<button class="btn btn-sm btn-danger" id="sf-clear">清除所有篩選</button>` : ''}

          <div class="insp-title" style="margin-top:8px;">符合結果 (${matchedNodes.length})</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${matchedNodes.map(({ node }) => `
              <button class="doc-item" data-jump-node="${node.id}" style="text-align:left;padding:7px 9px;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(node.title)}</span>
                <span style="font-size:11px;color:var(--accent);">定位</span>
              </button>
            `).join('') || `<div style="font-size:12px;color:var(--ui-text-muted);padding:6px 0;">輸入關鍵字或選擇條件以定位節點</div>`}
          </div>
        </div>
      `;

      this.drawerEl.querySelector('#drawer-close-btn').onclick = () => store.toggleLeftDrawer(null);
      const qInput = this.drawerEl.querySelector('#sf-query');
      qInput.oninput = () => store.setFilter({ searchQuery: qInput.value });
      this.drawerEl.querySelector('#sf-label').onchange = (e) => store.setFilter({ filterLabel: e.target.value });
      this.drawerEl.querySelector('#sf-marker').onchange = (e) => store.setFilter({ filterMarker: e.target.value });
      this.drawerEl.querySelector('#sf-todo').onchange = (e) => store.setFilter({ filterTodo: e.target.value });
      this.drawerEl.querySelector('#sf-clear')?.addEventListener('click', () => store.clearFilters());
      this.drawerEl.querySelector('#sf-replace-btn').onclick = () => {
        const find = qInput.value;
        const rep = this.drawerEl.querySelector('#sf-replace').value;
        if (!find) return showToast('請先輸入要搜尋的文字', 'error');
        const cnt = store.replaceAllText(find, rep);
        showToast(`已取代 ${cnt} 處文字`, 'success');
      };
      this.drawerEl.querySelectorAll('[data-jump-node]').forEach(btn => {
        btn.onclick = () => {
          store.selectNode(btn.dataset.jumpNode);
          if (store.viewMode === 'canvas') this.canvas.centerOnNode(btn.dataset.jumpNode);
        };
      });
    }
  }

  _renderBottomBar() {
    const doc = store.getActiveDoc();
    const sheet = store.getActiveSheet();
    const nodeCount = sheet ? store.getAllNodes(sheet).length : 0;

    const tabsHtml = doc.sheets.map(s => `
      <div class="sheet-tab ${s.id === doc.activeSheetId ? 'active' : ''}" data-sheet-id="${s.id}" title="雙擊重新命名畫布">
        <span>${esc(s.title)}</span>
        ${doc.sheets.length > 1 ? `<button class="sheet-close" data-close-sheet="${s.id}" title="刪除畫布">×</button>` : ''}
      </div>
    `).join('');

    this.bottomEl.innerHTML = `
      <div class="sheet-tabs">
        ${tabsHtml}
        <button class="sheet-tab" id="add-sheet-btn" title="新增畫布">＋</button>
        <button class="sheet-tab" id="dup-sheet-btn" title="複製目前畫布" style="font-size:11px;">複製畫布</button>
      </div>

      <div class="bottom-controls">
        <span style="font-size:11.5px;color:var(--ui-text-muted);">共 ${nodeCount} 個主題</span>

        ${store.viewMode === 'canvas' ? `
          <button class="btn btn-sm ${store.showMinimap ? 'btn-primary' : ''}" id="toggle-minimap-btn" title="開關導覽小地圖" style="height:26px;padding:0 8px;">小地圖</button>
          <div class="zoom-group">
            <button id="zoom-out-btn" title="縮小">−</button>
            <span id="zoom-pct-label" style="font-size:11.5px;font-weight:600;min-width:40px;text-align:center;">${Math.round(this.currentZoom * 100)}%</span>
            <button id="zoom-in-btn" title="放大">＋</button>
            <button id="zoom-fit-btn" title="適應視窗 (Cmd/Ctrl+0)" style="width:auto;padding:0 6px;font-size:11px;">適中</button>
          </div>
        ` : ''}

        <div class="segmented">
          <button class="${store.viewMode === 'canvas' ? 'active' : ''}" data-view="canvas">心智圖</button>
          <button class="${store.viewMode === 'outliner' ? 'active' : ''}" data-view="outliner">大綱</button>
          <button class="${store.viewMode === 'gantt' ? 'active' : ''}" data-view="gantt">甘特圖</button>
        </div>
      </div>
    `;

    // Sheet tab bindings
    this.bottomEl.querySelectorAll('[data-sheet-id]').forEach(tab => {
      tab.onclick = (e) => {
        if (e.target.closest('[data-close-sheet]')) return;
        store.switchSheet(tab.dataset.sheetId);
      };
      tab.ondblclick = () => {
        const s = doc.sheets.find(x => x.id === tab.dataset.sheetId);
        const next = prompt('重新命名畫布：', s?.title || '');
        if (next) store.renameSheet(tab.dataset.sheetId, next);
      };
    });
    this.bottomEl.querySelectorAll('[data-close-sheet]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (confirm('確定要刪除此畫布嗎？')) store.deleteSheet(btn.dataset.closeSheet);
      };
    });
    this.bottomEl.querySelector('#add-sheet-btn').onclick = () => store.addSheet();
    this.bottomEl.querySelector('#dup-sheet-btn').onclick = () => store.duplicateSheet(doc.activeSheetId);

    // Zoom & Minimap
    this.bottomEl.querySelector('#toggle-minimap-btn')?.addEventListener('click', () => store.toggleMinimap());
    this.bottomEl.querySelector('#zoom-out-btn')?.addEventListener('click', () => this.canvas.setZoom(this.canvas.scale / 1.15));
    this.bottomEl.querySelector('#zoom-in-btn')?.addEventListener('click', () => this.canvas.setZoom(this.canvas.scale * 1.15));
    this.bottomEl.querySelector('#zoom-fit-btn')?.addEventListener('click', () => this.canvas.fitToView());

    // View mode switch
    this.bottomEl.querySelectorAll('[data-view]').forEach(btn => {
      btn.onclick = () => store.setViewMode(btn.dataset.view);
    });
  }
}
