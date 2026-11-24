/**
 * Right-Side Context-Sensitive Format & Style Inspector (XMind Format Panel parity).
 * - Map Tab: 8 Structures, 8 Curated Themes, Rainbow Palettes, Line Style, Custom Background, Auto-Numbering
 * - Topic Tab: Per-Branch Mixed Structure, Shape, Colors, Typography, Markers, Labels, Notes, Link, Image, To-Do, Task, Boundary/Summary/Callout, Copy/Paste/Reset Style
 */

import { store } from '../core/store.js';
import {
  BRANCH_PALETTES,
  LINE_STYLES,
  MARKER_GROUPS,
  QUICK_COLORS,
  STRUCTURES,
  THEMES,
  TOPIC_SHAPES
} from '../render/themes.js';
import { showToast } from './toast.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class InspectorPanel {
  constructor(el) {
    this.el = el;
  }

  render() {
    this.el.classList.toggle('collapsed', !store.inspectorOpen);
    if (!store.inspectorOpen) return;

    const sheet = store.getActiveSheet();
    const node = store.selectedNodeId ? store.findNode(store.selectedNodeId, sheet) : null;
    const rel = store.selectedRelId ? (sheet.relationships || []).find(r => r.id === store.selectedRelId) : null;
    const activeTab = (store.inspectorTab === 'topic' && (node || rel)) ? 'topic' : 'map';

    this.el.innerHTML = `
      <div class="insp-tabs">
        <button class="insp-tab ${activeTab === 'map' ? 'active' : ''}" data-itab="map">畫布樣式</button>
        <button class="insp-tab ${activeTab === 'topic' ? 'active' : ''}" data-itab="topic">${rel ? '關聯線' : '主題樣式'}</button>
      </div>
      <div class="insp-body">
        ${activeTab === 'map' ? this._renderMapTab(sheet) : (rel ? this._renderRelTab(rel) : this._renderTopicTab(node, sheet))}
      </div>
    `;

    this.el.querySelectorAll('[data-itab]').forEach(btn => {
      btn.onclick = () => store.setInspectorTab(btn.dataset.itab);
    });

    if (activeTab === 'map') this._bindMapEvents(sheet);
    else if (rel) this._bindRelEvents(rel);
    else if (node) this._bindTopicEvents(node, sheet);
  }

  _renderMapTab(sheet) {
    return `
      <div class="insp-section">
        <div class="insp-title">視覺結構 (Structure)</div>
        <div class="grid-2">
          ${STRUCTURES.map(st => `
            <button class="choice-card ${sheet.structure === st.id ? 'active' : ''}" data-struct="${st.id}">
              <span style="font-size:15px;">${st.icon}</span>
              <span>${st.name}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-title">精選風格主題 (Themes)</div>
        <div class="grid-2">
          ${Object.values(THEMES).map(t => `
            <button class="choice-card ${sheet.themeId === t.id ? 'active' : ''}" data-theme="${t.id}">
              <div class="theme-swatch" style="background:${t.canvasBg};">
                <span class="theme-swatch-dot" style="background:${t.root.fill};"></span>
                <span class="theme-swatch-dot" style="background:${t.branchColor};"></span>
                <span class="theme-swatch-dot" style="background:${t.main.border};"></span>
              </div>
              <span>${t.name}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-title">分支線條與彩虹配色</div>
        <div class="grid-2">
          ${LINE_STYLES.map(ls => `
            <button class="choice-card ${sheet.lineStyle === ls.id ? 'active' : ''}" data-lstyle="${ls.id}">${ls.name}</button>
          `).join('')}
        </div>
        <label class="toggle-row" style="margin-top:4px;">
          <span>彩虹分支 (Colored Branches)</span>
          <span class="switch">
            <input type="checkbox" id="map-rainbow" ${sheet.rainbowBranches !== false ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </span>
        </label>
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${BRANCH_PALETTES.map(p => `
            <div class="palette-row ${sheet.branchPaletteId === p.id ? 'active' : ''}" data-palette="${p.id}">
              <span style="font-size:11.5px;font-weight:500;">${p.name}</span>
              <div class="palette-dots">${p.colors.map(c => `<span style="background:${c};"></span>`).join('')}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-title">畫布進階設定</div>
        <label class="toggle-row">
          <span>階層自動編號 (1.1, 1.2)</span>
          <span class="switch">
            <input type="checkbox" id="map-numbering" ${sheet.autoNumbering ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </span>
        </label>
        <div class="field-row">
          <span class="field-label">自訂背景色</span>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="color" id="map-bg-color" value="${sheet.customBg || '#f8fafc'}" style="width:28px;height:24px;border:none;background:none;cursor:pointer;" />
            ${sheet.customBg ? `<button class="btn btn-sm" id="map-bg-reset">還原</button>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:4px;">
          <button class="btn btn-sm" id="map-expand-all" style="flex:1;">全部展開</button>
          <button class="btn btn-sm" id="map-collapse-all" style="flex:1;">全部摺疊</button>
        </div>
      </div>
    `;
  }

  _bindMapEvents(sheet) {
    this.el.querySelectorAll('[data-struct]').forEach(btn => {
      btn.onclick = () => store.updateSheet({ structure: btn.dataset.struct });
    });
    this.el.querySelectorAll('[data-theme]').forEach(btn => {
      btn.onclick = () => {
        const t = THEMES[btn.dataset.theme];
        store.updateSheet({ themeId: t.id, branchPaletteId: t.paletteId, customBg: '' });
      };
    });
    this.el.querySelectorAll('[data-lstyle]').forEach(btn => {
      btn.onclick = () => store.updateSheet({ lineStyle: btn.dataset.lstyle });
    });
    this.el.querySelectorAll('[data-palette]').forEach(row => {
      row.onclick = () => store.updateSheet({ branchPaletteId: row.dataset.palette, rainbowBranches: true });
    });
    this.el.querySelector('#map-rainbow').onchange = (e) => store.updateSheet({ rainbowBranches: e.target.checked });
    this.el.querySelector('#map-numbering').onchange = (e) => store.updateSheet({ autoNumbering: e.target.checked });
    this.el.querySelector('#map-bg-color').oninput = (e) => store.updateSheet({ customBg: e.target.value });
    this.el.querySelector('#map-bg-reset')?.addEventListener('click', () => store.updateSheet({ customBg: '' }));
    this.el.querySelector('#map-expand-all').onclick = () => store.setAllCollapsed(false);
    this.el.querySelector('#map-collapse-all').onclick = () => store.setAllCollapsed(true);
  }

  _renderRelTab(rel) {
    return `
      <div class="insp-section">
        <div class="insp-title">關聯線設定</div>
        <div class="field-label">關聯說明文字</div>
        <input id="rel-label-input" class="ui-input" value="${esc(rel.label || '')}" placeholder="輸入關聯描述..." />
        <div class="field-row" style="margin-top:6px;">
          <span class="field-label">線條顏色</span>
          <input type="color" id="rel-color-input" value="${rel.color || '#6366f1'}" />
        </div>
        <label class="toggle-row">
          <span>虛線樣式</span>
          <span class="switch">
            <input type="checkbox" id="rel-dashed-input" ${rel.dashed !== false ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </span>
        </label>
        <button class="btn btn-danger btn-sm" id="rel-delete-btn" style="margin-top:8px;">刪除這條關聯線</button>
      </div>
    `;
  }

  _bindRelEvents(rel) {
    this.el.querySelector('#rel-label-input').onchange = (e) => store.updateRelationship(rel.id, { label: e.target.value });
    this.el.querySelector('#rel-color-input').oninput = (e) => store.updateRelationship(rel.id, { color: e.target.value });
    this.el.querySelector('#rel-dashed-input').onchange = (e) => store.updateRelationship(rel.id, { dashed: e.target.checked });
    this.el.querySelector('#rel-delete-btn').onclick = () => store.deleteRelationship(rel.id);
  }

  _renderTopicTab(node, sheet) {
    if (!node) {
      return `<div style="padding:20px;text-align:center;color:var(--ui-text-muted);">請點選畫布上的任意主題以檢視或修改樣式與內容。</div>`;
    }
    const isRoot = node.id === sheet.root.id;
    const st = node.style || {};

    return `
      <div class="insp-section">
        <div class="insp-title">
          <span>主題內容</span>
          ${!isRoot ? `<button class="btn btn-sm" id="tp-new-sheet" style="padding:2px 7px;font-size:11px;">獨立成新畫布</button>` : ''}
        </div>
        <input id="tp-title" class="ui-input" value="${esc(node.title)}" />
        ${!isRoot ? `
          <div class="field-row">
            <span class="field-label">分支混排結構</span>
            <select id="tp-substruct" class="ui-select" style="width:140px;">
              <option value="">跟隨畫布預設</option>
              <option value="logic-right" ${node.structure === 'logic-right' ? 'selected' : ''}>邏輯圖 (右)</option>
              <option value="logic-left" ${node.structure === 'logic-left' ? 'selected' : ''}>邏輯圖 (左)</option>
              <option value="org-chart" ${node.structure === 'org-chart' ? 'selected' : ''}>組織架構圖</option>
              <option value="brace-map" ${node.structure === 'brace-map' ? 'selected' : ''}>括號圖</option>
            </select>
          </div>
        ` : ''}
      </div>

      <div class="insp-section">
        <div class="insp-title">
          <span>形狀與外觀</span>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-sm" id="tp-copy-style" style="padding:2px 6px;font-size:10.5px;">複製</button>
            <button class="btn btn-sm" id="tp-paste-style" style="padding:2px 6px;font-size:10.5px;" ${store.copiedStyle ? '' : 'disabled'}>貼上</button>
            <button class="btn btn-sm" id="tp-reset-style" style="padding:2px 6px;font-size:10.5px;">重設</button>
          </div>
        </div>
        <div class="grid-3">
          ${TOPIC_SHAPES.map(sh => `
            <button class="choice-card ${st.shape === sh.id ? 'active' : ''}" data-shape="${sh.id}">${sh.name}</button>
          `).join('')}
        </div>
        <div class="field-label">填滿背景色</div>
        <div class="color-swatches">
          ${QUICK_COLORS.map(c => `<button class="color-dot ${st.fill === c ? 'active' : ''}" data-fill="${c}" style="background:${c};"></button>`).join('')}
        </div>
        <div class="field-row" style="margin-top:4px;">
          <span class="field-label">文字色 / 字級</span>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="color" id="tp-text-color" value="${st.color || '#0f172a'}" style="width:26px;height:24px;border:none;background:none;cursor:pointer;" />
            <input type="number" id="tp-font-size" class="ui-input" min="11" max="32" value="${st.fontSize || 14}" style="width:60px;padding:3px 6px;" />
            <button class="btn btn-sm ${st.fontWeight === '700' ? 'btn-primary' : ''}" id="tp-bold">B</button>
            <button class="btn btn-sm ${st.fontStyle === 'italic' ? 'btn-primary' : ''}" id="tp-italic"><i>I</i></button>
          </div>
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-title">標記與圖示 (Markers)</div>
        ${MARKER_GROUPS.map(g => `
          <div class="marker-grid">
            ${g.items.map(m => `
              <button class="marker-chip ${(node.markers || []).includes(m.id) ? 'active' : ''}" data-marker="${m.id}" title="${m.title}">${m.label}</button>
            `).join('')}
          </div>
        `).join('')}
      </div>

      <div class="insp-section">
        <div class="insp-title">標籤 (Labels)</div>
        <div class="tag-list">
          ${(node.labels || []).map((l, idx) => `
            <span class="tag-pill">${esc(l)} <button data-rm-label="${idx}">×</button></span>
          `).join('')}
        </div>
        <div style="display:flex;gap:5px;">
          <input id="tp-label-input" class="ui-input" placeholder="輸入標籤按 Enter 新增..." />
          <button class="btn btn-sm" id="tp-label-add">新增</button>
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-title">筆記、超連結與圖片</div>
        <textarea id="tp-notes" class="ui-textarea" placeholder="輸入詳細筆記或參考摘要...">${esc(node.notes || '')}</textarea>
        <input id="tp-link" class="ui-input" placeholder="https:// 網頁連結..." value="${esc(node.link || '')}" />
        <div style="display:flex;gap:5px;align-items:center;">
          <input id="tp-image-url" class="ui-input" placeholder="圖片網址或右側上傳..." value="${esc(node.image?.startsWith('data:') ? '(已嵌入本機圖片)' : (node.image || ''))}" />
          <label class="btn btn-sm" style="white-space:nowrap;margin:0;cursor:pointer;">
            上傳
            <input type="file" id="tp-image-file" accept="image/*" class="hidden" />
          </label>
          ${node.image ? `<button class="btn btn-sm btn-danger" id="tp-image-clear">✕</button>` : ''}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-title">待辦與專案任務 (To-Do & Task)</div>
        <label class="toggle-row">
          <span>啟用待辦核取方塊 (To-Do)</span>
          <span class="switch">
            <input type="checkbox" id="tp-todo-toggle" ${node.todo ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </span>
        </label>
        <label class="toggle-row">
          <span>啟用甘特圖任務排程 (Task)</span>
          <span class="switch">
            <input type="checkbox" id="tp-task-toggle" ${node.task ? 'checked' : ''} />
            <span class="switch-slider"></span>
          </span>
        </label>
        ${node.task ? `
          <div class="grid-2">
            <div><span class="field-label">開始日</span><input type="date" id="tp-task-start" class="ui-input" value="${esc(node.task.start || '')}" /></div>
            <div><span class="field-label">結束日</span><input type="date" id="tp-task-end" class="ui-input" value="${esc(node.task.end || '')}" /></div>
          </div>
          <div class="grid-2">
            <div><span class="field-label">進度 (%)</span><input type="number" min="0" max="100" id="tp-task-prog" class="ui-input" value="${node.task.progress || 0}" /></div>
            <div><span class="field-label">負責人</span><input type="text" id="tp-task-assign" class="ui-input" value="${esc(node.task.assignee || '')}" /></div>
          </div>
        ` : ''}
      </div>

      ${(node.boundary || node.summary || node.callout) ? `
        <div class="insp-section">
          <div class="insp-title">結構標註文字</div>
          ${node.boundary ? `
            <div class="field-label">外框標題</div>
            <input id="tp-boundary-title" class="ui-input" value="${esc(node.boundary.title || '')}" />
          ` : ''}
          ${node.summary ? `
            <div class="field-label">概要標題</div>
            <input id="tp-summary-title" class="ui-input" value="${esc(node.summary.title || '')}" />
          ` : ''}
          ${node.callout ? `
            <div class="field-label">氣泡標註內容</div>
            <input id="tp-callout-text" class="ui-input" value="${esc(node.callout.text || '')}" />
          ` : ''}
        </div>
      ` : ''}
    `;
  }

  _bindTopicEvents(node) {
    const id = node.id;
    this.el.querySelector('#tp-title').onchange = (e) => {
      const val = e.target.value.trim() || '未命名主題';
      store.updateNode(id, { title: val });
    };
    this.el.querySelector('#tp-new-sheet')?.addEventListener('click', () => {
      store.createSheetFromTopic(id);
      showToast('已從該主題建立獨立新畫布', 'success');
    });
    this.el.querySelector('#tp-substruct')?.addEventListener('change', (e) => {
      store.updateNode(id, { structure: e.target.value || null });
    });

    // Style controls
    this.el.querySelectorAll('[data-shape]').forEach(btn => {
      btn.onclick = () => store.updateNodeStyle(id, { shape: btn.dataset.shape });
    });
    this.el.querySelectorAll('[data-fill]').forEach(btn => {
      btn.onclick = () => store.updateNodeStyle(id, { fill: btn.dataset.fill });
    });
    this.el.querySelector('#tp-text-color').oninput = (e) => store.updateNodeStyle(id, { color: e.target.value });
    this.el.querySelector('#tp-font-size').onchange = (e) => store.updateNodeStyle(id, { fontSize: Number(e.target.value) || 14 });
    this.el.querySelector('#tp-bold').onclick = () => {
      store.updateNodeStyle(id, { fontWeight: node.style?.fontWeight === '700' ? '500' : '700' });
    };
    this.el.querySelector('#tp-italic').onclick = () => {
      store.updateNodeStyle(id, { fontStyle: node.style?.fontStyle === 'italic' ? 'normal' : 'italic' });
    };
    this.el.querySelector('#tp-copy-style').onclick = () => {
      store.copiedStyle = { ...(node.style || {}) };
      showToast('已複製節點樣式');
      this.render();
    };
    this.el.querySelector('#tp-paste-style').onclick = () => {
      if (store.copiedStyle) store.updateNode(id, { style: { ...store.copiedStyle } });
    };
    this.el.querySelector('#tp-reset-style').onclick = () => store.updateNode(id, { style: {} });

    // Markers
    this.el.querySelectorAll('[data-marker]').forEach(btn => {
      btn.onclick = () => {
        const mId = btn.dataset.marker;
        const cur = new Set(node.markers || []);
        if (cur.has(mId)) cur.delete(mId);
        else cur.add(mId);
        store.updateNode(id, { markers: [...cur] });
      };
    });

    // Labels
    const addLabel = () => {
      const inp = this.el.querySelector('#tp-label-input');
      const val = inp.value.trim();
      if (!val) return;
      const next = [...new Set([...(node.labels || []), ...val.split(',').map(s => s.trim()).filter(Boolean)])];
      store.updateNode(id, { labels: next });
    };
    this.el.querySelector('#tp-label-add').onclick = addLabel;
    this.el.querySelector('#tp-label-input').onkeydown = (e) => { if (e.key === 'Enter') addLabel(); };
    this.el.querySelectorAll('[data-rm-label]').forEach(btn => {
      btn.onclick = () => {
        const next = (node.labels || []).filter((_, i) => i !== Number(btn.dataset.rmLabel));
        store.updateNode(id, { labels: next });
      };
    });

    // Notes, link, image
    this.el.querySelector('#tp-notes').onchange = (e) => store.updateNode(id, { notes: e.target.value });
    this.el.querySelector('#tp-link').onchange = (e) => store.updateNode(id, { link: e.target.value.trim() });
    this.el.querySelector('#tp-image-url').onchange = (e) => {
      const v = e.target.value.trim();
      if (v && v !== '(已嵌入本機圖片)') store.updateNode(id, { image: v });
    };
    this.el.querySelector('#tp-image-file').onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => store.updateNode(id, { image: String(reader.result) });
      reader.readAsDataURL(file);
    };
    this.el.querySelector('#tp-image-clear')?.addEventListener('click', () => store.updateNode(id, { image: '' }));

    // To-Do & Task
    this.el.querySelector('#tp-todo-toggle').onchange = (e) => {
      store.updateNode(id, { todo: e.target.checked ? { checked: false } : null });
    };
    this.el.querySelector('#tp-task-toggle').onchange = (e) => {
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
      store.updateNode(id, { task: e.target.checked ? { start: today, end, progress: 0, assignee: '', priority: '中' } : null });
    };
    this.el.querySelector('#tp-task-start')?.addEventListener('change', (e) => {
      store.updateNode(id, { task: { ...node.task, start: e.target.value } });
    });
    this.el.querySelector('#tp-task-end')?.addEventListener('change', (e) => {
      store.updateNode(id, { task: { ...node.task, end: e.target.value } });
    });
    this.el.querySelector('#tp-task-prog')?.addEventListener('change', (e) => {
      store.updateNode(id, { task: { ...node.task, progress: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } });
    });
    this.el.querySelector('#tp-task-assign')?.addEventListener('change', (e) => {
      store.updateNode(id, { task: { ...node.task, assignee: e.target.value } });
    });

    // Annotations text
    this.el.querySelector('#tp-boundary-title')?.addEventListener('change', (e) => {
      store.updateNode(id, { boundary: { ...node.boundary, title: e.target.value } });
    });
    this.el.querySelector('#tp-summary-title')?.addEventListener('change', (e) => {
      store.updateNode(id, { summary: { ...node.summary, title: e.target.value } });
    });
    this.el.querySelector('#tp-callout-text')?.addEventListener('change', (e) => {
      store.updateNode(id, { callout: { ...node.callout, text: e.target.value } });
    });
  }
}
