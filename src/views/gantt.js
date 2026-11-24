/**
 * Project Management Gantt Chart View (XMind Gantt Chart parity).
 * Displays all task-scheduled topics on a date timeline with inline editing and CSV/ICS export.
 */

import { store } from '../core/store.js';
import { exportTasksCSV, exportTasksICS } from '../exporters/index.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function diffDays(a, b) {
  return Math.round((b - a) / 86400000);
}

export class GanttView {
  constructor(container) {
    this.container = container;
  }

  render() {
    if (store.viewMode !== 'gantt') return;
    const sheet = store.getActiveSheet();
    if (!sheet) return;

    const allNodes = store.getAllNodes(sheet);
    const taskNodes = allNodes.filter(x => x.node.task);

    // Determine timeline range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let minDate = new Date(today);
    minDate.setDate(minDate.getDate() - 3);
    let maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 21);

    for (const { node } of taskNodes) {
      const s = parseDate(node.task.start);
      const e = parseDate(node.task.end);
      if (s && s < minDate) minDate = new Date(s);
      if (e && e > maxDate) maxDate = new Date(e);
    }
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 3);
    const totalDays = Math.max(14, diffDays(minDate, maxDate));
    const dayW = 36;
    const timelineW = totalDays * dayW;

    const dateHeaders = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(minDate);
      d.setDate(d.getDate() + i);
      const isToday = d.getTime() === today.getTime();
      dateHeaders.push(`
        <div style="width:${dayW}px;text-align:center;font-size:11px;flex-shrink:0;padding:4px 0;${isToday ? 'background:var(--accent-soft);color:var(--accent);font-weight:700;border-radius:4px;' : ''}">
          ${d.getMonth() + 1}/${d.getDate()}
        </div>
      `);
    }

    const rowsHtml = taskNodes.length ? taskNodes.map(({ node }) => {
      const t = node.task;
      const s = parseDate(t.start) || today;
      const e = parseDate(t.end) || s;
      const startOff = Math.max(0, diffDays(minDate, s));
      const span = Math.max(1, diffDays(s, e) + 1);
      const leftPx = startOff * dayW + 2;
      const widthPx = Math.max(28, span * dayW - 4);
      const pct = Math.min(100, Math.max(0, Number(t.progress) || 0));

      return `
        <tr>
          <td style="font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            <a href="#" data-gselect="${node.id}" style="color:var(--ui-text);text-decoration:none;">${esc(node.title)}</a>
          </td>
          <td><input type="date" class="ui-input" data-gstart="${node.id}" value="${esc(t.start || '')}" style="padding:3px 4px;width:110px;font-size:11.5px;" /></td>
          <td><input type="date" class="ui-input" data-gend="${node.id}" value="${esc(t.end || '')}" style="padding:3px 4px;width:110px;font-size:11.5px;" /></td>
          <td><input type="number" min="0" max="100" class="ui-input" data-gprog="${node.id}" value="${pct}" style="padding:3px 4px;width:52px;font-size:11.5px;" /></td>
          <td><input type="text" class="ui-input" data-gassign="${node.id}" value="${esc(t.assignee || '')}" placeholder="負責人" style="padding:3px 4px;width:68px;font-size:11.5px;" /></td>
          <td class="gantt-bar-cell" style="width:${timelineW}px;min-width:${timelineW}px;">
            <div class="gantt-bar" data-gselect="${node.id}" style="left:${leftPx}px;width:${widthPx}px;" title="${esc(node.title)} (${pct}%)">
              <div class="gantt-bar-progress" style="width:${pct}%;"></div>
              <span style="position:relative;z-index:1;">${esc(node.title)} · ${pct}%</span>
            </div>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="6" style="text-align:center;padding:48px 20px;color:var(--ui-text-muted);">
          目前畫布尚無排程任務。請點擊右上方「將選取主題轉為任務」或在右側格式面板啟用任務排程！
        </td>
      </tr>
    `;

    this.container.innerHTML = `
      <div class="gantt-container">
        <div class="gantt-toolbar">
          <div>
            <strong style="font-size:14.5px;">📅 專案甘特圖 · ${esc(sheet.title)}</strong>
            <span style="margin-left:10px;font-size:12px;color:var(--ui-text-muted);">共 ${taskNodes.length} 項排程任務</span>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm btn-primary" id="gantt-add-task-btn">＋ 將目前選取主題加入任務</button>
            <button class="btn btn-sm" id="gantt-export-csv">匯出 CSV</button>
            <button class="btn btn-sm" id="gantt-export-ics">匯出行事曆 (.ics)</button>
          </div>
        </div>
        <div class="gantt-scroll">
          <table class="gantt-table">
            <thead>
              <tr>
                <th style="min-width:170px;">任務主題</th>
                <th>開始日</th>
                <th>結束日</th>
                <th>進度%</th>
                <th>負責人</th>
                <th style="padding:4px 0;"><div style="display:flex;">${dateHeaders.join('')}</div></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    this.container.querySelector('#gantt-add-task-btn')?.addEventListener('click', () => {
      const targetId = store.selectedNodeId || store.getActiveSheet().root.id;
      const node = store.findNode(targetId);
      if (!node) return;
      const today = new Date().toISOString().slice(0, 10);
      const end = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
      store.updateNode(targetId, {
        task: node.task || { start: today, end, progress: 20, assignee: '', priority: '中' }
      });
    });

    this.container.querySelector('#gantt-export-csv')?.addEventListener('click', () => exportTasksCSV());
    this.container.querySelector('#gantt-export-ics')?.addEventListener('click', () => exportTasksICS());

    this.container.querySelectorAll('[data-gselect]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        store.selectNode(el.dataset.gselect);
      });
    });

    const bindField = (attr, key, transform = v => v) => {
      this.container.querySelectorAll(`[${attr}]`).forEach(input => {
        input.addEventListener('change', () => {
          const id = input.getAttribute(attr);
          const node = store.findNode(id);
          if (!node?.task) return;
          store.updateNode(id, { task: { ...node.task, [key]: transform(input.value) } });
        });
      });
    };

    bindField('data-gstart', 'start');
    bindField('data-gend', 'end');
    bindField('data-gprog', 'progress', v => Math.min(100, Math.max(0, Number(v) || 0)));
    bindField('data-gassign', 'assignee');
  }
}
