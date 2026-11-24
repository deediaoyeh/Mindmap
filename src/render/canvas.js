/**
 * Interactive SVG Mind Map Canvas Renderer.
 * Handles pan/zoom, vector rendering of nodes/branches/boundaries/summaries/callouts/relationships,
 * inline text editing, drag-and-drop reparenting, floating toolbar, and live minimap.
 */

import { store } from '../core/store.js';
import { computeSheetLayout } from '../layout/engine.js';
import { MARKER_GROUPS } from './themes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const MARKER_MAP = (() => {
  const m = {};
  for (const g of MARKER_GROUPS) {
    for (const item of g.items) m[item.id] = item.label;
  }
  return m;
})();

function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

export class MindMapCanvas {
  constructor() {
    this.svg = document.getElementById('mindmap-svg');
    this.defs = document.getElementById('svg-defs');
    this.viewport = document.getElementById('viewport-group');
    this.layers = {
      boundaries: document.getElementById('layer-boundaries'),
      branches: document.getElementById('layer-branches'),
      summaries: document.getElementById('layer-summaries'),
      relationships: document.getElementById('layer-relationships'),
      callouts: document.getElementById('layer-callouts'),
      nodes: document.getElementById('layer-nodes'),
      overlay: document.getElementById('layer-overlay')
    };

    this.inlineWrap = document.getElementById('inline-editor-wrap');
    this.inlineEditor = document.getElementById('inline-editor');
    this.floatingToolbar = document.getElementById('floating-toolbar');
    this.canvasBanner = document.getElementById('canvas-banner');
    this.minimapPanel = document.getElementById('minimap-panel');
    this.minimapSvg = document.getElementById('minimap-svg');

    // Camera transform
    this.tx = 0;
    this.ty = 0;
    this.scale = 1;
    this.layout = null;
    this.hasInitializedCamera = false;

    // Interaction states
    this.panning = false;
    this.panStart = { x: 0, y: 0, tx: 0, ty: 0 };

    this.draggingNode = null; // { id, floatingId, startX, startY, moved, targetId, dropPos }
    this.draggingRel = null; // { relId, startX, startY, origOffset }

    this._bindEvents();
  }

  screenToWorld(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.tx) / this.scale,
      y: (clientY - rect.top - this.ty) / this.scale
    };
  }

  worldToScreen(wx, wy) {
    return {
      x: wx * this.scale + this.tx,
      y: wy * this.scale + this.ty
    };
  }

  applyTransform() {
    this.viewport.setAttribute('transform', `translate(${this.tx}, ${this.ty}) scale(${this.scale})`);
    this._positionFloatingToolbar();
    this._updateMinimapViewport();
    if (this.onZoomChange) this.onZoomChange(this.scale);
  }

  fitToView(animate = false) {
    if (!this.layout) return;
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const { minX, minY, maxX, maxY } = this.layout.bounds;
    const bw = Math.max(100, maxX - minX);
    const bh = Math.max(100, maxY - minY);
    const pad = 44;
    const sx = (rect.width - pad * 2) / bw;
    const sy = (rect.height - pad * 2) / bh;
    this.scale = Math.max(0.15, Math.min(1.15, Math.min(sx, sy)));
    this.tx = rect.width / 2 - ((minX + maxX) / 2) * this.scale;
    this.ty = rect.height / 2 - ((minY + maxY) / 2) * this.scale;
    this.applyTransform();
  }

  setZoom(newScale, pivotX = null, pivotY = null) {
    const rect = this.svg.getBoundingClientRect();
    const px = pivotX !== null ? pivotX : rect.width / 2;
    const py = pivotY !== null ? pivotY : rect.height / 2;
    const clamped = Math.max(0.2, Math.min(3.0, newScale));
    const ratio = clamped / this.scale;
    this.tx = px - (px - this.tx) * ratio;
    this.ty = py - (py - this.ty) * ratio;
    this.scale = clamped;
    this.applyTransform();
  }

  centerOnNode(nodeId) {
    const item = this.layout?.nodeMap.get(nodeId);
    if (!item) return;
    const rect = this.svg.getBoundingClientRect();
    this.tx = rect.width / 2 - (item.x + item.w / 2) * this.scale;
    this.ty = rect.height / 2 - (item.y + item.h / 2) * this.scale;
    this.applyTransform();
  }

  hitTestNodeAtScreen(clientX, clientY) {
    if (!this.layout) return null;
    const rect = this.svg.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    const world = this.screenToWorld(clientX, clientY);
    for (const [id, item] of this.layout.nodeMap.entries()) {
      if (
        world.x >= item.x - 14 &&
        world.x <= item.x + item.w + 14 &&
        world.y >= item.y - 12 &&
        world.y <= item.y + item.h + 12
      ) {
        return item;
      }
    }
    return null;
  }

  setExternalDropFeedback(targetItem, active) {
    this.layers.nodes.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
    if (!active) {
      this._renderBanner();
      return;
    }
    if (targetItem) {
      this.layers.nodes.querySelector(`[data-node-id="${targetItem.id}"]`)?.classList.add('drop-target');
      this.canvasBanner.classList.remove('hidden');
      this.canvasBanner.innerHTML = `<span>📥 放開即可將內容加入節點「<b>${targetItem.node.title.slice(0, 24)}</b>」</span>`;
    } else {
      this.canvasBanner.classList.remove('hidden');
      this.canvasBanner.innerHTML = `<span>📥 放開即可在此位置建立新主題，或匯入心智圖檔案</span>`;
    }
  }

  render(reason = 'update') {
    const sheet = store.getActiveSheet();
    if (!sheet) return;

    this.layout = computeSheetLayout(sheet);
    const { theme, nodeMap, edges, boundaries, summaries, callouts } = this.layout;
    const bg = sheet.customBg || theme.canvasBg;

    // Background & subtle dot grid
    this.svg.style.background = bg;
    this.svg.classList.toggle('connecting', Boolean(store.connectingFromId));
    this._renderDefs(theme, bg);

    for (const l of Object.values(this.layers)) l.innerHTML = '';

    const matchedIds = store.getMatchedNodeIds(sheet);

    this._renderBoundaries(boundaries);
    this._renderEdges(edges);
    this._renderSummaries(summaries, theme);
    this._renderRelationships(sheet.relationships || [], nodeMap);
    this._renderCallouts(callouts);
    this._renderNodes(nodeMap, matchedIds);

    if (!this.hasInitializedCamera || reason === 'sheet' || reason === 'doc-switch') {
      this.hasInitializedCamera = true;
      requestAnimationFrame(() => this.fitToView());
    } else {
      this.applyTransform();
    }

    this._renderInlineEditor();
    this._renderBanner();
    this._renderMinimap();
  }

  _renderDefs(theme, bg) {
    this.defs.innerHTML = `
      <filter id="node-shadow" x="-15%" y="-15%" width="130%" height="145%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0f172a" flood-opacity="${theme.dark ? '0.45' : '0.09'}" />
      </filter>
      <marker id="rel-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="context-stroke" />
      </marker>
    `;
  }

  _renderBoundaries(boundaries) {
    for (const b of boundaries) {
      const g = el('g', { class: 'boundary-group' }, this.layers.boundaries);
      el('rect', {
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        rx: 14,
        fill: b.color,
        'fill-opacity': 0.08,
        stroke: b.color,
        'stroke-width': 2,
        'stroke-dasharray': b.style === 'solid' ? '' : '6 4'
      }, g);
      if (b.title) {
        const tw = Math.max(54, b.title.length * 11 + 18);
        el('rect', {
          x: b.x + 12,
          y: b.y - 11,
          width: tw,
          height: 20,
          rx: 10,
          fill: b.color
        }, g);
        const t = el('text', {
          x: b.x + 12 + tw / 2,
          y: b.y + 3,
          'text-anchor': 'middle',
          fill: '#ffffff',
          'font-size': 11,
          'font-weight': 600
        }, g);
        t.textContent = b.title;
      }
    }
  }

  _renderEdges(edges) {
    for (const e of edges) {
      const { from, to, color, style, dir, isRoot } = e;
      let d = '';
      let strokeW = isRoot ? 3 : 2;

      if (style === 'fishbone-spine') {
        d = `M ${from.x} 0 L ${to.x} 0`;
        strokeW = 4;
      } else if (style === 'fishbone-rib') {
        const tx = to.x + to.w / 2;
        const ty = e.above ? to.y + to.h : to.y;
        d = `M ${e.anchorX} 0 L ${tx} ${ty}`;
        strokeW = 2.6;
      } else if (style === 'fishbone-sub') {
        const tx = to.x + to.w;
        const ty = to.y + to.h / 2;
        d = `M ${from.x} ${from.y} L ${tx} ${ty}`;
        strokeW = 1.8;
      } else if (style === 'brace-group') {
        // Genuine XMind-style continuous typographic curly brace { / } spanning sibling vertical bounds
        const fx = dir >= 0 ? from.x + from.w : from.x;
        const fy = from.y + from.h / 2;
        const topY = e.first.y + e.first.h / 2;
        const botY = e.last.y + e.last.h / 2;
        const tipX = dir >= 0 ? e.first.x - 4 : e.first.x + e.first.w + 4;
        const midX = (fx + tipX) / 2;
        const r = Math.min(12, Math.max(4, Math.abs(botY - topY) / 6));
        if (Math.abs(botY - topY) < 4) {
          d = `M ${fx} ${fy} L ${tipX} ${topY}`;
        } else {
          const sx = dir >= 0 ? 1 : -1;
          d = `M ${tipX} ${topY} Q ${midX + sx * 2} ${topY} ${midX} ${topY + r} L ${midX} ${fy - r} Q ${midX} ${fy} ${fx} ${fy} Q ${midX} ${fy} ${midX} ${fy + r} L ${midX} ${botY - r} Q ${midX + sx * 2} ${botY} ${tipX} ${botY}`;
        }
        strokeW = 2.2;
      } else if (style === 'timeline-rail') {
        const fx = from.x + from.w;
        const fy = 0;
        const tx = to.x;
        const ty = 0;
        d = `M ${fx} ${fy} L ${tx} ${ty}`;
        strokeW = 3.5;
      } else if (style === 'timeline-v-rail') {
        const fx = 0;
        const fy = from.y + from.h;
        const tx = 0;
        const ty = to.y;
        d = `M ${fx} ${fy} L ${tx} ${ty}`;
        strokeW = 3.5;
      } else if (style === 'timeline-sub-up' || style === 'timeline-sub-down') {
        const tx = to.x;
        const ty = to.y + to.h / 2;
        d = `M ${e.stemX} ${e.anchorY} L ${e.stemX} ${ty} L ${tx} ${ty}`;
        strokeW = 2;
      } else if (style === 'timeline-spine') {
        const cx = to.x + to.w / 2;
        const ty = e.above ? to.y + to.h : to.y;
        // Horizontal spine segment + vertical stem
        el('line', {
          x1: from.x + from.w,
          y1: 0,
          x2: cx,
          y2: 0,
          stroke: color,
          'stroke-width': 3.5,
          'stroke-linecap': 'round'
        }, this.layers.branches);
        el('circle', { cx, cy: 0, r: 6, fill: color }, this.layers.branches);
        d = `M ${cx} 0 L ${cx} ${ty}`;
        strokeW = 2.2;
      } else if (style === 'org') {
        const fx = from.x + from.w / 2;
        const fy = from.y + from.h;
        const tx = to.x + to.w / 2;
        const ty = to.y;
        const midY = (fy + ty) / 2;
        d = `M ${fx} ${fy} L ${fx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
      } else if (style === 'org-up') {
        const fx = from.x + from.w / 2;
        const fy = from.y;
        const tx = to.x + to.w / 2;
        const ty = to.y + to.h;
        const midY = (fy + ty) / 2;
        d = `M ${fx} ${fy} L ${fx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
      } else if (style === 'tree') {
        const fx = from.x + 14;
        const fy = from.y + from.h;
        const tx = to.x;
        const ty = to.y + to.h / 2;
        d = `M ${fx} ${fy} L ${fx} ${ty} L ${tx} ${ty}`;
      } else {
        // Horizontal variants (bezier, tapered, elbow, straight, brace)
        const fx = dir >= 0 ? from.x + from.w : from.x;
        const fy = from.y + from.h / 2;
        const tx = dir >= 0 ? to.x : to.x + to.w;
        const ty = to.y + to.h / 2;
        const midX = (fx + tx) / 2;

        if (style === 'straight') {
          d = `M ${fx} ${fy} L ${tx} ${ty}`;
        } else if (style === 'elbow') {
          d = `M ${fx} ${fy} L ${midX} ${fy} L ${midX} ${ty} L ${tx} ${ty}`;
        } else if (style === 'brace') {
          const c1x = fx + (tx - fx) * 0.65;
          const c2x = fx + (tx - fx) * 0.35;
          d = `M ${fx} ${fy} C ${c1x} ${fy}, ${c2x} ${ty}, ${tx} ${ty}`;
        } else if (style === 'tapered' && isRoot) {
          // Tapered organic filled shape
          const w1 = 6;
          const w2 = 1.4;
          const path = `M ${fx} ${fy - w1} C ${midX} ${fy - w1}, ${midX} ${ty - w2}, ${tx} ${ty - w2} L ${tx} ${ty + w2} C ${midX} ${ty + w2}, ${midX} ${fy + w1}, ${fx} ${fy + w1} Z`;
          el('path', { d: path, fill: color, opacity: 0.9 }, this.layers.branches);
          continue;
        } else {
          // Smooth cubic bezier
          d = `M ${fx} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${tx} ${ty}`;
        }
      }

      el('path', {
        d,
        fill: 'none',
        stroke: color,
        'stroke-width': strokeW,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      }, this.layers.branches);
    }
  }

  _renderSummaries(summaries, theme) {
    for (const s of summaries) {
      const g = el('g', { class: 'summary-group' }, this.layers.summaries);
      const midY = (s.minY + s.maxY) / 2;
      const dx = s.dir === 1 ? 10 : -10;
      const bx = s.bracketX;
      // Curly bracket SVG path
      const d = `M ${bx - dx * 0.4} ${s.minY} Q ${bx + dx * 0.4} ${s.minY} ${bx + dx * 0.4} ${s.minY + 14} L ${bx + dx * 0.4} ${midY - 8} Q ${bx + dx * 0.4} ${midY} ${bx + dx * 1.2} ${midY} Q ${bx + dx * 0.4} ${midY} ${bx + dx * 0.4} ${midY + 8} L ${bx + dx * 0.4} ${s.maxY - 14} Q ${bx + dx * 0.4} ${s.maxY} ${bx - dx * 0.4} ${s.maxY}`;
      el('path', {
        d,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 2.2,
        'stroke-linecap': 'round'
      }, g);

      const labelW = Math.max(66, s.title.length * 13 + 22);
      const lx = s.dir === 1 ? bx + dx * 1.5 : bx + dx * 1.5 - labelW;
      el('rect', {
        x: lx,
        y: midY - 15,
        width: labelW,
        height: 30,
        rx: 8,
        fill: theme.dark ? '#1e293b' : '#ffffff',
        stroke: s.color,
        'stroke-width': 1.8
      }, g);
      const t = el('text', {
        x: lx + labelW / 2,
        y: midY + 4,
        'text-anchor': 'middle',
        fill: theme.dark ? '#f1f5f9' : '#0f172a',
        'font-size': 12.5,
        'font-weight': 600
      }, g);
      t.textContent = s.title;
    }
  }

  _renderRelationships(relationships, nodeMap) {
    for (const rel of relationships) {
      const from = nodeMap.get(rel.fromId);
      const to = nodeMap.get(rel.toId);
      if (!from || !to) continue;

      const fx = from.x + from.w / 2;
      const fy = from.y + from.h / 2;
      const tx = to.x + to.w / 2;
      const ty = to.y + to.h / 2;
      const off = rel.controlOffset || { x: 0, y: -70 };
      const cx = (fx + tx) / 2 + off.x;
      const cy = (fy + ty) / 2 + off.y;
      const selected = store.selectedRelId === rel.id;

      const g = el('g', { class: 'rel-group', 'data-rel-id': rel.id }, this.layers.relationships);

      // Wide invisible hit area
      el('path', {
        d: `M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}`,
        fill: 'none',
        stroke: 'transparent',
        'stroke-width': 14,
        style: 'cursor:pointer'
      }, g);

      el('path', {
        d: `M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}`,
        fill: 'none',
        stroke: rel.color || '#6366f1',
        'stroke-width': selected ? 3 : 2,
        'stroke-dasharray': rel.dashed !== false ? '6 4' : '',
        'marker-end': 'url(#rel-arrow)'
      }, g);

      // Midpoint of quadratic bezier at t=0.5
      const mx = 0.25 * fx + 0.5 * cx + 0.25 * tx;
      const my = 0.25 * fy + 0.5 * cy + 0.25 * ty;

      if (rel.label) {
        const lw = Math.max(44, rel.label.length * 11 + 18);
        el('rect', {
          x: mx - lw / 2,
          y: my - 11,
          width: lw,
          height: 22,
          rx: 11,
          fill: rel.color || '#6366f1'
        }, g);
        const t = el('text', {
          x: mx,
          y: my + 4,
          'text-anchor': 'middle',
          fill: '#ffffff',
          'font-size': 11,
          'font-weight': 600
        }, g);
        t.textContent = rel.label;
      }

      if (selected) {
        // Draggable control point handle
        el('line', { x1: fx, y1: fy, x2: cx, y2: cy, stroke: '#94a3b8', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, g);
        el('line', { x1: tx, y1: ty, x2: cx, y2: cy, stroke: '#94a3b8', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, g);
        el('circle', {
          cx, cy, r: 6,
          fill: '#ffffff',
          stroke: rel.color || '#6366f1',
          'stroke-width': 2.5,
          class: 'rel-handle',
          'data-rel-handle': rel.id
        }, g);
      }
    }
  }

  _renderCallouts(callouts) {
    for (const c of callouts) {
      const g = el('g', { class: 'callout-group' }, this.layers.callouts);
      const w = Math.max(76, c.text.length * 12 + 22);
      const h = 26;
      const x = c.x;
      const y = c.y;
      const tailX = Math.min(x + w - 12, Math.max(x + 12, c.anchorX));
      el('path', {
        d: `M ${x + 8} ${y} H ${x + w - 8} Q ${x + w} ${y} ${x + w} ${y + 8} V ${y + h - 8} Q ${x + w} ${y + h} ${x + w - 8} ${y + h} H ${tailX + 7} L ${c.anchorX} ${c.anchorY - 2} L ${tailX - 5} ${y + h} H ${x + 8} Q ${x} ${y + h} ${x} ${y + h - 8} V ${y + 8} Q ${x} ${y} ${x + 8} ${y} Z`,
        fill: c.color,
        filter: 'url(#node-shadow)'
      }, g);
      const t = el('text', {
        x: x + w / 2,
        y: y + 17,
        'text-anchor': 'middle',
        fill: '#ffffff',
        'font-size': 11.5,
        'font-weight': 600
      }, g);
      t.textContent = c.text;
    }
  }

  _renderNodeShape(g, item, selected) {
    const { x, y, w, h, visual, depth } = item;
    const stroke = selected ? '#4f46e5' : visual.border;
    const strokeW = selected ? 2.6 : (depth === 0 ? 2 : 1.5);
    const fill = visual.fill;

    if (item.isTableCell) {
      const cellFill = depth === 0 ? visual.fill : (depth === 1 ? `${visual.branchColor}20` : visual.fill);
      el('rect', {
        x, y, width: w, height: h, rx: 0,
        fill: cellFill,
        stroke: selected ? '#4f46e5' : (depth <= 1 ? visual.branchColor : visual.border),
        'stroke-width': selected ? 2.5 : 1.3,
        class: 'node-shape'
      }, g);
      return;
    }

    if (visual.shape === 'underline') {
      el('rect', { x, y, width: w, height: h, fill: selected ? 'rgba(79,70,229,0.08)' : 'transparent', rx: 6, class: 'node-shape' }, g);
      el('line', { x1: x + 2, y1: y + h - 1, x2: x + w - 2, y2: y + h - 1, stroke: selected ? '#4f46e5' : visual.branchColor, 'stroke-width': 2.2 }, g);
      return;
    }

    if (visual.shape === 'diamond') {
      const pts = `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
      el('polygon', { points: pts, fill, stroke, 'stroke-width': strokeW, filter: 'url(#node-shadow)', class: 'node-shape' }, g);
      return;
    }

    if (visual.shape === 'hexagon') {
      const cut = 14;
      const pts = `${x + cut},${y} ${x + w - cut},${y} ${x + w},${y + h / 2} ${x + w - cut},${y + h} ${x + cut},${y + h} ${x},${y + h / 2}`;
      el('polygon', { points: pts, fill, stroke, 'stroke-width': strokeW, filter: 'url(#node-shadow)', class: 'node-shape' }, g);
      return;
    }

    const hasMedia = Boolean(item.node.image || item.node.video);
    const rx = visual.shape === 'pill'
      ? (hasMedia ? 16 : h / 2)
      : visual.shape === 'rect' ? 3 : (depth === 0 ? 12 : 9);
    el('rect', {
      x, y, width: w, height: h, rx,
      fill, stroke, 'stroke-width': strokeW,
      filter: 'url(#node-shadow)',
      class: 'node-shape'
    }, g);

    if (selected) {
      el('rect', {
        x: x - 3, y: y - 3, width: w + 6, height: h + 6, rx: rx + 3,
        fill: 'none', stroke: '#4f46e5', 'stroke-width': 1.5, opacity: 0.4
      }, g);
    }
  }

  _renderNodes(nodeMap, matchedIds) {
    for (const item of nodeMap.values()) {
      const { node, x, y, w, h, visual, box } = item;
      const selected = store.selectedNodeId === node.id;
      const isDimmed = matchedIds && !matchedIds.has(node.id);
      const isMatch = matchedIds && matchedIds.has(node.id);

      const g = el('g', {
        class: `node-group${selected ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}${isMatch ? ' match-highlight' : ''}`,
        'data-node-id': node.id,
        'data-floating-id': item.floatingId || ''
      }, this.layers.nodes);

      this._renderNodeShape(g, item, selected);

      let curX = x + box.padX;
      const contentTop = y + box.padY;

      // Optional embedded image (clickable for lightbox)
      let textTop = contentTop;
      if (node.image) {
        const imgW = 148;
        const imgH = 86;
        const ix = x + (w - imgW) / 2;
        const imgClipId = `clip_img_${node.id}`;
        const cp = el('clipPath', { id: imgClipId }, g);
        el('rect', { x: ix, y: textTop, width: imgW, height: imgH, rx: 7 }, cp);
        const ig = el('g', { class: 'node-image-btn', 'data-img-node': node.id, style: 'cursor:pointer' }, g);
        el('image', {
          href: node.image,
          x: ix,
          y: textTop,
          width: imgW,
          height: imgH,
          preserveAspectRatio: 'xMidYMid slice',
          'clip-path': `url(#${imgClipId})`
        }, ig);
        el('rect', { x: ix, y: textTop, width: imgW, height: imgH, rx: 7, fill: 'none', stroke: 'rgba(15,23,42,0.12)', 'stroke-width': 1 }, ig);
        el('title', {}, ig).textContent = '點擊放大檢視圖片';
        textTop += 96;
      }

      // Optional embedded video thumbnail + Play Button overlay
      if (node.video) {
        const vw = 164;
        const vh = 94;
        const vx = x + (w - vw) / 2;
        const vy = textTop;
        const vidClipId = `clip_vid_${node.id}`;
        const cp = el('clipPath', { id: vidClipId }, g);
        el('rect', { x: vx, y: vy, width: vw, height: vh, rx: 8 }, cp);

        const vg = el('g', { class: 'node-video-btn', 'data-video-node': node.id, style: 'cursor:pointer' }, g);
        // Dark cinema poster backdrop
        el('rect', { x: vx, y: vy, width: vw, height: vh, rx: 8, fill: '#0f172a' }, vg);

        if (node.video.thumbnail) {
          el('image', {
            href: node.video.thumbnail,
            x: vx,
            y: vy,
            width: vw,
            height: vh,
            preserveAspectRatio: 'xMidYMid slice',
            'clip-path': `url(#${vidClipId})`
          }, vg);
          // Subtle scrim so play button pops
          el('rect', { x: vx, y: vy, width: vw, height: vh, rx: 8, fill: 'rgba(15, 23, 42, 0.28)' }, vg);
        } else {
          // Stylish gradient-like fallback poster with film label
          el('rect', { x: vx, y: vy, width: vw, height: vh, rx: 8, fill: '#1e1b4b' }, vg);
          const vLabel = el('text', { x: vx + vw / 2, y: vy + vh - 12, 'text-anchor': 'middle', fill: '#cbd5e1', 'font-size': 10, 'font-weight': 600 }, vg);
          vLabel.textContent = (node.video.name || node.video.title || '影片').slice(0, 18);
        }

        // Centered Circular Play Button
        const pcx = vx + vw / 2;
        const pcy = vy + vh / 2;
        el('circle', { cx: pcx, cy: pcy, r: 19, fill: 'rgba(15, 23, 42, 0.72)', stroke: '#ffffff', 'stroke-width': 2 }, vg);
        el('polygon', {
          points: `${pcx - 5},${pcy - 8} ${pcx - 5},${pcy + 8} ${pcx + 9},${pcy}`,
          fill: '#ffffff'
        }, vg);

        // Video badge (duration or cloud icon)
        const badgeText = node.video.duration || (node.video.sourceType === 'youtube' ? 'YT' : node.video.driveFileId ? '☁️' : 'VIDEO');
        const bw = Math.max(30, badgeText.length * 7 + 12);
        el('rect', { x: vx + vw - bw - 6, y: vy + vh - 20, width: bw, height: 15, rx: 4, fill: 'rgba(0,0,0,0.72)' }, vg);
        const bt = el('text', { x: vx + vw - bw / 2 - 6, y: vy + vh - 9, 'text-anchor': 'middle', fill: '#ffffff', 'font-size': 9.5, 'font-weight': 700 }, vg);
        bt.textContent = badgeText;

        el('title', {}, vg).textContent = `點擊播放影片：${node.video.name || node.video.title || '影片'}`;
        textTop += 104;
      }

      const firstLineMidY = textTop + box.lineHeight * 0.55;

      // To-Do Checkbox or Roll-up Progress Ring
      if (node.todo) {
        const cbG = el('g', { class: 'todo-toggle', 'data-todo-id': node.id, style: 'cursor:pointer' }, g);
        el('rect', {
          x: curX,
          y: firstLineMidY - 8,
          width: 15,
          height: 15,
          rx: 4,
          fill: node.todo.checked ? '#10b981' : 'transparent',
          stroke: node.todo.checked ? '#10b981' : visual.color,
          'stroke-width': 1.6
        }, cbG);
        if (node.todo.checked) {
          el('path', {
            d: `M ${curX + 3.5} ${firstLineMidY} L ${curX + 6.5} ${firstLineMidY + 3} L ${curX + 11.5} ${firstLineMidY - 3.5}`,
            fill: 'none', stroke: '#ffffff', 'stroke-width': 2, 'stroke-linecap': 'round'
          }, cbG);
        }
        curX += 21;
      } else {
        const rollup = store.getTodoRollup(node);
        if (rollup.total > 0) {
          const pct = rollup.done / rollup.total;
          const r = 6.5;
          const circ = 2 * Math.PI * r;
          el('circle', { cx: curX + 7, cy: firstLineMidY, r, fill: 'none', stroke: '#cbd5e1', 'stroke-width': 2.4 }, g);
          el('circle', {
            cx: curX + 7, cy: firstLineMidY, r,
            fill: 'none', stroke: '#10b981', 'stroke-width': 2.4,
            'stroke-dasharray': `${circ * pct} ${circ}`,
            transform: `rotate(-90 ${curX + 7} ${firstLineMidY})`
          }, g);
          curX += 20;
        }
      }

      // Markers
      if (node.markers && node.markers.length) {
        for (const mId of node.markers) {
          const emoji = MARKER_MAP[mId] || mId;
          const mt = el('text', { x: curX, y: firstLineMidY + 4.5, 'font-size': 13 }, g);
          mt.textContent = emoji;
          curX += 20;
        }
      }

      // Title lines
      box.lines.forEach((line, idx) => {
        const t = el('text', {
          x: curX,
          y: textTop + box.lineHeight * (idx + 0.76),
          fill: visual.color,
          'font-size': visual.fontSize,
          'font-weight': visual.fontWeight,
          'font-style': visual.fontStyle,
          'text-decoration': node.todo?.checked ? 'line-through' : 'none',
          opacity: node.todo?.checked ? 0.65 : 1
        }, g);
        t.textContent = line;
      });

      // Right-side indicator badges (Attachments, Note, Link, Task)
      let bx = x + w - box.padX - 6;
      if (node.attachments && node.attachments.length > 0) {
        const ag = el('g', { class: 'node-att-btn', 'data-att-node': node.id, style: 'cursor:pointer' }, g);
        const aw = 32;
        el('rect', {
          x: bx - aw + 8,
          y: firstLineMidY - 9,
          width: aw,
          height: 17,
          rx: 8,
          fill: visual.branchColor,
          opacity: 0.18
        }, ag);
        const at = el('text', {
          x: bx - aw / 2 + 8,
          y: firstLineMidY + 3.5,
          'text-anchor': 'middle',
          fill: visual.branchColor,
          'font-size': 10.5,
          'font-weight': 700
        }, ag);
        at.textContent = `📎${node.attachments.length}`;
        el('title', {}, ag).textContent = `檢視 ${node.attachments.length} 個附加檔案`;
        bx -= 38;
      }
      if (node.link) {
        const lg = el('g', { class: 'node-link-btn', 'data-link': node.link, style: 'cursor:pointer' }, g);
        const lt = el('text', { x: bx, y: firstLineMidY + 4, 'text-anchor': 'middle', 'font-size': 12 }, lg);
        lt.textContent = '🔗';
        el('title', {}, lg).textContent = `開啟連結：${node.link}`;
        bx -= 19;
      }
      if (node.notes) {
        const ng = el('g', {}, g);
        const nt = el('text', { x: bx, y: firstLineMidY + 4, 'text-anchor': 'middle', 'font-size': 12 }, ng);
        nt.textContent = '📝';
        el('title', {}, ng).textContent = node.notes;
        bx -= 19;
      }
      if (node.task) {
        const tg = el('g', {}, g);
        const tt = el('text', { x: bx, y: firstLineMidY + 4, 'text-anchor': 'middle', 'font-size': 12 }, tg);
        tt.textContent = '📅';
        el('title', {}, tg).textContent = `任務：${node.task.start || ''} ~ ${node.task.end || ''} (${node.task.progress || 0}%)`;
      }

      // Labels chips at bottom of node
      if (node.labels && node.labels.length) {
        let lx = x + box.padX;
        const ly = y + h - 20;
        for (const lbl of node.labels) {
          const lw = Math.max(30, lbl.length * 10 + 14);
          if (lx + lw > x + w - 4) break;
          el('rect', { x: lx, y: ly, width: lw, height: 15, rx: 7, fill: visual.branchColor, opacity: 0.16 }, g);
          const lt = el('text', { x: lx + lw / 2, y: ly + 11, 'text-anchor': 'middle', fill: visual.branchColor, 'font-size': 10, 'font-weight': 600 }, g);
          lt.textContent = lbl;
          lx += lw + 4;
        }
      }

      // Collapse / Expand badge (positioned smartly by layout axis)
      const isVerticalDown = item.layoutAxis === 'vertical-down';
      const isTreeVertical = item.layoutAxis === 'tree-vertical';
      const hasVisibleCollapse = node.children && node.children.length > 0 && item.depth > 0;

      if (hasVisibleCollapse) {
        const cx = isVerticalDown ? (x + w / 2) : (item.dir === -1 ? x - 11 : x + w + 11);
        const cy = isVerticalDown ? (y + h + 11) : (y + h / 2);
        const colG = el('g', { class: 'collapse-badge', 'data-collapse-id': node.id }, g);
        el('circle', {
          cx, cy, r: 9,
          fill: node.collapsed ? visual.branchColor : '#ffffff',
          stroke: visual.branchColor,
          'stroke-width': 1.6
        }, colG);
        const ct = el('text', {
          x: cx, y: cy + 3.5,
          'text-anchor': 'middle',
          fill: node.collapsed ? '#ffffff' : visual.branchColor,
          'font-size': 9.5,
          'font-weight': 700
        }, colG);
        ct.textContent = node.collapsed ? `+${store.countDescendants(node)}` : '−';
      }

      // XMind-style Dual Quick-Add Buttons on hover/select:
      // 1) Purple (+) = Add Child / Sub-branch (Tab)
      const childBtnX = isVerticalDown
        ? (x + w / 2)
        : (item.dir === -1 ? x - (hasVisibleCollapse ? 28 : 14) : x + w + (hasVisibleCollapse ? 28 : 14));
      const childBtnY = isVerticalDown
        ? (y + h + (hasVisibleCollapse ? 29 : 14))
        : (y + h / 2);
      const childLabel = item.depth === 0 ? '新增主主題 (Tab)' : item.depth === 1 ? '新增子主題 (Tab)' : '新增分子題 (Tab)';

      const qG = el('g', { class: 'node-quick-add', 'data-quick-add': node.id, style: 'cursor:pointer' }, g);
      el('circle', { cx: childBtnX, cy: childBtnY, r: 9.5, fill: '#4f46e5', stroke: '#ffffff', 'stroke-width': 1.4 }, qG);
      const qt = el('text', { x: childBtnX, y: childBtnY + 4, 'text-anchor': 'middle', fill: '#ffffff', 'font-size': 13, 'font-weight': 700 }, qG);
      qt.textContent = '+';
      el('title', {}, qG).textContent = childLabel;

      // 2) Teal (+) = Add Sibling Topic (Enter) — placed directly in sibling direction!
      if (item.depth > 0 && !item.floatingId) {
        const sibBtnX = isVerticalDown ? (x + w + 14) : isTreeVertical ? (x + 22) : (x + w / 2);
        const sibBtnY = isVerticalDown ? (y + h / 2) : (y + h + 13);
        const sG = el('g', { class: 'node-quick-add', 'data-quick-sibling': node.id, style: 'cursor:pointer' }, g);
        el('circle', { cx: sibBtnX, cy: sibBtnY, r: 9.5, fill: '#0d9488', stroke: '#ffffff', 'stroke-width': 1.4 }, sG);
        const st = el('text', { x: sibBtnX, y: sibBtnY + 4, 'text-anchor': 'middle', fill: '#ffffff', 'font-size': 13, 'font-weight': 700 }, sG);
        st.textContent = '+';
        el('title', {}, sG).textContent = '新增同層主題 (Enter)';
      }
    }
  }

  _renderInlineEditor() {
    const id = store.editingNodeId;
    if (!id || store.viewMode !== 'canvas') {
      this.inlineWrap.classList.add('hidden');
      return;
    }
    const item = this.layout?.nodeMap.get(id);
    if (!item) {
      this.inlineWrap.classList.add('hidden');
      return;
    }
    const pos = this.worldToScreen(item.x, item.y);
    this.inlineWrap.classList.remove('hidden');
    this.inlineWrap.style.left = `${pos.x}px`;
    this.inlineWrap.style.top = `${pos.y}px`;
    this.inlineEditor.style.minWidth = `${Math.max(110, item.w * this.scale)}px`;
    this.inlineEditor.style.fontSize = `${Math.max(12, Math.round(item.visual.fontSize * this.scale))}px`;

    if (document.activeElement !== this.inlineEditor) {
      this.inlineEditor.value = item.node.title;
      this._autoResizeInline();
      this.inlineEditor.focus();
      this.inlineEditor.select();
      requestAnimationFrame(() => {
        if (store.editingNodeId === id) {
          this.inlineEditor.focus();
          this.inlineEditor.select();
        }
      });
    }
  }

  _autoResizeInline() {
    this.inlineEditor.style.height = 'auto';
    this.inlineEditor.style.height = `${this.inlineEditor.scrollHeight + 4}px`;
  }

  _commitInlineEdit() {
    const id = store.editingNodeId;
    if (!id) return;
    const val = this.inlineEditor.value.trim() || '未命名主題';
    const node = store.findNode(id);
    store.stopEditing();
    if (node && node.title !== val) {
      store.updateNode(id, { title: val });
    }
  }

  _positionFloatingToolbar() {
    const id = store.selectedNodeId;
    if (!id || store.editingNodeId || store.viewMode !== 'canvas' || store.zenMode) {
      this.floatingToolbar.classList.add('hidden');
      return;
    }
    const item = this.layout?.nodeMap.get(id);
    if (!item) {
      this.floatingToolbar.classList.add('hidden');
      return;
    }
    const pos = this.worldToScreen(item.x + item.w / 2, item.y - 12);
    const rect = this.svg.getBoundingClientRect();
    const isRoot = id === store.getActiveSheet().root.id;
    const childBtnText = isRoot ? '＋主主題' : (item.depth >= 2 ? '＋分子題' : '＋子主題');
    this.floatingToolbar.innerHTML = `
      <button class="ft-btn" data-ft="child" title="新增下一層主題 (Tab)">${childBtnText}</button>
      <button class="ft-btn" data-ft="sibling" title="新增同層兄弟主題 (Enter)">＋同層</button>
      <button class="ft-btn" data-ft="files" title="從本機或連結批次新增檔案">📎檔案</button>
      <button class="ft-btn" data-ft="rel" title="建立關聯線">↗關聯</button>
      <button class="ft-btn" data-ft="boundary" title="外框">▢外框</button>
      <button class="ft-btn" data-ft="summary" title="概要">｝概要</button>
      <button class="ft-btn" data-ft="callout" title="標註">💬標註</button>
      <button class="ft-btn" data-ft="todo" title="待辦勾選">☑待辦</button>
      ${!isRoot ? '<button class="ft-btn danger" data-ft="delete" title="刪除 (Delete)">✕</button>' : ''}
    `;
    this.floatingToolbar.classList.remove('hidden');
    const tbW = this.floatingToolbar.offsetWidth || 380;
    const clampedX = Math.max(tbW / 2 + 12, Math.min(rect.width - tbW / 2 - 12, pos.x));
    this.floatingToolbar.style.left = `${clampedX}px`;
    this.floatingToolbar.style.top = `${Math.max(46, pos.y)}px`;
  }

  _renderBanner() {
    if (store.connectingFromId) {
      this.canvasBanner.classList.remove('hidden');
      this.canvasBanner.innerHTML = `
        <span>🔗 關聯線模式：請點擊目標節點以完成連線</span>
        <button id="cancel-connect-btn">取消 (Esc)</button>
      `;
      this.canvasBanner.querySelector('#cancel-connect-btn').onclick = () => store.setConnectingMode(null);
      return;
    }
    if (store.hasActiveFilter()) {
      const matched = store.getMatchedNodeIds();
      this.canvasBanner.classList.remove('hidden');
      this.canvasBanner.innerHTML = `
        <span>🔍 篩選中：符合 ${matched ? matched.size : 0} 個主題</span>
        <button id="clear-filter-banner-btn">清除篩選</button>
      `;
      this.canvasBanner.querySelector('#clear-filter-banner-btn').onclick = () => store.clearFilters();
      return;
    }
    this.canvasBanner.classList.add('hidden');
  }

  _renderMinimap() {
    this.minimapPanel.classList.toggle('hidden', !store.showMinimap || store.viewMode !== 'canvas');
    if (!store.showMinimap || !this.layout) return;

    const { bounds, nodeMap } = this.layout;
    const bw = Math.max(100, bounds.maxX - bounds.minX);
    const bh = Math.max(100, bounds.maxY - bounds.minY);
    this.minimapSvg.setAttribute('viewBox', `${bounds.minX} ${bounds.minY} ${bw} ${bh}`);
    this.minimapSvg.innerHTML = '';

    for (const item of nodeMap.values()) {
      el('rect', {
        x: item.x, y: item.y, width: item.w, height: item.h, rx: 4,
        fill: item.id === store.selectedNodeId ? '#4f46e5' : item.visual.branchColor,
        opacity: item.depth === 0 ? 1 : 0.72
      }, this.minimapSvg);
    }
    el('rect', {
      id: 'minimap-viewport-rect',
      fill: 'rgba(79, 70, 229, 0.14)',
      stroke: '#4f46e5',
      'stroke-width': Math.max(4, bw / 90)
    }, this.minimapSvg);
    this._updateMinimapViewport();
  }

  _updateMinimapViewport() {
    const vr = this.minimapSvg.querySelector('#minimap-viewport-rect');
    if (!vr) return;
    const rect = this.svg.getBoundingClientRect();
    const tl = this.screenToWorld(rect.left, rect.top);
    const br = this.screenToWorld(rect.right, rect.bottom);
    vr.setAttribute('x', tl.x);
    vr.setAttribute('y', tl.y);
    vr.setAttribute('width', Math.max(20, br.x - tl.x));
    vr.setAttribute('height', Math.max(20, br.y - tl.y));
  }

  _bindEvents() {
    // Inline editor events
    this.inlineEditor.addEventListener('input', () => this._autoResizeInline());
    this.inlineEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._commitInlineEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        store.stopEditing();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const id = store.editingNodeId;
        this._commitInlineEdit();
        store.addChild(id);
      }
    });
    this.inlineEditor.addEventListener('blur', () => this._commitInlineEdit());

    // Floating toolbar click delegation
    this.floatingToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ft]');
      if (!btn) return;
      const act = btn.dataset.ft;
      const id = store.selectedNodeId;
      if (act === 'child') store.addChild(id);
      else if (act === 'sibling') store.addSibling(id);
      else if (act === 'files') {
        const node = store.findNode(id);
        if (node && this.onOpenAttachments) this.onOpenAttachments(node);
      }
      else if (act === 'rel') store.setConnectingMode(id);
      else if (act === 'boundary') store.toggleBoundary(id);
      else if (act === 'summary') store.toggleSummary(id);
      else if (act === 'callout') store.toggleCallout(id);
      else if (act === 'todo') {
        const node = store.findNode(id);
        store.updateNode(id, { todo: node.todo ? null : { checked: false } });
      } else if (act === 'delete') store.deleteNode(id);
    });

    // Wheel zoom
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 0.91;
      this.setZoom(this.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Pointer down
    this.svg.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;

      // Relationship control handle drag
      const relHandle = e.target.closest('[data-rel-handle]');
      if (relHandle) {
        e.stopPropagation();
        const relId = relHandle.dataset.relHandle;
        const rel = store.getActiveSheet().relationships.find(r => r.id === relId);
        if (rel) {
          this.draggingRel = {
            relId,
            startX: e.clientX,
            startY: e.clientY,
            origOffset: { ...(rel.controlOffset || { x: 0, y: -70 }) }
          };
        }
        return;
      }

      // Video play button click
      const videoBtn = e.target.closest('.node-video-btn');
      if (videoBtn) {
        e.stopPropagation();
        const node = store.findNode(videoBtn.dataset.videoNode);
        if (node && this.onOpenVideo) this.onOpenVideo(node);
        return;
      }

      // Image click -> Lightbox
      const imgBtn = e.target.closest('.node-image-btn');
      if (imgBtn) {
        e.stopPropagation();
        const node = store.findNode(imgBtn.dataset.imgNode);
        if (node && this.onOpenImage) this.onOpenImage(node);
        return;
      }

      // Attachments badge click
      const attBtn = e.target.closest('.node-att-btn');
      if (attBtn) {
        e.stopPropagation();
        const node = store.findNode(attBtn.dataset.attNode);
        if (node && this.onOpenAttachments) this.onOpenAttachments(node, 'list');
        return;
      }

      // Link badge click
      const linkBtn = e.target.closest('.node-link-btn');
      if (linkBtn) {
        e.stopPropagation();
        const url = linkBtn.dataset.link;
        if (url && /^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
        return;
      }

      // To-Do toggle click
      const todoBtn = e.target.closest('.todo-toggle');
      if (todoBtn) {
        e.stopPropagation();
        const id = todoBtn.dataset.todoId;
        const node = store.findNode(id);
        if (node?.todo) store.updateNode(id, { todo: { checked: !node.todo.checked } });
        return;
      }

      // Collapse toggle click
      const colBtn = e.target.closest('.collapse-badge');
      if (colBtn) {
        e.stopPropagation();
        store.toggleCollapse(colBtn.dataset.collapseId);
        return;
      }

      // Quick Add Child (+) click
      const quickAdd = e.target.closest('[data-quick-add]');
      if (quickAdd) {
        e.stopPropagation();
        store.addChild(quickAdd.dataset.quickAdd);
        return;
      }

      // Quick Add Sibling (+) click
      const quickSib = e.target.closest('[data-quick-sibling]');
      if (quickSib) {
        e.stopPropagation();
        store.addSibling(quickSib.dataset.quickSibling);
        return;
      }

      // Relationship click (with reliable double-click detection across SVG re-renders)
      const relGroup = e.target.closest('.rel-group');
      if (relGroup) {
        e.stopPropagation();
        const relId = relGroup.dataset.relId;
        const now = Date.now();
        if (
          this._lastClick &&
          now - this._lastClick.time < 420 &&
          this._lastClick.relId === relId &&
          Math.hypot(e.clientX - this._lastClick.x, e.clientY - this._lastClick.y) < 18
        ) {
          e.preventDefault();
          this._lastClick = null;
          const rel = store.getActiveSheet().relationships.find(r => r.id === relId);
          if (rel) {
            const next = prompt('編輯關聯線文字：', rel.label || '');
            if (next !== null) store.updateRelationship(relId, { label: next });
          }
          return;
        }
        this._lastClick = { time: now, nodeId: null, relId, x: e.clientX, y: e.clientY };
        store.selectRelationship(relId);
        return;
      }

      // Node click / double-click to edit / start drag
      const nodeGroup = e.target.closest('.node-group');
      if (nodeGroup && e.button === 0) {
        e.stopPropagation();
        const id = nodeGroup.dataset.nodeId;
        const floatingId = nodeGroup.dataset.floatingId || null;

        if (store.connectingFromId) {
          if (store.connectingFromId !== id) {
            store.addRelationship(store.connectingFromId, id);
          } else {
            store.setConnectingMode(null);
          }
          return;
        }

        const now = Date.now();
        if (
          this._lastClick &&
          now - this._lastClick.time < 420 &&
          this._lastClick.nodeId === id &&
          Math.hypot(e.clientX - this._lastClick.x, e.clientY - this._lastClick.y) < 18
        ) {
          e.preventDefault();
          this._lastClick = null;
          this.draggingNode = null;
          store.startEditing(id);
          return;
        }
        this._lastClick = { time: now, nodeId: id, relId: null, x: e.clientX, y: e.clientY };

        store.selectNode(id);

        if (id !== store.getActiveSheet().root.id) {
          const item = this.layout.nodeMap.get(id);
          this.draggingNode = {
            id,
            depth: item.depth,
            floatingId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            origX: item.x,
            origY: item.y,
            autoX: item.autoX !== undefined ? item.autoX : item.x,
            autoY: item.autoY !== undefined ? item.autoY : item.y,
            moved: false,
            targetId: null
          };
        }
        return;
      }

      // Empty background -> pan & deselect
      this._lastClick = null;
      if (store.connectingFromId) store.setConnectingMode(null);
      store.selectNode(null);
      this.panning = true;
      this.svg.classList.add('panning');
      this.panStart = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
    });

    // Double click -> Fallback edit node OR create Floating Topic on blank canvas
    this.svg.addEventListener('dblclick', (e) => {
      const nodeGroup = e.target.closest('.node-group');
      if (nodeGroup) {
        e.stopPropagation();
        e.preventDefault();
        store.startEditing(nodeGroup.dataset.nodeId);
        return;
      }
      const relGroup = e.target.closest('.rel-group');
      if (relGroup) {
        const relId = relGroup.dataset.relId;
        const rel = store.getActiveSheet().relationships.find(r => r.id === relId);
        if (rel) {
          const next = prompt('編輯關聯線文字：', rel.label || '');
          if (next !== null) store.updateRelationship(relId, { label: next });
        }
        return;
      }
      // Blank canvas double-click -> Create Floating Topic (XMind signature UX!)
      const world = this.screenToWorld(e.clientX, e.clientY);
      store.addFloatingTopic(world.x - 50, world.y);
    });

    // Global mousemove
    window.addEventListener('mousemove', (e) => {
      if (this.panning) {
        this.tx = this.panStart.tx + (e.clientX - this.panStart.x);
        this.ty = this.panStart.ty + (e.clientY - this.panStart.y);
        this.applyTransform();
        return;
      }

      if (this.draggingRel) {
        const dx = (e.clientX - this.draggingRel.startX) / this.scale;
        const dy = (e.clientY - this.draggingRel.startY) / this.scale;
        const rel = store.getActiveSheet().relationships.find(r => r.id === this.draggingRel.relId);
        if (rel) {
          rel.controlOffset = {
            x: Math.round(this.draggingRel.origOffset.x + dx * 2),
            y: Math.round(this.draggingRel.origOffset.y + dy * 2)
          };
          this.layers.relationships.innerHTML = '';
          this._renderRelationships(store.getActiveSheet().relationships, this.layout.nodeMap);
        }
        return;
      }

      if (this.draggingNode) {
        const dx = e.clientX - this.draggingNode.startClientX;
        const dy = e.clientY - this.draggingNode.startClientY;
        if (!this.draggingNode.moved && Math.hypot(dx, dy) < 6) return;
        this.draggingNode.moved = true;

        const world = this.screenToWorld(e.clientX, e.clientY);
        this.layers.overlay.innerHTML = '';

        // Draw translucent drag ghost
        const item = this.layout.nodeMap.get(this.draggingNode.id);
        el('rect', {
          x: world.x - item.w / 2,
          y: world.y - item.h / 2,
          width: item.w,
          height: item.h,
          rx: 8,
          fill: 'rgba(79, 70, 229, 0.18)',
          stroke: '#4f46e5',
          'stroke-width': 2,
          'stroke-dasharray': '5 3'
        }, this.layers.overlay);

        // Hit-test drop targets
        let bestTarget = null;
        for (const [nid, candidate] of this.layout.nodeMap.entries()) {
          if (nid === this.draggingNode.id) continue;
          if (store.isDescendant(this.draggingNode.id, nid)) continue;
          if (
            world.x >= candidate.x - 16 &&
            world.x <= candidate.x + candidate.w + 16 &&
            world.y >= candidate.y - 12 &&
            world.y <= candidate.y + candidate.h + 12
          ) {
            bestTarget = candidate;
            break;
          }
        }

        // Highlight target
        this.layers.nodes.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
        if (bestTarget) {
          this.draggingNode.targetId = bestTarget.id;
          const relY = (world.y - bestTarget.y) / bestTarget.h;
          this.draggingNode.dropPos = (bestTarget.id === store.getActiveSheet().root.id)
            ? 'inside'
            : (relY < 0.25 ? 'before' : relY > 0.75 ? 'after' : 'inside');
          const elTarget = this.layers.nodes.querySelector(`[data-node-id="${bestTarget.id}"]`);
          if (elTarget) elTarget.classList.add('drop-target');
        } else {
          this.draggingNode.targetId = null;
        }
      }
    });

    // Global mouseup
    window.addEventListener('mouseup', (e) => {
      if (this.panning) {
        this.panning = false;
        this.svg.classList.remove('panning');
      }
      if (this.draggingRel) {
        const rel = store.getActiveSheet().relationships.find(r => r.id === this.draggingRel.relId);
        if (rel) store.updateRelationship(rel.id, { controlOffset: rel.controlOffset });
        this.draggingRel = null;
      }
      if (this.draggingNode) {
        const drag = this.draggingNode;
        this.draggingNode = null;
        this.layers.overlay.innerHTML = '';
        this.layers.nodes.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));

        if (drag.moved) {
          if (drag.targetId) {
            store.moveNode(drag.id, drag.targetId, drag.dropPos || 'inside');
          } else if (drag.floatingId) {
            const world = this.screenToWorld(e.clientX, e.clientY);
            store.moveFloatingTopic(drag.floatingId, world.x - 40, world.y);
          } else if (drag.depth === 1) {
            // XMind-style Main Branch Free-Positioning!
            const sheet = store.getActiveSheet();
            const deltaX = (e.clientX - drag.startClientX) / this.scale;
            const deltaY = (e.clientY - drag.startClientY) / this.scale;
            const newX = drag.origX + deltaX;
            const newY = drag.origY + deltaY;
            const rootItem = this.layout?.rootItem;
            const curNode = store.findNode(drag.id);

            if (sheet.structure === 'mindmap' && rootItem && curNode) {
              const rootMidX = rootItem.x + rootItem.w / 2;
              const droppedCenterX = newX + (this.layout.nodeMap.get(drag.id)?.w || 100) / 2;
              const targetSide = droppedCenterX < rootMidX ? 'left' : 'right';
              const prevSide = this.layout.nodeMap.get(drag.id)?.dir === -1 ? 'left' : 'right';
              if (targetSide !== prevSide) {
                // Crossed center line -> flip side cleanly & reset offset for natural balance
                store.setBranchOffset(drag.id, 0, Math.round(newY - drag.autoY), targetSide);
              } else {
                store.setBranchOffset(drag.id, Math.round(newX - drag.autoX), Math.round(newY - drag.autoY));
              }
            } else {
              store.setBranchOffset(drag.id, Math.round(newX - drag.autoX), Math.round(newY - drag.autoY));
            }
          }
        }
      }
    });

    // Minimap click-to-pan
    this.minimapSvg.addEventListener('mousedown', (e) => {
      if (!this.layout) return;
      const rect = this.minimapSvg.getBoundingClientRect();
      const { bounds } = this.layout;
      const wx = bounds.minX + ((e.clientX - rect.left) / rect.width) * (bounds.maxX - bounds.minX);
      const wy = bounds.minY + ((e.clientY - rect.top) / rect.height) * (bounds.maxY - bounds.minY);
      const svgRect = this.svg.getBoundingClientRect();
      this.tx = svgRect.width / 2 - wx * this.scale;
      this.ty = svgRect.height / 2 - wy * this.scale;
      this.applyTransform();
    });

    // =========================================================================
    // Mobile & Tablet Multi-Touch Support:
    // - 1-finger pan on background
    // - 2-finger pinch-to-zoom & pan
    // - Tap node to select / quick-add / video play / collapse / todo
    // - Double-tap node to edit text, double-tap blank canvas for Floating Topic
    // - Long-press node (450ms) to drag & reparent
    // =========================================================================
    let touchMode = null; // 'pan' | 'pinch' | 'node-drag'
    let touchPanStart = null;
    let pinchStart = null;
    let lastTap = { time: 0, x: 0, y: 0, nodeId: null };
    let longPressTimer = null;

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    this.svg.addEventListener('touchstart', (e) => {
      clearLongPress();
      if (e.touches.length === 2) {
        e.preventDefault();
        touchMode = 'pinch';
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const rect = this.svg.getBoundingClientRect();
        pinchStart = {
          dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1,
          midX: (t0.clientX + t1.clientX) / 2 - rect.left,
          midY: (t0.clientY + t1.clientY) / 2 - rect.top,
          scale: this.scale,
          tx: this.tx,
          ty: this.ty
        };
        return;
      }

      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY);

      // Direct interactive SVG controls
      const videoBtn = target?.closest('.node-video-btn');
      if (videoBtn) {
        e.preventDefault();
        const node = store.findNode(videoBtn.dataset.videoNode);
        if (node && this.onOpenVideo) this.onOpenVideo(node);
        return;
      }
      const imgBtn = target?.closest('.node-image-btn');
      if (imgBtn) {
        e.preventDefault();
        const node = store.findNode(imgBtn.dataset.imgNode);
        if (node && this.onOpenImage) this.onOpenImage(node);
        return;
      }
      const attBtn = target?.closest('.node-att-btn');
      if (attBtn) {
        e.preventDefault();
        const node = store.findNode(attBtn.dataset.attNode);
        if (node && this.onOpenAttachments) this.onOpenAttachments(node);
        return;
      }
      const todoBtn = target?.closest('.todo-toggle');
      if (todoBtn) {
        e.preventDefault();
        const node = store.findNode(todoBtn.dataset.todoId);
        if (node?.todo) store.updateNode(node.id, { todo: { checked: !node.todo.checked } });
        return;
      }
      const colBtn = target?.closest('.collapse-badge');
      if (colBtn) {
        e.preventDefault();
        store.toggleCollapse(colBtn.dataset.collapseId);
        return;
      }
      const quickAdd = target?.closest('[data-quick-add]');
      if (quickAdd) {
        e.preventDefault();
        store.addChild(quickAdd.dataset.quickAdd);
        return;
      }
      const quickSib = target?.closest('[data-quick-sibling]');
      if (quickSib) {
        e.preventDefault();
        store.addSibling(quickSib.dataset.quickSibling);
        return;
      }

      const nodeGroup = target?.closest('.node-group');
      const now = Date.now();
      const isDoubleTap = (now - lastTap.time < 340) && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 32;

      if (nodeGroup) {
        e.preventDefault();
        const id = nodeGroup.dataset.nodeId;
        const floatingId = nodeGroup.dataset.floatingId || null;

        if (store.connectingFromId) {
          if (store.connectingFromId !== id) store.addRelationship(store.connectingFromId, id);
          else store.setConnectingMode(null);
          return;
        }

        if (isDoubleTap && lastTap.nodeId === id) {
          lastTap = { time: 0, x: 0, y: 0, nodeId: null };
          store.startEditing(id);
          return;
        }

        lastTap = { time: now, x: t.clientX, y: t.clientY, nodeId: id };
        store.selectNode(id, false);

        // Allow 1-finger panning if user drags immediately, OR long-press to reparent
        touchMode = 'pan';
        touchPanStart = { x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };

        if (id !== store.getActiveSheet().root.id) {
          longPressTimer = setTimeout(() => {
            const item = this.layout?.nodeMap.get(id);
            if (!item) return;
            touchMode = 'node-drag';
            this.draggingNode = {
              id,
              depth: item.depth,
              floatingId,
              startClientX: t.clientX,
              startClientY: t.clientY,
              origX: item.x,
              origY: item.y,
              autoX: item.autoX !== undefined ? item.autoX : item.x,
              autoY: item.autoY !== undefined ? item.autoY : item.y,
              moved: true,
              targetId: null
            };
            if (navigator.vibrate) navigator.vibrate(25);
          }, 420);
        }
        return;
      }

      // Blank canvas touch
      e.preventDefault();
      if (isDoubleTap && !lastTap.nodeId) {
        lastTap = { time: 0, x: 0, y: 0, nodeId: null };
        const world = this.screenToWorld(t.clientX, t.clientY);
        store.addFloatingTopic(world.x - 50, world.y);
        return;
      }
      lastTap = { time: now, x: t.clientX, y: t.clientY, nodeId: null };
      if (store.connectingFromId) store.setConnectingMode(null);
      store.selectNode(null, false);
      touchMode = 'pan';
      touchPanStart = { x: t.clientX, y: t.clientY, tx: this.tx, ty: this.ty };
    }, { passive: false });

    this.svg.addEventListener('touchmove', (e) => {
      if (touchMode === 'pinch' && e.touches.length === 2 && pinchStart) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const rect = this.svg.getBoundingClientRect();
        const curDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
        const curMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const curMidY = (t0.clientY + t1.clientY) / 2 - rect.top;
        const nextScale = Math.max(0.15, Math.min(3.0, pinchStart.scale * (curDist / pinchStart.dist)));
        const ratio = nextScale / pinchStart.scale;
        this.scale = nextScale;
        this.tx = curMidX - (pinchStart.midX - pinchStart.tx) * ratio;
        this.ty = curMidY - (pinchStart.midY - pinchStart.ty) * ratio;
        this.applyTransform();
        return;
      }

      if (e.touches.length !== 1) return;
      const t = e.touches[0];

      if (touchMode === 'pan' && touchPanStart) {
        const dx = t.clientX - touchPanStart.x;
        const dy = t.clientY - touchPanStart.y;
        if (Math.hypot(dx, dy) > 8) clearLongPress();
        e.preventDefault();
        this.tx = touchPanStart.tx + dx;
        this.ty = touchPanStart.ty + dy;
        this.applyTransform();
      } else if (touchMode === 'node-drag' && this.draggingNode) {
        e.preventDefault();
        const world = this.screenToWorld(t.clientX, t.clientY);
        this.layers.overlay.innerHTML = '';
        const item = this.layout.nodeMap.get(this.draggingNode.id);
        if (item) {
          el('rect', {
            x: world.x - item.w / 2,
            y: world.y - item.h / 2,
            width: item.w,
            height: item.h,
            rx: 8,
            fill: 'rgba(79, 70, 229, 0.2)',
            stroke: '#4f46e5',
            'stroke-width': 2.5,
            'stroke-dasharray': '5 3'
          }, this.layers.overlay);
        }
        let bestTarget = null;
        for (const [nid, cand] of this.layout.nodeMap.entries()) {
          if (nid === this.draggingNode.id || store.isDescendant(this.draggingNode.id, nid)) continue;
          if (world.x >= cand.x - 18 && world.x <= cand.x + cand.w + 18 && world.y >= cand.y - 14 && world.y <= cand.y + cand.h + 14) {
            bestTarget = cand;
            break;
          }
        }
        this.layers.nodes.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
        this.draggingNode.targetId = bestTarget ? bestTarget.id : null;
        this.draggingNode.dropPos = 'inside';
        if (bestTarget) {
          this.layers.nodes.querySelector(`[data-node-id="${bestTarget.id}"]`)?.classList.add('drop-target');
        }
      }
    }, { passive: false });

    this.svg.addEventListener('touchend', (e) => {
      clearLongPress();
      if (touchMode === 'node-drag' && this.draggingNode) {
        const drag = this.draggingNode;
        this.draggingNode = null;
        this.layers.overlay.innerHTML = '';
        this.layers.nodes.querySelectorAll('.drop-target').forEach(n => n.classList.remove('drop-target'));
        if (drag.targetId) {
          store.moveNode(drag.id, drag.targetId, drag.dropPos || 'inside');
        } else if (drag.floatingId && e.changedTouches?.[0]) {
          const world = this.screenToWorld(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
          store.moveFloatingTopic(drag.floatingId, world.x - 40, world.y);
        } else if (drag.depth === 1 && e.changedTouches?.[0]) {
          const ct = e.changedTouches[0];
          const newX = drag.origX + (ct.clientX - drag.startClientX) / this.scale;
          const newY = drag.origY + (ct.clientY - drag.startClientY) / this.scale;
          store.setBranchOffset(drag.id, Math.round(newX - drag.autoX), Math.round(newY - drag.autoY));
        }
      }
      if (e.touches.length === 0) {
        touchMode = null;
        touchPanStart = null;
        pinchStart = null;
      }
    });
  }
}
