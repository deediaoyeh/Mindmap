/**
 * Google NotebookLM (Gemini Notebook) Import Bridge.
 * Supports:
 *  1. One-click Bookmarklet & DevTools Console extractor (reads D3 __data__ incl. collapsed _children,
 *     with live DOM bounding-box SVG fallback and Shadow DOM traversal)
 *  2. NotebookLM JSON / D3 hierarchy / Graph / Obsidian .canvas parser
 *  3. NotebookLM SVG geometry parser (reconstructs tree from <g> transforms, <text>, and <path>)
 *  4. Native NotebookLM PNG -> Editable MindMap via user-provided Gemini Vision API Key
 */

import { createNode } from '../core/schema.js';

/**
 * Recursively normalize any tree-like JSON (NotebookLM D3, XMind-like, MindFlow, generic)
 * into a clean MindFlow Node tree.
 */
export function normalizeTreeObject(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return createNode(obj);

  // Unwrap D3 hierarchy wrapper { data: { name }, children, _children }
  const data = (obj.data && typeof obj.data === 'object') ? obj.data : obj;
  const title =
    data.name ||
    data.title ||
    data.text ||
    data.label ||
    data.topic ||
    data.content ||
    obj.name ||
    obj.title ||
    '未命名節點';

  // Combine visible children and D3 collapsed _children
  const rawChildren = [];
  const candidates = [
    obj.children,
    obj._children,
    data.children,
    data._children,
    obj.subtopics,
    obj.items,
    obj.nodes
  ];
  const seen = new Set();
  for (const arr of candidates) {
    if (Array.isArray(arr)) {
      for (const child of arr) {
        if (child && !seen.has(child)) {
          seen.add(child);
          rawChildren.push(child);
        }
      }
    }
  }

  return createNode(String(title).trim() || '未命名節點', {
    notes: data.notes || data.description || data.summary || '',
    link: data.link || data.url || '',
    labels: Array.isArray(data.labels) ? data.labels : [],
    markers: Array.isArray(data.markers) ? data.markers : [],
    todo: data.todo || null,
    task: data.task || null,
    children: rawChildren.map(normalizeTreeObject).filter(Boolean)
  });
}

/**
 * Parse NotebookLM JSON, MindFlow JSON, or Graph JSON ({ nodes, edges } / Obsidian .canvas).
 */
export function parseNotebookLMJson(textOrObj) {
  const raw = typeof textOrObj === 'string' ? JSON.parse(textOrObj) : textOrObj;

  // MindFlow full document export
  if (raw && Array.isArray(raw.sheets) && raw.sheets[0]?.root) {
    return {
      title: raw.title || raw.sheets[0].title || '匯入的文件',
      sheets: raw.sheets,
      root: raw.sheets[0].root
    };
  }

  // MindFlow single sheet export
  if (raw && raw.root && raw.structure) {
    return {
      title: raw.title || raw.root.title || '匯入的畫布',
      sheets: [raw],
      root: raw.root
    };
  }

  // Graph format: { nodes: [...], edges: [...] } (including Obsidian .canvas)
  if (raw && Array.isArray(raw.nodes) && Array.isArray(raw.edges)) {
    const map = new Map();
    const hasParent = new Set();
    for (const n of raw.nodes) {
      const id = String(n.id);
      const label = n.text || n.title || n.name || n.label || n.file || id;
      map.set(id, createNode(String(label).replace(/^#+\s*/, '').trim() || '節點'));
    }
    for (const e of raw.edges) {
      const from = String(e.fromNode || e.source || e.from);
      const to = String(e.toNode || e.target || e.to);
      if (map.has(from) && map.has(to) && from !== to) {
        map.get(from).children.push(map.get(to));
        hasParent.add(to);
      }
    }
    const roots = [];
    for (const [id, node] of map.entries()) {
      if (!hasParent.has(id)) roots.push(node);
    }
    const root = roots.length === 1
      ? roots[0]
      : createNode('NotebookLM 心智圖', { children: roots });
    return { title: root.title, root };
  }

  // Array of top-level nodes
  if (Array.isArray(raw)) {
    if (raw.length === 1) {
      const root = normalizeTreeObject(raw[0]);
      return { title: root.title, root };
    }
    const root = createNode('NotebookLM 心智圖', {
      children: raw.map(normalizeTreeObject).filter(Boolean)
    });
    return { title: root.title, root };
  }

  // Standard hierarchical tree JSON ({ name, children })
  const root = normalizeTreeObject(raw);
  if (!root) throw new Error('無法辨識 JSON 心智圖結構');
  return { title: root.title, root };
}

/**
 * Parse SVG transform attribute into cumulative (tx, ty) translation.
 */
function parseTransform(attr) {
  let tx = 0;
  let ty = 0;
  if (!attr) return { tx, ty };
  const trMatches = attr.matchAll(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/g);
  for (const m of trMatches) {
    tx += parseFloat(m[1]) || 0;
    ty += parseFloat(m[2]) || 0;
  }
  const matMatches = attr.matchAll(/matrix\(([^)]+)\)/g);
  for (const m of matMatches) {
    const nums = m[1].split(/[\s,]+/).map(Number);
    if (nums.length === 6 && !nums.some(isNaN)) {
      tx += nums[4];
      ty += nums[5];
    }
  }
  return { tx, ty };
}

/**
 * Parse NotebookLM exported or copied <svg>...</svg> back into a hierarchical mind map!
 */
export function parseNotebookLMSvg(svgText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('找不到有效的 <svg> 元素');

  const extractedNodes = [];
  const extractedPaths = [];

  function walk(node, accX, accY) {
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    const { tx, ty } = parseTransform(node.getAttribute('transform'));
    const curX = accX + tx;
    const curY = accY + ty;

    if (tag === 'g') {
      // Check if this <g> directly owns a <text> label (typical D3 node group)
      const directTexts = Array.from(node.children).filter(c => c.tagName.toLowerCase() === 'text');
      if (directTexts.length > 0) {
        const label = directTexts
          .map(t => t.textContent.trim())
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Filter out expand/collapse buttons like ">", "<", "+", "-", "3"
        if (label && !/^[><+\-−•▸▾◀▶\d]{1,3}$/.test(label)) {
          const rect = Array.from(node.children).find(c => c.tagName.toLowerCase() === 'rect');
          const rx = rect ? (parseFloat(rect.getAttribute('x')) || 0) : 0;
          const ry = rect ? (parseFloat(rect.getAttribute('y')) || 0) : 0;
          const rw = rect ? (parseFloat(rect.getAttribute('width')) || Math.max(80, label.length * 10)) : Math.max(80, label.length * 10);
          const rh = rect ? (parseFloat(rect.getAttribute('height')) || 32) : 32;
          extractedNodes.push({
            id: `svg_${extractedNodes.length}`,
            title: label,
            x: curX + rx,
            y: curY + ry,
            w: rw,
            h: rh,
            cx: curX + rx + rw / 2,
            cy: curY + ry + rh / 2
          });
        }
      }
    } else if (tag === 'path') {
      const d = node.getAttribute('d') || '';
      const nums = d.match(/-?\d*\.?\d+/g)?.map(Number);
      if (nums && nums.length >= 4) {
        const x1 = curX + nums[0];
        const y1 = curY + nums[1];
        const x2 = curX + nums[nums.length - 2];
        const y2 = curY + nums[nums.length - 1];
        if (Math.hypot(x2 - x1, y2 - y1) > 12) {
          extractedPaths.push({ x1, y1, x2, y2 });
        }
      }
    }

    for (const child of node.children) {
      walk(child, curX, curY);
    }
  }

  walk(svg, 0, 0);

  // Fallback: collect standalone <text> elements if no <g>-wrapped nodes found
  if (extractedNodes.length === 0) {
    svg.querySelectorAll('text').forEach((t, idx) => {
      const label = t.textContent.trim();
      if (!label || /^[><+\-−\d]{1,2}$/.test(label)) return;
      const x = parseFloat(t.getAttribute('x')) || 0;
      const y = parseFloat(t.getAttribute('y')) || idx * 36;
      extractedNodes.push({ id: `t_${idx}`, title: label, x, y, w: 100, h: 28, cx: x + 50, cy: y });
    });
  }

  if (extractedNodes.length === 0) {
    throw new Error('SVG 中未偵測到可解析的心智圖文字節點');
  }

  // Deduplicate overlapping nodes with identical text
  const uniqueNodes = [];
  for (const n of extractedNodes) {
    if (!uniqueNodes.some(u => u.title === n.title && Math.hypot(u.cx - n.cx, u.cy - n.cy) < 12)) {
      uniqueNodes.push(n);
    }
  }

  const mindNodes = new Map(uniqueNodes.map(n => [n.id, createNode(n.title)]));
  const parentOf = new Map();

  // Helper: distance from point to node box edges
  function distToNode(px, py, n) {
    const dx = Math.max(n.x - px, 0, px - (n.x + n.w));
    const dy = Math.max(n.y - py, 0, py - (n.y + n.h));
    return Math.hypot(dx, dy);
  }

  // Match paths to parent -> child pairs (leftmost endpoint = parent in NotebookLM LTR trees)
  for (const p of extractedPaths) {
    let bestA = null, minA = 90;
    let bestB = null, minB = 90;
    for (const n of uniqueNodes) {
      const dA = distToNode(p.x1, p.y1, n);
      if (dA < minA) { minA = dA; bestA = n; }
      const dB = distToNode(p.x2, p.y2, n);
      if (dB < minB) { minB = dB; bestB = n; }
    }
    if (bestA && bestB && bestA.id !== bestB.id) {
      const [parent, child] = bestA.x <= bestB.x ? [bestA, bestB] : [bestB, bestA];
      if (!parentOf.has(child.id)) {
        parentOf.set(child.id, parent.id);
      }
    }
  }

  // Fallback geometric X-column inference for orphan nodes
  const sortedByX = [...uniqueNodes].sort((a, b) => a.x - b.x || a.y - b.y);
  const rootGeo = sortedByX[0];

  for (const n of sortedByX.slice(1)) {
    if (!parentOf.has(n.id)) {
      // Find closest node strictly to the left
      let bestP = rootGeo;
      let bestScore = Infinity;
      for (const cand of sortedByX) {
        if (cand.id === n.id || cand.x >= n.x - 24) continue;
        const score = Math.abs(n.y - cand.cy) + Math.abs(n.x - (cand.x + cand.w)) * 0.5;
        if (score < bestScore) {
          bestScore = score;
          bestP = cand;
        }
      }
      parentOf.set(n.id, bestP.id);
    }
  }

  // Assemble tree ordered by Y coordinate
  const childrenByParent = new Map();
  for (const n of uniqueNodes) {
    const pid = parentOf.get(n.id);
    if (pid) {
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(n);
    }
  }

  const visited = new Set();
  function attach(id) {
    visited.add(id);
    const cur = mindNodes.get(id);
    const kids = (childrenByParent.get(id) || []).sort((a, b) => a.y - b.y);
    for (const k of kids) {
      if (!visited.has(k.id)) {
        cur.children.push(attach(k.id));
      }
    }
    return cur;
  }

  const root = attach(rootGeo.id);
  return { title: root.title, root };
}

/**
 * Core extraction payload that runs inside notebooklm.google.com (used by both Bookmarklet & Console script).
 */
export function buildNotebookLMExtractorSource(targetAppUrl) {
  const cleanTarget = targetAppUrl.split('#')[0].split('?')[0];
  return `(function(){
  const TARGET = ${JSON.stringify(cleanTarget)};

  function collectAllElements(root, selector) {
    const res = [];
    function walk(r) {
      if (!r || !r.querySelectorAll) return;
      res.push(...r.querySelectorAll(selector));
      r.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    }
    walk(root);
    return res;
  }

  // Strategy 1: Read native D3 hierarchy bound on __data__ (captures BOTH expanded and collapsed _children!)
  function extractFromD3() {
    const gs = collectAllElements(document, 'svg g');
    let rootDatum = null;
    for (const g of gs) {
      const d = g.__data__;
      if (d && typeof d === 'object' && (d.data || d.children || d._children || d.name)) {
        let cur = d;
        let guard = 0;
        while (cur.parent && guard++ < 50) cur = cur.parent;
        if (cur && ((cur.children && cur.children.length) || (cur._children && cur._children.length) || (cur.data && cur.data.name))) {
          rootDatum = cur;
          break;
        }
      }
    }
    if (!rootDatum) return null;

    function convert(d) {
      const raw = d.data && typeof d.data === 'object' ? d.data : d;
      const name = String(raw.name || raw.title || raw.text || raw.label || '節點').trim();
      const rawKids = [];
      if (Array.isArray(d.children)) rawKids.push(...d.children);
      if (Array.isArray(d._children)) rawKids.push(...d._children);
      if (!rawKids.length && Array.isArray(raw.children)) rawKids.push(...raw.children);
      const seen = new Set();
      const children = [];
      for (const k of rawKids) {
        if (k && !seen.has(k)) {
          seen.add(k);
          children.push(convert(k));
        }
      }
      return { name, children };
    }
    return convert(rootDatum);
  }

  // Strategy 2: Live DOM BoundingBox SVG fallback (works even if D3 __data__ is obfuscated)
  function extractFromRenderedSvg() {
    const svgs = collectAllElements(document, 'svg');
    let bestSvg = null, bestCount = 0;
    for (const s of svgs) {
      const cnt = s.querySelectorAll('text').length;
      if (cnt > bestCount) { bestCount = cnt; bestSvg = s; }
    }
    if (!bestSvg || bestCount < 2) return null;

    const nodes = [];
    bestSvg.querySelectorAll('g').forEach((g, idx) => {
      const texts = Array.from(g.children).filter(c => c.tagName.toLowerCase() === 'text');
      if (!texts.length) return;
      const name = texts.map(t => t.textContent.trim()).filter(Boolean).join(' ').trim();
      if (!name || /^[><+\\-−•▸▾◀▶\\d]{1,3}$/.test(name)) return;
      const r = g.getBoundingClientRect();
      if (!r.width && !r.height) return;
      nodes.push({ id: idx, name, x: r.left, y: r.top, w: r.width, h: r.height, cy: r.top + r.height / 2 });
    });
    if (!nodes.length) return null;

    const unique = [];
    nodes.forEach(n => {
      if (!unique.some(u => u.name === n.name && Math.hypot(u.x - n.x, u.cy - n.cy) < 10)) unique.push(n);
    });
    unique.sort((a, b) => a.x - b.x || a.y - b.y);
    const map = new Map(unique.map(n => [n.id, { name: n.name, children: [] }]));
    const root = unique[0];
    for (let i = 1; i < unique.length; i++) {
      const n = unique[i];
      let bestP = root, bestScore = Infinity;
      for (const c of unique) {
        if (c.id === n.id || c.x >= n.x - 20) continue;
        const sc = Math.abs(n.cy - c.cy) + Math.abs(n.x - (c.x + c.w)) * 0.6;
        if (sc < bestScore) { bestScore = sc; bestP = c; }
      }
      map.get(bestP.id).children.push(map.get(n.id));
    }
    return map.get(root.id);
  }

  const tree = extractFromD3() || extractFromRenderedSvg();
  if (!tree) {
    alert('未偵測到 NotebookLM 心智圖！請先在 NotebookLM 開啟心智圖檢視畫面後再點擊一次。');
    return;
  }

  const json = JSON.stringify(tree);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).catch(() => {});
  }

  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');

  if (b64.length < 28000) {
    window.open(TARGET + '#notebooklm=u.' + b64, '_blank');
  } else {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (tree.name || 'notebooklm-mindmap') + '.json';
    a.click();
    alert('心智圖節點較多，已自動下載 JSON 檔案並複製到剪貼簿！請至 MindFlow 貼上或拖曳該檔案匯入。');
  }
})();`;
}

export function generateBookmarkletHref(targetAppUrl) {
  const src = buildNotebookLMExtractorSource(targetAppUrl)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return 'javascript:' + encodeURIComponent(src);
}

/**
 * Gemini Vision API: Convert NotebookLM's native downloaded PNG directly into an editable mind map!
 * Runs 100% client-side using the user's own Gemini API key.
 */
export async function extractMindMapFromPngWithGemini(file, apiKey, model = 'gemini-2.5-flash') {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('請輸入您的 Gemini API Key');
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      resolve(res.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.readAsDataURL(file);
  });

  const prompt = `You are a precision Mind Map OCR & Structure extractor.
Analyze this mind map image (likely exported from Google NotebookLM) and reconstruct the ENTIRE visible hierarchy faithfully in the exact original language of the image.
Return ONLY valid JSON matching this schema:
{
  "name": "Root topic title",
  "children": [
    {
      "name": "Main branch 1",
      "children": [
        { "name": "Subtopic 1.1", "children": [] }
      ]
    }
  ]
}
Preserve all text accurately, keep hierarchy exact, do not omit any visible leaf nodes.`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: file.type || 'image/png', data: base64 } }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API 呼叫失敗 (${resp.status})：${errText.slice(0, 160)}`);
  }

  const data = await resp.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!rawText) throw new Error('Gemini API 未回傳內容');

  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  return parseNotebookLMJson(cleaned);
}
