/**
 * Exporters & Sharing Engine:
 *  - High-resolution PNG (1x / 2x / 3x, transparent or themed bg, optional 3D Map Shot frame)
 *  - Lossless standalone SVG
 *  - Authentic .xmind ZIP archive (compatible with XMind Desktop & Web!)
 *  - Markdown (.md), OPML (.opml), FreeMind (.mm), JSON (.json)
 *  - Project Tasks CSV (.csv) & Calendar (.ics)
 *  - Zero-backend compressed shareable URL (#map=...) & Embed iframe snippet
 */

import { store } from '../core/store.js';
import { compressStringToUrl, createZip } from '../core/zip.js';

function triggerDownload(blobOrText, filename, mime = 'text/plain;charset=utf-8') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeFileName(name, ext) {
  const clean = String(name || 'mindflow').replace(/[\\/:*?"<>|]/g, '_').trim() || 'mindflow';
  return `${clean}.${ext}`;
}

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a clean standalone SVG string cropped tightly to the active map bounds.
 */
export function buildStandaloneSvgString(canvas, { transparent = false, padding = 48 } = {}) {
  if (!canvas.layout) throw new Error('畫布尚未初始化');
  const sheet = store.getActiveSheet();
  const { bounds, theme } = canvas.layout;
  const x = Math.floor(bounds.minX - padding);
  const y = Math.floor(bounds.minY - padding);
  const w = Math.ceil((bounds.maxX - bounds.minX) + padding * 2);
  const h = Math.ceil((bounds.maxY - bounds.minY) + padding * 2);
  const bg = sheet.customBg || theme.canvasBg;

  const clone = canvas.svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  clone.removeAttribute('style');

  // Remove interactive quick-add buttons & overlay from export
  clone.querySelectorAll('.node-quick-add, #layer-overlay').forEach(el => el.remove());

  const vp = clone.querySelector('#viewport-group');
  if (vp) vp.removeAttribute('transform');

  // Embed font style
  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = `text { font-family: Inter, "Noto Sans TC", -apple-system, BlinkMacSystemFont, sans-serif; }`;
  clone.insertBefore(styleEl, clone.firstChild);

  if (!transparent) {
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', String(x));
    bgRect.setAttribute('y', String(y));
    bgRect.setAttribute('width', String(w));
    bgRect.setAttribute('height', String(h));
    bgRect.setAttribute('fill', bg);
    clone.insertBefore(bgRect, vp);
  }

  return {
    svgString: new XMLSerializer().serializeToString(clone),
    width: w,
    height: h,
    bg
  };
}

export function exportSVG(canvas, opts = {}) {
  const sheet = store.getActiveSheet();
  const { svgString } = buildStandaloneSvgString(canvas, opts);
  triggerDownload(svgString, safeFileName(sheet.title, 'svg'), 'image/svg+xml;charset=utf-8');
}

export async function exportPNG(canvas, { scale = 2, transparent = false, framed = false } = {}) {
  const sheet = store.getActiveSheet();
  const { svgString, width, height, bg } = buildStandaloneSvgString(canvas, { transparent });
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('SVG 轉繪 PNG 失敗'));
      i.src = url;
    });

    const framePad = framed ? 64 : 0;
    const outW = (width + framePad * 2) * scale;
    const outH = (height + framePad * 2) * scale;

    const c = document.createElement('canvas');
    c.width = outW;
    c.height = outH;
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);

    if (framed) {
      // Aesthetic Map Shot gradient frame
      const grad = ctx.createLinearGradient(0, 0, width + framePad * 2, height + framePad * 2);
      grad.addColorStop(0, '#6366f1');
      grad.addColorStop(0.5, '#8b5cf6');
      grad.addColorStop(1, '#ec4899');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width + framePad * 2, height + framePad * 2);

      // Soft elevated card shadow
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.34)';
      ctx.shadowBlur = 34;
      ctx.shadowOffsetY = 14;
      ctx.fillStyle = bg;
      const r = 18;
      ctx.beginPath();
      ctx.roundRect(framePad, framePad, width, height, r);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(framePad, framePad, width, height, r);
      ctx.clip();
      ctx.drawImage(img, framePad, framePad, width, height);
      ctx.restore();
    } else {
      ctx.drawImage(img, 0, 0, width, height);
    }

    const pngBlob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    triggerDownload(pngBlob, safeFileName(sheet.title, 'png'), 'image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportMarkdown() {
  const sheet = store.getActiveSheet();
  const lines = [];
  function walk(node, depth) {
    const todoPrefix = node.todo ? (node.todo.checked ? '[x] ' : '[ ] ') : '';
    if (depth === 0) {
      lines.push(`# ${node.title}`);
    } else if (depth === 1) {
      lines.push(`\n## ${todoPrefix}${node.title}`);
    } else {
      const indent = '  '.repeat(depth - 2);
      lines.push(`${indent}- ${todoPrefix}${node.title}`);
    }
    if (node.notes) {
      const nIndent = depth <= 1 ? '' : '  '.repeat(depth - 1);
      lines.push(`${nIndent}> ${node.notes.replace(/\n/g, `\n${nIndent}> `)}`);
    }
    for (const c of (node.children || [])) walk(c, depth + 1);
  }
  walk(sheet.root, 0);
  triggerDownload(lines.join('\n') + '\n', safeFileName(sheet.title, 'md'), 'text/markdown;charset=utf-8');
}

export function exportOPML() {
  const sheet = store.getActiveSheet();
  function walk(node, indent) {
    const attrs = [`text="${xmlEscape(node.title)}"`];
    if (node.notes) attrs.push(`_note="${xmlEscape(node.notes)}"`);
    if (node.link) attrs.push(`url="${xmlEscape(node.link)}"`);
    if (!node.children || !node.children.length) {
      return `${indent}<outline ${attrs.join(' ')} />`;
    }
    const inner = node.children.map(c => walk(c, indent + '  ')).join('\n');
    return `${indent}<outline ${attrs.join(' ')}>\n${inner}\n${indent}</outline>`;
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${xmlEscape(sheet.title)}</title>\n  </head>\n  <body>\n${walk(sheet.root, '    ')}\n  </body>\n</opml>\n`;
  triggerDownload(xml, safeFileName(sheet.title, 'opml'), 'text/xml;charset=utf-8');
}

export function exportFreeMind() {
  const sheet = store.getActiveSheet();
  function walk(node, indent, depth) {
    const attrs = [`TEXT="${xmlEscape(node.title)}"`];
    if (depth === 1 && node.side) attrs.push(`POSITION="${node.side}"`);
    if (node.link) attrs.push(`LINK="${xmlEscape(node.link)}"`);
    if (!node.children || !node.children.length) {
      return `${indent}<node ${attrs.join(' ')} />`;
    }
    const inner = node.children.map(c => walk(c, indent + '  ', depth + 1)).join('\n');
    return `${indent}<node ${attrs.join(' ')}>\n${inner}\n${indent}</node>`;
  }
  const xml = `<map version="1.0.1">\n${walk(sheet.root, '  ', 0)}\n</map>\n`;
  triggerDownload(xml, safeFileName(sheet.title, 'mm'), 'application/xml;charset=utf-8');
}

export function exportJSON() {
  const doc = store.getActiveDoc();
  triggerDownload(JSON.stringify(doc, null, 2), safeFileName(doc.title, 'json'), 'application/json;charset=utf-8');
}

/**
 * Export an authentic XMind Zen (.xmind) ZIP package containing content.json, metadata.json, manifest.json.
 */
export async function exportXMind() {
  const doc = store.getActiveDoc();

  function mapStructureClass(struct) {
    const table = {
      'mindmap': 'org.xmind.ui.map.unbalanced',
      'logic-right': 'org.xmind.ui.logic.right',
      'logic-left': 'org.xmind.ui.logic.left',
      'org-chart': 'org.xmind.ui.org-chart.down',
      'tree-chart': 'org.xmind.ui.tree.right',
      'timeline': 'org.xmind.ui.timeline.horizontal',
      'fishbone': 'org.xmind.ui.fishbone.leftHeaded',
      'brace-map': 'org.xmind.ui.brace.right'
    };
    return table[struct] || 'org.xmind.ui.map.unbalanced';
  }

  function convertNode(node, isRoot, struct) {
    const out = {
      id: node.id,
      class: 'topic',
      title: node.title
    };
    if (isRoot) out.structureClass = mapStructureClass(struct);
    if (node.notes) out.notes = { plain: { content: node.notes } };
    if (node.labels?.length) out.labels = node.labels;
    if (node.link) out.href = node.link;
    if (node.children?.length) {
      out.children = {
        attached: node.children.map(c => convertNode(c, false, struct))
      };
    }
    return out;
  }

  const contentJson = doc.sheets.map(s => ({
    id: s.id,
    class: 'sheet',
    title: s.title,
    rootTopic: convertNode(s.root, true, s.structure),
    relationships: (s.relationships || []).map(r => ({
      id: r.id,
      end1Id: r.fromId,
      end2Id: r.toId,
      title: r.label || ''
    }))
  }));

  const metadataJson = {
    creator: { name: 'MindFlow', version: '1.0.0' },
    activeSheetId: doc.activeSheetId
  };

  const manifestJson = {
    'file-entries': {
      'content.json': {},
      'metadata.json': {}
    }
  };

  const zipBlob = await createZip({
    'content.json': JSON.stringify(contentJson, null, 2),
    'metadata.json': JSON.stringify(metadataJson, null, 2),
    'manifest.json': JSON.stringify(manifestJson, null, 2)
  });

  triggerDownload(zipBlob, safeFileName(doc.title, 'xmind'), 'application/octet-stream');
}

export function exportTasksCSV() {
  const sheet = store.getActiveSheet();
  const rows = [['主題', '開始日期', '結束日期', '進度(%)', '負責人', '優先級', '待辦完成']];
  for (const { node } of store.getAllNodes(sheet)) {
    if (node.task || node.todo) {
      rows.push([
        node.title,
        node.task?.start || '',
        node.task?.end || '',
        node.task ? String(node.task.progress || 0) : (node.todo?.checked ? '100' : '0'),
        node.task?.assignee || '',
        node.task?.priority || '',
        node.todo ? (node.todo.checked ? '是' : '否') : ''
      ]);
    }
  }
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  triggerDownload(csv, safeFileName(`${sheet.title}_tasks`, 'csv'), 'text/csv;charset=utf-8');
}

export function exportTasksICS() {
  const sheet = store.getActiveSheet();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MindFlow//MindMap Tasks//ZH'
  ];
  for (const { node } of store.getAllNodes(sheet)) {
    if (!node.task?.start) continue;
    const start = node.task.start.replace(/-/g, '');
    const end = (node.task.end || node.task.start).replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${node.id}@mindflow`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(`SUMMARY:${node.title.replace(/\n/g, ' ')}`);
    if (node.notes) lines.push(`DESCRIPTION:${node.notes.replace(/\n/g, '\\n')}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  triggerDownload(lines.join('\r\n'), safeFileName(`${sheet.title}_schedule`, 'ics'), 'text/calendar;charset=utf-8');
}

export async function generateShareUrl() {
  const sheet = store.getActiveSheet();
  const payload = JSON.stringify({
    title: store.getActiveDoc().title,
    sheet
  });
  const token = await compressStringToUrl(payload);
  const base = window.location.origin + window.location.pathname;
  return `${base}#map=${token}`;
}
