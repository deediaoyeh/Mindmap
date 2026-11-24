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
  const attCount = (node.attachments || []).length;
  const badgeCount = (node.notes ? 1 : 0) + (node.link ? 1 : 0) + (node.task ? 1 : 0);
  const attBadgeW = attCount > 0 ? 38 : 0;
  const badgeW = (badgeCount > 0 ? badgeCount * 20 + 10 : 0) + attBadgeW;

  const padX = depth === 0 ? 22 : depth === 1 ? 16 : 12;
  const padY = depth === 0 ? 13 : depth === 1 ? 9 : 7;

  const contentW = Math.max(52, todoW + markerW + maxLineW + badgeW);
  const imgH = node.image ? 96 : 0;
  const imgW = node.image ? 156 : 0;
  const videoH = node.video ? 104 : 0;
  const videoW = node.video ? 172 : 0;
  const mediaH = imgH + videoH;
  const mediaW = Math.max(imgW, videoW);
  const labelsH = (node.labels && node.labels.length > 0) ? 22 : 0;

  let width = Math.ceil(Math.max(contentW, mediaW) + padX * 2);
  let height = Math.ceil(lines.length * lineHeight + padY * 2 + mediaH + labelsH);

  if (visual.shape === 'diamond') {
    width = Math.ceil(width * 1.28);
    height = Math.ceil(height * 1.35);
  } else if (visual.shape === 'hexagon') {
    width = Math.ceil(width + 20);
  }

  return { width, height, lines, lineHeight, padX, padY, displayTitle, imgH, videoH, labelsH };
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
      layoutAxis: 'horizontal', // 'horizontal' | 'vertical-down' | 'tree-vertical'
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
    item.layoutAxis = 'horizontal';
    if (item.structure === 'org-chart' && item.depth > 0) {
      measureOrgSubtree(item);
      return;
    }
    if (item.structure === 'tree-chart' && item.depth > 0) {
      measureTreeSubtree(item);
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
    item.layoutAxis = 'horizontal';
    if (item.structure === 'org-chart' && item.depth > 0) {
      const cx = dir >= 0 ? leftX + item.subW / 2 : leftX - item.subW / 2;
      placeOrgSubtree(item, cx, topY);
      return;
    }
    if (item.structure === 'tree-chart' && item.depth > 0) {
      const startX = dir >= 0 ? leftX : leftX - item.subW;
      placeTreeSubtree(item, startX, topY);
      return;
    }

    const cy = topY + item.subH / 2;
    item.x = dir >= 0 ? leftX : leftX - item.w;
    item.y = cy - item.h / 2;

    if (!item.children.length) return;

    let childrenTotalH = item.children.reduce((acc, c) => acc + c.subH, 0) + V_GAP * (item.children.length - 1);
    let curY = cy - childrenTotalH / 2;
    const isBrace = item.structure === 'brace-map';
    const nextX = dir >= 0 ? item.x + item.w + (isBrace ? 42 : H_GAP) : item.x - (isBrace ? 42 : H_GAP);

    for (const c of item.children) {
      placeHorizontalSubtree(c, nextX, curY, dir, lineStyle);
      if (!isBrace) {
        edges.push({
          from: item,
          to: c,
          color: c.visual.branchColor,
          style: lineStyle,
          dir
        });
      }
      curY += c.subH + V_GAP;
    }

    if (isBrace && item.children.length > 0) {
      const first = item.children[0];
      const last = item.children[item.children.length - 1];
      edges.push({
        from: item,
        to: first,
        first,
        last,
        color: item.depth === 0 ? theme.branchColor : item.visual.branchColor,
        style: 'brace-group',
        dir
      });
    }
  }

  // --- Org Chart (Top-Down) ---
  const ORG_H_GAP = 26;
  const ORG_V_GAP = 50;

  function measureOrgSubtree(item) {
    item.dir = 0;
    item.layoutAxis = 'vertical-down';
    if (item.structure === 'tree-chart' && item.depth > 0) {
      measureTreeSubtree(item);
      return;
    }
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
    if (item.structure === 'tree-chart' && item.depth > 0) {
      placeTreeSubtree(item, centerX - item.subW / 2, topY);
      return;
    }
    item.layoutAxis = 'vertical-down';
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

  // --- Tree Chart (Indented vertical branches: siblings stack below, sub-branches indent right) ---
  const TREE_INDENT = 32;
  const TREE_V_GAP = 16;

  function measureTreeSubtree(item) {
    item.dir = 1;
    item.layoutAxis = 'tree-vertical';
    let totalH = item.h;
    let maxW = item.w;
    for (const c of item.children) {
      measureTreeSubtree(c);
      totalH += TREE_V_GAP + c.subH;
      maxW = Math.max(maxW, TREE_INDENT + c.subW);
    }
    item.subH = totalH;
    item.subW = maxW;
  }

  function placeTreeSubtree(item, x, y) {
    item.dir = 1;
    item.layoutAxis = 'tree-vertical';
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

  // --- Org-Tree Hybrid (Top-down horizontal Main Topics + vertical stacked Subtopics + indented Sub-branches!) ---
  function layoutOrgTree(rootItem) {
    rootItem.dir = 0;
    rootItem.layoutAxis = 'vertical-down';
    rootItem.x = -rootItem.w / 2;
    rootItem.y = 0;
    if (!rootItem.children.length) return;

    const COL_GAP = 36;
    for (const mainTopic of rootItem.children) {
      measureTreeSubtree(mainTopic);
      mainTopic.layoutAxis = 'vertical-down'; // depth-1 siblings expand horizontally
    }
    const totalW = rootItem.children.reduce((acc, c) => acc + c.subW, 0) + COL_GAP * (rootItem.children.length - 1);
    let curX = -totalW / 2;
    const nextY = rootItem.h + ORG_V_GAP;

    for (const mainTopic of rootItem.children) {
      placeTreeSubtree(mainTopic, curX, nextY);
      mainTopic.layoutAxis = 'vertical-down';
      edges.push({
        from: rootItem,
        to: mainTopic,
        color: mainTopic.visual.branchColor,
        style: 'org',
        dir: 0
      });
      curX += mainTopic.subW + COL_GAP;
    }
  }

  // --- Timeline Horizontal (XMind-faithful: L1 milestones sit ON the continuous horizontal rail; L2->L3 branch above/below) ---
  function layoutTimeline(rootItem) {
    rootItem.x = 0;
    rootItem.y = -rootItem.h / 2;
    rootItem.layoutAxis = 'vertical-down';
    const children = rootItem.children;
    if (!children.length) return;

    let curX = rootItem.w + 56;
    let prevNode = rootItem;

    children.forEach((c, idx) => {
      const above = idx % 2 === 0;
      c.layoutAxis = 'vertical-down';
      // Measure L2+ subtrees as compact indented vertical trees
      let subBlockW = c.w;
      let subBlockH = 0;
      for (const g of c.children) {
        measureTreeSubtree(g);
        subBlockW = Math.max(subBlockW, g.subW + 24);
        subBlockH += g.subH + 14;
      }
      const colW = Math.max(c.w, subBlockW, 130);
      c.x = curX;
      c.y = -c.h / 2;

      edges.push({
        from: prevNode,
        to: c,
        color: c.visual.branchColor,
        style: 'timeline-rail'
      });
      prevNode = c;

      // Branch L2->L3 perpendicularly above or below the milestone
      if (c.children.length) {
        const stemX = c.x + 18;
        if (above) {
          let curY = c.y - 34 - subBlockH + 14;
          for (const g of c.children) {
            placeTreeSubtree(g, stemX + 18, curY);
            edges.push({
              from: { x: stemX, y: c.y, w: 0, h: 0 },
              to: g,
              color: c.visual.branchColor,
              style: 'timeline-sub-up',
              stemX,
              anchorY: c.y
            });
            curY += g.subH + 14;
          }
        } else {
          let curY = c.y + c.h + 32;
          for (const g of c.children) {
            placeTreeSubtree(g, stemX + 18, curY);
            edges.push({
              from: { x: stemX, y: c.y + c.h, w: 0, h: 0 },
              to: g,
              color: c.visual.branchColor,
              style: 'timeline-sub-down',
              stemX,
              anchorY: c.y + c.h
            });
            curY += g.subH + 14;
          }
        }
      }

      curX += colW + 44;
    });
  }

  // --- Timeline Vertical (XMind Vertical Timeline: L1 milestones stack on central vertical rail; L2->L3 branch left/right) ---
  function layoutTimelineVertical(rootItem) {
    rootItem.x = -rootItem.w / 2;
    rootItem.y = 0;
    rootItem.layoutAxis = 'tree-vertical';
    const children = rootItem.children;
    if (!children.length) return;

    let curY = rootItem.h + 52;
    let prevNode = rootItem;

    children.forEach((c, idx) => {
      const dir = idx % 2 === 0 ? 1 : -1;
      c.dir = dir;
      c.layoutAxis = 'horizontal';
      let subsTotalH = 0;
      for (const g of c.children) {
        measureHorizontalSubtree(g, dir);
        subsTotalH += g.subH;
      }
      if (c.children.length > 1) subsTotalH += V_GAP * (c.children.length - 1);
      const rowH = Math.max(c.h, subsTotalH);

      c.x = -c.w / 2;
      c.y = curY + (rowH - c.h) / 2;

      edges.push({
        from: prevNode,
        to: c,
        color: c.visual.branchColor,
        style: 'timeline-v-rail'
      });
      prevNode = c;

      if (c.children.length) {
        let gy = curY + (rowH - subsTotalH) / 2;
        const startX = dir === 1 ? c.x + c.w + 46 : c.x - 46;
        for (const g of c.children) {
          placeHorizontalSubtree(g, startX, gy, dir, sheet.lineStyle);
          edges.push({ from: c, to: g, color: c.visual.branchColor, style: sheet.lineStyle, dir });
          gy += g.subH + V_GAP;
        }
      }
      curY += rowH + 40;
    });
  }

  // --- Tree Table (XMind Icicle / Flush Partition Table: zero branch lines, tightly packed hierarchical cells) ---
  function layoutTreeTable(rootItem) {
    const colWidths = [];
    function scanWidths(item) {
      colWidths[item.depth] = Math.max(colWidths[item.depth] || 132, item.w + 14);
      for (const c of item.children) scanWidths(c);
    }
    scanWidths(rootItem);

    function measureHeight(item) {
      item.isTableCell = true;
      item.layoutAxis = 'horizontal';
      if (!item.children.length) {
        item.tableH = Math.max(item.h + 8, 42);
        return item.tableH;
      }
      let sum = 0;
      for (const c of item.children) sum += measureHeight(c);
      item.tableH = Math.max(item.h + 8, sum);
      return item.tableH;
    }
    measureHeight(rootItem);

    function placeCells(item, colX, topY, availH) {
      item.x = colX;
      item.y = topY;
      item.w = colWidths[item.depth];
      item.h = availH;
      item.isTableCell = true;
      if (!item.children.length) return;
      const sumKids = item.children.reduce((a, c) => a + c.tableH, 0);
      const scaleH = sumKids > 0 ? availH / sumKids : 1;
      let curY = topY;
      for (const c of item.children) {
        const ch = c.tableH * scaleH;
        placeCells(c, colX + item.w, curY, ch);
        curY += ch;
      }
    }
    placeCells(rootItem, 0, 0, rootItem.tableH);
  }

  // --- Matrix (XMind 2D Classification Grid: L0 top banner, L1 row headers, L2 column cells, L3 stacked items) ---
  function layoutMatrix(rootItem) {
    const CELL_GAP = 14;
    const ROW_HEADER_W = Math.max(150, ...rootItem.children.map(c => c.w + 18));

    // Determine max columns across L1 rows & width per column
    const colWidths = [];
    for (const row of rootItem.children) {
      row.children.forEach((cell, cIdx) => {
        let cw = Math.max(cell.w + 16, 160);
        for (const sub of cell.children) {
          measureTreeSubtree(sub);
          cw = Math.max(cw, sub.subW + 28);
        }
        colWidths[cIdx] = Math.max(colWidths[cIdx] || 160, cw);
      });
    }
    const totalColsW = colWidths.reduce((a, w) => a + w + CELL_GAP, 0);
    const totalW = Math.max(rootItem.w + 40, ROW_HEADER_W + CELL_GAP + Math.max(totalColsW, 200));

    rootItem.x = 0;
    rootItem.y = 0;
    rootItem.w = totalW;
    rootItem.isTableCell = true;
    rootItem.layoutAxis = 'vertical-down';

    let curY = rootItem.h + CELL_GAP;
    for (const row of rootItem.children) {
      // Measure row height from tallest L2 cell (+ its L3 items)
      let rowH = Math.max(row.h + 16, 56);
      for (const cell of row.children) {
        let cellTotalH = cell.h + 14;
        for (const sub of cell.children) cellTotalH += sub.subH + 10;
        rowH = Math.max(rowH, cellTotalH + 10);
      }

      row.x = 0;
      row.y = curY;
      row.w = ROW_HEADER_W;
      row.h = rowH;
      row.isTableCell = true;
      row.layoutAxis = 'horizontal';

      let curX = ROW_HEADER_W + CELL_GAP;
      row.children.forEach((cell, cIdx) => {
        const cw = colWidths[cIdx] || 170;
        cell.x = curX;
        cell.y = curY;
        cell.w = cw;
        cell.layoutAxis = 'horizontal';

        // Place L3 items neatly stacked beneath/inside the L2 cell column
        let subY = curY + cell.h + 10;
        for (const sub of cell.children) {
          placeTreeSubtree(sub, curX + 16, subY);
          edges.push({ from: cell, to: sub, color: row.visual.branchColor, style: 'tree', dir: 1 });
          subY += sub.subH + 10;
        }
        edges.push({ from: row, to: cell, color: row.visual.branchColor, style: 'straight', dir: 1 });
        curX += cw + CELL_GAP;
      });
      curY += rowH + CELL_GAP;
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
    case 'org-tree':
      layoutOrgTree(rootItem);
      break;
    case 'tree-chart':
      measureTreeSubtree(rootItem);
      placeTreeSubtree(rootItem, 0, 0);
      break;
    case 'timeline':
      layoutTimeline(rootItem);
      break;
    case 'timeline-vertical':
      layoutTimelineVertical(rootItem);
      break;
    case 'fishbone':
      layoutFishbone(rootItem);
      break;
    case 'tree-table':
      layoutTreeTable(rootItem);
      break;
    case 'matrix':
      layoutMatrix(rootItem);
      break;
    case 'mindmap':
    default:
      layoutMindMap(rootItem);
      break;
  }

  // Record auto-computed positions & apply XMind-style Main Branch Free-Positioning offsets
  function shiftSubtree(item, dx, dy) {
    item.x += dx;
    item.y += dy;
    for (const c of item.children) shiftSubtree(c, dx, dy);
  }
  function saveAutoCoords(item) {
    item.autoX = item.x;
    item.autoY = item.y;
    for (const c of item.children) saveAutoCoords(c);
  }
  saveAutoCoords(rootItem);

  if (sheet.structure !== 'tree-table' && sheet.structure !== 'matrix') {
    for (const mainBranch of rootItem.children) {
      const off = mainBranch.node.customOffset;
      if (off && (off.x || off.y)) {
        shiftSubtree(mainBranch, off.x || 0, off.y || 0);
      }
    }
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
