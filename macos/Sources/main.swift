import Cocoa
import WebKit
import Network
import UniformTypeIdentifiers

// =============================================================================
// Embedded Zero-Dependency Offline Loopback HTTP Server (127.0.0.1)
// Serves MindFlow's bundled ES Modules so localStorage, IndexedDB, and ESM
// work 100% offline with persistent origin across launches.
// =============================================================================

final class LocalWebServer {
    private var listener: NWListener?
    private let rootURL: URL
    private let queue = DispatchQueue(label: "com.mindflow.localserver", qos: .userInitiated)
    private(set) var port: UInt16 = 18421

    init(rootURL: URL) {
        self.rootURL = rootURL
    }

    func start() -> UInt16 {
        let preferredPorts: [UInt16] = [18421, 18422, 18423, 0]
        for candidate in preferredPorts {
            do {
                let params = NWParameters.tcp
                params.requiredLocalEndpoint = NWEndpoint.hostPort(
                    host: .ipv4(.loopback),
                    port: candidate == 0 ? .any : NWEndpoint.Port(rawValue: candidate)!
                )
                let l = try NWListener(using: params)
                let sem = DispatchSemaphore(value: 0)
                var ready = false

                l.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        ready = true
                        sem.signal()
                    case .failed, .cancelled:
                        sem.signal()
                    default:
                        break
                    }
                }
                l.newConnectionHandler = { [weak self] conn in
                    self?.handleConnection(conn)
                }
                l.start(queue: queue)
                _ = sem.wait(timeout: .now() + 2.0)

                if ready, let actualPort = l.port?.rawValue, actualPort > 0 {
                    self.listener = l
                    self.port = actualPort
                    return actualPort
                }
                l.cancel()
            } catch {
                continue
            }
        }
        return self.port
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func handleConnection(_ conn: NWConnection) {
        conn.start(queue: queue)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self = self, let data = data, error == nil,
                  let reqStr = String(data: data, encoding: .utf8) else {
                conn.cancel()
                return
            }

            let firstLine = reqStr.components(separatedBy: "\r\n").first ?? ""
            let parts = firstLine.components(separatedBy: " ")
            guard parts.count >= 2 else {
                conn.cancel()
                return
            }

            let rawPath = parts[1].components(separatedBy: "?").first ?? "/"
            var decodedPath = rawPath.removingPercentEncoding ?? "/"
            if decodedPath == "/" || decodedPath.isEmpty {
                decodedPath = "/index.html"
            }

            // Prevent path traversal outside bundled web directory
            let candidateURL = self.rootURL.appendingPathComponent(String(decodedPath.dropFirst())).standardizedFileURL
            let basePath = self.rootURL.standardizedFileURL.path
            guard candidateURL.path.hasPrefix(basePath),
                  let fileData = try? Data(contentsOf: candidateURL) else {
                let notFound = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found"
                conn.send(content: notFound.data(using: .utf8), completion: .contentProcessed { _ in
                    conn.cancel()
                })
                return
            }

            let mime = Self.mimeType(for: candidateURL.pathExtension.lowercased())
            let header = "HTTP/1.1 200 OK\r\nContent-Type: \(mime)\r\nContent-Length: \(fileData.count)\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n"
            var response = Data(header.utf8)
            response.append(fileData)

            conn.send(content: response, completion: .contentProcessed { _ in
                conn.cancel()
            })
        }
    }

    private static func mimeType(for ext: String) -> String {
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs":   return "application/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json":        return "application/json; charset=utf-8"
        case "svg":         return "image/svg+xml"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp":        return "image/webp"
        case "gif":         return "image/gif"
        case "ico":         return "image/x-icon"
        case "md":          return "text/markdown; charset=utf-8"
        case "woff2":       return "font/woff2"
        default:            return "application/octet-stream"
        }
    }
}

// =============================================================================
// Native macOS Application Delegate & WKWebView Window Controller
// =============================================================================

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: LocalWebServer!
    private var baseURL: URL!

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()

        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        server = LocalWebServer(rootURL: webRoot)
        let port = server.start()
        baseURL = URL(string: "http://127.0.0.1:\(port)/")!

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Bridge <a download> blob/data downloads to native macOS NSSavePanel
        let downloadBridgeJS = """
        (function() {
          const origClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function() {
            if (this.hasAttribute('download') && this.href && (this.href.startsWith('blob:') || this.href.startsWith('data:'))) {
              const filename = this.getAttribute('download') || 'mindflow-export';
              fetch(this.href)
                .then(r => r.arrayBuffer())
                .then(buf => {
                  const bytes = new Uint8Array(buf);
                  let bin = '';
                  const chunk = 0x8000;
                  for (let i = 0; i < bytes.length; i += chunk) {
                    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                  }
                  window.webkit.messageHandlers.mindflowSave.postMessage({
                    filename: filename,
                    base64: btoa(bin)
                  });
                })
                .catch(err => console.error('Native save bridge error:', err));
              return;
            }
            return origClick.apply(this, arguments);
          };
        })();
        """
        let userScript = WKUserScript(source: downloadBridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        config.userContentController.addUserScript(userScript)
        config.userContentController.add(self, name: "mindflowSave")

        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
        let width = min(1440, max(1080, screenFrame.width * 0.86))
        let height = min(920, max(720, screenFrame.height * 0.88))
        let originX = screenFrame.midX - width / 2
        let originY = screenFrame.midY - height / 2

        window = NSWindow(
            contentRect: NSRect(x: originX, y: originY, width: width, height: height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "MindFlow — 離線心智圖工作站"
        window.minSize = NSSize(width: 900, height: 600)
        window.collectionBehavior = [.fullScreenPrimary]

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView?.addSubview(webView)

        webView.load(URLRequest(url: baseURL))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    // MARK: - Native Menu Bar (Enables Cmd+C/V/X/A/Z/Q/R & Print)
    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // App Menu
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "關於 MindFlow", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "隱藏 MindFlow", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "結束 MindFlow", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        // File Menu
        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "檔案")
        fileMenu.addItem(withTitle: "列印 / 另存 PDF...", action: #selector(printPage), keyEquivalent: "p")
        fileMenu.addItem(withTitle: "關閉視窗", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        mainMenu.addItem(fileItem)

        // Edit Menu (Required for copy/paste inside WKWebView text inputs!)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "編輯")
        editMenu.addItem(withTitle: "剪下", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷貝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "貼上", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全選", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        // View Menu
        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "檢視")
        viewMenu.addItem(withTitle: "重新載入", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "切換全螢幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewItem.submenu = viewMenu
        mainMenu.addItem(viewItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func reloadPage() {
        webView?.reload()
    }

    @objc private func printPage() {
        webView?.evaluateJavaScript("window.print()", completionHandler: nil)
    }

    // MARK: - Native Save Panel for Exports & Attachment Downloads
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "mindflowSave",
              let dict = message.body as? [String: Any],
              let filename = dict["filename"] as? String,
              let b64 = dict["base64"] as? String,
              let fileData = Data(base64Encoded: b64) else {
            return
        }

        DispatchQueue.main.async {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = filename
            panel.canCreateDirectories = true
            panel.beginSheetModal(for: self.window) { resp in
                if resp == .OK, let dest = panel.url {
                    do {
                        try fileData.write(to: dest)
                    } catch {
                        let errAlert = NSAlert()
                        errAlert.messageText = "儲存檔案失敗"
                        errAlert.informativeText = error.localizedDescription
                        errAlert.runModal()
                    }
                }
            }
        }
    }

    // MARK: - Native File Picker for <input type="file"> (Images, Videos, Attachments, Imports)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { resp in
            completionHandler(resp == .OK ? panel.urls : nil)
        }
    }

    // MARK: - Native Alert / Confirm / Prompt Dialogs
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "MindFlow"
        alert.informativeText = message
        alert.addButton(withTitle: "確定")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "確認操作"
        alert.informativeText = message
        alert.addButton(withTitle: "確定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        alert.addButton(withTitle: "確定")
        alert.addButton(withTitle: "取消")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.window.initialFirstResponder = input
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }

    // MARK: - Open External Links (Google Drive, NotebookLM, Web Links) in Default Browser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.host == "127.0.0.1" {
                webView.load(navigationAction.request)
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           navigationAction.targetFrame?.isMainFrame == true,
           url.host != "127.0.0.1",
           url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
