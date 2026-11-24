/**
 * MindFlow Main Application Bootstrapper.
 * Wires reactive store, views (Canvas, Outliner, Gantt, Pitch), ZEN timer,
 * global keyboard shortcuts, global file drag-and-drop, and URL hash importers (#notebooklm= / #map=).
 */

import { gdrive } from './core/gdrive.js';
import { pickAndBindSaveFile, writeDocToHandle } from './core/localFile.js';
import {
  extractVideoMetadata,
  parseVideoUrl,
  readImageAsDataUrl,
  saveMediaBlob
} from './core/mediaDb.js';
import { uid } from './core/schema.js';
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
const inspector = new InspectorPanel(document.getElementById('inspector-panel'), modals);

canvas.onOpenVideo = (node) => modals.openVideoPlayer(node);
canvas.onOpenImage = (node) => modals.openImageLightbox(node);
canvas.onOpenAttachments = (node, tab = 'local') => modals.openAttachmentsModal(node, tab);
gdrive.subscribe(() => syncViews('ui'));

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

// =========================================================================
// Direct Drag-and-Drop Content onto Canvas or Specific Nodes:
// Supports Images, Videos (auto thumbnail + play), File Attachments,
// MindMap files (.xmind/.mm/.opml/.md/.json/.svg), URLs (YouTube/Drive/Web), and Text!
// =========================================================================
const MINDMAP_IMPORT_EXTS = new Set(['xmind', 'mm', 'opml', 'md', 'markdown', 'json', 'svg', 'canvas']);
let dragCounter = 0;

function hasDroppablePayload(dt) {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
}

window.addEventListener('dragenter', (e) => {
  if (e.target.closest('.modal-root')) return;
  if (hasDroppablePayload(e.dataTransfer)) dragCounter++;
});

window.addEventListener('dragover', (e) => {
  if (e.target.closest('.modal-root')) return;
  if (!hasDroppablePayload(e.dataTransfer)) return;
  e.preventDefault();
  if (store.viewMode === 'canvas') {
    const hit = canvas.hitTestNodeAtScreen(e.clientX, e.clientY);
    canvas.setExternalDropFeedback(hit, true);
  }
});

window.addEventListener('dragleave', (e) => {
  if (e.target.closest('.modal-root')) return;
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) canvas.setExternalDropFeedback(null, false);
});

window.addEventListener('drop', async (e) => {
  dragCounter = 0;
  canvas.setExternalDropFeedback(null, false);
  if (e.target.closest('.modal-root')) return;
  if (!hasDroppablePayload(e.dataTransfer)) return;
  e.preventDefault();

  const hitItem = store.viewMode === 'canvas' ? canvas.hitTestNodeAtScreen(e.clientX, e.clientY) : null;
  const dropWorld = store.viewMode === 'canvas' ? canvas.screenToWorld(e.clientX, e.clientY) : { x: 260, y: 120 };
  const files = Array.from(e.dataTransfer.files || []);

  // --- 1. File Drops (Images, Videos, Attachments, or Full MindMap Imports) ---
  if (files.length > 0) {
    // Single MindMap document dropped on blank canvas -> import full mind map sheet
    if (!hitItem && files.length === 1) {
      const ext = (files[0].name.split('.').pop() || '').toLowerCase();
      if (MINDMAP_IMPORT_EXTS.has(ext)) {
        try {
          const parsed = await importFromFile(files[0]);
          store.importAsSheetOrDoc(parsed.root, {
            title: parsed.title,
            sheets: parsed.sheets,
            structure: 'logic-right',
            themeId: 'notebooklm-clean'
          });
          showToast(`已匯入心智圖「${parsed.title}」`, 'success');
          return;
        } catch (err) {
          showToast(`匯入失敗：${err.message}`, 'error', 4000);
          return;
        }
      }
    }

    // Target existing hovered node, or create a new Floating Topic right where dropped!
    let targetNodeId = hitItem?.id;
    if (!targetNodeId) {
      const baseTitle = files[0].name.replace(/\.[^.]+$/, '') || '拖曳內容';
      const created = store.addFloatingTopic(dropWorld.x - 60, dropWorld.y, baseTitle);
      store.stopEditing();
      targetNodeId = created.id;
    }

    let imgCount = 0;
    let vidCount = 0;
    let attCount = 0;
    const newAttachments = [];

    for (const file of files) {
      const node = store.findNode(targetNodeId);
      if (!node) break;

      if (file.type.startsWith('image/')) {
        try {
          const dataUrl = await readImageAsDataUrl(file, 960);
          if (!node.image) {
            store.updateNode(targetNodeId, { image: dataUrl });
          } else {
            // Multiple images -> create child topic with image so none are overwritten!
            const child = store.addChild(targetNodeId, file.name.replace(/\.[^.]+$/, ''), false);
            if (child) store.updateNode(child.id, { image: dataUrl });
          }
          if (gdrive.isConnected()) {
            gdrive.uploadNodeMedia(store.getActiveDoc(), file).catch(() => {});
          }
          imgCount++;
        } catch (err) {
          showToast(`圖片處理失敗：${err.message}`, 'error');
        }
      } else if (file.type.startsWith('video/')) {
        try {
          showToast(`正在擷取影片縮圖：${file.name}...`);
          const blobId = uid('vid');
          await saveMediaBlob(blobId, file, { name: file.name, mimeType: file.type });
          const meta = await extractVideoMetadata(file);
          const videoObj = {
            sourceType: 'local',
            name: file.name,
            mimeType: file.type || 'video/mp4',
            size: file.size,
            localBlobId: blobId,
            thumbnail: meta.thumbnail,
            duration: meta.duration
          };
          if (gdrive.isConnected()) {
            try {
              const up = await gdrive.uploadNodeMedia(store.getActiveDoc(), file);
              videoObj.driveFileId = up.driveFileId;
              videoObj.driveWebViewLink = up.driveWebViewLink;
              videoObj.embedUrl = `https://drive.google.com/file/d/${up.driveFileId}/preview`;
            } catch {}
          }
          if (!node.video) {
            store.updateNode(targetNodeId, { video: videoObj });
          } else {
            const child = store.addChild(targetNodeId, file.name.replace(/\.[^.]+$/, ''), false);
            if (child) store.updateNode(child.id, { video: videoObj });
          }
          vidCount++;
        } catch (err) {
          showToast(`影片處理失敗：${err.message}`, 'error');
        }
      } else {
        // Generic file attachment (PDF, Office, ZIP, Audio, etc.)
        const blobId = uid('att');
        await saveMediaBlob(blobId, file, { name: file.name, mimeType: file.type });
        const att = {
          id: uid('f'),
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          localBlobId: blobId,
          uploadedAt: new Date().toISOString()
        };
        if (gdrive.isConnected()) {
          try {
            const up = await gdrive.uploadNodeMedia(store.getActiveDoc(), file);
            att.driveFileId = up.driveFileId;
            att.driveWebViewLink = up.driveWebViewLink;
          } catch {}
        }
        newAttachments.push(att);
        attCount++;
      }
    }

    if (newAttachments.length > 0) {
      const node = store.findNode(targetNodeId);
      if (node) {
        store.updateNode(targetNodeId, { attachments: [...(node.attachments || []), ...newAttachments] });
      }
    }

    store.selectNode(targetNodeId);
    const summary = [
      imgCount ? `${imgCount} 張圖片` : '',
      vidCount ? `${vidCount} 部影片` : '',
      attCount ? `${attCount} 個附加檔案` : ''
    ].filter(Boolean).join('、');
    if (summary) showToast(`📥 已拖曳加入 ${summary}！`, 'success');
    return;
  }

  // --- 2. URL or Text Drops (from browser tabs, notes, or documents) ---
  const uriText = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find(l => l.trim() && !l.startsWith('#')) || '';
  const plainText = (e.dataTransfer.getData('text/plain') || '').trim();
  const droppedStr = (uriText || plainText).trim();
  if (!droppedStr) return;

  const isUrl = /^https?:\/\/\S+$/i.test(droppedStr);
  if (isUrl) {
    const isImageUrl = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(droppedStr);
    const parsedVideo = parseVideoUrl(droppedStr);
    const isVideoUrl = parsedVideo && (
      parsedVideo.sourceType === 'youtube' ||
      parsedVideo.sourceType === 'gdrive' ||
      /\.(mp4|webm|mov)(\?.*)?$/i.test(droppedStr)
    );

    let targetId = hitItem?.id;
    if (!targetId) {
      const label = isVideoUrl ? parsedVideo.title : isImageUrl ? '拖曳圖片' : new URL(droppedStr).hostname;
      const created = store.addFloatingTopic(dropWorld.x - 60, dropWorld.y, label);
      store.stopEditing();
      targetId = created.id;
    }

    if (isVideoUrl) {
      store.updateNode(targetId, { video: parsedVideo });
      showToast('📥 已拖曳加入影片縮圖與播放按鈕！', 'success');
    } else if (isImageUrl) {
      store.updateNode(targetId, { image: droppedStr });
      showToast('📥 已拖曳加入圖片！', 'success');
    } else {
      const node = store.findNode(targetId);
      if (node && !node.link) {
        store.updateNode(targetId, { link: droppedStr });
      } else {
        const child = store.addChild(targetId, new URL(droppedStr).hostname, false);
        if (child) store.updateNode(child.id, { link: droppedStr });
      }
      showToast('📥 已拖曳加入網頁連結！', 'success');
    }
    store.selectNode(targetId);
    return;
  }

  // Plain text drop (single or multi-line -> child topics or floating topic)
  const lines = droppedStr.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return;

  if (hitItem) {
    for (const line of lines.slice(0, 20)) {
      store.addChild(hitItem.id, line.slice(0, 120), false);
    }
    store.selectNode(hitItem.id);
    showToast(`📥 已拖曳新增 ${Math.min(lines.length, 20)} 個子主題！`, 'success');
  } else {
    const created = store.addFloatingTopic(dropWorld.x - 60, dropWorld.y, lines[0].slice(0, 120));
    store.stopEditing();
    for (const line of lines.slice(1, 20)) {
      store.addChild(created.id, line.slice(0, 120), false);
    }
    store.selectNode(created.id);
    showToast('📥 已在畫布建立拖曳文字主題！', 'success');
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

  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const doc = store.getActiveDoc();
    if (doc.storageLocation?.type === 'local-file') {
      writeDocToHandle(doc).then((ok) => {
        if (ok) {
          store._saveToStorage();
          store.notify('doc');
          showToast(`💾 已儲存至 ${doc.storageLocation.fileName}`, 'success');
        } else {
          modals.openStorageSettings();
        }
      }).catch(() => modals.openStorageSettings());
    } else {
      pickAndBindSaveFile(doc).then((res) => {
        store._saveToStorage();
        store.notify('doc');
        showToast(`💾 已儲存至 ${res.fileName}`, 'success');
      }).catch((err) => {
        if (err?.name !== 'AbortError') modals.openStorageSettings();
      });
    }
    return;
  }

  if (e.altKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    modals.openNewFile();
    return;
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

// Register Offline PWA Service Worker (enables mobile/tablet Add-to-Home-Screen & offline caching)
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
