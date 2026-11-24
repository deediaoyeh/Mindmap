/**
 * MindFlow Main Application Bootstrapper.
 * Wires reactive store, views (Canvas, Outliner, Gantt, Pitch), ZEN timer,
 * global keyboard shortcuts, global file drag-and-drop, and URL hash importers (#notebooklm= / #map=).
 */

import { store } from './core/store.js';
import { decompressStringFromUrl } from './core/zip.js';
import { importFromFile } from './importers/formats.js';
import { parseNotebookLMJson } from './importers/notebooklm.js';
import { MindMapCanvas } from './render/canvas.js';
import { InspectorPanel } from './ui/inspector.js';
import { ModalManager } from './ui/modals.js';
import { showToast } from './ui/toast.js';
import { StudioChrome } from './ui/toolbar.js';
import { GanttView } from './views/gantt.js';
import { OutlinerView } from './views/outliner.js';
import { PitchView } from './views/pitch.js';

// Apply saved UI theme immediately
document.body.dataset.uiTheme = store.uiTheme;

// Initialize Core Views & UI
const canvas = new MindMapCanvas();
const outliner = new OutlinerView(document.getElementById('outliner-view'));
const gantt = new GanttView(document.getElementById('gantt-view'));
const pitch = new PitchView(document.getElementById('pitch-overlay'));
const modals = new ModalManager(canvas);
const inspector = new InspectorPanel(document.getElementById('inspector-panel'));

// ZEN Mode + Focus Timer
let zenSeconds = 0;
let zenInterval = null;
const zenTimerEl = document.getElementById('zen-timer-value');

function updateZenClock() {
  const m = String(Math.floor(zenSeconds / 60)).padStart(2, '0');
  const s = String(zenSeconds % 60).padStart(2, '0');
  if (zenTimerEl) zenTimerEl.textContent = `${m}:${s}`;
}

function toggleZen(enable) {
  store.zenMode = enable;
  document.body.classList.toggle('zen-mode', enable);
  if (enable) {
    store.setViewMode('canvas');
    if (!zenInterval) {
      zenInterval = setInterval(() => {
        zenSeconds++;
        updateZenClock();
      }, 1000);
    }
    showToast('已進入 ZEN 專注模式（按 Esc 離開）');
  } else {
    if (zenInterval) {
      clearInterval(zenInterval);
      zenInterval = null;
    }
  }
  store.notify('ui');
  requestAnimationFrame(() => canvas.fitToView());
}

document.getElementById('zen-exit-btn').onclick = () => toggleZen(false);
document.getElementById('zen-theme-btn').onclick = () => {
  const cur = store.getActiveSheet().themeId;
  store.updateSheet({ themeId: cur === 'midnight-studio' ? 'minimal-ink' : 'midnight-studio' });
};

const chrome = new StudioChrome({ canvas, pitch, modals, toggleZen });

// Master Render Loop
function syncViews(reason = 'update') {
  document.getElementById('canvas-view').classList.toggle('active', store.viewMode === 'canvas');
  document.getElementById('outliner-view').classList.toggle('active', store.viewMode === 'outliner');
  document.getElementById('gantt-view').classList.toggle('active', store.viewMode === 'gantt');

  chrome.render();
  inspector.render();

  if (store.viewMode === 'canvas') canvas.render(reason);
  else if (store.viewMode === 'outliner') outliner.render();
  else if (store.viewMode === 'gantt') gantt.render();
}

store.subscribe(syncViews);

// Global File Input (from My Works drawer)
const globalFileInput = document.getElementById('global-file-input');
globalFileInput.addEventListener('change', async () => {
  const file = globalFileInput.files?.[0];
  globalFileInput.value = '';
  if (!file) return;
  try {
    const parsed = await importFromFile(file);
    store.importAsSheetOrDoc(parsed.root, {
      title: parsed.title,
      sheets: parsed.sheets,
      structure: 'logic-right',
      themeId: 'notebooklm-clean'
    });
    showToast(`已成功匯入「${parsed.title}」`, 'success');
  } catch (err) {
    showToast(`匯入失敗：${err.message}`, 'error', 4000);
  }
});

// Global Drag-and-Drop onto Workspace
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  // Let modal dropzones handle their own drops
  if (e.target.closest('.modal-root')) return;
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file.type.startsWith('image/')) {
    modals.openNotebookLM('png');
    showToast('偵測到圖片檔，已為您開啟 PNG AI 還原工具！');
    return;
  }
  try {
    const parsed = await importFromFile(file);
    store.importAsSheetOrDoc(parsed.root, {
      title: parsed.title,
      sheets: parsed.sheets,
      structure: 'logic-right',
      themeId: 'notebooklm-clean'
    });
    showToast(`已匯入「${parsed.title}」`, 'success');
  } catch (err) {
    showToast(`無法匯入該檔案：${err.message}`, 'error', 4000);
  }
});

// Global Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (pitch.open) return;

  const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Escape') {
    if (!document.getElementById('modal-root').classList.contains('hidden')) {
      modals.close();
      return;
    }
    if (store.connectingFromId) {
      store.setConnectingMode(null);
      return;
    }
    if (store.zenMode) {
      toggleZen(false);
      return;
    }
  }

  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    store.toggleLeftDrawer('search');
    setTimeout(() => document.getElementById('sf-query')?.focus(), 50);
    return;
  }

  if (mod && e.key === '0') {
    e.preventDefault();
    canvas.fitToView();
    return;
  }

  if (isTyping) return;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }

  if (mod && e.key === '/') {
    e.preventDefault();
    if (store.selectedNodeId) store.toggleCollapse(store.selectedNodeId);
    return;
  }

  if (store.viewMode !== 'canvas') return;

  if (e.key === 'Tab' && store.selectedNodeId) {
    e.preventDefault();
    store.addChild(store.selectedNodeId);
  } else if (e.key === 'Enter' && store.selectedNodeId) {
    e.preventDefault();
    store.addSibling(store.selectedNodeId);
  } else if ((e.key === ' ' || e.key === 'F2') && store.selectedNodeId) {
    e.preventDefault();
    store.startEditing(store.selectedNodeId);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (store.selectedRelId) {
      e.preventDefault();
      store.deleteRelationship(store.selectedRelId);
    } else if (store.selectedNodeId) {
      e.preventDefault();
      store.deleteNode(store.selectedNodeId);
    }
  }
});

// URL Hash Auto-Importer: Supports #notebooklm=... (from Bookmarklet/Extension) and #map=... (from Share Link)
let handlingHash = false;
let lastHandledHash = '';

async function handleIncomingHash() {
  const hash = window.location.hash || '';
  if (!hash || handlingHash || hash === lastHandledHash) return;
  if (!hash.startsWith('#notebooklm=') && !hash.startsWith('#map=')) return;

  handlingHash = true;
  lastHandledHash = hash;
  history.replaceState(null, '', window.location.pathname + window.location.search);

  try {
    if (hash.startsWith('#notebooklm=')) {
      const token = hash.slice('#notebooklm='.length);
      const jsonStr = await decompressStringFromUrl(token);
      const parsed = parseNotebookLMJson(jsonStr);
      store.importAsSheetOrDoc(parsed.root, {
        title: parsed.title || 'NotebookLM 匯入',
        structure: 'logic-right',
        themeId: 'notebooklm-clean'
      });
      showToast(`✨ 已自動從 NotebookLM 匯入「${parsed.title}」！`, 'success', 4500);
    } else if (hash.startsWith('#map=')) {
      const token = hash.slice('#map='.length);
      const jsonStr = await decompressStringFromUrl(token);
      const data = JSON.parse(jsonStr);
      if (data.sheet && data.sheet.root) {
        store.importAsSheetOrDoc(data.sheet.root, {
          title: data.title || data.sheet.title || '分享的心智圖',
          sheets: [data.sheet],
          asNewDoc: true
        });
        showToast(`🔗 已載入分享的心智圖「${data.title || data.sheet.title}」`, 'success', 4000);
      }
    }
  } catch (err) {
    console.error('Hash import failed:', err);
    showToast(`連結解析失敗：${err.message}`, 'error', 4500);
  } finally {
    handlingHash = false;
  }
}

window.addEventListener('hashchange', handleIncomingHash);
window.addEventListener('resize', () => {
  if (store.viewMode === 'canvas') canvas.applyTransform();
});

// First Render + Check Incoming Hash
syncViews('init');
handleIncomingHash();
