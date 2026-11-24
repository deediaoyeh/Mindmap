/**
 * Modal Dialogs:
 *  1. NotebookLM (Gemini Notebook) Import Bridge Center (4 modes!)
 *  2. Templates Gallery
 *  3. Export & Share Studio
 *  4. Keyboard Shortcuts Cheat Sheet
 */

import { gdrive } from '../core/gdrive.js';
import {
  getStorageBadgeInfo,
  pickAndBindSaveFile,
  supportsFileSystemPicker,
  writeDocToHandle
} from '../core/localFile.js';
import { formatBytes, getMediaObjectUrl } from '../core/mediaDb.js';
import { createNode, createSheet, TEMPLATES } from '../core/schema.js';
import { store } from '../core/store.js';
import { STRUCTURES, THEMES } from '../render/themes.js';
import {
  buildXMindBlob,
  exportFreeMind,
  exportFullBundleZip,
  exportJSON,
  exportMarkdown,
  exportOPML,
  exportPNG,
  exportSVG,
  exportTasksCSV,
  exportTasksICS,
  exportXMind,
  generateShareUrl
} from '../exporters/index.js';
import { importFromFile, importFromText } from '../importers/formats.js';
import {
  buildNotebookLMExtractorSource,
  extractMindMapFromPngWithGemini,
  generateBookmarkletHref
} from '../importers/notebooklm.js';
import { showToast } from './toast.js';

const GEMINI_KEY_STORAGE = 'mindflow_gemini_api_key_local';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class ModalManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.root = document.getElementById('modal-root');
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  close() {
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  _open(html) {
    this.root.innerHTML = `<div class="modal-card">${html}</div>`;
    this.root.classList.remove('hidden');
    this.root.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.onclick = () => this.close();
    });
  }

  // =========================================================================
  // 0. Create New File Dialog (with explicit Storage Location & Google Drive Folder Picker)
  // =========================================================================
  openNewFile() {
    const defaultName = `心智圖 ${store.docs.length + 1}`;
    const defaultDriveRoot = gdrive.getDefaultRootFolder();
    const canPickLocal = supportsFileSystemPicker();
    const driveConnected = gdrive.isConnected();

    this._open(`
      <div class="modal-header">
        <h3>📄 建立新心智圖檔案</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <div class="field-label" style="margin-bottom:5px;font-weight:600;">檔案名稱</div>
          <input id="nf-title" class="ui-input" value="${esc(defaultName)}" placeholder="輸入新心智圖名稱..." />
        </div>

        <div class="grid-2" style="gap:10px;">
          <div>
            <div class="field-label" style="margin-bottom:5px;font-weight:600;">初始視覺結構</div>
            <select id="nf-structure" class="ui-select">
              ${STRUCTURES.map(s => `<option value="${s.id}">${s.icon} ${s.name}（${s.sub}）</option>`).join('')}
            </select>
          </div>
          <div>
            <div class="field-label" style="margin-bottom:5px;font-weight:600;">風格主題</div>
            <select id="nf-theme" class="ui-select">
              ${Object.values(THEMES).map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="padding:12px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);display:flex;flex-direction:column;gap:10px;">
          <div class="field-label" style="font-weight:700;color:var(--ui-text);">📍 選擇儲存位置</div>

          <div class="storage-options-grid">
            <label class="storage-option-card active" data-stopt="browser">
              <input type="radio" name="nf-storage" value="browser" checked />
              <div>
                <div style="font-weight:700;font-size:12.5px;">🌐 瀏覽器本機空間</div>
                <div style="font-size:11px;color:var(--ui-text-muted);margin-top:2px;">立即開始，自動暫存於瀏覽器本機（隨時可另存到電腦或雲端）</div>
              </div>
            </label>

            <label class="storage-option-card" data-stopt="local-file">
              <input type="radio" name="nf-storage" value="local-file" />
              <div>
                <div style="font-weight:700;font-size:12.5px;">💻 電腦指定資料夾</div>
                <div style="font-size:11px;color:var(--ui-text-muted);margin-top:2px;">
                  ${canPickLocal ? '建立時跳出系統視窗讓你挑選本機資料夾，之後修改自動即時寫回硬碟' : '建立時自動下載 .mindflow.json 到你的本機下載資料夾'}
                </div>
              </div>
            </label>

            <label class="storage-option-card" data-stopt="gdrive">
              <input type="radio" name="nf-storage" value="gdrive" />
              <div>
                <div style="font-weight:700;font-size:12.5px;">☁️ Google 雲端硬碟 ${driveConnected ? '<span style="color:var(--success);">● 已連線</span>' : '<span style="color:var(--ui-text-muted);">(未連線時可於下一步連結)</span>'}</div>
                <div style="font-size:11px;color:var(--ui-text-muted);margin-top:2px;">預設位置：<code>Google Drive / ${esc(defaultDriveRoot)} /</code>（可選擇是否建立新檔案夾）</div>
              </div>
            </label>
          </div>

          <!-- Dynamic Google Drive Folder Options -->
          <div id="nf-gdrive-panel" class="hidden" style="padding:10px 12px;border-radius:8px;border:1px solid var(--ui-border);background:var(--ui-surface);display:flex;flex-direction:column;gap:8px;">
            <div style="font-size:12px;font-weight:700;">☁️ Google 雲端硬碟儲存位置設定</div>
            <div class="grid-2" style="gap:8px;">
              <div>
                <div class="field-label" style="margin-bottom:3px;">預設根目錄（可修改）</div>
                <input id="nf-gd-root" class="ui-input" value="${esc(defaultDriveRoot)}" placeholder="MindFlow" />
              </div>
              <div id="nf-gd-existing-wrap" style="${driveConnected ? '' : 'opacity:0.65;'}">
                <div class="field-label" style="margin-bottom:3px;">或選擇現有子資料夾</div>
                <select id="nf-gd-existing" class="ui-select" ${driveConnected ? '' : 'disabled'}>
                  <option value="">（不選現有資料夾）</option>
                </select>
              </div>
            </div>
            <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;">
              <input type="checkbox" id="nf-gd-create-folder" checked />
              <span>在此預設位置下<b>建立新的專屬檔案夾</b>（一併集中存放原檔與節點附件）</span>
            </label>
            <div id="nf-gd-newfolder-row">
              <div class="field-label" style="margin-bottom:3px;">新檔案夾名稱</div>
              <input id="nf-gd-subfolder" class="ui-input" value="${esc(defaultName)}" placeholder="輸入新檔案夾名稱..." />
            </div>
          </div>

          <!-- Live Final Storage Path Preview -->
          <div id="nf-path-preview" style="font-size:12px;padding:7px 10px;border-radius:7px;background:var(--accent-soft);color:var(--accent);font-weight:600;word-break:break-all;"></div>
        </div>

        <div style="padding-top:8px;border-top:1px solid var(--ui-border);">
          <div class="field-label" style="margin-bottom:8px;font-weight:600;">或者從其他來源建立</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="nf-from-tpl">📑 從精選範本建立</button>
            <button class="btn btn-sm" id="nf-from-file">📂 開啟電腦檔案 (.xmind / .json / .md / .opml)</button>
            <button class="btn btn-sm" id="nf-from-nlm">✨ 從 NotebookLM 匯入</button>
            <button class="btn btn-sm" id="nf-from-works">🗂️ 管理現有檔案 (${store.docs.length})</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close-modal>取消</button>
        <button class="btn btn-primary" id="nf-create-btn">＋ 建立並儲存新檔案</button>
      </div>
    `);

    const titleEl = this.root.querySelector('#nf-title');
    const gdPanel = this.root.querySelector('#nf-gdrive-panel');
    const gdRootEl = this.root.querySelector('#nf-gd-root');
    const gdCreateCb = this.root.querySelector('#nf-gd-create-folder');
    const gdSubRow = this.root.querySelector('#nf-gd-newfolder-row');
    const gdSubEl = this.root.querySelector('#nf-gd-subfolder');
    const gdExistingSel = this.root.querySelector('#nf-gd-existing');
    const previewEl = this.root.querySelector('#nf-path-preview');
    let subEditedManually = false;

    const getSelectedMode = () => this.root.querySelector('input[name="nf-storage"]:checked')?.value || 'browser';

    const updatePreview = () => {
      const mode = getSelectedMode();
      const name = (titleEl.value.trim() || defaultName).replace(/[\\/:*?"<>|]/g, '_');
      this.root.querySelectorAll('.storage-option-card').forEach(c => {
        c.classList.toggle('active', c.dataset.stopt === mode);
      });
      gdPanel.classList.toggle('hidden', mode !== 'gdrive');
      gdSubRow.classList.toggle('hidden', !gdCreateCb.checked);

      if (mode === 'browser') {
        previewEl.textContent = `📍 預計儲存位置：瀏覽器本機空間（LocalStorage + IndexedDB）· 檔名：${name}`;
      } else if (mode === 'local-file') {
        previewEl.textContent = `📍 預計儲存位置：電腦本機指定資料夾 / ${name}.mindflow.json（按下建立後立即選擇資料夾）`;
      } else {
        const rootName = gdRootEl.value.trim() || 'MindFlow';
        if (gdExistingSel.value) {
          const optText = gdExistingSel.options[gdExistingSel.selectedIndex]?.textContent || '';
          previewEl.textContent = `📍 預計儲存位置：Google Drive / ${rootName} / ${optText} / ${name}.mindflow.json`;
        } else if (gdCreateCb.checked) {
          const sub = gdSubEl.value.trim() || name;
          previewEl.textContent = `📍 預計儲存位置：Google Drive / ${rootName} / ${sub}（新建檔案夾）/ ${name}.mindflow.json`;
        } else {
          previewEl.textContent = `📍 預計儲存位置：Google Drive / ${rootName}（預設位置，不建新檔案夾）/ ${name}.mindflow.json`;
        }
      }
    };

    // If Google Drive is connected, populate existing subfolders for quick picking
    if (driveConnected) {
      gdrive.listSubfoldersInRoot(defaultDriveRoot).then((folders) => {
        if (!gdExistingSel) return;
        for (const f of folders) {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.name;
          opt.dataset.url = f.webViewLink || '';
          gdExistingSel.appendChild(opt);
        }
      }).catch(() => {});
    }

    titleEl.addEventListener('input', () => {
      if (!subEditedManually) gdSubEl.value = titleEl.value;
      updatePreview();
    });
    gdSubEl.addEventListener('input', () => { subEditedManually = true; updatePreview(); });
    gdRootEl.addEventListener('input', updatePreview);
    gdCreateCb.addEventListener('change', () => {
      if (gdCreateCb.checked) gdExistingSel.value = '';
      updatePreview();
    });
    gdExistingSel.addEventListener('change', () => {
      if (gdExistingSel.value) gdCreateCb.checked = false;
      updatePreview();
    });
    this.root.querySelectorAll('input[name="nf-storage"]').forEach(r => r.addEventListener('change', updatePreview));

    updatePreview();
    titleEl.focus();
    titleEl.select();

    const doCreate = async () => {
      const title = titleEl.value.trim() || defaultName;
      const structure = this.root.querySelector('#nf-structure').value;
      const themeId = this.root.querySelector('#nf-theme').value;
      const mode = getSelectedMode();
      const theme = THEMES[themeId] || THEMES['xmind-classic'];

      const sheet = createSheet('畫布 1', createNode(title, {
        children: [createNode('主要分支 1'), createNode('主要分支 2'), createNode('主要分支 3')]
      }), {
        structure,
        themeId,
        branchPaletteId: theme.paletteId
      });

      const doc = store.createNewDocument(title, sheet);

      if (mode === 'local-file') {
        try {
          const res = await pickAndBindSaveFile(doc);
          store._saveToStorage();
          store.notify('doc');
          this.close();
          showToast(
            res.mode === 'local-file'
              ? `💻 已建立並綁定本機檔案：${res.fileName}`
              : `📥 已建立並下載檔案：${res.fileName}`,
            'success',
            3800
          );
        } catch (err) {
          if (err?.name === 'AbortError') {
            this.close();
            showToast('已建立新檔案（目前暫存於瀏覽器本機空間，可隨時點頂部儲存位置另存）');
          } else {
            showToast(`本機存檔失敗：${err.message}`, 'error', 4000);
          }
        }
        return;
      }

      if (mode === 'gdrive') {
        const rootName = gdRootEl.value.trim() || 'MindFlow';
        gdrive.setDefaultRootFolder(rootName);
        doc.driveParentFolderName = rootName;

        if (gdExistingSel.value) {
          doc.driveFolderId = gdExistingSel.value;
          doc.driveFolderUrl = gdExistingSel.options[gdExistingSel.selectedIndex]?.dataset?.url || '';
          doc.driveUseSubfolder = true;
          doc.driveSubfolderName = gdExistingSel.options[gdExistingSel.selectedIndex]?.textContent || title;
        } else {
          doc.driveUseSubfolder = gdCreateCb.checked;
          doc.driveSubfolderName = gdCreateCb.checked ? (gdSubEl.value.trim() || title) : '';
        }
        doc.storageLocation = { type: 'gdrive', label: gdrive.getDocTargetPathLabel(doc) };
        store._saveToStorage();
        store.notify('doc');

        if (gdrive.isConnected()) {
          try {
            showToast(`☁️ 正在儲存至 ${gdrive.getDocTargetPathLabel(doc)}...`);
            await gdrive.syncDocument(doc, (d) => buildXMindBlob(d));
            store._saveToStorage();
            store.notify('doc');
            this.close();
            showToast(`☁️ 已成功建立並儲存至 ${gdrive.getDocTargetPathLabel(doc)}`, 'success', 4200);
          } catch (err) {
            this.close();
            showToast(`已建立檔案，但雲端同步失敗：${err.message}`, 'error', 4500);
          }
        } else {
          this.openGoogleDrive();
          showToast(`已建立新檔案並記住目標路徑，請連線 Google 帳號以完成雲端建立！`, 'info', 4200);
        }
        return;
      }

      // Default: browser storage
      doc.storageLocation = { type: 'browser', label: '瀏覽器本機空間' };
      store._saveToStorage();
      store.notify('doc');
      this.close();
      showToast(`已建立新檔案「${title}」（儲存於瀏覽器本機空間）`, 'success');
    };

    this.root.querySelector('#nf-create-btn').onclick = doCreate;
    titleEl.onkeydown = (e) => { if (e.key === 'Enter') doCreate(); };

    this.root.querySelector('#nf-from-tpl').onclick = () => this.openTemplates();
    this.root.querySelector('#nf-from-nlm').onclick = () => this.openNotebookLM();
    this.root.querySelector('#nf-from-works').onclick = () => {
      this.close();
      store.toggleLeftDrawer('works');
    };
    this.root.querySelector('#nf-from-file').onclick = () => {
      this.close();
      document.getElementById('global-file-input')?.click();
    };
  }

  // =========================================================================
  // 0.5 Current File Storage Location & Save Settings Dialog
  // =========================================================================
  openStorageSettings() {
    const doc = store.getActiveDoc();
    const badge = getStorageBadgeInfo(doc);
    const defaultRoot = doc.driveParentFolderName || gdrive.getDefaultRootFolder();
    const useSub = doc.driveUseSubfolder !== false;
    const subName = doc.driveSubfolderName || doc.title;

    this._open(`
      <div class="modal-header">
        <h3>📍 檔案儲存位置管理 · ${esc(doc.title)}</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
        <div class="nlm-hero" style="margin-bottom:0;">
          <div style="font-size:12px;color:var(--ui-text-secondary);margin-bottom:4px;">目前儲存位置</div>
          <div style="font-size:15px;font-weight:700;">${badge.icon} ${esc(badge.fullLabel)}</div>
          <div style="font-size:11.5px;color:var(--ui-text-muted);margin-top:4px;">最後修改時間：${new Date(doc.updatedAt).toLocaleString()}</div>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:700;font-size:13px;">💻 儲存到電腦本機指定位置</div>
          <div style="font-size:12px;color:var(--ui-text-secondary);">
            ${supportsFileSystemPicker()
              ? '點選下方按鈕可開啟電腦資料夾視窗，指定儲存為實體 <code>.mindflow.json</code> 檔案，之後每次編輯都會自動寫回硬碟（亦可用 <code>Cmd/Ctrl + S</code> 立即存檔）。'
              : '目前瀏覽器不支援直接寫入硬碟路徑，點擊將下載 <code>.mindflow.json</code> 原始檔到您的本機下載資料夾。'}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="st-pick-local-btn">📂 選擇 / 變更電腦儲存位置</button>
            ${doc.storageLocation?.type === 'local-file' ? `<button class="btn" id="st-save-now-btn">💾 立即存檔 (Cmd/Ctrl+S)</button>` : ''}
            <button class="btn" id="st-export-xmind-btn">另存標準 .xmind</button>
          </div>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:700;font-size:13px;">☁️ 儲存到 Google 雲端硬碟</div>
          <div style="font-size:12px;color:var(--ui-text-secondary);">
            預設位置：<code>Google Drive / ${esc(defaultRoot)} /</code>
          </div>
          <div class="grid-2" style="gap:8px;">
            <div>
              <div class="field-label" style="margin-bottom:3px;">雲端預設根資料夾</div>
              <input id="st-gd-root" class="ui-input" value="${esc(defaultRoot)}" />
            </div>
            <div>
              <div class="field-label" style="margin-bottom:3px;">新檔案夾名稱（若啟用）</div>
              <input id="st-gd-sub" class="ui-input" value="${esc(subName)}" ${useSub ? '' : 'disabled'} />
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;">
            <input type="checkbox" id="st-gd-usesub" ${useSub ? 'checked' : ''} />
            <span>在預設位置下建立獨立檔案夾（否則直接存於預設根資料夾）</span>
          </label>
          <div id="st-gd-preview" style="font-size:12px;color:var(--accent);font-weight:600;"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="st-gd-save-btn">☁️ ${gdrive.isConnected() ? '立即同步到此雲端位置' : '前往連線 Google 雲端硬碟'}</button>
            ${doc.driveFolderUrl ? `<a class="btn" href="${esc(doc.driveFolderUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">📂 開啟目前雲端資料夾</a>` : ''}
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-close-modal>關閉</button>
      </div>
    `);

    const gdRoot = this.root.querySelector('#st-gd-root');
    const gdSub = this.root.querySelector('#st-gd-sub');
    const gdUseSub = this.root.querySelector('#st-gd-usesub');
    const gdPrev = this.root.querySelector('#st-gd-preview');

    const refreshGdPrev = () => {
      gdSub.disabled = !gdUseSub.checked;
      const r = gdRoot.value.trim() || 'MindFlow';
      const s = gdSub.value.trim() || doc.title;
      gdPrev.textContent = gdUseSub.checked
        ? `📍 雲端目標路徑：Google Drive / ${r} / ${s} / ${doc.title}.mindflow.json`
        : `📍 雲端目標路徑：Google Drive / ${r} / ${doc.title}.mindflow.json`;
    };
    gdRoot.oninput = refreshGdPrev;
    gdSub.oninput = refreshGdPrev;
    gdUseSub.onchange = refreshGdPrev;
    refreshGdPrev();

    this.root.querySelector('#st-pick-local-btn').onclick = async () => {
      try {
        const res = await pickAndBindSaveFile(doc);
        store._saveToStorage();
        store.notify('doc');
        showToast(`💻 已更新本機儲存位置：${res.fileName}`, 'success');
        this.openStorageSettings();
      } catch (err) {
        if (err?.name !== 'AbortError') showToast(`選擇位置失敗：${err.message}`, 'error');
      }
    };

    this.root.querySelector('#st-save-now-btn')?.addEventListener('click', async () => {
      try {
        const ok = await writeDocToHandle(doc);
        if (ok) {
          store._saveToStorage();
          store.notify('doc');
          showToast('💾 已儲存至本機檔案！', 'success');
          this.openStorageSettings();
        } else {
          showToast('找不到本機檔案權限，請重新點選「選擇／變更電腦儲存位置」', 'error');
        }
      } catch (err) {
        showToast(`存檔失敗：${err.message}`, 'error');
      }
    });

    this.root.querySelector('#st-export-xmind-btn').onclick = async () => {
      await exportXMind();
      showToast('已匯出標準 .xmind 檔案', 'success');
    };

    this.root.querySelector('#st-gd-save-btn').onclick = async () => {
      const r = gdRoot.value.trim() || 'MindFlow';
      gdrive.setDefaultRootFolder(r);
      const changedPath =
        doc.driveParentFolderName !== r ||
        (doc.driveUseSubfolder !== false) !== gdUseSub.checked ||
        (doc.driveSubfolderName || doc.title) !== (gdSub.value.trim() || doc.title);

      doc.driveParentFolderName = r;
      doc.driveUseSubfolder = gdUseSub.checked;
      doc.driveSubfolderName = gdUseSub.checked ? (gdSub.value.trim() || doc.title) : '';
      if (changedPath) {
        doc.driveFolderId = '';
        doc.driveJsonFileId = '';
        doc.driveXmindFileId = '';
      }
      doc.storageLocation = { type: 'gdrive', label: gdrive.getDocTargetPathLabel(doc) };
      store._saveToStorage();
      store.notify('doc');

      if (!gdrive.isConnected()) {
        this.openGoogleDrive();
        return;
      }

      try {
        showToast(`☁️ 正在同步至 ${gdrive.getDocTargetPathLabel(doc)}...`);
        await gdrive.syncDocument(doc, (d) => buildXMindBlob(d));
        store._saveToStorage();
        store.notify('doc');
        showToast(`☁️ 已儲存至 ${gdrive.getDocTargetPathLabel(doc)}`, 'success', 3800);
        this.openStorageSettings();
      } catch (err) {
        showToast(`同步失敗：${err.message}`, 'error', 4200);
      }
    };
  }

  // =========================================================================
  // 1. NotebookLM (Gemini Notebook) Import Bridge Center
  // =========================================================================
  openNotebookLM(activeTab = 'bookmarklet') {
    const appUrl = window.location.origin + window.location.pathname;
    const bookmarkletHref = generateBookmarkletHref(appUrl);
    const consoleScript = buildNotebookLMExtractorSource(appUrl);
    const savedKey = localStorage.getItem(GEMINI_KEY_STORAGE) || '';

    this._open(`
      <div class="modal-header">
        <h3>✨ Google NotebookLM（Gemini Notebook）心智圖匯入中心</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body">
        <div class="nlm-hero">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">將 NotebookLM 心智圖無損搬進 MindFlow 繼續編輯！</div>
          <div style="font-size:12.5px;color:var(--ui-text-secondary);line-height:1.55;">
            NotebookLM 原生僅提供靜態 PNG 下載。本平台提供 <b>4 種無縫橋接方式</b>：一鍵書籤擷取（連收合子節點都抓得到）、檔案／貼上還原、Gemini Vision 圖片辨識，以及隨附 Chrome 擴充套件。
          </div>
        </div>

        <div class="modal-tabs">
          <button class="modal-tab ${activeTab === 'bookmarklet' ? 'active' : ''}" data-nlmtab="bookmarklet">⚡ 一鍵書籤工具（推薦）</button>
          <button class="modal-tab ${activeTab === 'paste' ? 'active' : ''}" data-nlmtab="paste">📥 上傳 / 貼上資料</button>
          <button class="modal-tab ${activeTab === 'png' ? 'active' : ''}" data-nlmtab="png">🖼️ 原生 PNG AI 辨識</button>
          <button class="modal-tab ${activeTab === 'ext' ? 'active' : ''}" data-nlmtab="ext">🧩 Chrome 擴充套件</button>
        </div>

        <div id="nlm-tab-content"></div>
      </div>
    `);

    const renderTab = (tab) => {
      this.root.querySelectorAll('[data-nlmtab]').forEach(b => b.classList.toggle('active', b.dataset.nlmtab === tab));
      const box = this.root.querySelector('#nlm-tab-content');

      if (tab === 'bookmarklet') {
        box.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);">
              <div style="font-weight:700;margin-bottom:8px;">步驟 1：將下方按鈕拖曳到瀏覽器的「書籤列」</div>
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <a class="bookmarklet-btn" href="${bookmarkletHref}" onclick="event.preventDefault();alert('請按住滑鼠左鍵，將此按鈕拖曳到瀏覽器上方的書籤列！');">
                  ✨ 匯出 NotebookLM 到 MindFlow
                </a>
                <span style="font-size:12px;color:var(--ui-text-muted);">← 按住拖到書籤列即可永久使用</span>
              </div>
              <div style="font-size:12.5px;color:var(--ui-text-secondary);margin-top:10px;line-height:1.6;">
                <b>步驟 2</b>：在 <a href="https://notebooklm.google.com" target="_blank" rel="noopener" style="color:var(--accent);">notebooklm.google.com</a> 打開任意筆記本並點開「心智圖」。<br/>
                <b>步驟 3</b>：點一下剛剛加入的書籤，它會自動讀取底層 D3 資料（<b>包含尚未展開的收合分支</b>），並自動開啟本平台將完整心智圖載入成可編輯畫布！
              </div>
            </div>

            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <strong style="font-size:12.5px;">備用方式：複製開發者主控台 (DevTools Console) 腳本</strong>
                <button class="btn btn-sm btn-primary" id="copy-console-script">複製腳本</button>
              </div>
              <div class="code-box">${esc(consoleScript.slice(0, 700))} ...</div>
            </div>
          </div>
        `;
        box.querySelector('#copy-console-script').onclick = async () => {
          await navigator.clipboard.writeText(consoleScript);
          showToast('已複製擷取腳本！請在 NotebookLM 按 F12 → Console 貼上執行', 'success', 3800);
        };
      } else if (tab === 'paste') {
        box.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:12px;">
            <div class="dropzone" id="nlm-dropzone">
              <div style="font-size:24px;margin-bottom:6px;">📂</div>
              <div style="font-weight:700;">拖曳檔案到此處，或點擊選擇檔案</div>
              <div style="font-size:12px;color:var(--ui-text-muted);margin-top:4px;">
                自動辨識：NotebookLM JSON / SVG、Markdown (.md)、OPML (.opml)、FreeMind (.mm)、XMind (.xmind)、Obsidian (.canvas)
              </div>
              <input type="file" id="nlm-file-input" class="hidden" accept=".json,.svg,.md,.markdown,.opml,.mm,.xmind,.canvas,.txt" />
            </div>

            <div style="font-weight:600;font-size:12.5px;">或直接貼上 NotebookLM JSON / SVG 原始碼 / Markdown 大綱：</div>
            <textarea id="nlm-paste-area" class="ui-textarea" style="min-height:140px;font-family:var(--font-mono);font-size:12px;" placeholder='例如貼上 {"name":"AI 研究","children":[{"name":"核心架構","children":[]}]} 或 <svg>...</svg> 或 Markdown 清單...'></textarea>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <div style="display:flex;align-items:center;gap:12px;">
                <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;">
                  <input type="checkbox" id="nlm-as-new-doc" /> 建為全新文件（否則新增為新畫布）
                </label>
                <button class="btn btn-sm" id="nlm-sample-btn">載入 NotebookLM 範例資料</button>
              </div>
              <button class="btn btn-primary" id="nlm-import-text-btn">解析並匯入畫布</button>
            </div>
          </div>
        `;

        const dz = box.querySelector('#nlm-dropzone');
        const fi = box.querySelector('#nlm-file-input');
        const doFile = async (file) => {
          try {
            const parsed = await importFromFile(file);
            const asNewDoc = box.querySelector('#nlm-as-new-doc').checked;
            store.importAsSheetOrDoc(parsed.root, {
              title: parsed.title,
              sheets: parsed.sheets,
              structure: 'logic-right',
              themeId: 'notebooklm-clean',
              asNewDoc
            });
            this.close();
            showToast(`成功匯入「${parsed.title}」！`, 'success');
          } catch (err) {
            showToast(`匯入失敗：${err.message}`, 'error', 4000);
          }
        };

        dz.onclick = () => fi.click();
        fi.onchange = () => { if (fi.files?.[0]) doFile(fi.files[0]); };
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
        dz.ondragleave = () => dz.classList.remove('dragover');
        dz.ondrop = (e) => {
          e.preventDefault();
          dz.classList.remove('dragover');
          if (e.dataTransfer.files?.[0]) doFile(e.dataTransfer.files[0]);
        };

        box.querySelector('#nlm-sample-btn').onclick = () => {
          box.querySelector('#nlm-paste-area').value = JSON.stringify({
            name: 'Gemini NotebookLM：生成式 AI 產品策略',
            children: [
              {
                name: '核心使用者價值',
                children: [
                  { name: '跨文件語意整合與溯源引用' },
                  { name: '自動生成心智圖與 Audio Overview' }
                ]
              },
              {
                name: '技術架構重點',
                children: [
                  { name: '長上下文視窗 (Long Context) + RAG' },
                  { name: '前端 D3.js 互動式 SVG 心智圖渲染' }
                ]
              },
              {
                name: '延伸工作流 (MindFlow)',
                children: [
                  { name: '二次編輯、重排結構與補充筆記' },
                  { name: '轉為演說簡報、甘特圖或匯出 .xmind' }
                ]
              }
            ]
          }, null, 2);
        };

        box.querySelector('#nlm-import-text-btn').onclick = () => {
          const text = box.querySelector('#nlm-paste-area').value;
          try {
            const parsed = importFromText(text, 'NotebookLM 匯入');
            const asNewDoc = box.querySelector('#nlm-as-new-doc').checked;
            store.importAsSheetOrDoc(parsed.root, {
              title: parsed.title,
              sheets: parsed.sheets,
              structure: 'logic-right',
              themeId: 'notebooklm-clean',
              asNewDoc
            });
            this.close();
            showToast(`成功匯入「${parsed.title}」！`, 'success');
          } catch (err) {
            showToast(`解析失敗：${err.message}`, 'error', 4000);
          }
        };
      } else if (tab === 'png') {
        box.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:12px;">
            <p style="margin:0;font-size:12.5px;color:var(--ui-text-secondary);line-height:1.6;">
              如果你直接按了 NotebookLM 右上角的原生「下載 PNG」按鈕，可在此上傳該 PNG 截圖，並使用您個人的 <b>Gemini API Key</b>（僅存於您的瀏覽器本機，直接呼叫 Google 官方 API）自動辨識並還原為完全可編輯的心智圖！
            </p>
            <div class="grid-2">
              <div>
                <div class="field-label" style="margin-bottom:4px;">Gemini API Key（僅存於本機）</div>
                <input type="password" id="gemini-key-input" class="ui-input" value="${esc(savedKey)}" placeholder="AIzaSy..." />
              </div>
              <div>
                <div class="field-label" style="margin-bottom:4px;">視覺辨識模型</div>
                <select id="gemini-model-select" class="ui-select">
                  <option value="gemini-2.5-flash">gemini-2.5-flash（推薦，快速準確）</option>
                  <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro（超大型複雜心智圖）</option>
                </select>
              </div>
            </div>
            <div class="dropzone" id="png-dropzone">
              <div style="font-size:24px;margin-bottom:6px;">🖼️</div>
              <div style="font-weight:700;" id="png-drop-label">選擇或拖曳 NotebookLM 下載的 PNG 心智圖</div>
              <input type="file" id="png-file-input" class="hidden" accept="image/png,image/jpeg,image/webp" />
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button class="btn btn-primary" id="png-run-btn" disabled>✨ 開始 AI 還原心智圖</button>
            </div>
          </div>
        `;

        let selectedFile = null;
        const dz = box.querySelector('#png-dropzone');
        const fi = box.querySelector('#png-file-input');
        const runBtn = box.querySelector('#png-run-btn');
        const lbl = box.querySelector('#png-drop-label');

        const pick = (f) => {
          selectedFile = f;
          lbl.textContent = `已選擇圖片：${f.name} (${Math.round(f.size / 1024)} KB)`;
          runBtn.disabled = false;
        };
        dz.onclick = () => fi.click();
        fi.onchange = () => { if (fi.files?.[0]) pick(fi.files[0]); };
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
        dz.ondragleave = () => dz.classList.remove('dragover');
        dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files?.[0]) pick(e.dataTransfer.files[0]); };

        runBtn.onclick = async () => {
          const key = box.querySelector('#gemini-key-input').value.trim();
          const model = box.querySelector('#gemini-model-select').value;
          if (!key) return showToast('請先填入 Gemini API Key', 'error');
          localStorage.setItem(GEMINI_KEY_STORAGE, key);
          runBtn.disabled = true;
          runBtn.textContent = '⏳ Gemini 視覺辨識中...';
          try {
            const parsed = await extractMindMapFromPngWithGemini(selectedFile, key, model);
            store.importAsSheetOrDoc(parsed.root, {
              title: parsed.title,
              structure: 'logic-right',
              themeId: 'notebooklm-clean'
            });
            this.close();
            showToast(`AI 成功還原「${parsed.title}」！`, 'success');
          } catch (err) {
            showToast(err.message, 'error', 4500);
            runBtn.disabled = false;
            runBtn.textContent = '✨ 開始 AI 還原心智圖';
          }
        };
      } else if (tab === 'ext') {
        box.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;line-height:1.65;">
            <p style="margin:0;">本專案 GitHub 儲存庫內已隨附完整的 Chrome Manifest V3 擴充套件（位於 <code>notebooklm-extension/</code> 資料夾），安裝後會直接在 NotebookLM 心智圖右上角注入「<b>✨ 匯出到 MindFlow</b>」按鈕！</p>
            <ol style="margin:0;padding-left:20px;">
              <li>從 GitHub 下載本專案，找到 <code>notebooklm-extension</code> 資料夾。</li>
              <li>在 Chrome 網址列輸入 <code>chrome://extensions</code>，開啟右上角「<b>開發人員模式</b>」。</li>
              <li>點擊「<b>載入未封裝項目</b>」，選擇 <code>notebooklm-extension</code> 資料夾。</li>
              <li>點擴充圖示設定你的 MindFlow 網址（預設已填入本頁網址：<code>${esc(appUrl)}</code>），之後在 NotebookLM 即可一鍵直達！</li>
            </ol>
          </div>
        `;
      }
    };

    this.root.querySelectorAll('[data-nlmtab]').forEach(btn => {
      btn.onclick = () => renderTab(btn.dataset.nlmtab);
    });
    renderTab(activeTab);
  }

  // =========================================================================
  // 2. Templates Gallery
  // =========================================================================
  openTemplates() {
    this._open(`
      <div class="modal-header">
        <h3>📑 精選範本庫 (Templates Gallery)</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body">
        <div class="template-grid">
          ${TEMPLATES.map(t => `
            <div class="template-card" data-tpl="${t.id}">
              <span class="template-badge">${esc(t.category)}</span>
              <strong style="font-size:14px;">${esc(t.name)}</strong>
              <p style="margin:0;font-size:12px;color:var(--ui-text-secondary);line-height:1.5;">${esc(t.desc)}</p>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <span style="margin-right:auto;font-size:12px;color:var(--ui-text-muted);">點擊任意範本即可新增為一張獨立畫布</span>
        <button class="btn" data-close-modal>關閉</button>
      </div>
    `);

    this.root.querySelectorAll('[data-tpl]').forEach(card => {
      card.onclick = () => {
        const tpl = TEMPLATES.find(t => t.id === card.dataset.tpl);
        if (!tpl) return;
        const sheet = tpl.build();
        store.addSheet(sheet);
        this.close();
        showToast(`已套用範本「${tpl.name}」`, 'success');
      };
    });
  }

  // =========================================================================
  // 3. Export & Share Studio
  // =========================================================================
  openExport() {
    this._open(`
      <div class="modal-header">
        <h3>📤 匯出與分享工作室</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:16px;">
        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);">
          <div style="font-weight:700;margin-bottom:8px;">🖼️ 匯出高解析圖片（支援 Map Shot 質感畫框）</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
            <label style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">解析度：
              <select id="exp-png-scale" class="ui-select" style="width:auto;min-width:140px;">
                <option value="1">1x 標準</option>
                <option value="2" selected>2x 高清 (Retina)</option>
                <option value="3">3x 超清印刷</option>
              </select>
            </label>
            <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;">
              <input type="checkbox" id="exp-png-trans" /> 透明背景
            </label>
            <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;">
              <input type="checkbox" id="exp-png-frame" /> 漸層 3D 畫框 (Map Shot)
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="exp-png-btn">下載 PNG 圖片</button>
            <button class="btn" id="exp-svg-btn">下載無損 SVG</button>
            <button class="btn" id="exp-pdf-btn">列印 / 儲存 PDF</button>
          </div>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);">
          <div style="font-weight:700;margin-bottom:8px;">📦 心智圖與文件格式</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="exp-xmind-btn">匯出原生 .xmind</button>
            <button class="btn btn-primary" id="exp-bundle-btn" title="包含原始心智圖檔 + attachments 資料夾內所有附件與影片">☁️ 完整套件 (.zip 含所有附件)</button>
            <button class="btn" id="exp-md-btn">Markdown (.md)</button>
            <button class="btn" id="exp-opml-btn">OPML (.opml)</button>
            <button class="btn" id="exp-mm-btn">FreeMind (.mm)</button>
            <button class="btn" id="exp-json-btn">MindFlow JSON</button>
            <button class="btn" id="exp-csv-btn">任務 CSV</button>
            <button class="btn" id="exp-ics-btn">行事曆 (.ics)</button>
          </div>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);">
          <div style="font-weight:700;margin-bottom:6px;">🔗 免後端壓縮分享連結（GitHub Pages 適用）</div>
          <div style="font-size:12px;color:var(--ui-text-muted);margin-bottom:8px;">
            將目前畫布壓縮編碼進網址 Hash，對方點開連結即可直接檢視並建立自己的複本，完全不需伺服器或登入！
          </div>
          <div style="display:flex;gap:8px;">
            <input id="exp-share-url" class="ui-input" readonly placeholder="點擊右側產生分享連結..." />
            <button class="btn btn-primary" id="exp-share-gen" style="white-space:nowrap;">產生並複製</button>
          </div>
        </div>
      </div>
    `);

    this.root.querySelector('#exp-png-btn').onclick = async () => {
      try {
        await exportPNG(this.canvas, {
          scale: Number(this.root.querySelector('#exp-png-scale').value) || 2,
          transparent: this.root.querySelector('#exp-png-trans').checked,
          framed: this.root.querySelector('#exp-png-frame').checked
        });
        showToast('已匯出 PNG 圖片', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
    this.root.querySelector('#exp-svg-btn').onclick = () => {
      exportSVG(this.canvas, { transparent: this.root.querySelector('#exp-png-trans').checked });
      showToast('已匯出 SVG 向量檔', 'success');
    };
    this.root.querySelector('#exp-pdf-btn').onclick = () => {
      this.close();
      setTimeout(() => window.print(), 200);
    };
    this.root.querySelector('#exp-xmind-btn').onclick = async () => {
      await exportXMind();
      showToast('已匯出標準 .xmind 檔案（可直接於 XMind 開啟）', 'success');
    };
    this.root.querySelector('#exp-bundle-btn').onclick = async () => {
      showToast('正在打包原檔與所有附加檔案...');
      await exportFullBundleZip();
      showToast('已匯出完整套件 ZIP（含原檔 + attachments/）', 'success');
    };
    this.root.querySelector('#exp-md-btn').onclick = () => { exportMarkdown(); showToast('已匯出 Markdown', 'success'); };
    this.root.querySelector('#exp-opml-btn').onclick = () => { exportOPML(); showToast('已匯出 OPML', 'success'); };
    this.root.querySelector('#exp-mm-btn').onclick = () => { exportFreeMind(); showToast('已匯出 FreeMind (.mm)', 'success'); };
    this.root.querySelector('#exp-json-btn').onclick = () => { exportJSON(); showToast('已匯出 JSON 備份', 'success'); };
    this.root.querySelector('#exp-csv-btn').onclick = () => { exportTasksCSV(); showToast('已匯出任務 CSV', 'success'); };
    this.root.querySelector('#exp-ics-btn').onclick = () => { exportTasksICS(); showToast('已匯出行事曆 .ics', 'success'); };

    this.root.querySelector('#exp-share-gen').onclick = async () => {
      const url = await generateShareUrl();
      const inp = this.root.querySelector('#exp-share-url');
      inp.value = url;
      inp.select();
      await navigator.clipboard.writeText(url).catch(() => {});
      showToast('已產生並複製分享連結！', 'success');
    };
  }

  // =========================================================================
  // 4. Shortcuts Cheat Sheet
  // =========================================================================
  openShortcuts() {
    const rows = [
      ['Tab', '新增子主題'],
      ['Enter', '新增同層兄弟主題'],
      ['雙擊節點 / Space / F2', '編輯節點文字'],
      ['雙擊畫布空白處', '建立自由主題 (Floating Topic)'],
      ['Delete / Backspace', '刪除選取的主題或關聯線'],
      ['Cmd / Ctrl + Z', '復原上一步'],
      ['Cmd / Ctrl + Shift + Z', '重做'],
      ['Cmd / Ctrl + /', '摺疊 / 展開子分支'],
      ['Cmd / Ctrl + F', '開啟搜尋、取代與篩選面板'],
      ['Cmd / Ctrl + 0', '畫布自動縮放適中 (Fit Map)'],
      ['拖曳節點至其他節點', '調整父子層級或同層排序'],
      ['Esc', '取消連線模式 / 離開 ZEN 或演說模式']
    ];

    this._open(`
      <div class="modal-header">
        <h3>⌨️ 快捷鍵速查表</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body">
        <table style="width:100%;border-collapse:collapse;">
          ${rows.map(([k, desc]) => `
            <tr style="border-bottom:1px solid var(--ui-border);">
              <td style="padding:8px 4px;width:44%;"><kbd style="padding:3px 8px;border-radius:5px;border:1px solid var(--ui-border-strong);background:var(--ui-surface-2);font-family:var(--font-mono);font-size:12px;">${k}</kbd></td>
              <td style="padding:8px 4px;color:var(--ui-text-secondary);">${desc}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `);
  }

  // =========================================================================
  // 5. Google Drive Cloud Storage & Sync Center
  // =========================================================================
  openGoogleDrive() {
    const doc = store.getActiveDoc();
    const connected = gdrive.isConnected();
    const clientId = gdrive.getClientId();
    const origin = window.location.origin;

    this._open(`
      <div class="modal-header">
        <h3>☁️ Google 雲端硬碟整合中心</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
        <div class="nlm-hero" style="margin-bottom:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;">
                <span class="gdrive-status-dot ${connected ? 'connected' : 'offline'}"></span>
                ${connected ? `已連線：${esc(gdrive.userInfo?.displayName || 'Google Drive')} (${esc(gdrive.userInfo?.emailAddress || '')})` : '尚未連線至 Google 雲端硬碟'}
              </div>
              <div style="font-size:12px;color:var(--ui-text-secondary);margin-top:4px;">
                雲端自動結構：<code>Google Drive / MindFlow / &lt;心智圖名稱&gt; /</code>（同時存放原始 <code>.mindflow.json</code>、<code>.xmind</code> 與 <code>attachments/</code> 內所有節點附件與影片）
              </div>
            </div>
            ${connected ? `<button class="btn btn-sm btn-danger" id="gd-disconnect-btn">中斷連線</button>` : ''}
          </div>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);display:flex;flex-direction:column;gap:8px;">
          <div style="font-weight:700;font-size:13px;">🔑 連線設定（純前端 OAuth 2.0，僅存取本應用建立的檔案）</div>
          <div style="display:flex;gap:8px;">
            <input id="gd-client-id" class="ui-input" value="${esc(clientId)}" placeholder="貼上您的 Google OAuth Client ID (xxxx.apps.googleusercontent.com)" />
            <button class="btn btn-primary" id="gd-connect-btn" style="white-space:nowrap;">${connected ? '重新授權' : '連結 Google 帳號'}</button>
          </div>
          <details style="font-size:12px;color:var(--ui-text-secondary);line-height:1.6;">
            <summary style="cursor:pointer;font-weight:600;color:var(--accent);">如何取得自己的 Google OAuth Client ID（1 分鐘免費設定）？</summary>
            <ol style="margin:6px 0 0;padding-left:20px;">
              <li>前往 <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener" style="color:var(--accent);">Google Cloud Console</a> 啟用 <b>Google Drive API</b>。</li>
              <li>在 <b>憑證 → 建立憑證 → OAuth 用戶端 ID</b> 選擇「<b>網頁應用程式</b>」。</li>
              <li>在「已授權的 JavaScript 來源」填入目前網址來源：<code>${esc(origin)}</code></li>
              <li>複製產生的 Client ID 貼到上方欄位，按「連結 Google 帳號」即可！</li>
            </ol>
          </details>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;font-size:13.5px;">目前心智圖：${esc(doc.title)}</div>
              <div style="font-size:12px;color:var(--accent);font-weight:600;margin-top:2px;">
                📍 目標路徑：${esc(gdrive.getDocTargetPathLabel(doc))}
              </div>
              <div id="gd-sync-status" style="font-size:12px;color:var(--ui-text-muted);margin-top:2px;">
                ${doc.driveLastSyncedAt ? `上次雲端同步：${new Date(doc.driveLastSyncedAt).toLocaleString()}` : '尚未同步到 Google Drive'}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="btn btn-sm" id="gd-change-folder-btn">📂 變更雲端位置 / 檔案夾</button>
              ${doc.driveFolderUrl ? `<a class="btn btn-sm" href="${esc(doc.driveFolderUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">開啟雲端資料夾</a>` : ''}
              <button class="btn btn-primary" id="gd-sync-now-btn" ${connected ? '' : 'disabled'}>☁️ 立即同步原檔＋附件</button>
            </div>
          </div>
        </div>

        <div style="padding:14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface-2);display:flex;flex-direction:column;gap:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <strong style="font-size:13px;">📂 雲端已儲存的心智圖</strong>
            <button class="btn btn-sm" id="gd-refresh-list-btn" ${connected ? '' : 'disabled'}>重新整理清單</button>
          </div>
          <div id="gd-cloud-list" style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--ui-text-muted);">
            ${connected ? '點擊「重新整理清單」載入您的 MindFlow 雲端資料夾...' : '連線 Google 帳號後即可瀏覽並開啟雲端心智圖。'}
          </div>
        </div>

        <div style="padding:12px 14px;border:1px dashed var(--ui-border-strong);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="font-size:12px;color:var(--ui-text-secondary);">
            <b>免設定 OAuth 備用方案：</b>直接打包本心智圖原檔（<code>.mindflow.json</code> + <code>.xmind</code>）與所有節點附件／影片成單一 ZIP，手動拖進 Google Drive！
          </div>
          <button class="btn btn-sm" id="gd-bundle-zip-btn" style="white-space:nowrap;">📦 下載完整 ZIP 套件</button>
        </div>
      </div>
    `);

    const loadList = async () => {
      const listEl = this.root.querySelector('#gd-cloud-list');
      if (!gdrive.isConnected() || !listEl) return;
      listEl.textContent = '⏳ 正在讀取 Google Drive / MindFlow 資料夾...';
      try {
        const items = await gdrive.listSavedMindMaps();
        if (!items.length) {
          listEl.textContent = 'Google Drive / MindFlow 目前尚無已同步的心智圖。';
          return;
        }
        listEl.innerHTML = items.map(it => `
          <div class="att-item">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;color:var(--ui-text);">${esc(it.folderName)}</div>
              <div style="font-size:11px;color:var(--ui-text-muted);">更新於 ${new Date(it.modifiedTime).toLocaleString()}</div>
            </div>
            <a class="btn btn-sm" href="${esc(it.folderUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">雲端資料夾</a>
            <button class="btn btn-sm btn-primary" data-gd-open="${it.jsonFileId}">載入編輯</button>
          </div>
        `).join('');
        listEl.querySelectorAll('[data-gd-open]').forEach(btn => {
          btn.onclick = async () => {
            try {
              showToast('正在從 Google Drive 載入心智圖...');
              const loaded = await gdrive.downloadJsonFile(btn.dataset.gdOpen);
              if (loaded?.sheets?.[0]?.root) {
                store.importAsSheetOrDoc(loaded.sheets[0].root, {
                  title: loaded.title || 'Google Drive 心智圖',
                  sheets: loaded.sheets,
                  asNewDoc: true
                });
                const cur = store.getActiveDoc();
                cur.driveFolderId = loaded.driveFolderId || '';
                cur.driveFolderUrl = loaded.driveFolderUrl || '';
                cur.driveJsonFileId = btn.dataset.gdOpen;
                cur.driveXmindFileId = loaded.driveXmindFileId || '';
                cur.driveLastSyncedAt = loaded.driveLastSyncedAt || '';
                store._saveToStorage();
                this.close();
                showToast(`已從 Google Drive 載入「${loaded.title}」！`, 'success');
              }
            } catch (err) {
              showToast(`載入失敗：${err.message}`, 'error', 4000);
            }
          };
        });
      } catch (err) {
        listEl.textContent = `讀取清單失敗：${err.message}`;
      }
    };

    this.root.querySelector('#gd-connect-btn').onclick = async () => {
      const cid = this.root.querySelector('#gd-client-id').value.trim();
      try {
        await gdrive.connect(cid);
        showToast('已成功連線至 Google 雲端硬碟！', 'success');
        this.openGoogleDrive();
      } catch (err) {
        showToast(`連線失敗：${err.message}`, 'error', 4500);
      }
    };

    this.root.querySelector('#gd-disconnect-btn')?.addEventListener('click', () => {
      gdrive.disconnect();
      showToast('已中斷 Google Drive 連線');
      this.openGoogleDrive();
    });

    this.root.querySelector('#gd-change-folder-btn')?.addEventListener('click', () => this.openStorageSettings());

    this.root.querySelector('#gd-sync-now-btn')?.addEventListener('click', async () => {
      const statusEl = this.root.querySelector('#gd-sync-status');
      const btn = this.root.querySelector('#gd-sync-now-btn');
      btn.disabled = true;
      try {
        const res = await gdrive.syncDocument(
          store.getActiveDoc(),
          (d) => buildXMindBlob(d),
          (msg) => { if (statusEl) statusEl.textContent = `⏳ ${msg}`; }
        );
        store._saveToStorage();
        store.notify('doc');
        showToast(`☁️ 同步完成！已上傳 ${res.uploadedCount} 個新附件並備份原檔`, 'success', 4000);
        this.openGoogleDrive();
      } catch (err) {
        if (statusEl) statusEl.textContent = `同步失敗：${err.message}`;
        showToast(`同步失敗：${err.message}`, 'error', 4500);
        btn.disabled = false;
      }
    });

    this.root.querySelector('#gd-refresh-list-btn')?.addEventListener('click', loadList);
    this.root.querySelector('#gd-bundle-zip-btn').onclick = async () => {
      showToast('正在打包心智圖與所有附件...');
      await exportFullBundleZip();
      showToast('已下載完整 ZIP 套件，可直接拖入 Google Drive！', 'success');
    };

    if (connected) loadList();
  }

  // =========================================================================
  // 6. Video Player Lightbox Modal (Local IndexedDB / YouTube / Google Drive / Direct URL)
  // =========================================================================
  async openVideoPlayer(node) {
    const v = node?.video;
    if (!v) return;

    let playerHtml = '';
    let objectUrlToRevoke = null;

    if (v.localBlobId) {
      objectUrlToRevoke = await getMediaObjectUrl(v.localBlobId);
    }

    if (objectUrlToRevoke) {
      playerHtml = `<video src="${objectUrlToRevoke}" controls autoplay playsinline style="width:100%;max-height:66vh;border-radius:10px;background:#000;"></video>`;
    } else if (v.sourceType === 'youtube' || v.sourceType === 'gdrive' || v.driveFileId) {
      const embedSrc = v.embedUrl || `https://drive.google.com/file/d/${v.driveFileId}/preview`;
      playerHtml = `<iframe src="${esc(embedSrc)}" allow="autoplay; fullscreen" allowfullscreen style="display:block;width:100%;aspect-ratio:16/9;max-height:58vh;border:none;border-radius:10px;background:#000;"></iframe>`;
    } else if (v.url) {
      playerHtml = `<video src="${esc(v.url)}" controls autoplay playsinline style="width:100%;max-height:66vh;border-radius:10px;background:#000;"></video>`;
    } else {
      playerHtml = `<div style="padding:40px;text-align:center;color:var(--ui-text-muted);">找不到影片來源，請確認已同步至 Google Drive 或重新上傳影片。</div>`;
    }

    this._open(`
      <div class="modal-header">
        <h3>🎬 ${esc(v.name || v.title || node.title)}</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="padding:14px 18px;">
        ${playerHtml}
      </div>
      <div class="modal-footer">
        <span style="margin-right:auto;font-size:12px;color:var(--ui-text-muted);">所屬知識節點：${esc(node.title)}</span>
        ${v.driveWebViewLink ? `<a class="btn btn-sm" href="${esc(v.driveWebViewLink)}" target="_blank" rel="noopener" style="text-decoration:none;">☁️ 在 Google Drive 開啟</a>` : ''}
        <button class="btn btn-primary" data-close-modal>關閉</button>
      </div>
    `);

    if (objectUrlToRevoke) {
      const origClose = this.close.bind(this);
      const cleanup = () => {
        if (objectUrlToRevoke) {
          URL.revokeObjectURL(objectUrlToRevoke);
          objectUrlToRevoke = null;
        }
      };
      this.root.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.onclick = () => { cleanup(); origClose(); };
      });
    }
  }

  // =========================================================================
  // 7. Image Lightbox Modal
  // =========================================================================
  openImageLightbox(node) {
    if (!node?.image) return;
    this._open(`
      <div class="modal-header">
        <h3>🖼️ ${esc(node.title)}</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="text-align:center;background:#0f172a;padding:16px;">
        <img src="${esc(node.image)}" alt="${esc(node.title)}" style="max-width:100%;max-height:70vh;border-radius:8px;object-fit:contain;" />
      </div>
      <div class="modal-footer">
        <a class="btn btn-sm" href="${esc(node.image)}" download="${esc(node.title)}.png" style="text-decoration:none;">下載圖片</a>
        <button class="btn btn-primary" data-close-modal>關閉</button>
      </div>
    `);
  }

  // =========================================================================
  // 8. Node Attachments Viewer Modal
  // =========================================================================
  openAttachmentsModal(node) {
    if (!node) return;
    store.selectNode(node.id);
    const list = node.attachments || [];
    this._open(`
      <div class="modal-header">
        <h3>📎 附加檔案 · ${esc(node.title)} (${list.length})</h3>
        <button class="btn btn-sm" data-close-modal>✕</button>
      </div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:8px;">
        ${list.map((att, idx) => `
          <div class="att-item">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;">${att.driveFileId ? '☁️ ' : '📄 '}${esc(att.name)}</div>
              <div style="font-size:11.5px;color:var(--ui-text-muted);">
                ${att.size ? formatBytes(att.size) : '雲端 / 外部連結'}${att.driveFileId ? ' · 已同步至 Google Drive' : ' · 本機 IndexedDB'}
              </div>
            </div>
            <button class="btn btn-sm btn-primary" data-modal-open-att="${idx}">下載 / 開啟</button>
          </div>
        `).join('') || `<div style="padding:24px;text-align:center;color:var(--ui-text-muted);">此節點尚無附加檔案，請於右側主題面板上傳！</div>`}
      </div>
      <div class="modal-footer">
        <button class="btn" id="att-modal-gdrive-btn">☁️ 同步至 Google Drive</button>
        <button class="btn btn-primary" data-close-modal>完成</button>
      </div>
    `);

    this.root.querySelector('#att-modal-gdrive-btn').onclick = () => this.openGoogleDrive();
    this.root.querySelectorAll('[data-modal-open-att]').forEach(btn => {
      btn.onclick = async () => {
        const att = list[Number(btn.dataset.modalOpenAtt)];
        if (!att) return;
        if (att.localBlobId) {
          const objUrl = await getMediaObjectUrl(att.localBlobId);
          if (objUrl) {
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = att.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
            return;
          }
        }
        if (att.driveWebViewLink || att.url) {
          window.open(att.driveWebViewLink || att.url, '_blank', 'noopener');
        } else if (att.driveFileId) {
          window.open(`https://drive.google.com/file/d/${att.driveFileId}/view`, '_blank', 'noopener');
        }
      };
    });
  }
}
