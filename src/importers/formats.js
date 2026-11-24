/**
 * Multi-format Mind Map Importers:
 * Markdown (.md), OPML (.opml), FreeMind (.mm), XMind (.xmind ZIP),
 * NotebookLM JSON / SVG, and indented plain text.
 */

import { createNode, createSheet } from '../core/schema.js';
import { readZip } from '../core/zip.js';
import { parseNotebookLMJson, parseNotebookLMSvg } from './notebooklm.js';

/**
 * Parse Markdown headings (#, ##, ###) and nested bullet/numbered lists into a MindFlow Node tree.
 */
export function parseMarkdown(mdText, fallbackTitle = 'Markdown 心智圖') {
  const lines = mdText.replace(/\r\n/g, '\n').split('\n');
  const root = createNode(fallbackTitle);
  const stack = [{ level: -1, node: root }];

  let headingBaseLevel = 0;
  let rootSetFromH1 = false;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    if (/^```/.test(rawLine.trim())) continue;

    // Heading: # Title
    const hMatch = rawLine.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = hMatch[2].replace(/\s*#+\s*$/, '').trim();
      if (level === 1 && !rootSetFromH1 && root.children.length === 0) {
        root.title = text;
        rootSetFromH1 = true;
        headingBaseLevel = 1;
        stack.length = 0;
        stack.push({ level: 1, node: root });
        continue;
      }
      const effLevel = level;
      headingBaseLevel = effLevel;
      const node = createNode(text);
      while (stack.length > 1 && stack[stack.length - 1].level >= effLevel) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level: effLevel, node });
      continue;
    }

    // Bullet / numbered / indented list item
    const lMatch = rawLine.match(/^(\s*)(?:[-*+]|\d+\.)\s+(?:\[([ xX])\]\s+)?(.+)$/);
    if (lMatch) {
      const indent = lMatch[1].replace(/\t/g, '  ').length;
      const checkMark = lMatch[2];
      const text = lMatch[3].trim();
      const level = headingBaseLevel + 10 + Math.floor(indent / 2);
      const node = createNode(text, {
        todo: checkMark !== undefined ? { checked: checkMark.toLowerCase() === 'x' } : null
      });
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level, node });
      continue;
    }

    // Plain indented outline fallback
    const pMatch = rawLine.match(/^(\s*)(.+)$/);
    if (pMatch) {
      const indent = pMatch[1].replace(/\t/g, '  ').length;
      const text = pMatch[2].trim();
      if (!text) continue;
      const level = headingBaseLevel + 10 + Math.floor(indent / 2);
      const node = createNode(text);
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack[stack.length - 1].node.children.push(node);
      stack.push({ level, node });
    }
  }

  // If root only acted as a dummy wrapper around a single top item, unwrap it
  if (!rootSetFromH1 && root.children.length === 1 && root.title === fallbackTitle) {
    return { title: root.children[0].title, root: root.children[0] };
  }
  return { title: root.title, root };
}

/**
 * Parse OPML (.opml) XML into MindFlow Node tree.
 */
export function parseOPML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const titleEl = doc.querySelector('head > title');
  const body = doc.querySelector('body');
  if (!body) throw new Error('無效的 OPML 檔案（找不到 <body>）');

  function walk(outlineEl) {
    const title = outlineEl.getAttribute('text') || outlineEl.getAttribute('title') || '節點';
    const notes = outlineEl.getAttribute('_note') || outlineEl.getAttribute('note') || '';
    const link = outlineEl.getAttribute('url') || outlineEl.getAttribute('htmlUrl') || '';
    const kids = Array.from(outlineEl.children)
      .filter(c => c.tagName.toLowerCase() === 'outline')
      .map(walk);
    return createNode(title, { notes, link, children: kids });
  }

  const topOutlines = Array.from(body.children)
    .filter(c => c.tagName.toLowerCase() === 'outline')
    .map(walk);

  if (topOutlines.length === 1) {
    return { title: topOutlines[0].title, root: topOutlines[0] };
  }
  const rootTitle = titleEl?.textContent?.trim() || 'OPML 心智圖';
  return { title: rootTitle, root: createNode(rootTitle, { children: topOutlines }) };
}

/**
 * Parse FreeMind (.mm) XML into MindFlow Node tree.
 */
export function parseFreeMind(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const topNode = doc.querySelector('map > node');
  if (!topNode) throw new Error('無效的 FreeMind (.mm) 檔案');

  function walk(el) {
    const title = el.getAttribute('TEXT') || el.getAttribute('text') || '節點';
    const link = el.getAttribute('LINK') || '';
    const pos = el.getAttribute('POSITION');
    const side = pos === 'left' ? 'left' : pos === 'right' ? 'right' : null;
    const kids = Array.from(el.children)
      .filter(c => c.tagName.toLowerCase() === 'node')
      .map(walk);
    return createNode(title, { link, side, children: kids });
  }

  const root = walk(topNode);
  return { title: root.title, root };
}

/**
 * Parse real XMind (.xmind) ZIP archive (supports modern content.json AND legacy content.xml).
 */
export async function parseXMindFile(arrayBuffer) {
  const files = await readZip(arrayBuffer);
  const dec = new TextDecoder();

  // Modern XMind Zen / XMind 2020+ format: content.json
  if (files['content.json']) {
    const json = JSON.parse(dec.decode(files['content.json']));
    const sheets = [];

    function convertTopic(t) {
      const notes = t.notes?.plain?.content || '';
      const labels = Array.isArray(t.labels) ? t.labels : [];
      const link = t.href || '';
      const attached = t.children?.attached || [];
      return createNode(t.title || '主題', {
        notes,
        labels,
        link,
        children: attached.map(convertTopic)
      });
    }

    for (const s of (Array.isArray(json) ? json : [json])) {
      if (!s.rootTopic) continue;
      const root = convertTopic(s.rootTopic);
      const structureClass = s.rootTopic.structureClass || '';
      let structure = 'mindmap';
      if (structureClass.includes('logic.right')) structure = 'logic-right';
      else if (structureClass.includes('logic.left')) structure = 'logic-left';
      else if (structureClass.includes('org-chart')) structure = 'org-chart';
      else if (structureClass.includes('tree')) structure = 'tree-chart';
      else if (structureClass.includes('fishbone')) structure = 'fishbone';
      else if (structureClass.includes('timeline')) structure = 'timeline';
      else if (structureClass.includes('brace')) structure = 'brace-map';

      sheets.push(createSheet(s.title || root.title, root, { structure }));
    }

    if (!sheets.length) throw new Error('.xmind content.json 中未找到有效畫布');
    return { title: sheets[0].root.title, root: sheets[0].root, sheets };
  }

  // Legacy XMind 8 format: content.xml
  if (files['content.xml']) {
    const xmlText = dec.decode(files['content.xml']);
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const sheetEls = Array.from(doc.querySelectorAll('sheet'));
    const sheets = [];

    function convertXmlTopic(tEl) {
      const titleEl = Array.from(tEl.children).find(c => c.tagName === 'title');
      const title = titleEl?.textContent?.trim() || '主題';
      const childrenEl = Array.from(tEl.children).find(c => c.tagName === 'children');
      const kids = [];
      if (childrenEl) {
        const topicsEl = Array.from(childrenEl.children).find(c => c.tagName === 'topics' && (c.getAttribute('type') === 'attached' || !c.getAttribute('type')));
        if (topicsEl) {
          for (const sub of Array.from(topicsEl.children).filter(c => c.tagName === 'topic')) {
            kids.push(convertXmlTopic(sub));
          }
        }
      }
      return createNode(title, { children: kids });
    }

    for (const sEl of sheetEls) {
      const rootTopicEl = Array.from(sEl.children).find(c => c.tagName === 'topic');
      if (!rootTopicEl) continue;
      const root = convertXmlTopic(rootTopicEl);
      const sTitleEl = Array.from(sEl.children).find(c => c.tagName === 'title');
      sheets.push(createSheet(sTitleEl?.textContent?.trim() || root.title, root));
    }

    if (!sheets.length) throw new Error('.xmind content.xml 中未找到有效畫布');
    return { title: sheets[0].root.title, root: sheets[0].root, sheets };
  }

  throw new Error('此 .xmind 檔案缺少 content.json 或 content.xml');
}

/**
 * Unified auto-detecting importer for Files or pasted raw text.
 */
export async function importFromFile(file) {
  const name = file.name || '匯入檔案';
  const ext = name.split('.').pop().toLowerCase();

  if (ext === 'xmind') {
    const buf = await file.arrayBuffer();
    return parseXMindFile(buf);
  }

  const text = await file.text();
  return importFromText(text, name.replace(/\.[^.]+$/, ''), ext);
}

export function importFromText(text, fallbackTitle = '匯入心智圖', extHint = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('匯入內容為空');

  if (extHint === 'json' || extHint === 'canvas' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return parseNotebookLMJson(trimmed);
    } catch (e) {
      if (extHint === 'json') throw e;
    }
  }

  if (extHint === 'svg' || /<svg[\s>]/i.test(trimmed)) {
    return parseNotebookLMSvg(trimmed);
  }

  if (extHint === 'opml' || /<opml[\s>]/i.test(trimmed)) {
    return parseOPML(trimmed);
  }

  if (extHint === 'mm' || /<map[\s>]/i.test(trimmed)) {
    return parseFreeMind(trimmed);
  }

  return parseMarkdown(trimmed, fallbackTitle);
}
