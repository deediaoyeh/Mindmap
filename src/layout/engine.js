/**
 * Multi-Structure Layout Engine for MindFlow.
 * Supports 8 structures: mindmap, logic-right, logic-left, org-chart,
 * tree-chart, timeline, fishbone, brace-map — plus per-branch mixed structures!
 */

import { getPalette, getTheme } from '../render/themes.js';

let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  return measureCtx;
}

function measureTextWidth(text, fontSize, fontWeight = '500') {
  const ctx = getMeasureCtx();
  ctx.font = `${fontWeight} ${fontSize}px Inter, "Noto Sans TC", sans-serif`;
  return ctx.measureText(text).width;
}

/**
 * Wrap long text into lines cleanly (supports CJK + spaces).
 */
export function wrapNodeText(text, fontSize, fontWeight, maxWidth = 240) {
  const rawLines = String(text || ' ').split('\n');
  const lines = [];
  for (const raw of rawLines) {
    if (!raw) {
      lines.push('');
      continue;
    }
    if (measureTextWidth(raw, fontSize, fontWeight) <= maxWidth) {
      lines.push(raw);
      continue;
    }
    let current = '';
    for (const ch of raw) {
      const next = current + ch;
      if (current && measureTextWidth(next, fontSize, fontWeight) > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [''];
}

function getNodeVisualSpec(node, depth, theme, palette, branchIdx, rainbow) {
  const tier = depth === 0 ? theme.root : depth === 1 ? theme.main : theme.sub;
  const st = node.style || {};
  const fontSize = st.fontSize || tier.fontSize;
  const fontWeight = st.fontWeight || (depth === 0 ? '700' : depth === 1 ? '600' : '500');
  const fontStyle = st.fontStyle || 'normal';
  const shape = st.shape || tier.shape || 'rounded';
  const branchColor = rainbow
    ? palette.colors[branchIdx % palette.colors.length]
    : theme.branchColor;

  let fill = st.fill || tier.fill;
  let border = st.borderColor || (depth === 1 && rainbow ? branchColor : tier.border);
  let color = st.color || tier.color;

  return { fontSize, fontWeight, fontStyle, shape, fill, border, color, branchColor };
}

function measureNodeBox(node, depth, visual, numberingPrefix = '') {
  const displayTitle = numberingPrefix ? `${numberingPrefix} ${node.title}` : node.title;
  const maxTextW = depth === 0 ? 280 : 240;
  const lines = wrapNodeText(displayTitle, visual.fontSize, visual.fontWeight, maxTextW);
  const lineHeight = Math.round(visual.fontSize * 1.42);

  let maxLineW = 0;
  for (const l of lines) {
    maxLineW = Math.max(maxLineW, measureTextWidth(l, visual.fontSize, visual.fontWeight));
  }
  maxLineW = Math.ceil(maxLineW * 1.06) + 6;

  const markerW = (node.markers?.length || 0) * 21;
  const todoW = node.todo ? 22 : 0;
  const badgeCount = (node.notes ? 1 : 0) + (node.link ? 1 : 0) + (node.task ? 1 : 0);
  const badgeW = badgeCount > 0 ? badgeCount * 20 + 10 : 0;

  const padX = depth === 0 ? 22 : depth === 1 ? 16 : 12;
  const padY = depth === 0 ? 13 : depth === 1 ? 9 : 7;

  const contentW = Math.max(52, todoW + markerW + maxLineW + badgeW);
  const imgH = node.image ? 96 : 0;
  const imgW = node.image ? 148 : 0;
  const labelsH = (node.labels && node.labels.length > 0) ? 22 : 0;

  let width = Math.ceil(Math.max(contentW, imgW) + padX * 2);
  let height = Math.ceil(lines.length * lineHeight + padY * 2 + imgH + labelsH);

  if (visual.shape === 'diamond') {
    width = Math.ceil(width * 1.28);
    height = Math.ceil(height * 1.35);
  } else if (visual.shape === 'hexagon') {
    width = Math.ceil(width + 20);
  }

  return { width, height, lines, lineHeight, padX, padY, displayTitle, imgH, labelsH };
}

/**
 * Compute full layout for a Sheet: nodes Map, edges Array, boundaries, summaries, callouts, bounds.
 */
export function computeSheetLayout(sheet) {
  const theme = getTheme(sheet.themeId);
  const palette = getPalette(sheet.branchPaletteId || theme.paletteId);
  const rainbow = sheet.rainbowBranches !== false;

  const nodeMap = new Map(); // id -> layoutItem
  const edges = [];
  const boundaries = [];
  const summaries = [];
  const callouts = [];

  // Build layout wrapper tree with measurements
  function buildMeta(node, depth, parent, branchIdx, numPath, effectiveStructure) {
    const struct = (depth > 0 && node.structure) ? node.structure : effectiveStructure;
    const visual = getNodeVisualSpec(node, depth, theme, palette, branchIdx, rainbow);
    const numPrefix = (sheet.autoNumbering && depth > 0) ? numPath.join('.') : '';
    const box = measureNodeBox(node, depth, visual, numPrefix);

    const item = {
      id: node.id,
      node,
      depth,
      parent,
      branchIdx,
      structure: struct,
      visual,
      box,
      x: 0,
      y: 0,
      w: box.width,
      h: box.height,
      dir: 1, // 1 = right, -1 = left, 0 = center
      children: []
    };

    if (!node.collapsed && node.children && node.children.length > 0) {
      item.children = node.children.map((c, idx) =>
        buildMeta(c, depth + 1, item, depth === 0 ? idx : branchIdx, [...numPath, idx + 1], struct)
      );
    }
    return item;
  }

  // --- Horizontal Tree (logic-right / logic-left / brace-map) ---
  const H_GAP = 54;
  const V_GAP = 16;

  function measureHorizontalSubtree(item, dir) {
    item.dir = dir;
    if (item.structure === 'org-chart' && item.depth > 0) {
      measureOrgSubtree(item);
      return;
    }
    if (!item.children.length) {
      item.subW = item.w;
      item.subH = item.h + (item.node.callout ? 36 : 0);
      return;
    }
    let totalH = 0;
    let maxChildW = 0;
    for (const c of item.children) {
      measureHorizontalSubtree(c, dir);
      totalH += c.subH;
      maxChildW = Math.max(maxChildW, c.subW);
    }
    totalH += V_GAP * (item.children.length - 1);
    if (item.node.boundary) totalH += 28;
    if (item.node.callout) totalH += 36;
    item.subH = Math.max(item.h + (item.node.callout ? 36 : 0), totalH);
    item.subW = item.w + H_GAP + maxChildW + (item.node.summary ? 130 : 0);
  }

  function placeHorizontalSubtree(item, leftX, topY, dir, lineStyle) {
    item.dir = dir;
    if (item.structure === 'org-chart' && item.depth > 0) {
      // Place org subtree anchored from its top-left box
      const cx = dir >= 0 ? leftX + item.subW / 2 : leftX - item.subW / 2;
      placeOrgSubtree(item, cx, topY);
      return;
    }

    const cy = topY + item.subH / 2;
    item.x = dir >= 0 ? leftX : leftX - item.w;
    item.y = cy - item.h / 2;

    if (!item.children.length) return;

    let childrenTotalH = item.children.reduce((acc, c) => acc + c.subH, 0) + V_GAP * (item.children.length - 1);
    let curY = cy - childrenTotalH / 2;
    const nextX = dir >= 0 ? item.x + item.w + H_GAP : item.x - H_GAP;

    for (const c of item.children) {
      placeHorizontalSubtree(c, nextX, curY, dir, lineStyle);
      edges.push({
        from: item,
        to: c,
        color: c.visual.branchColor,
        style: item.structure === 'brace-map' ? 'brace' : lineStyle,
        dir
      });
      curY += c.subH + V_GAP;
    }
  }

  // --- Org Chart (Top-Down) ---
  const ORG_H_GAP = 22;
  const ORG_V_GAP = 48;

  function measureOrgSubtree(item) {
    item.dir = 0;
    if (!item.children.length) {
      item.subW = item.w;
      item.subH = item.h;
      return;
    }
    let totalW = 0;
    let maxH = 0;
    for (const c of item.children) {
      measureOrgSubtree(c);
      totalW += c.subW;
      maxH = Math.max(maxH, c.subH);
    }
    totalW += ORG_H_GAP * (item.children.length - 1);
    item.subW = Math.max(item.w, totalW);
    item.subH = item.h + ORG_V_GAP + maxH;
  }

  function placeOrgSubtree(item, centerX, topY) {
    item.x = centerX - item.w / 2;
    item.y = topY;
    if (!item.children.length) return;
    const totalW = item.children.reduce((acc, c) => acc + c.subW, 0) + ORG_H_GAP * (item.children.length - 1);
    let curX = centerX - totalW / 2;
    const nextY = topY + item.h + ORG_V_GAP;
    for (const c of item.children) {
      placeOrgSubtree(c, curX + c.subW / 2, nextY);
      edges.push({
        from: item,
        to: c,
        color: c.visual.branchColor,
        style: 'org',
        dir: 0
      });
      curX += c.subW + ORG_H_GAP;
    }
  }

  // --- Tree Chart (Indented vertical branches) ---
  const TREE_INDENT = 34;
  const TREE_V_GAP = 14;

  function measureTreeSubtree(item) {
    item.dir = 1;
    let totalH = item.h;
    for (const c of item.children) {
      measureTreeSubtree(c);
      totalH += TREE_V_GAP + c.subH;
    }
    item.subH = totalH;
    item.subW = item.w;
  }

  function placeTreeSubtree(item, x, y) {
    item.x = x;
    item.y = y;
    let curY = y + item.h + TREE_V_GAP;
    for (const c of item.children) {
      placeTreeSubtree(c, x + TREE_INDENT, curY);
      edges.push({
        from: item,
        to: c,
        color: c.visual.branchColor,
        style: 'tree',
        dir: 1
      });
      curY += c.subH + TREE_V_GAP;
    }
  }

  // --- Timeline (Horizontal spine with alternating top/bottom branches) ---
  function layoutTimeline(rootItem) {
    rootItem.x = 0;
    rootItem.y = -rootItem.h / 2;
    const children = rootItem.children;
    if (!children.length) return;

    let curX = rootItem.w + 68;
    const spineY = 0;

    children.forEach((c, idx) => {
      const above = idx % 2 === 0;
      measureOrgSubtree(c);
      const colW = Math.max(c.subW, 140);
      const cx = curX + colW / 2;
      const stemY = above ? -56 - c.h : 56;
      c.x = cx - c.w / 2;
      c.y = stemY;
      c.dir = above ? -2 : 2; // vertical marker

      edges.push({
        from: rootItem,
        to: c,
        color: c.visual.branchColor,
        style: 'timeline-spine',
        spineY,
        above
      });

      // Place grandchildren vertically away from spine
      if (c.children.length) {
        const gTotalW = c.children.reduce((a, g) => a + g.subW, 0) + 16 * (c.children.length - 1);
        let gx = cx - gTotalW / 2;
        for (const g of c.children) {
          if (above) {
            placeTimelineSubUp(g, gx + g.subW / 2, c.y - 34);
          } else {
            placeOrgSubtree(g, gx + g.subW / 2, c.y + c.h + 34);
          }
          edges.push({
            from: c,
            to: g,
            color: g.visual.branchColor,
            style: above ? 'org-up' : 'org',
            dir: 0
          });
          gx += g.subW + 16;
        }
      }
      curX += colW + 44;
    });
  }

  function placeTimelineSubUp(item, centerX, bottomY) {
    item.x = centerX - item.w / 2;
    item.y = bottomY - item.h;
    if (!item.children.length) return;
    const totalW = item.children.reduce((a, c) => a + c.subW, 0) + 16 * (item.children.length - 1);
    let curX = centerX - totalW / 2;
    for (const c of item.children) {
      placeTimelineSubUp(c, curX + c.subW / 2, item.y - 34);
      edges.push({ from: item, to: c, color: c.visual.branchColor, style: 'org-up', dir: 0 });
      curX += c.subW + 16;
    }
  }

  // --- Fishbone (Ishikawa Diagram: Root = Fish Head on Right, Ribs alternate top/bottom) ---
  function layoutFishbone(rootItem) {
    const children = rootItem.children;
    const ribSpacing = 210;
    const spineLen = Math.max(360, Math.ceil(children.length / 2) * ribSpacing + 140);

    rootItem.x = spineLen;
    rootItem.y = -rootItem.h / 2;

    // Add spine virtual edge from tail to head
    edges.push({
      from: { x: 0, y: 0, w: 0, h: 0 },
      to: rootItem,
      color: theme.branchColor,
      style: 'fishbone-spine'
    });

    children.forEach((c, idx) => {
      const above = idx % 2 === 0;
      const pairIdx = Math.floor(idx / 2);
      const anchorX = spineLen - 90 - pairIdx * ribSpacing;
      const ribLenY = Math.max(130, (c.children.length + 1) * 44);
      const slantX = 65;

      c.x = anchorX - slantX - c.w / 2;
      c.y = above ? -ribLenY - c.h : ribLenY;

      edges.push({
        from: { x: anchorX, y: 0, w: 0, h: 0 },
        to: c,
        color: c.visual.branchColor,
        style: 'fishbone-rib',
        above,
        anchorX
      });

      // Place sub-causes horizontally along the slanted rib
      c.children.forEach((sub, sIdx) => {
        const t = (sIdx + 1) / (c.children.length + 1);
        const rx = anchorX - slantX * t;
        const ry = above ? -ribLenY * t : ribLenY * t;
        sub.x = rx - sub.w - 30;
        sub.y = ry - sub.h / 2;
        edges.push({
          from: { x: rx, y: ry, w: 0, h: 0 },
          to: sub,
          color: c.visual.branchColor,
          style: 'fishbone-sub'
        });
        // Deeper grandchildren stack cleanly to the left
        if (sub.children.length) {
          measureHorizontalSubtree(sub, -1);
          placeHorizontalSubtree(sub, sub.x + sub.w, sub.y - (sub.subH - sub.h) / 2, -1, 'straight');
        }
      });
    });
  }

  // --- Balanced Radial Mind Map (default XMind Mind Map) ---
  function layoutMindMap(rootItem) {
    rootItem.x = -rootItem.w / 2;
    rootItem.y = -rootItem.h / 2;

    const rightChildren = [];
    const leftChildren = [];
    rootItem.children.forEach((c, i) => {
      if (c.node.side === 'right') rightChildren.push(c);
      else if (c.node.side === 'left') leftChildren.push(c);
      else if (i % 2 === 0) rightChildren.push(c);
      else leftChildren.push(c);
    });

    const ROOT_GAP = 66;
    const MAIN_V_GAP = 24;

    // Right side
    if (rightChildren.length) {
      for (const c of rightChildren) measureHorizontalSubtree(c, 1);
      const totalH = rightChildren.reduce((a, c) => a + c.subH, 0) + MAIN_V_GAP * (rightChildren.length - 1);
      let curY = -totalH / 2;
      const startX = rootItem.x + rootItem.w + ROOT_GAP;
      for (const c of rightChildren) {
        placeHorizontalSubtree(c, startX, curY, 1, sheet.lineStyle);
        edges.push({ from: rootItem, to: c, color: c.visual.branchColor, style: sheet.lineStyle, dir: 1, isRoot: true });
        curY += c.subH + MAIN_V_GAP;
      }
    }

    // Left side
    if (leftChildren.length) {
      for (const c of leftChildren) measureHorizontalSubtree(c, -1);
      const totalH = leftChildren.reduce((a, c) => a + c.subH, 0) + MAIN_V_GAP * (leftChildren.length - 1);
      let curY = -totalH / 2;
      const startX = rootItem.x - ROOT_GAP;
      for (const c of leftChildren) {
        placeHorizontalSubtree(c, startX, curY, -1, sheet.lineStyle);
        edges.push({ from: rootItem, to: c, color: c.visual.branchColor, style: sheet.lineStyle, dir: -1, isRoot: true });
        curY += c.subH + MAIN_V_GAP;
      }
    }
  }

  // Dispatch Root Layout
  const rootItem = buildMeta(sheet.root, 0, null, 0, [], sheet.structure);

  switch (sheet.structure) {
    case 'logic-right':
    case 'brace-map':
      measureHorizontalSubtree(rootItem, 1);
      placeHorizontalSubtree(rootItem, 0, -rootItem.subH / 2, 1, sheet.lineStyle);
      break;
    case 'logic-left':
      measureHorizontalSubtree(rootItem, -1);
      placeHorizontalSubtree(rootItem, 0, -rootItem.subH / 2, -1, sheet.lineStyle);
      break;
    case 'org-chart':
      measureOrgSubtree(rootItem);
      placeOrgSubtree(rootItem, 0, 0);
      break;
    case 'tree-chart':
      measureTreeSubtree(rootItem);
      placeTreeSubtree(rootItem, 0, 0);
      break;
    case 'timeline':
      layoutTimeline(rootItem);
      break;
    case 'fishbone':
      layoutFishbone(rootItem);
      break;
    case 'mindmap':
    default:
      layoutMindMap(rootItem);
      break;
  }

  // Register main tree nodes
  function collect(item) {
    nodeMap.set(item.id, item);
    for (const c of item.children) collect(c);
  }
  collect(rootItem);

  // Layout Floating Topics independently
  const floatingRoots = [];
  for (const flt of (sheet.floatingTopics || [])) {
    const fItem = buildMeta(flt.node, 1, null, 4, [], 'logic-right');
    fItem.floatingId = flt.id;
    measureHorizontalSubtree(fItem, 1);
    placeHorizontalSubtree(fItem, flt.x, flt.y - fItem.subH / 2, 1, sheet.lineStyle);
    collect(fItem);
    floatingRoots.push(fItem);
  }

  // Helper: get bounding box of an item's entire visible subtree
  function getSubtreeBounds(item) {
    let minX = item.x;
    let minY = item.y;
    let maxX = item.x + item.w;
    let maxY = item.y + item.h;
    const walk = (n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
      for (const c of n.children) walk(c);
    };
    walk(item);
    return { minX, minY, maxX, maxY };
  }

  // Compute Boundaries, Summaries, and Callouts
  for (const item of nodeMap.values()) {
    if (item.node.boundary) {
      const b = getSubtreeBounds(item);
      boundaries.push({
        nodeId: item.id,
        title: item.node.boundary.title || '',
        color: item.node.boundary.color || item.visual.branchColor,
        style: item.node.boundary.style || 'dashed',
        x: b.minX - 14,
        y: b.minY - 16,
        w: (b.maxX - b.minX) + 28,
        h: (b.maxY - b.minY) + 32
      });
    }
    if (item.node.summary && item.children.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of item.children) {
        const b = getSubtreeBounds(c);
        minX = Math.min(minX, b.minX);
        minY = Math.min(minY, b.minY);
        maxX = Math.max(maxX, b.maxX);
        maxY = Math.max(maxY, b.maxY);
      }
      const dir = item.dir === -1 ? -1 : 1;
      summaries.push({
        nodeId: item.id,
        title: item.node.summary.title || '概要',
        color: item.visual.branchColor,
        dir,
        bracketX: dir === 1 ? maxX + 16 : minX - 16,
        minY,
        maxY
      });
    }
    if (item.node.callout) {
      callouts.push({
        nodeId: item.id,
        text: item.node.callout.text || '標註',
        color: item.node.callout.color || '#f59e0b',
        anchorX: item.x + item.w * 0.72,
        anchorY: item.y,
        x: item.x + item.w * 0.55,
        y: item.y - 40
      });
    }
  }

  // Compute global bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of nodeMap.values()) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.w);
    maxY = Math.max(maxY, item.y + item.h);
  }
  for (const b of boundaries) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const s of summaries) {
    minX = Math.min(minX, s.bracketX - 120);
    maxX = Math.max(maxX, s.bracketX + 140);
  }
  if (!isFinite(minX)) {
    minX = -200; minY = -120; maxX = 200; maxY = 120;
  }

  return {
    rootItem,
    floatingRoots,
    nodeMap,
    edges,
    boundaries,
    summaries,
    callouts,
    theme,
    palette,
    bounds: { minX: minX - 60, minY: minY - 60, maxX: maxX + 60, maxY: maxY + 60 }
  };
}
