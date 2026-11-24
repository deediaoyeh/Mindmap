# MindFlow — 開源線上心智圖平台 & Google NotebookLM 橋接工具

🌐 **線上正式網址（GitHub Pages）**：https://deediaoyeh.github.io/Mindmap/

**MindFlow** 是一個受 **XMind** 深度啟發、**零建置依賴（Zero-Build Pure ES Modules）**、原生可架設於 **GitHub Pages** 的完整線上心智圖平台，並內建專為 **Google NotebookLM（Gemini Notebook）** 打造的心智圖無損匯入橋接系統。

> 📘 完整 XMind 實地觀察與架構對照報告請參閱：[docs/XMIND_ANALYSIS.md](./docs/XMIND_ANALYSIS.md)

---

## 核心特色

### 1. Google NotebookLM（Gemini Notebook）四合一無縫匯入中心
點擊頂部工具列 **「✨ NotebookLM 匯入」**，支援四種匯入方式：
1. **一鍵書籤小工具（Bookmarklet，推薦）**：拖曳到瀏覽器書籤列後，在 `notebooklm.google.com` 的心智圖畫面點一下，自動讀取底層 D3 `__data__`（**連尚未展開的收合分支 `_children` 也能完整擷取**），一鍵跳轉開啟 MindFlow 編輯！
2. **隨附 Chrome Manifest V3 擴充套件（`notebooklm-extension/`）**：載入未封裝套件後，直接在 NotebookLM 頁面右下角出現「✨ 匯出到 MindFlow」浮動按鈕。
3. **多格式檔案與原始碼匯入**：支援拖曳或貼上 NotebookLM JSON、SVG（自動幾何還原節點與連線層級）、Markdown、OPML、FreeMind (`.mm`)、Obsidian (`.canvas`) 與原生 `.xmind`。
4. **NotebookLM 原生下載 PNG 之 AI 視覺還原**：填入個人 Gemini API Key（僅存於瀏覽器本機 LocalStorage），直接呼叫 Gemini Vision API 將 NotebookLM 下載的 PNG 圖片還原為可編輯心智圖。

### 2. XMind 等級多結構與混排引擎
- 支援 **8 種視覺結構**：心智圖（雙向平衡）、右邏輯圖、左邏輯圖、組織架構圖、樹狀圖、水平時間軸、魚骨圖（Ishikawa）、括號圖。
- 支援 **單分支獨立混排覆寫**（在同一張心智圖中混用不同結構）。
- 支援 **多畫布（Multi-Sheet）**、**多文件管理（My Works）**、60 步復原/重做與 LocalStorage 自動儲存。

### 3. 完整標註、豐富多媒體（圖片／影片縮圖播放）與附加檔案
- **結構標註**：可拖曳控制點之關聯線（Relationship）、分支外框（Boundary）、兄弟概要大括號（Summary）、氣泡標註（Callout）、雙擊空白處建立自由主題（Floating Topic）。
- **知識節點多媒體與附件**：
  - **圖片匯入**：支援本機上傳圖片或圖片／Google Drive 網址，點擊縮圖可開啟全螢幕燈箱檢視。
  - **影片匯入（自動縮圖＋播放按鈕）**：支援本機影片（`.mp4` / `.webm` / `.mov` 自動擷取首幀縮圖並存於 IndexedDB）、YouTube 或 Google Drive 影片連結；節點上直接呈現圓角縮圖與中央 `▶` 播放按鈕，點擊即時彈出播放器！
  - **多檔案附件**：任意知識節點皆可附加多份 PDF / Office / ZIP / 音訊或 Google Drive 檔案連結，並顯示 `📎 數量` 徽章供一鍵開啟下載。
- **Google 雲端硬碟整合（☁️ 雲端硬碟）**：
  - 純前端 Google Identity Services OAuth 2.0 + Drive API v3 整合，自動依每張心智圖建立獨立雲端資料夾：`Google Drive / MindFlow / <心智圖名稱> /`，同步保存原始 `.mindflow.json`、標準 `.xmind` 與 `attachments/` 內的所有節點附件與影片！
  - 另提供「免 OAuth 備用方案」：一鍵匯出完整心智圖套件（`.zip`，內含原檔與 `attachments/`），可直接拖入 Google Drive。

### 4. 五大高效視圖模式
- **心智圖畫布**：支援平滑縮放、拖曳調整父子層級、節點快速浮動工具列與即時小地圖（Minimap）。
- **雙向大綱模式（Outliner）**：`Enter` 新增同層、`Tab` 縮排、`Shift+Tab` 凸排，與心智圖即時同步。
- **一鍵演說簡報（Pitch Mode）**：自動將心智圖轉為全螢幕投影片，內建極光／深邃暗／簡約白 3 種簡報主題。
- **ZEN 專注模式**：隱藏干擾介面並內建今日專注計時器。
- **專案任務甘特圖（Gantt Chart）**：視覺化日期排程並可匯出 CSV 與行事曆 `.ics`。

### 5. 全方位匯出與零後端分享
- **圖片與列印**：PNG（1x / 2x / 3x 解析度、透明背景、漸層 3D Map Shot 畫框）、無損 SVG、PDF 列印。
- **跨軟體互通**：零依賴純前端 ZIP 引擎，支援標準 **`.xmind` 檔案雙向讀寫**，以及 Markdown、OPML、FreeMind (`.mm`)、JSON、CSV、ICS。
- **免後端分享連結**：將畫布以 Deflate 壓縮進 URL Hash（`#map=...`），在 GitHub Pages 上不需任何後端伺服器即可分享！

### 6. 全平台支援：手機／平板觸控 PWA ＋ Mac / Windows 離線安裝版
- **手機與平板瀏覽器最佳化（iOS / iPadOS / Android）**：
  - 完整多點觸控手勢：單指拖曳平移、雙指捏合縮放、雙擊編輯文字、空白處雙擊建立自由主題、長按節點拖曳調整父子層級。
  - 自適應行動介面與底部浮動工具列，支援 **PWA（加入主畫面）** 離線運作。
- **macOS 獨立離線版（`.dmg`）**：原碼位於 `macos/`，採用原生 Swift + WKWebView + 內建本機離線伺服器打包，雙擊 `MindFlow-macOS.dmg` 拖曳至「應用程式」即可 100% 離線使用。
- **Windows 獨立安裝版（`.exe` / 攜帶版 `.zip`）**：原碼位於 `windows/`，採用 .NET 8 + WebView2 + Inno Setup 打包為獨立安裝精靈 `MindFlow-Windows-Setup.exe`，透過 GitHub Actions 自動建置並發布於 [GitHub Releases](https://github.com/deediaoyeh/Mindmap/releases)。

---

## 本機啟動

無須安裝 Node 或任何套件，直接以任意靜態伺服器啟動即可：

```bash
python3 -m http.server 8080
```

接著在瀏覽器開啟 `http://localhost:8080`。

## 架設於 GitHub Pages

1. 將本專案推送至你的 GitHub 儲存庫（預設分支 `main`）。
2. 前往 GitHub 儲存庫的 **Settings → Pages**。
3. 將 **Build and deployment → Source** 設為 **GitHub Actions**（本專案已內建 `.github/workflows/pages.yml`），或直接選 **Deploy from a branch (`main` / `/root`)**。
4. 數十秒後即可透過 `https://<你的帳號>.github.io/<儲存庫名稱>/` 線上使用！
