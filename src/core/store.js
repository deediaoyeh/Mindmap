/**
 * Central Reactive Store for MindFlow.
 * Manages multi-document workspace, multi-sheet state, undo/redo history,
 * node CRUD, drag-and-drop reparenting, search/filter, and localStorage sync.
 */

import { createDocument, createNode, createSheet, createWelcomeDocument, uid } from './schema.js';

const STORAGE_DOCS_KEY = 'mindflow_docs_v1';
const STORAGE_ACTIVE_KEY = 'mindflow_active_doc_v1';
const STORAGE_UI_THEME_KEY = 'mindflow_ui_theme_v1';
const MAX_HISTORY = 60;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

class MindFlowStore {
  constructor() {
    this.listeners = new Set();
    this.docs = [];
    this.activeDocId = null;

    // Transient UI State
    this.selectedNodeId = null;
    this.selectedRelId = null;
    this.editingNodeId = null;
    this.viewMode = 'canvas'; // 'canvas' | 'outliner' | 'gantt'
    this.inspectorTab = 'map'; // 'map' | 'topic'
    this.inspectorOpen = typeof window !== 'undefined' ? window.innerWidth > 900 : true;
    this.leftDrawer = null; // null | 'works' | 'search'
    this.showMinimap = false;
    this.zenMode = false;
    this.uiTheme = localStorage.getItem(STORAGE_UI_THEME_KEY) || 'light';

    // Relationship drawing mode
    this.connectingFromId = null;

    // Style clipboard (Copy/Paste style)
    this.copiedStyle = null;

    // Search & Filter state
    this.searchQuery = '';
    this.filterLabel = '';
    this.filterMarker = '';
    this.filterTodo = ''; // '' | 'unchecked' | 'checked' | 'tasks'

    // Undo / Redo stacks (serialized active document snapshots)
    this.undoStack = [];
    this.redoStack = [];

    this._loadFromStorage();
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_DOCS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.docs = parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to parse saved documents:', e);
    }

    if (this.docs.length === 0) {
      const welcome = createWelcomeDocument();
      this.docs = [welcome];
    }

    const savedActive = localStorage.getItem(STORAGE_ACTIVE_KEY);
    this.activeDocId = this.docs.some(d => d.id === savedActive)
      ? savedActive
      : this.docs[0].id;

    const sheet = this.getActiveSheet();
    this.selectedNodeId = sheet?.root?.id || null;
  }

  _saveToStorage() {
    try {
      const doc = this.getActiveDoc();
      if (doc) doc.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_DOCS_KEY, JSON.stringify(this.docs));
      localStorage.setItem(STORAGE_ACTIVE_KEY, this.activeDocId || '');
    } catch (e) {
      console.warn('localStorage save failed (possibly quota exceeded):', e);
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(reason = 'update') {
    for (const fn of this.listeners) {
      try {
        fn(reason);
      } catch (err) {
        console.error('Store listener error:', err);
      }
    }
  }

  getActiveDoc() {
    return this.docs.find(d => d.id === this.activeDocId) || this.docs[0];
  }

  getActiveSheet() {
    const doc = this.getActiveDoc();
    if (!doc) return null;
    return doc.sheets.find(s => s.id === doc.activeSheetId) || doc.sheets[0];
  }

  _pushHistory() {
    const doc = this.getActiveDoc();
    if (!doc) return;
    this.undoStack.push(JSON.stringify(doc));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  mutate(fn, reason = 'doc') {
    this._pushHistory();
    fn(this.getActiveSheet(), this.getActiveDoc());
    this._saveToStorage();
    this.notify(reason);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    const doc = this.getActiveDoc();
    this.redoStack.push(JSON.stringify(doc));
    const prev = JSON.parse(this.undoStack.pop());
    const idx = this.docs.findIndex(d => d.id === this.activeDocId);
    if (idx >= 0) this.docs[idx] = prev;
    this._saveToStorage();
    this.notify('undo');
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    const doc = this.getActiveDoc();
    this.undoStack.push(JSON.stringify(doc));
    const next = JSON.parse(this.redoStack.pop());
    const idx = this.docs.findIndex(d => d.id === this.activeDocId);
    if (idx >= 0) this.docs[idx] = next;
    this._saveToStorage();
    this.notify('redo');
    return true;
  }

  // --- UI State Controls ---

  setUiTheme(theme) {
    this.uiTheme = theme;
    localStorage.setItem(STORAGE_UI_THEME_KEY, theme);
    document.body.dataset.uiTheme = theme;
    this.notify('ui');
  }

  setViewMode(mode) {
    this.viewMode = mode;
    this.editingNodeId = null;
    this.notify('view');
  }

  selectNode(nodeId, autoSwitchTab = true) {
    this.selectedNodeId = nodeId;
    this.selectedRelId = null;
    if (autoSwitchTab) {
      this.inspectorTab = nodeId ? 'topic' : 'map';
    }
    this.notify('selection');
  }

  selectRelationship(relId) {
    this.selectedRelId = relId;
    this.selectedNodeId = null;
    this.notify('selection');
  }

  startEditing(nodeId) {
    this.selectedNodeId = nodeId;
    this.editingNodeId = nodeId;
    this.notify('editing');
  }

  stopEditing() {
    if (this.editingNodeId) {
      this.editingNodeId = null;
      this.notify('editing');
    }
  }

  toggleInspector(open = null) {
    this.inspectorOpen = open === null ? !this.inspectorOpen : open;
    this.notify('ui');
  }

  setInspectorTab(tab) {
    this.inspectorTab = tab;
    this.notify('ui');
  }

  toggleLeftDrawer(drawer) {
    this.leftDrawer = this.leftDrawer === drawer ? null : drawer;
    this.notify('ui');
  }

  toggleMinimap() {
    this.showMinimap = !this.showMinimap;
    this.notify('ui');
  }

  setConnectingMode(fromNodeId) {
    this.connectingFromId = fromNodeId;
    this.notify('ui');
  }

  setFilter({ searchQuery, filterLabel, filterMarker, filterTodo }) {
    if (searchQuery !== undefined) this.searchQuery = searchQuery;
    if (filterLabel !== undefined) this.filterLabel = filterLabel;
    if (filterMarker !== undefined) this.filterMarker = filterMarker;
    if (filterTodo !== undefined) this.filterTodo = filterTodo;
    this.notify('filter');
  }

  clearFilters() {
    this.searchQuery = '';
    this.filterLabel = '';
    this.filterMarker = '';
    this.filterTodo = '';
    this.notify('filter');
  }

  hasActiveFilter() {
    return Boolean(this.searchQuery.trim() || this.filterLabel || this.filterMarker || this.filterTodo);
  }

  // --- Tree Traversal Helpers (includes main root + floating topics) ---

  getAllRoots(sheet = this.getActiveSheet()) {
    if (!sheet) return [];
    return [sheet.root, ...(sheet.floatingTopics || []).map(f => f.node)];
  }

  findNodeWithParent(nodeId, sheet = this.getActiveSheet()) {
    if (!sheet || !nodeId) return null;
    const walk = (node, parent, index, floatingObj) => {
      if (node.id === nodeId) return { node, parent, index, floatingObj };
      for (let i = 0; i < (node.children || []).length; i++) {
        const res = walk(node.children[i], node, i, floatingObj);
        if (res) return res;
      }
      return null;
    };
    const inMain = walk(sheet.root, null, -1, null);
    if (inMain) return inMain;
    for (const flt of (sheet.floatingTopics || [])) {
      const inFlt = walk(flt.node, null, -1, flt);
      if (inFlt) return inFlt;
    }
    return null;
  }

  findNode(nodeId, sheet = this.getActiveSheet()) {
    return this.findNodeWithParent(nodeId, sheet)?.node || null;
  }

  getAllNodes(sheet = this.getActiveSheet()) {
    const out = [];
    const walk = (node, depth = 0, parent = null) => {
      out.push({ node, depth, parent });
      for (const c of (node.children || [])) walk(c, depth + 1, node);
    };
    for (const r of this.getAllRoots(sheet)) walk(r, 0, null);
    return out;
  }

  countDescendants(node) {
    let count = 0;
    for (const c of (node.children || [])) {
      count += 1 + this.countDescendants(c);
    }
    return count;
  }

  isDescendant(ancestorId, targetId, sheet = this.getActiveSheet()) {
    const anc = this.findNode(ancestorId, sheet);
    if (!anc) return false;
    const check = (n) => {
      if (n.id === targetId) return true;
      return (n.children || []).some(check);
    };
    return check(anc);
  }

  getTodoRollup(node) {
    let total = 0;
    let done = 0;
    const walk = (n) => {
      if (n.todo) {
        total++;
        if (n.todo.checked) done++;
      }
      for (const c of (n.children || [])) walk(c);
    };
    for (const c of (node.children || [])) walk(c);
    return { total, done };
  }

  getMatchedNodeIds(sheet = this.getActiveSheet()) {
    if (!this.hasActiveFilter()) return null;
    const q = this.searchQuery.trim().toLowerCase();
    const matched = new Set();
    for (const { node } of this.getAllNodes(sheet)) {
      let ok = true;
      if (q) {
        const hay = `${node.title} ${node.notes || ''} ${(node.labels || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) ok = false;
      }
      if (ok && this.filterLabel && !(node.labels || []).includes(this.filterLabel)) {
        ok = false;
      }
      if (ok && this.filterMarker && !(node.markers || []).includes(this.filterMarker)) {
        ok = false;
      }
      if (ok && this.filterTodo) {
        if (this.filterTodo === 'unchecked' && !(node.todo && !node.todo.checked)) ok = false;
        if (this.filterTodo === 'checked' && !(node.todo && node.todo.checked)) ok = false;
        if (this.filterTodo === 'tasks' && !node.task) ok = false;
      }
      if (ok) matched.add(node.id);
    }
    return matched;
  }

  // --- Node CRUD Operations ---

  addChild(parentId = this.selectedNodeId, title = '子主題', autoEdit = true) {
    const sheet = this.getActiveSheet();
    const targetId = parentId || sheet.root.id;
    let created = null;
    this.mutate((s) => {
      const parent = this.findNode(targetId, s);
      if (!parent) return;
      parent.collapsed = false;
      const side = (parent.id === s.root.id && s.structure === 'mindmap')
        ? ((parent.children.filter(c => c.side === 'right').length <= parent.children.filter(c => c.side === 'left').length) ? 'right' : 'left')
        : null;
      created = createNode(title, { side });
      parent.children.push(created);
    }, 'tree');
    if (created) {
      this.selectedNodeId = created.id;
      if (autoEdit) this.editingNodeId = created.id;
      this.notify('selection');
    }
    return created;
  }

  addSibling(nodeId = this.selectedNodeId, title = '新主題', autoEdit = true) {
    const sheet = this.getActiveSheet();
    const info = this.findNodeWithParent(nodeId || sheet.root.id, sheet);
    if (!info) return null;
    if (!info.parent) {
      // Root or floating root -> add child instead
      return this.addChild(info.node.id, title, autoEdit);
    }
    let created = null;
    this.mutate((s) => {
      const cur = this.findNodeWithParent(nodeId, s);
      if (!cur || !cur.parent) return;
      created = createNode(title, { side: cur.node.side || null });
      cur.parent.children.splice(cur.index + 1, 0, created);
    }, 'tree');
    if (created) {
      this.selectedNodeId = created.id;
      if (autoEdit) this.editingNodeId = created.id;
      this.notify('selection');
    }
    return created;
  }

  insertParent(nodeId = this.selectedNodeId, title = '父主題') {
    const sheet = this.getActiveSheet();
    const info = this.findNodeWithParent(nodeId, sheet);
    if (!info || !info.parent) return null;
    let created = null;
    this.mutate((s) => {
      const cur = this.findNodeWithParent(nodeId, s);
      if (!cur || !cur.parent) return;
      created = createNode(title, { side: cur.node.side || null, children: [cur.node] });
      cur.parent.children.splice(cur.index, 1, created);
    }, 'tree');
    if (created) {
      this.selectedNodeId = created.id;
      this.editingNodeId = created.id;
      this.notify('selection');
    }
    return created;
  }

  deleteNode(nodeId = this.selectedNodeId) {
    const sheet = this.getActiveSheet();
    if (!nodeId || nodeId === sheet.root.id) return false;
    const info = this.findNodeWithParent(nodeId, sheet);
    if (!info) return false;

    const nextFocus = info.parent ? info.parent.id : sheet.root.id;
    this.mutate((s) => {
      const cur = this.findNodeWithParent(nodeId, s);
      if (!cur) return;
      if (cur.parent) {
        cur.parent.children.splice(cur.index, 1);
      } else if (cur.floatingObj) {
        s.floatingTopics = s.floatingTopics.filter(f => f.id !== cur.floatingObj.id);
      }
      // Clean dangling relationships
      const remaining = new Set(this.getAllNodes(s).map(x => x.node.id));
      s.relationships = (s.relationships || []).filter(r => remaining.has(r.fromId) && remaining.has(r.toId));
    }, 'tree');

    this.selectedNodeId = nextFocus;
    this.editingNodeId = null;
    this.notify('selection');
    return true;
  }

  updateNode(nodeId, patch) {
    if (!nodeId) return;
    this.mutate((s) => {
      const node = this.findNode(nodeId, s);
      if (!node) return;
      Object.assign(node, patch);
    }, 'node');
  }

  updateNodeStyle(nodeId, stylePatch) {
    if (!nodeId) return;
    this.mutate((s) => {
      const node = this.findNode(nodeId, s);
      if (!node) return;
      node.style = { ...(node.style || {}), ...stylePatch };
    }, 'style');
  }

  moveNode(sourceId, targetId, position = 'inside') {
    if (!sourceId || !targetId || sourceId === targetId) return false;
    const sheet = this.getActiveSheet();
    if (sourceId === sheet.root.id) return false;
    if (this.isDescendant(sourceId, targetId, sheet)) return false;

    this.mutate((s) => {
      const src = this.findNodeWithParent(sourceId, s);
      const tgt = this.findNodeWithParent(targetId, s);
      if (!src || !tgt) return;

      // Detach source
      if (src.parent) {
        src.parent.children.splice(src.index, 1);
      } else if (src.floatingObj) {
        s.floatingTopics = s.floatingTopics.filter(f => f.id !== src.floatingObj.id);
      }

      // Re-find target after removal
      const tgt2 = this.findNodeWithParent(targetId, s);
      if (!tgt2) return;

      if (position === 'inside' || !tgt2.parent) {
        tgt2.node.collapsed = false;
        if (tgt2.node.id === s.root.id && !src.node.side) {
          src.node.side = 'right';
        }
        tgt2.node.children.push(src.node);
      } else {
        const insertIdx = position === 'before' ? tgt2.index : tgt2.index + 1;
        src.node.side = tgt2.node.side || src.node.side;
        tgt2.parent.children.splice(insertIdx, 0, src.node);
      }
    }, 'tree');
    return true;
  }

  indentNode(nodeId) {
    const info = this.findNodeWithParent(nodeId);
    if (!info || !info.parent || info.index === 0) return false;
    const prevSibling = info.parent.children[info.index - 1];
    return this.moveNode(nodeId, prevSibling.id, 'inside');
  }

  outdentNode(nodeId) {
    const info = this.findNodeWithParent(nodeId);
    if (!info || !info.parent) return false;
    const grand = this.findNodeWithParent(info.parent.id);
    if (!grand || !grand.parent) return false;
    return this.moveNode(nodeId, info.parent.id, 'after');
  }

  toggleCollapse(nodeId = this.selectedNodeId) {
    const node = this.findNode(nodeId);
    if (!node || !node.children.length) return;
    this.updateNode(nodeId, { collapsed: !node.collapsed });
  }

  setAllCollapsed(collapsed) {
    this.mutate((s) => {
      const walk = (n, depth) => {
        if (depth >= 1 && n.children.length > 0) n.collapsed = collapsed;
        for (const c of n.children) walk(c, depth + 1);
      };
      walk(s.root, 0);
    }, 'tree');
  }

  addFloatingTopic(x, y, title = '自由主題') {
    let created = null;
    this.mutate((s) => {
      const node = createNode(title);
      const flt = { id: uid('flt'), x: Math.round(x), y: Math.round(y), node };
      if (!s.floatingTopics) s.floatingTopics = [];
      s.floatingTopics.push(flt);
      created = node;
    }, 'tree');
    if (created) {
      this.selectedNodeId = created.id;
      this.editingNodeId = created.id;
      this.notify('selection');
    }
    return created;
  }

  moveFloatingTopic(floatingId, x, y) {
    this.mutate((s) => {
      const flt = (s.floatingTopics || []).find(f => f.id === floatingId);
      if (flt) {
        flt.x = Math.round(x);
        flt.y = Math.round(y);
      }
    }, 'move');
  }

  // --- Structural Annotations ---

  addRelationship(fromId, toId, label = '關聯') {
    if (!fromId || !toId || fromId === toId) return null;
    let rel = null;
    this.mutate((s) => {
      if (!s.relationships) s.relationships = [];
      rel = {
        id: uid('rel'),
        fromId,
        toId,
        label,
        color: '#6366f1',
        dashed: true,
        controlOffset: { x: 0, y: -70 }
      };
      s.relationships.push(rel);
    }, 'rel');
    this.connectingFromId = null;
    this.selectedRelId = rel.id;
    this.notify('selection');
    return rel;
  }

  updateRelationship(relId, patch) {
    this.mutate((s) => {
      const rel = (s.relationships || []).find(r => r.id === relId);
      if (rel) Object.assign(rel, patch);
    }, 'rel');
  }

  deleteRelationship(relId) {
    this.mutate((s) => {
      s.relationships = (s.relationships || []).filter(r => r.id !== relId);
    }, 'rel');
    if (this.selectedRelId === relId) this.selectedRelId = null;
    this.notify('selection');
  }

  toggleBoundary(nodeId = this.selectedNodeId) {
    const node = this.findNode(nodeId);
    if (!node) return;
    this.updateNode(nodeId, {
      boundary: node.boundary ? null : { title: '群組外框', color: '#6366f1', style: 'dashed' }
    });
  }

  toggleSummary(nodeId = this.selectedNodeId) {
    const node = this.findNode(nodeId);
    if (!node) return;
    this.updateNode(nodeId, {
      summary: node.summary ? null : { title: '概要重點' }
    });
  }

  toggleCallout(nodeId = this.selectedNodeId) {
    const node = this.findNode(nodeId);
    if (!node) return;
    this.updateNode(nodeId, {
      callout: node.callout ? null : { text: '補充標註', color: '#f59e0b' }
    });
  }

  // --- Sheet & Document Management ---

  updateSheet(patch) {
    this.mutate((s) => Object.assign(s, patch), 'sheet');
  }

  addSheet(sheetObj = null) {
    const doc = this.getActiveDoc();
    const s = sheetObj || createSheet(`畫布 ${doc.sheets.length + 1}`);
    this.mutate((_, d) => {
      d.sheets.push(s);
      d.activeSheetId = s.id;
    }, 'sheet');
    this.selectedNodeId = s.root.id;
    this.notify('sheet');
    return s;
  }

  switchSheet(sheetId) {
    const doc = this.getActiveDoc();
    if (!doc.sheets.some(s => s.id === sheetId)) return;
    doc.activeSheetId = sheetId;
    const s = this.getActiveSheet();
    this.selectedNodeId = s.root.id;
    this.selectedRelId = null;
    this.editingNodeId = null;
    this._saveToStorage();
    this.notify('sheet');
  }

  renameSheet(sheetId, title) {
    const clean = title.trim();
    if (!clean) return;
    this.mutate((_, d) => {
      const s = d.sheets.find(x => x.id === sheetId);
      if (s) s.title = clean;
    }, 'sheet');
  }

  duplicateSheet(sheetId) {
    const doc = this.getActiveDoc();
    const src = doc.sheets.find(x => x.id === sheetId);
    if (!src) return;
    const copy = deepClone(src);
    copy.id = uid('sheet');
    copy.title = `${src.title} (複本)`;
    this.addSheet(copy);
  }

  deleteSheet(sheetId) {
    const doc = this.getActiveDoc();
    if (doc.sheets.length <= 1) return false;
    this.mutate((_, d) => {
      const idx = d.sheets.findIndex(x => x.id === sheetId);
      if (idx < 0) return;
      d.sheets.splice(idx, 1);
      if (d.activeSheetId === sheetId) {
        d.activeSheetId = d.sheets[Math.max(0, idx - 1)].id;
      }
    }, 'sheet');
    this.selectedNodeId = this.getActiveSheet().root.id;
    this.notify('sheet');
    return true;
  }

  createSheetFromTopic(nodeId = this.selectedNodeId) {
    const node = this.findNode(nodeId);
    if (!node) return;
    const cloned = deepClone(node);
    const cur = this.getActiveSheet();
    const newSheet = createSheet(cloned.title.slice(0, 20), cloned, {
      structure: cur.structure,
      themeId: cur.themeId,
      branchPaletteId: cur.branchPaletteId,
      lineStyle: cur.lineStyle
    });
    this.addSheet(newSheet);
  }

  // Document-level actions
  renameDocument(title) {
    const clean = title.trim();
    if (!clean) return;
    const doc = this.getActiveDoc();
    doc.title = clean;
    this._saveToStorage();
    this.notify('doc');
  }

  createNewDocument(title = '新心智圖', sheet = null) {
    const doc = createDocument(title, sheet ? [sheet] : null);
    this.docs.unshift(doc);
    this.activeDocId = doc.id;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedNodeId = doc.sheets[0].root.id;
    this._saveToStorage();
    this.notify('doc-switch');
    return doc;
  }

  switchDocument(docId) {
    if (!this.docs.some(d => d.id === docId)) return;
    this.activeDocId = docId;
    this.undoStack = [];
    this.redoStack = [];
    this.selectedNodeId = this.getActiveSheet()?.root?.id || null;
    this._saveToStorage();
    this.notify('doc-switch');
  }

  deleteDocument(docId) {
    if (this.docs.length <= 1) return false;
    this.docs = this.docs.filter(d => d.id !== docId);
    if (this.activeDocId === docId) {
      this.activeDocId = this.docs[0].id;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.selectedNodeId = this.getActiveSheet()?.root?.id || null;
    this._saveToStorage();
    this.notify('doc-switch');
    return true;
  }

  importAsSheetOrDoc(rootNode, { title = '匯入的心智圖', structure = 'logic-right', themeId = 'notebooklm-clean', asNewDoc = false, sheets = null } = {}) {
    if (asNewDoc) {
      const sheetList = sheets || [createSheet(title.slice(0, 24), rootNode, { structure, themeId, branchPaletteId: 'notebooklm' })];
      return this.createNewDocument(title, null) && (() => {
        const doc = this.getActiveDoc();
        doc.sheets = sheetList;
        doc.activeSheetId = sheetList[0].id;
        this.selectedNodeId = sheetList[0].root.id;
        this._saveToStorage();
        this.notify('doc-switch');
      })();
    }
    if (sheets && sheets.length) {
      for (const s of sheets) this.addSheet(s);
    } else {
      const sheet = createSheet(title.slice(0, 24), rootNode, {
        structure,
        themeId,
        branchPaletteId: themeId === 'notebooklm-clean' ? 'notebooklm' : 'xmind-vivid'
      });
      this.addSheet(sheet);
    }
  }

  replaceAllText(findStr, replaceStr, caseSensitive = false) {
    if (!findStr) return 0;
    let count = 0;
    const flags = caseSensitive ? 'g' : 'gi';
    const esc = findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, flags);
    this.mutate((s) => {
      for (const { node } of this.getAllNodes(s)) {
        if (re.test(node.title)) {
          re.lastIndex = 0;
          node.title = node.title.replace(re, () => { count++; return replaceStr; });
        }
      }
    }, 'tree');
    return count;
  }
}

export const store = new MindFlowStore();
