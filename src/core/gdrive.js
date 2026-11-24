/**
 * Google Drive Integration Engine (Client-side GIS OAuth 2.0 + Drive API v3).
 * Organizes each mind map cleanly inside Google Drive:
 *   MindFlow/
 *     └── <MindMap Title>/
 *           ├── <MindMap Title>.mindflow.json   (Original editable MindFlow file)
 *           ├── <MindMap Title>.xmind           (Standard XMind backup)
 *           └── attachments/                    (All node attachments, images, and videos)
 */

import { getMediaRecord, saveMediaBlob } from './mediaDb.js';
import { uid } from './schema.js';

const CLIENT_ID_KEY = 'mindflow_gdrive_client_id';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ROOT_FOLDER_NAME = 'MindFlow';

class GoogleDriveService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userInfo = null;
    this.gisLoaded = false;
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) {
      try { fn(); } catch {}
    }
  }

  getClientId() {
    return localStorage.getItem(CLIENT_ID_KEY) || '';
  }

  setClientId(id) {
    localStorage.setItem(CLIENT_ID_KEY, String(id || '').trim());
    this.notify();
  }

  isConnected() {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiresAt - 30000);
  }

  async _loadGisScript() {
    if (this.gisLoaded && window.google?.accounts?.oauth2) return;
    await new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        this.gisLoaded = true;
        return resolve();
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this.gisLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('無法載入 Google Identity Services 腳本，請檢查網路連線'));
      document.head.appendChild(script);
    });
  }

  async connect(clientId = this.getClientId()) {
    const cid = String(clientId || '').trim();
    if (!cid) throw new Error('請先填入您的 Google OAuth Client ID');
    this.setClientId(cid);
    await this._loadGisScript();

    const tokenResp = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          if (resp.error) reject(new Error(resp.error_description || resp.error));
          else resolve(resp);
        }
      });
      client.requestAccessToken({ prompt: this.accessToken ? '' : 'consent' });
    });

    this.accessToken = tokenResp.access_token;
    this.tokenExpiresAt = Date.now() + (Number(tokenResp.expires_in) || 3500) * 1000;

    // Fetch Drive About info (user display name & email)
    try {
      const about = await this._apiJson('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)');
      this.userInfo = about.user || null;
    } catch {
      this.userInfo = { displayName: 'Google 使用者' };
    }
    this.notify();
    return this.userInfo;
  }

  disconnect() {
    if (this.accessToken && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(this.accessToken); } catch {}
    }
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.userInfo = null;
    this.notify();
  }

  async _apiFetch(url, options = {}) {
    if (!this.isConnected()) throw new Error('尚未連線至 Google 雲端硬碟');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    const resp = await fetch(url, { ...options, headers });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Google Drive API 錯誤 (${resp.status})：${txt.slice(0, 180)}`);
    }
    return resp;
  }

  async _apiJson(url, options = {}) {
    const resp = await this._apiFetch(url, options);
    return resp.json();
  }

  async findOrCreateFolder(name, parentId = null) {
    const safeName = String(name || 'Untitled').replace(/'/g, "\\'");
    let q = `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const res = await this._apiJson(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&spaces=drive`
    );
    if (res.files && res.files.length > 0) return res.files[0];

    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    };
    return this._apiJson('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
  }

  async ensureDocFolders(doc) {
    const rootFolder = await this.findOrCreateFolder(ROOT_FOLDER_NAME);
    let docFolder = null;
    if (doc.driveFolderId) {
      try {
        docFolder = await this._apiJson(`https://www.googleapis.com/drive/v3/files/${doc.driveFolderId}?fields=id,name,webViewLink,trashed`);
        if (docFolder.trashed) docFolder = null;
      } catch {
        docFolder = null;
      }
    }
    if (!docFolder) {
      docFolder = await this.findOrCreateFolder(doc.title || '未命名心智圖', rootFolder.id);
    }
    const attachFolder = await this.findOrCreateFolder('attachments', docFolder.id);
    return { rootFolder, docFolder, attachFolder };
  }

  /**
   * Multipart upload (create or update) a file/blob to Google Drive.
   */
  async uploadFile({ name, mimeType, blob, parentId, existingFileId = null }) {
    const metadata = existingFileId
      ? { name, mimeType }
      : { name, mimeType, parents: parentId ? [parentId] : undefined };

    const boundary = 'mindflow_boundary_' + Math.random().toString(36).slice(2);
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;
    const endPart = `\r\n--${boundary}--`;

    const bodyBlob = new Blob([metaPart, blob, endPart], {
      type: `multipart/related; boundary=${boundary}`
    });

    const url = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,thumbnailLink`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,thumbnailLink`;

    return this._apiJson(url, {
      method: existingFileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: bodyBlob
    });
  }

  /**
   * Upload a single attachment/video/image blob directly to the current document's Google Drive attachments/ folder.
   */
  async uploadNodeMedia(doc, file) {
    const { docFolder, attachFolder } = await this.ensureDocFolders(doc);
    doc.driveFolderId = docFolder.id;
    doc.driveFolderUrl = docFolder.webViewLink;
    const uploaded = await this.uploadFile({
      name: file.name || `media_${Date.now()}`,
      mimeType: file.type || 'application/octet-stream',
      blob: file,
      parentId: attachFolder.id
    });
    return {
      driveFileId: uploaded.id,
      driveWebViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      thumbnailLink: uploaded.thumbnailLink || '',
      docFolderId: docFolder.id,
      docFolderUrl: docFolder.webViewLink
    };
  }

  /**
   * Sync the entire MindMap document:
   * 1. Upload all unsynced node attachments & videos from local IndexedDB into <Doc>/attachments/
   * 2. Upload original <Doc>.mindflow.json and <Doc>.xmind into <Doc>/
   */
  async syncDocument(doc, xmindBlobBuilder, onProgress = () => {}) {
    onProgress('正在確認 Google Drive 資料夾結構...');
    const { docFolder, attachFolder } = await this.ensureDocFolders(doc);
    doc.driveFolderId = docFolder.id;
    doc.driveFolderUrl = docFolder.webViewLink;

    // Collect all nodes across all sheets
    const nodes = [];
    const walk = (n) => {
      nodes.push(n);
      for (const c of (n.children || [])) walk(c);
    };
    for (const s of doc.sheets) {
      walk(s.root);
      for (const f of (s.floatingTopics || [])) walk(f.node);
    }

    // Upload any local attachments / local videos not yet on Drive
    let uploadedCount = 0;
    for (const node of nodes) {
      for (const att of (node.attachments || [])) {
        if (!att.driveFileId && att.localBlobId) {
          const rec = await getMediaRecord(att.localBlobId);
          if (rec?.blob) {
            onProgress(`正在上傳附件：${att.name}...`);
            const up = await this.uploadFile({
              name: att.name,
              mimeType: att.mimeType || rec.mimeType,
              blob: rec.blob,
              parentId: attachFolder.id
            });
            att.driveFileId = up.id;
            att.driveWebViewLink = up.webViewLink || `https://drive.google.com/file/d/${up.id}/view`;
            uploadedCount++;
          }
        }
      }
      if (node.video && !node.video.driveFileId && node.video.localBlobId) {
        const rec = await getMediaRecord(node.video.localBlobId);
        if (rec?.blob) {
          onProgress(`正在上傳影片：${node.video.name || 'video.mp4'}...`);
          const up = await this.uploadFile({
            name: node.video.name || `video_${Date.now()}.mp4`,
            mimeType: node.video.mimeType || rec.mimeType || 'video/mp4',
            blob: rec.blob,
            parentId: attachFolder.id
          });
          node.video.driveFileId = up.id;
          node.video.driveWebViewLink = up.webViewLink || `https://drive.google.com/file/d/${up.id}/view`;
          node.video.embedUrl = `https://drive.google.com/file/d/${up.id}/preview`;
          uploadedCount++;
        }
      }
    }

    // Upload original MindFlow JSON file
    const safeTitle = String(doc.title || 'MindFlow').replace(/[\\/:*?"<>|]/g, '_');
    onProgress(`正在儲存原始心智圖檔 (${safeTitle}.mindflow.json)...`);
    const jsonBlob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const jsonUp = await this.uploadFile({
      name: `${safeTitle}.mindflow.json`,
      mimeType: 'application/json',
      blob: jsonBlob,
      parentId: docFolder.id,
      existingFileId: doc.driveJsonFileId || null
    });
    doc.driveJsonFileId = jsonUp.id;

    // Upload standard .xmind backup
    if (xmindBlobBuilder) {
      onProgress(`正在同步標準 .xmind 備份檔...`);
      const xmindBlob = await xmindBlobBuilder(doc);
      const xmUp = await this.uploadFile({
        name: `${safeTitle}.xmind`,
        mimeType: 'application/octet-stream',
        blob: xmindBlob,
        parentId: docFolder.id,
        existingFileId: doc.driveXmindFileId || null
      });
      doc.driveXmindFileId = xmUp.id;
    }

    doc.driveLastSyncedAt = new Date().toISOString();
    return {
      folderUrl: docFolder.webViewLink,
      uploadedCount
    };
  }

  /**
   * List all MindFlow mind map folders/files saved in Google Drive.
   */
  async listSavedMindMaps() {
    const rootFolder = await this.findOrCreateFolder(ROOT_FOLDER_NAME);
    const q = `mimeType='application/vnd.google-apps.folder' and '${rootFolder.id}' in parents and trashed=false`;
    const folders = await this._apiJson(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc`
    );

    const results = [];
    for (const f of (folders.files || [])) {
      const fq = `'${f.id}' in parents and name contains '.mindflow.json' and trashed=false`;
      const files = await this._apiJson(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fq)}&fields=files(id,name,modifiedTime,size)`
      );
      if (files.files && files.files.length > 0) {
        results.push({
          folderId: f.id,
          folderName: f.name,
          folderUrl: f.webViewLink,
          jsonFileId: files.files[0].id,
          modifiedTime: files.files[0].modifiedTime
        });
      }
    }
    return results;
  }

  async downloadJsonFile(fileId) {
    const resp = await this._apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    return resp.json();
  }

  async downloadFileBlob(fileId, filename = 'download') {
    const resp = await this._apiFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    const blob = await resp.blob();
    // Cache locally for instant playback next time
    const localBlobId = uid('blob');
    await saveMediaBlob(localBlobId, blob, { name: filename, mimeType: blob.type });
    return { blob, localBlobId };
  }
}

export const gdrive = new GoogleDriveService();
