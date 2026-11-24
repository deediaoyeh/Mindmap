/**
 * Local Disk Storage Bridge using the File System Access API (with graceful fallback).
 * Lets users pick an exact folder/file location on their computer for a MindFlow document,
 * persists the handle in IndexedDB where supported, and auto-saves changes directly to disk.
 */

const HANDLE_DB_NAME = 'MindFlowHandlesDB';
const HANDLE_STORE = 'handles';

const memoryHandles = new Map(); // docId -> FileSystemFileHandle
const saveTimers = new Map();

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HANDLE_STORE)) {
        req.result.createObjectStore(HANDLE_STORE, { keyPath: 'docId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(docId, handle) {
  memoryHandles.set(docId, handle);
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put({ docId, handle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Some browsers disallow cloning FileSystemFileHandle into IDB; memory cache still works
  }
}

export async function getBoundHandle(docId) {
  if (memoryHandles.has(docId)) return memoryHandles.get(docId);
  try {
    const db = await openHandleDb();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const req = tx.objectStore(HANDLE_STORE).get(docId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (rec?.handle) {
      memoryHandles.set(docId, rec.handle);
      return rec.handle;
    }
  } catch {}
  return null;
}

export function supportsFileSystemPicker() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

export async function pickAndBindSaveFile(doc) {
  const safeName = String(doc.title || 'MindFlow').replace(/[\\/:*?"<>|]/g, '_').trim() || 'MindFlow';
  if (!supportsFileSystemPicker()) {
    // Fallback download for browsers without File System Access API (e.g. Safari / Mobile)
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.mindflow.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    doc.storageLocation = {
      type: 'downloaded',
      fileName: `${safeName}.mindflow.json`,
      label: `已下載：${safeName}.mindflow.json`,
      lastSavedAt: new Date().toISOString()
    };
    return { mode: 'downloaded', fileName: `${safeName}.mindflow.json` };
  }

  const handle = await window.showSaveFilePicker({
    suggestedName: `${safeName}.mindflow.json`,
    types: [
      {
        description: 'MindFlow 心智圖原始檔 (.mindflow.json)',
        accept: { 'application/json': ['.mindflow.json', '.json'] }
      }
    ]
  });

  await persistHandle(doc.id, handle);
  doc.storageLocation = {
    type: 'local-file',
    fileName: handle.name,
    label: `本機檔案：${handle.name}`,
    lastSavedAt: new Date().toISOString()
  };
  await writeDocToHandle(doc, handle);
  return { mode: 'local-file', fileName: handle.name, handle };
}

export async function writeDocToHandle(doc, handle = null) {
  const h = handle || await getBoundHandle(doc.id);
  if (!h) return false;

  if (h.queryPermission) {
    const perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await h.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') return false;
    }
  }

  const writable = await h.createWritable();
  await writable.write(JSON.stringify(doc, null, 2));
  await writable.close();
  doc.storageLocation = {
    ...(doc.storageLocation || {}),
    type: 'local-file',
    fileName: h.name,
    label: `本機檔案：${h.name}`,
    lastSavedAt: new Date().toISOString()
  };
  return true;
}

export function scheduleAutoSaveToDisk(doc, onSaved = null) {
  if (!doc || doc.storageLocation?.type !== 'local-file') return;
  if (!memoryHandles.has(doc.id)) return;

  if (saveTimers.has(doc.id)) clearTimeout(saveTimers.get(doc.id));
  const timer = setTimeout(async () => {
    saveTimers.delete(doc.id);
    try {
      const ok = await writeDocToHandle(doc);
      if (ok && onSaved) onSaved();
    } catch (err) {
      console.warn('Auto-save to bound local file failed:', err);
    }
  }, 650);
  saveTimers.set(doc.id, timer);
}

/**
 * Compute human-readable storage location metadata for toolbar & My Works badges.
 */
export function getStorageBadgeInfo(doc) {
  if (!doc) {
    return { icon: '🌐', shortLabel: '瀏覽器本機空間', fullLabel: '儲存於瀏覽器本機空間 (LocalStorage + IndexedDB)', type: 'browser' };
  }

  const loc = doc.storageLocation;
  if (loc?.type === 'local-file' && loc.fileName) {
    return {
      icon: '💻',
      shortLabel: loc.fileName,
      fullLabel: `本機硬碟檔案：${loc.fileName}${loc.lastSavedAt ? `（上次儲存：${new Date(loc.lastSavedAt).toLocaleTimeString()}）` : ''}`,
      type: 'local-file'
    };
  }

  if (doc.driveFolderId || loc?.type === 'gdrive') {
    const rootName = doc.driveParentFolderName || 'MindFlow';
    const useSub = doc.driveUseSubfolder !== false;
    const subName = doc.driveSubfolderName || doc.title;
    const shortPath = useSub ? `Drive/${rootName}/${subName}` : `Drive/${rootName}`;
    return {
      icon: '☁️',
      shortLabel: shortPath,
      fullLabel: `Google 雲端硬碟：${shortPath}/${doc.driveLastSyncedAt ? `（上次同步：${new Date(doc.driveLastSyncedAt).toLocaleTimeString()}）` : '（待同步）'}`,
      type: 'gdrive'
    };
  }

  if (loc?.type === 'downloaded' && loc.fileName) {
    return {
      icon: '📥',
      shortLabel: `瀏覽器＋${loc.fileName}`,
      fullLabel: `瀏覽器本機空間（並已下載複本：${loc.fileName}）`,
      type: 'downloaded'
    };
  }

  const isDesktopApp = typeof window !== 'undefined' && window.location.hostname === '127.0.0.1' && window.location.port === '18421';
  return {
    icon: isDesktopApp ? '💾' : '🌐',
    shortLabel: isDesktopApp ? '本機離線資料庫' : '瀏覽器本機暫存',
    fullLabel: isDesktopApp
      ? '自動儲存於本機離線工作站資料庫（點擊可另指定實體檔案位置或同步至 Google Drive）'
      : '目前自動儲存於瀏覽器本機空間（點擊可指定電腦實體儲存位置或同步至 Google Drive）',
    type: 'browser'
  };
}
