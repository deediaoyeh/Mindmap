/**
 * Curated XMind-inspired themes, color palettes, structures, branch styles,
 * node shapes, and marker/sticker catalogs.
 */

export const STRUCTURES = [
  { id: 'mindmap', name: '心智圖', sub: '雙向輻射', icon: '🧠' },
  { id: 'logic-right', name: '邏輯圖 (右)', sub: '向右展開', icon: '➡️' },
  { id: 'logic-left', name: '邏輯圖 (左)', sub: '向左展開', icon: '⬅️' },
  { id: 'org-chart', name: '組織架構圖', sub: '由上而下', icon: '🏛️' },
  { id: 'tree-chart', name: '樹狀圖', sub: '階層目錄', icon: '🌳' },
  { id: 'timeline', name: '時間軸', sub: '水平序列', icon: '⏳' },
  { id: 'fishbone', name: '魚骨圖', sub: '因果分析', icon: '🐟' },
  { id: 'brace-map', name: '括號圖', sub: '整體拆解', icon: '🧩' }
];

export const LINE_STYLES = [
  { id: 'bezier', name: '柔順曲線' },
  { id: 'tapered', name: '漸細有機線' },
  { id: 'elbow', name: '直角折線' },
  { id: 'straight', name: '俐落直線' }
];

export const TOPIC_SHAPES = [
  { id: 'rounded', name: '圓角矩形' },
  { id: 'pill', name: '膠囊形' },
  { id: 'rect', name: '銳角矩形' },
  { id: 'underline', name: '底線式' },
  { id: 'diamond', name: '菱形' },
  { id: 'hexagon', name: '六邊形' }
];

export const BRANCH_PALETTES = [
  {
    id: 'xmind-vivid',
    name: 'XMind 彩虹',
    colors: ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#ec4899']
  },
  {
    id: 'notebooklm',
    name: 'NotebookLM 藍紫',
    colors: ['#4285f4', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899']
  },
  {
    id: 'oceanic',
    name: '深海藍調',
    colors: ['#0284c7', '#0891b2', '#2563eb', '#4f46e5', '#0d9488', '#3b82f6']
  },
  {
    id: 'botanical',
    name: '森系自然',
    colors: ['#059669', '#65a30d', '#0d9488', '#d97706', '#16a34a', '#b45309']
  },
  {
    id: 'sunset',
    name: '暮色珊瑚',
    colors: ['#f43f5e', '#f97316', '#eab308', '#d946ef', '#fb7185', '#f59e0b']
  },
  {
    id: 'mono-slate',
    name: '商務極簡灰',
    colors: ['#334155', '#475569', '#64748b', '#1e293b', '#475569', '#334155']
  }
];

export const THEMES = {
  'xmind-classic': {
    id: 'xmind-classic',
    name: 'XMind 經典白',
    dark: false,
    canvasBg: '#f8fafc',
    gridColor: '#e2e8f0',
    root: { fill: '#1e293b', color: '#ffffff', border: '#0f172a', shape: 'rounded', fontSize: 18 },
    main: { fill: '#ffffff', color: '#0f172a', border: '#cbd5e1', shape: 'rounded', fontSize: 14 },
    sub: { fill: '#ffffff', color: '#334155', border: '#e2e8f0', shape: 'rounded', fontSize: 13 },
    branchColor: '#64748b',
    paletteId: 'xmind-vivid'
  },
  'midnight-studio': {
    id: 'midnight-studio',
    name: '午夜霓虹',
    dark: true,
    canvasBg: '#0b1120',
    gridColor: '#1e293b',
    root: { fill: '#4f46e5', color: '#ffffff', border: '#818cf8', shape: 'pill', fontSize: 18 },
    main: { fill: '#1e293b', color: '#f1f5f9', border: '#334155', shape: 'rounded', fontSize: 14 },
    sub: { fill: '#131c31', color: '#cbd5e1', border: '#273552', shape: 'rounded', fontSize: 13 },
    branchColor: '#818cf8',
    paletteId: 'notebooklm'
  },
  'notebooklm-clean': {
    id: 'notebooklm-clean',
    name: 'NotebookLM 學院',
    dark: false,
    canvasBg: '#f5f7fb',
    gridColor: '#e3e8f2',
    root: { fill: '#dbeafe', color: '#1e3a8a', border: '#93c5fd', shape: 'pill', fontSize: 17 },
    main: { fill: '#ede9fe', color: '#3b0764', border: '#c4b5fd', shape: 'rounded', fontSize: 14 },
    sub: { fill: '#ffffff', color: '#1e293b', border: '#cbd5e1', shape: 'rounded', fontSize: 13 },
    branchColor: '#6366f1',
    paletteId: 'notebooklm'
  },
  'minimal-ink': {
    id: 'minimal-ink',
    name: '極簡墨白',
    dark: false,
    canvasBg: '#ffffff',
    gridColor: '#f1f5f9',
    root: { fill: '#111827', color: '#ffffff', border: '#111827', shape: 'rect', fontSize: 18 },
    main: { fill: '#f9fafb', color: '#111827', border: '#111827', shape: 'rect', fontSize: 14 },
    sub: { fill: 'transparent', color: '#1f2937', border: '#9ca3af', shape: 'underline', fontSize: 13 },
    branchColor: '#374151',
    paletteId: 'mono-slate'
  },
  'nordic-sage': {
    id: 'nordic-sage',
    name: '北歐鼠尾草',
    dark: false,
    canvasBg: '#f3f7f4',
    gridColor: '#dce8df',
    root: { fill: '#14532d', color: '#ffffff', border: '#166534', shape: 'pill', fontSize: 18 },
    main: { fill: '#ffffff', color: '#14532d', border: '#86efac', shape: 'rounded', fontSize: 14 },
    sub: { fill: '#ffffff', color: '#365314', border: '#d9f99d', shape: 'rounded', fontSize: 13 },
    branchColor: '#16a34a',
    paletteId: 'botanical'
  },
  'warm-sunset': {
    id: 'warm-sunset',
    name: '暖陽手札',
    dark: false,
    canvasBg: '#fffaf5',
    gridColor: '#fde8d7',
    root: { fill: '#ea580c', color: '#ffffff', border: '#c2410c', shape: 'rounded', fontSize: 18 },
    main: { fill: '#fff7ed', color: '#7c2d12', border: '#fdba74', shape: 'rounded', fontSize: 14 },
    sub: { fill: '#ffffff', color: '#431407', border: '#fed7aa', shape: 'rounded', fontSize: 13 },
    branchColor: '#f97316',
    paletteId: 'sunset'
  },
  'cyber-obsidian': {
    id: 'cyber-obsidian',
    name: '黑曜賽博',
    dark: true,
    canvasBg: '#09090b',
    gridColor: '#18181b',
    root: { fill: '#06b6d4', color: '#042f2e', border: '#22d3ee', shape: 'hexagon', fontSize: 18 },
    main: { fill: '#18181b', color: '#fafafa', border: '#27272a', shape: 'rounded', fontSize: 14 },
    sub: { fill: '#121215', color: '#d4d4d8', border: '#27272a', shape: 'underline', fontSize: 13 },
    branchColor: '#22d3ee',
    paletteId: 'xmind-vivid'
  },
  'academic-cream': {
    id: 'academic-cream',
    name: '象牙學術紙',
    dark: false,
    canvasBg: '#faf7f0',
    gridColor: '#ede6d6',
    root: { fill: '#7c2d12', color: '#fefce8', border: '#7c2d12', shape: 'rounded', fontSize: 18 },
    main: { fill: '#fffdf7', color: '#292524', border: '#d6cbb8', shape: 'rounded', fontSize: 14 },
    sub: { fill: 'transparent', color: '#44403c', border: '#a8a29e', shape: 'underline', fontSize: 13 },
    branchColor: '#78716c',
    paletteId: 'sunset'
  }
};

export const MARKER_GROUPS = [
  {
    name: '優先級',
    items: [
      { id: 'p1', label: '🔴', title: '優先 1 (最高)' },
      { id: 'p2', label: '🟠', title: '優先 2 (高)' },
      { id: 'p3', label: '🟡', title: '優先 3 (中)' },
      { id: 'p4', label: '🟢', title: '優先 4 (低)' },
      { id: 'p5', label: '🔵', title: '優先 5 (參考)' }
    ]
  },
  {
    name: '進度與狀態',
    items: [
      { id: 'done', label: '✅', title: '已完成' },
      { id: 'wip', label: '🔄', title: '進行中' },
      { id: 'pause', label: '⏸️', title: '暫停' },
      { id: 'warn', label: '⚠️', title: '風險 / 注意' },
      { id: 'fire', label: '🔥', title: '重點 / 緊急' },
      { id: 'idea', label: '💡', title: '靈感' }
    ]
  },
  {
    name: '旗標與貼紙',
    items: [
      { id: 'star', label: '⭐', title: '星號' },
      { id: 'flag', label: '🚩', title: '里程碑' },
      { id: 'pin', label: '📌', title: '釘選' },
      { id: 'book', label: '📚', title: '文獻 / NotebookLM' },
      { id: 'rocket', label: '🚀', title: '啟動 / 發布' },
      { id: 'target', label: '🎯', title: '目標' },
      { id: 'question', label: '❓', title: '待釐清' },
      { id: 'heart', label: '❤️', title: '喜愛' }
    ]
  }
];

export const QUICK_COLORS = [
  '#ffffff', '#f1f5f9', '#1e293b', '#ef4444', '#f97316', '#f59e0b',
  '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#fee2e2', '#fef3c7', '#d1fae5', '#dbeafe', '#ede9fe', '#fce7f3'
];

export function getTheme(themeId) {
  return THEMES[themeId] || THEMES['xmind-classic'];
}

export function getPalette(paletteId) {
  return BRANCH_PALETTES.find(p => p.id === paletteId) || BRANCH_PALETTES[0];
}
