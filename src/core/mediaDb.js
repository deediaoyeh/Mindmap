/**
 * Local Media & Attachment Vault backed by IndexedDB.
 * Stores uploaded images, videos, and arbitrary node attachments locally
 * without hitting LocalStorage's 5MB limit, plus video thumbnail extraction helpers.
 */

const DB_NAME = 'MindFlowMediaDB';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export async function saveMediaBlob(id, blob, meta = {}) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      id,
      blob,
      name: meta.name || blob.name || 'file',
      mimeType: meta.mimeType || blob.type || 'application/octet-stream',
      size: blob.size || 0,
      savedAt: Date.now()
    });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMediaRecord(id) {
  if (!id) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMediaBlob(id) {
  if (!id) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMediaObjectUrl(id) {
  const rec = await getMediaRecord(id);
  if (!rec || !rec.blob) return null;
  return URL.createObjectURL(rec.blob);
}

/**
 * Extract a clean 16:9 JPEG thumbnail DataURL and duration from a local Video File/Blob.
 */
export function extractVideoMetadata(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ thumbnail: '', duration: '' }), 6000);

    video.onloadeddata = () => {
      try {
        const targetTime = isFinite(video.duration) && video.duration > 1.2 ? 1.0 : 0.1;
        video.currentTime = targetTime;
      } catch {
        captureFrame();
      }
    };

    video.onseeked = captureFrame;

    function captureFrame() {
      clearTimeout(timeout);
      try {
        const w = 320;
        const ratio = video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
        const h = Math.max(120, Math.min(220, Math.round(w * ratio)));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.78);
        const dur = isFinite(video.duration) ? formatDuration(video.duration) : '';
        finish({ thumbnail, duration: dur });
      } catch {
        finish({ thumbnail: '', duration: '' });
      }
    }

    video.onerror = () => {
      clearTimeout(timeout);
      finish({ thumbnail: '', duration: '' });
    };
  });
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = String(s % 60).padStart(2, '0');
  return `${m}:${rem}`;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parse video URLs (YouTube, Google Drive share links, direct MP4/WebM)
 * and derive thumbnail + embed/playback URL automatically.
 */
export function parseVideoUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return null;

  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) {
    const ytId = ytMatch[1];
    return {
      sourceType: 'youtube',
      url,
      embedUrl: `https://www.youtube.com/embed/${ytId}?autoplay=1`,
      thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      title: 'YouTube 影片'
    };
  }

  // Google Drive File Link
  const gdId = extractGoogleDriveFileId(url);
  if (gdId) {
    return {
      sourceType: 'gdrive',
      driveFileId: gdId,
      url,
      embedUrl: `https://drive.google.com/file/d/${gdId}/preview`,
      thumbnail: `https://drive.google.com/thumbnail?id=${gdId}&sz=w400`,
      title: 'Google Drive 影片'
    };
  }

  // Direct HTML5 video URL
  return {
    sourceType: 'url',
    url,
    embedUrl: url,
    thumbnail: '',
    title: url.split('/').pop()?.split('?')[0] || '線上影片'
  };
}

export function extractGoogleDriveFileId(url) {
  const s = String(url || '');
  const m1 = s.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = s.match(/drive\.google\.com\/open\?id=([A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  const m3 = s.match(/docs\.google\.com\/[^/]+\/d\/([A-Za-z0-9_-]+)/);
  if (m3) return m3[1];
  return null;
}

/**
 * Compress an uploaded image slightly for crisp SVG embedding & fast storage.
 */
export function readImageAsDataUrl(file, maxWidth = 960) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        if (img.width <= maxWidth) {
          resolve(String(reader.result));
          return;
        }
        const scale = maxWidth / img.width;
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => resolve(String(reader.result));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.readAsDataURL(file);
  });
}
