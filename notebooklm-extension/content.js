/**
 * Content Script injected on https://notebooklm.google.com/*
 * Automatically detects rendered NotebookLM mind maps, reads D3 __data__ (including collapsed _children)
 * or falls back to SVG bounding-box extraction, and opens MindFlow in one click.
 */

(function () {
  const DEFAULT_APP_URL = 'https://deediaoyeh.github.io/Mindmap/';

  function collectAllElements(root, selector) {
    const res = [];
    function walk(r) {
      if (!r || !r.querySelectorAll) return;
      res.push(...r.querySelectorAll(selector));
      r.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    }
    walk(root);
    return res;
  }

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

  function extractFromRenderedSvg() {
    const svgs = collectAllElements(document, 'svg');
    let bestSvg = null;
    let bestCount = 0;
    for (const s of svgs) {
      const cnt = s.querySelectorAll('text').length;
      if (cnt > bestCount) {
        bestCount = cnt;
        bestSvg = s;
      }
    }
    if (!bestSvg || bestCount < 2) return null;

    const nodes = [];
    bestSvg.querySelectorAll('g').forEach((g, idx) => {
      const texts = Array.from(g.children).filter((c) => c.tagName.toLowerCase() === 'text');
      if (!texts.length) return;
      const name = texts.map((t) => t.textContent.trim()).filter(Boolean).join(' ').trim();
      if (!name || /^[><+\-−•▸▾◀▶\d]{1,3}$/.test(name)) return;
      const r = g.getBoundingClientRect();
      if (!r.width && !r.height) return;
      nodes.push({ id: idx, name, x: r.left, y: r.top, w: r.width, h: r.height, cy: r.top + r.height / 2 });
    });
    if (!nodes.length) return null;

    const unique = [];
    nodes.forEach((n) => {
      if (!unique.some((u) => u.name === n.name && Math.hypot(u.x - n.x, u.cy - n.cy) < 10)) unique.push(n);
    });
    unique.sort((a, b) => a.x - b.x || a.y - b.y);
    const map = new Map(unique.map((n) => [n.id, { name: n.name, children: [] }]));
    const root = unique[0];
    for (let i = 1; i < unique.length; i++) {
      const n = unique[i];
      let bestP = root;
      let bestScore = Infinity;
      for (const c of unique) {
        if (c.id === n.id || c.x >= n.x - 20) continue;
        const sc = Math.abs(n.cy - c.cy) + Math.abs(n.x - (c.x + c.w)) * 0.6;
        if (sc < bestScore) {
          bestScore = sc;
          bestP = c;
        }
      }
      map.get(bestP.id).children.push(map.get(n.id));
    }
    return map.get(root.id);
  }

  function extractMindMap() {
    return extractFromD3() || extractFromRenderedSvg();
  }

  function treeToMarkdown(node, depth = 0) {
    const lines = [];
    if (depth === 0) lines.push(`# ${node.name}`);
    else lines.push(`${'  '.repeat(depth - 1)}- ${node.name}`);
    for (const c of node.children || []) lines.push(...treeToMarkdown(c, depth + 1));
    return lines;
  }

  function openInMindFlow(tree, targetUrl) {
    const json = JSON.stringify(tree);
    navigator.clipboard?.writeText(json).catch(() => {});
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const cleanTarget = (targetUrl || DEFAULT_APP_URL).split('#')[0];

    if (b64.length < 28000) {
      window.open(`${cleanTarget}#notebooklm=u.${b64}`, '_blank');
    } else {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${tree.name || 'notebooklm-mindmap'}.json`;
      a.click();
      alert('心智圖規模較大，已自動下載 JSON 檔並複製到剪貼簿，請拖曳至 MindFlow 匯入！');
    }
  }

  // Inject floating button when an SVG mind map appears
  function ensureFloatingButton() {
    if (document.getElementById('mindflow-nlm-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'mindflow-nlm-fab';
    btn.textContent = '✨ 匯出到 MindFlow';
    Object.assign(btn.style, {
      position: 'fixed',
      right: '22px',
      bottom: '22px',
      zIndex: '2147483647',
      padding: '10px 16px',
      borderRadius: '999px',
      border: 'none',
      background: 'linear-gradient(135deg, #4285f4 0%, #9b72cb 50%, #d96570 100%)',
      color: '#ffffff',
      fontWeight: '700',
      fontSize: '13px',
      fontFamily: 'Inter, "Noto Sans TC", sans-serif',
      boxShadow: '0 8px 24px rgba(79, 70, 229, 0.35)',
      cursor: 'pointer'
    });
    btn.onclick = () => {
      const tree = extractMindMap();
      if (!tree) {
        alert('未偵測到心智圖！請先在 NotebookLM 開啟心智圖檢視畫面。');
        return;
      }
      chrome.storage?.sync?.get(['mindflowUrl'], (res) => {
        openInMindFlow(tree, res?.mindflowUrl || DEFAULT_APP_URL);
      });
    };
    document.body.appendChild(btn);
  }

  // Listen for popup commands
  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    const tree = extractMindMap();
    if (!tree) {
      sendResponse({ ok: false, error: '目前畫面未偵測到 NotebookLM 心智圖' });
      return true;
    }
    if (msg.action === 'open') {
      openInMindFlow(tree, msg.targetUrl);
      sendResponse({ ok: true, title: tree.name });
    } else if (msg.action === 'json') {
      sendResponse({ ok: true, title: tree.name, data: JSON.stringify(tree, null, 2) });
    } else if (msg.action === 'markdown') {
      sendResponse({ ok: true, title: tree.name, data: treeToMarkdown(tree).join('\n') });
    }
    return true;
  });

  setInterval(() => {
    if (extractMindMap()) ensureFloatingButton();
  }, 2500);
})();
