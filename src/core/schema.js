/**
 * Document, Sheet, Node data schemas and curated starter templates.
 */

export function uid(prefix = 'n') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

export function createNode(title = '新主題', extras = {}) {
  return {
    id: extras.id || uid('node'),
    title,
    children: (extras.children || []).map(c =>
      typeof c === 'string' ? createNode(c) : c
    ),
    collapsed: Boolean(extras.collapsed),
    notes: extras.notes || '',
    labels: Array.isArray(extras.labels) ? [...extras.labels] : [],
    markers: Array.isArray(extras.markers) ? [...extras.markers] : [],
    link: extras.link || '',
    image: extras.image || '',
    video: extras.video ? { ...extras.video } : null,
    attachments: Array.isArray(extras.attachments) ? extras.attachments.map(a => ({ ...a })) : [],
    todo: extras.todo ? { checked: Boolean(extras.todo.checked) } : null,
    task: extras.task ? { ...extras.task } : null,
    callout: extras.callout ? { text: extras.callout.text || '標註說明', color: extras.callout.color || '#f59e0b' } : null,
    boundary: extras.boundary ? { title: extras.boundary.title || '群組外框', color: extras.boundary.color || '#6366f1', style: extras.boundary.style || 'dashed' } : null,
    summary: extras.summary ? { title: extras.summary.title || '概要總結' } : null,
    structure: extras.structure || null, // Optional per-branch mixed structure override
    side: extras.side || null, // 'left' | 'right' | null
    style: extras.style ? { ...extras.style } : {}
  };
}

export function createSheet(title = '畫布 1', root = null, options = {}) {
  return {
    id: options.id || uid('sheet'),
    title,
    structure: options.structure || 'mindmap',
    themeId: options.themeId || 'xmind-classic',
    branchPaletteId: options.branchPaletteId || 'xmind-vivid',
    lineStyle: options.lineStyle || 'bezier',
    rainbowBranches: options.rainbowBranches !== undefined ? options.rainbowBranches : true,
    autoNumbering: Boolean(options.autoNumbering),
    customBg: options.customBg || '',
    root: root || createNode('中心主題', {
      children: [
        createNode('主要分支 1', { children: [createNode('子主題 1-1'), createNode('子主題 1-2')] }),
        createNode('主要分支 2', { children: [createNode('子主題 2-1')] }),
        createNode('主要分支 3')
      ]
    }),
    floatingTopics: options.floatingTopics || [],
    relationships: options.relationships || []
  };
}

export function createDocument(title = '未命名心智圖', sheets = null) {
  const sheetList = sheets && sheets.length ? sheets : [createSheet('畫布 1')];
  const now = new Date().toISOString();
  return {
    id: uid('doc'),
    title,
    createdAt: now,
    updatedAt: now,
    activeSheetId: sheetList[0].id,
    sheets: sheetList
  };
}

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Rich initial showcase document demonstrating XMind parity + NotebookLM bridge.
 */
export function createWelcomeDocument() {
  const nNlm = createNode('NotebookLM 橋接', {
    markers: ['book', 'fire'],
    labels: ['核心亮點'],
    side: 'right',
    boundary: { title: 'Gemini Notebook 無縫匯入', color: '#6366f1', style: 'dashed' },
    notes: '點擊工具列「NotebookLM 匯入」即可透過一鍵書籤工具、Chrome 擴充套件、JSON/SVG/Markdown 或 PNG AI 辨識直接匯入！',
    children: [
      createNode('一鍵書籤小工具', { notes: '直接讀取 NotebookLM 頁面的 D3 __data__，連收合節點也完整匯出！' }),
      createNode('SVG / JSON / Markdown 匯入', { labels: ['免安裝'] }),
      createNode('PNG 截圖 Gemini Vision 還原', { labels: ['AI 辨識'] }),
      createNode('附帶 Chrome 擴充套件原始碼')
    ]
  });

  const nStruct = createNode('8 種結構與混排', {
    markers: ['idea'],
    side: 'right',
    summary: { title: '右側樣式面板可自由切換' },
    children: [
      createNode('心智圖 / 左右邏輯圖', { callout: { text: '就像 XMind 一樣！', color: '#f59e0b' } }),
      createNode('組織架構圖 / 樹狀圖'),
      createNode('時間軸 / 魚骨圖 / 括號圖'),
      createNode('單分支獨立覆寫混排結構')
    ]
  });

  const nModes = createNode('五大高效視圖模式', {
    markers: ['rocket'],
    side: 'left',
    children: [
      createNode('雙向大綱模式 (Outliner)', { todo: { checked: true } }),
      createNode('一鍵演說簡報 (Pitch Mode)', { todo: { checked: true } }),
      createNode('ZEN 專注計時模式', { todo: { checked: true } }),
      createNode('專案任務甘特圖 (Gantt)', {
        todo: { checked: false },
        task: { start: isoDateOffset(0), end: isoDateOffset(5), progress: 65, assignee: '團隊', priority: '高' }
      })
    ]
  });

  const nExport = createNode('專業匯出與分享', {
    markers: ['star'],
    side: 'left',
    children: [
      createNode('原生 .xmind 檔案雙向讀寫'),
      createNode('高解析 PNG (1x/2x/3x) & SVG'),
      createNode('Markdown / OPML / FreeMind'),
      createNode('壓縮連結分享 (純靜態零後端)')
    ]
  });

  const root = createNode('MindFlow 線上心智圖平台', {
    markers: ['target'],
    notes: '雙擊任意節點即可編輯文字；按 Enter 新增同層主題，按 Tab 新增子主題，拖曳節點可自由調整父子層級！',
    children: [nNlm, nStruct, nModes, nExport]
  });

  const sheet1 = createSheet('平台導覽', root, {
    structure: 'mindmap',
    themeId: 'xmind-classic',
    branchPaletteId: 'xmind-vivid',
    rainbowBranches: true,
    relationships: [
      {
        id: uid('rel'),
        fromId: nNlm.id,
        toId: nExport.id,
        label: '匯入後再匯出 .xmind',
        color: '#6366f1',
        dashed: true,
        controlOffset: { x: 0, y: -90 }
      }
    ],
    floatingTopics: [
      {
        id: uid('flt'),
        x: 420,
        y: 260,
        node: createNode('💡 快捷鍵提示', {
          children: [
            createNode('Tab：子主題｜Enter：同層主題'),
            createNode('雙擊空白處：建立自由主題')
          ]
        })
      }
    ]
  });

  // Second sheet showing Project Gantt & Logic Chart
  const sheet2 = createSheet('專案規劃範例', createNode('Q4 產品上線計畫', {
    markers: ['rocket'],
    children: [
      createNode('需求與架構設計', {
        task: { start: isoDateOffset(-2), end: isoDateOffset(3), progress: 100, assignee: 'PM', priority: '高' },
        todo: { checked: true },
        children: [
          createNode('競品 XMind 架構分析', { todo: { checked: true } }),
          createNode('NotebookLM 匯入規格書', { todo: { checked: true } })
        ]
      }),
      createNode('核心引擎開發', {
        task: { start: isoDateOffset(2), end: isoDateOffset(10), progress: 70, assignee: 'Frontend', priority: '最高' },
        todo: { checked: false },
        children: [
          createNode('多結構排版引擎', { todo: { checked: true } }),
          createNode('SVG 互動畫布與拖曳', { todo: { checked: true } }),
          createNode('甘特圖與簡報模式', { todo: { checked: false } })
        ]
      }),
      createNode('測試與 GitHub Pages 發布', {
        task: { start: isoDateOffset(9), end: isoDateOffset(14), progress: 30, assignee: 'QA', priority: '中' },
        todo: { checked: false },
        children: [
          createNode('跨瀏覽器匯出驗證'),
          createNode('GitHub Actions 自動部署')
        ]
      })
    ]
  }), {
    structure: 'logic-right',
    themeId: 'notebooklm-clean',
    branchPaletteId: 'notebooklm',
    autoNumbering: true
  });

  return createDocument('MindFlow 歡迎指南', [sheet1, sheet2]);
}

export const TEMPLATES = [
  {
    id: 'notebooklm-study',
    category: '學習研究',
    name: 'NotebookLM 論文研讀筆記',
    desc: '模仿 NotebookLM 視覺風格的向右邏輯圖，適合整理 AI 摘要與文獻脈絡。',
    structure: 'logic-right',
    themeId: 'notebooklm-clean',
    build: () => createSheet('論文研讀', createNode('大型語言模型推論加速綜述', {
      markers: ['book'],
      children: [
        createNode('核心研究問題', {
          children: [createNode('記憶體頻寬瓶頸 (KV Cache)'), createNode('長上下文二次方計算複雜度')]
        }),
        createNode('關鍵技術路線', {
          children: [
            createNode('模型壓縮與量化', { children: [createNode('INT4 / FP8 權重量化'), createNode('結構化剪枝')] }),
            createNode('解碼演算法優化', { children: [createNode('Speculative Decoding'), createNode('FlashAttention / PagedAttention')] })
          ]
        }),
        createNode('實驗結論與啟發', {
          children: [createNode('吞吐量提升 3.2x 且精度損失 < 0.5%'), createNode('可延伸應用於端側 AI 部署')]
        })
      ]
    }), { structure: 'logic-right', themeId: 'notebooklm-clean', branchPaletteId: 'notebooklm' })
  },
  {
    id: 'fishbone-rca',
    category: '問題分析',
    name: '魚骨圖根因分析 (Ishikawa)',
    desc: '從人員、流程、技術、環境四維度剖析問題根本原因。',
    structure: 'fishbone',
    themeId: 'warm-sunset',
    build: () => createSheet('魚骨分析', createNode('線上轉換率下降 15%', {
      markers: ['warn'],
      children: [
        createNode('產品體驗', { children: [createNode('結帳步驟過長'), createNode('行動端載入緩慢')] }),
        createNode('技術穩定', { children: [createNode('API 尖峰逾時'), createNode('第三方金流錯誤')] }),
        createNode('行銷流量', { children: [createNode('廣告受眾偏移'), createNode('落地頁文案不符')] }),
        createNode('競品與市場', { children: [createNode('競品限時促銷'), createNode('季節性需求波動')] })
      ]
    }), { structure: 'fishbone', themeId: 'warm-sunset', branchPaletteId: 'sunset' })
  },
  {
    id: 'org-chart',
    category: '團隊組織',
    name: '產品研發組織架構圖',
    desc: '由上而下的清晰組織層級，適合團隊職責劃分與人員規劃。',
    structure: 'org-chart',
    themeId: 'xmind-classic',
    build: () => createSheet('組織架構', createNode('VP of Product & Engineering', {
      markers: ['flag'],
      children: [
        createNode('產品設計部', { children: [createNode('產品經理團隊'), createNode('UI/UX 設計系統')] }),
        createNode('前端與視覺部', { children: [createNode('Web 畫布引擎組'), createNode('跨端應用組')] }),
        createNode('AI 與資料平台', { children: [createNode('LLM 應用工程'), createNode('資料分析與成長')] })
      ]
    }), { structure: 'org-chart', themeId: 'xmind-classic', branchPaletteId: 'oceanic' })
  },
  {
    id: 'timeline-roadmap',
    category: '專案管理',
    name: '年度產品路線圖 (Timeline)',
    desc: '水平時間軸串聯季度里程碑，並可切換甘特圖追蹤進度。',
    structure: 'timeline',
    themeId: 'midnight-studio',
    build: () => createSheet('年度路線圖', createNode('2026 產品演進藍圖', {
      markers: ['rocket'],
      children: [
        createNode('Q1：核心引擎奠基', {
          task: { start: isoDateOffset(-10), end: isoDateOffset(2), progress: 100, assignee: 'Core', priority: '高' },
          children: [createNode('完成 8 種結構引擎'), createNode('本地儲存與多畫布')]
        }),
        createNode('Q2：AI 與生態整合', {
          task: { start: isoDateOffset(3), end: isoDateOffset(14), progress: 60, assignee: 'AI Team', priority: '最高' },
          children: [createNode('NotebookLM 雙向橋接'), createNode('Gemini Vision 截圖還原')]
        }),
        createNode('Q3：簡報與協作升級', {
          task: { start: isoDateOffset(15), end: isoDateOffset(25), progress: 20, assignee: 'Web', priority: '中' },
          children: [createNode('演說簡報主題擴充'), createNode('連結壓縮即時分享')]
        }),
        createNode('Q4：社群開源發布', {
          task: { start: isoDateOffset(26), end: isoDateOffset(35), progress: 0, assignee: 'DevRel', priority: '中' },
          children: [createNode('GitHub Pages 正式上線'), createNode('Chrome 擴充商店上架')]
        })
      ]
    }), { structure: 'timeline', themeId: 'midnight-studio', branchPaletteId: 'xmind-vivid' })
  },
  {
    id: 'brace-breakdown',
    category: '知識拆解',
    name: '括號圖系統架構拆解',
    desc: '整體到局部的結構拆解，適合系統架構、書籍章節與複習大綱。',
    structure: 'brace-map',
    themeId: 'nordic-sage',
    build: () => createSheet('系統拆解', createNode('現代前端心智圖系統', {
      children: [
        createNode('資料層 (State)', { children: [createNode('不可變歷史快照'), createNode('多畫布與本地持久化')] }),
        createNode('演算法層 (Layout)', { children: [createNode('文字寬度精確量測'), createNode('八種結構座標求解')] }),
        createNode('渲染與互動層', { children: [createNode('SVG 向量與貝茲曲線'), createNode('拖曳重排與快捷鍵')] })
      ]
    }), { structure: 'brace-map', themeId: 'nordic-sage', branchPaletteId: 'botanical' })
  },
  {
    id: 'brainstorm-blank',
    category: '空白畫布',
    name: '空白心智圖 (快速開始)',
    desc: '從零開始自由發想，搭配預設彩虹分支與極簡風格。',
    structure: 'mindmap',
    themeId: 'xmind-classic',
    build: () => createSheet('新心智圖', createNode('核心想法', {
      children: [createNode('靈感 1'), createNode('靈感 2'), createNode('靈感 3')]
    }))
  }
];
