using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MindFlow;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

internal sealed class LocalWebServer : IDisposable
{
    private readonly string _webRoot;
    private readonly HttpListener _listener = new();
    private readonly CancellationTokenSource _cts = new();
    public int Port { get; private set; } = 18421;

    public LocalWebServer(string webRoot)
    {
        _webRoot = Path.GetFullPath(webRoot);
    }

    public int Start()
    {
        int[] candidates = [18421, 18422, 18423, 18424, 18425];
        foreach (int p in candidates)
        {
            try
            {
                _listener.Prefixes.Clear();
                _listener.Prefixes.Add($"http://127.0.0.1:{p}/");
                _listener.Start();
                Port = p;
                Task.Run(() => ListenLoopAsync(_cts.Token));
                return Port;
            }
            catch
            {
                // Try next loopback port
            }
        }
        throw new InvalidOperationException("無法啟動本機離線服務連接埠 (18421-18425)。");
    }

    private async Task ListenLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener.IsListening)
        {
            try
            {
                var ctx = await _listener.GetContextAsync();
                _ = Task.Run(() => HandleRequest(ctx), ct);
            }
            catch when (ct.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                // Ignore transient socket disconnects
            }
        }
    }

    private void HandleRequest(HttpListenerContext ctx)
    {
        try
        {
            string relPath = Uri.UnescapeDataString(ctx.Request.Url?.AbsolutePath ?? "/").TrimStart('/');
            if (string.IsNullOrEmpty(relPath)) relPath = "index.html";

            string fullPath = Path.GetFullPath(Path.Combine(_webRoot, relPath));
            if (!fullPath.StartsWith(_webRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
            {
                ctx.Response.StatusCode = 404;
                byte[] nf = Encoding.UTF8.GetBytes("Not Found");
                ctx.Response.OutputStream.Write(nf, 0, nf.Length);
                ctx.Response.Close();
                return;
            }

            byte[] data = File.ReadAllBytes(fullPath);
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = GetMimeType(Path.GetExtension(fullPath));
            ctx.Response.Headers["Cache-Control"] = "no-cache";
            ctx.Response.ContentLength64 = data.Length;
            ctx.Response.OutputStream.Write(data, 0, data.Length);
            ctx.Response.Close();
        }
        catch
        {
            try { ctx.Response.Abort(); } catch { }
        }
    }

    private static string GetMimeType(string ext) => ext.ToLowerInvariant() switch
    {
        ".html" or ".htm" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "application/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" or ".webmanifest" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        ".md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream"
    };

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener.Stop(); _listener.Close(); } catch { }
        _cts.Dispose();
    }
}

internal sealed class MainForm : Form
{
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private LocalWebServer? _server;

    public MainForm()
    {
        Text = "MindFlow — 離線心智圖工作站";
        Width = 1380;
        Height = 880;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;

        string icoPath = Path.Combine(AppContext.BaseDirectory, "MindFlow.ico");
        if (File.Exists(icoPath))
        {
            Icon = new Icon(icoPath);
        }

        Controls.Add(_webView);
        Load += MainForm_Load;
        FormClosed += (_, _) => _server?.Dispose();
    }

    private async void MainForm_Load(object? sender, EventArgs e)
    {
        try
        {
            string webDir = Path.Combine(AppContext.BaseDirectory, "web");
            _server = new LocalWebServer(webDir);
            int port = _server.Start();

            string userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MindFlow",
                "WebView2Data"
            );
            Directory.CreateDirectory(userDataDir);

            var env = await CoreWebView2Environment.CreateAsync(null, userDataDir);
            await _webView.EnsureCoreWebView2Async(env);

            var core = _webView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.IsZoomControlEnabled = true;

            core.NewWindowRequested += (_, args) =>
            {
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && uri.Host != "127.0.0.1")
                {
                    args.Handled = true;
                    Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
                }
            };

            core.NavigationStarting += (_, args) =>
            {
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == "http" || uri.Scheme == "https") &&
                    uri.Host != "127.0.0.1")
                {
                    args.Cancel = true;
                    Process.Start(new ProcessStartInfo(args.Uri) { UseShellExecute = true });
                }
            };

            core.Navigate($"http://127.0.0.1:{port}/");
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"啟動 MindFlow 時發生錯誤：\n{ex.Message}\n\n請確認系統已安裝 Microsoft Edge WebView2 Runtime。",
                "MindFlow 啟動錯誤",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
