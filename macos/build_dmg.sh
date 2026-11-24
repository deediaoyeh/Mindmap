#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build/macos"
DIST_DIR="$ROOT_DIR/dist"
APP_NAME="MindFlow"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
DMG_STAGING="$BUILD_DIR/dmg-staging"
DMG_OUT="$DIST_DIR/MindFlow-macOS.dmg"

echo "==> Cleaning previous build artifacts..."
rm -rf "$BUILD_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources/web" "$DMG_STAGING" "$DIST_DIR"

echo "==> Generating high-resolution macOS AppIcon.icns..."
python3 - "$APP_BUNDLE/Contents/Resources/AppIcon.icns" <<'PYEOF'
import struct, zlib, math, sys

out_icns = sys.argv[1]

def render_icon_png(size):
    W = H = size
    raw = bytearray()
    scale = size / 1024.0

    def seg_dist(px, py, x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        l2 = dx*dx + dy*dy
        if l2 == 0:
            return math.hypot(px - x1, py - y1)
        t = max(0.0, min(1.0, ((px - x1)*dx + (py - y1)*dy) / l2))
        return math.hypot(px - (x1 + t*dx), py - (y1 + t*dy))

    nodes = [
        (512*scale, 512*scale, 118*scale),
        (256*scale, 300*scale, 72*scale),
        (768*scale, 300*scale, 72*scale),
        (256*scale, 724*scale, 72*scale),
        (768*scale, 724*scale, 72*scale),
    ]
    links = [
        (512*scale, 512*scale, 256*scale, 300*scale),
        (512*scale, 512*scale, 768*scale, 300*scale),
        (512*scale, 512*scale, 256*scale, 724*scale),
        (512*scale, 512*scale, 768*scale, 724*scale),
    ]

    margin = 84 * scale
    radius = 210 * scale
    half = W / 2.0
    inner = half - margin - radius
    lw = 24.0 * scale

    for y in range(H):
        raw.append(0)
        for x in range(W):
            ax = abs(x - half) - inner
            ay = abs(y - half) - inner
            sdf = math.hypot(max(ax, 0.0), max(ay, 0.0)) - radius
            if sdf > 1.5:
                raw.extend((0, 0, 0, 0))
                continue
            alpha = max(0.0, min(1.0, 0.5 - sdf / 2.0))

            t = (x * 0.55 + y * 0.45) / W
            if t < 0.5:
                u = t * 2.0
                r = int(79 + (139 - 79) * u)
                g = int(70 + (92 - 70) * u)
                b = int(229 + (246 - 229) * u)
            else:
                u = (t - 0.5) * 2.0
                r = int(139 + (236 - 139) * u)
                g = int(92 + (72 - 92) * u)
                b = int(246 + (153 - 246) * u)

            fg = 0.0
            for x1, y1, x2, y2 in links:
                d = seg_dist(x, y, x1, y1, x2, y2) - lw
                if d < 2.0:
                    fg = max(fg, max(0.0, min(1.0, 0.5 - d / 2.0)) * 0.92)
            for nx, ny, nr in nodes:
                d = math.hypot(x - nx, y - ny) - nr
                if d < 2.0:
                    fg = max(fg, max(0.0, min(1.0, 0.5 - d / 2.0)))

            r = int(r * (1.0 - fg) + 255 * fg)
            g = int(g * (1.0 - fg) + 255 * fg)
            b = int(b * (1.0 - fg) + 255 * fg)
            raw.extend((r, g, b, int(alpha * 255)))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 6)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")

entries = [
    (b"ic07", render_icon_png(128)),
    (b"ic08", render_icon_png(256)),
    (b"ic09", render_icon_png(512)),
]
body = b"".join(tag + struct.pack(">I", len(data) + 8) + data for tag, data in entries)
icns = b"icns" + struct.pack(">I", len(body) + 8) + body
with open(out_icns, "wb") as f:
    f.write(icns)
PYEOF

echo "==> Writing Info.plist..."
cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_TW</string>
  <key>CFBundleDisplayName</key>
  <string>MindFlow</string>
  <key>CFBundleExecutable</key>
  <string>MindFlow</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>io.github.deediaoyeh.mindflow</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>MindFlow</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST

echo "==> Bundling offline MindFlow web assets..."
cp "$ROOT_DIR/index.html" "$APP_BUNDLE/Contents/Resources/web/"
cp "$ROOT_DIR/manifest.webmanifest" "$APP_BUNDLE/Contents/Resources/web/"
cp "$ROOT_DIR/sw.js" "$APP_BUNDLE/Contents/Resources/web/"
cp -R "$ROOT_DIR/styles" "$APP_BUNDLE/Contents/Resources/web/"
cp -R "$ROOT_DIR/src" "$APP_BUNDLE/Contents/Resources/web/"
cp -R "$ROOT_DIR/docs" "$APP_BUNDLE/Contents/Resources/web/"

echo "==> Compiling native Swift binary..."
mkdir -p "$BUILD_DIR/module-cache"
swiftc -O \
  -module-cache-path "$BUILD_DIR/module-cache" \
  -framework Cocoa \
  -framework WebKit \
  -framework Network \
  -framework UniformTypeIdentifiers \
  "$ROOT_DIR/macos/Sources/main.swift" \
  -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

echo "==> Ad-hoc code signing MindFlow.app..."
codesign --force --deep --sign - "$APP_BUNDLE"

echo "==> Creating macOS installer DMG ($DMG_OUT)..."
cp -R "$APP_BUNDLE" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"
cat > "$DMG_STAGING/安裝說明.txt" <<'TXT'
MindFlow — Mac 離線心智圖工作站 安裝說明
========================================

1. 將「MindFlow.app」拖曳至右側的「Applications（應用程式）」資料夾即可完成安裝。
2. 首次開啟時若 macOS 顯示「無法驗證開發者」提示：
   請對 MindFlow.app 按右鍵（或按住 Control 點擊）→ 選擇「打開」→ 再次點擊「打開」即可正常啟動。
3. 本應用程式內建獨立本機引擎，無需網路即可 100% 離線建立、編輯心智圖、匯入圖片／影片縮圖播放與附加檔案，所有資料會自動保存於您的 Mac 本機！
4. 連網時亦可使用「✨ NotebookLM 匯入」與「☁️ 雲端硬碟」同步至 Google Drive。
TXT

rm -f "$DMG_OUT"
hdiutil create \
  -volname "MindFlow Installer" \
  -srcfolder "$DMG_STAGING" \
  -ov \
  -format UDZO \
  "$DMG_OUT"

echo "==> SUCCESS! Built $DMG_OUT"
ls -lh "$DMG_OUT"
