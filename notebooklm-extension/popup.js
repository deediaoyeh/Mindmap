const urlInput = document.getElementById('url-input');
const statusEl = document.getElementById('status');

chrome.storage.sync.get(['mindflowUrl'], (res) => {
  urlInput.value = res.mindflowUrl || 'https://deediaoyeh.github.io/Mindmap/';
});

urlInput.addEventListener('change', () => {
  chrome.storage.sync.set({ mindflowUrl: urlInput.value.trim() });
  statusEl.textContent = '已儲存平台網址';
});

async function sendToTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url?.includes('notebooklm.google.com')) {
    statusEl.textContent = '請先切換到 notebooklm.google.com 心智圖分頁！';
    return null;
  }
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, payload, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        statusEl.textContent = '無法連線頁面，請重新整理 NotebookLM 後再試。';
        resolve(null);
      } else {
        resolve(resp);
      }
    });
  });
}

document.getElementById('btn-open').onclick = async () => {
  const targetUrl = urlInput.value.trim();
  chrome.storage.sync.set({ mindflowUrl: targetUrl });
  const resp = await sendToTab({ action: 'open', targetUrl });
  if (resp?.ok) statusEl.textContent = `已匯出「${resp.title}」！`;
  else if (resp?.error) statusEl.textContent = resp.error;
};

document.getElementById('btn-json').onclick = async () => {
  const resp = await sendToTab({ action: 'json' });
  if (!resp?.ok) return (statusEl.textContent = resp?.error || '匯出失敗');
  const blob = new Blob([resp.data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${resp.title || 'notebooklm'}.json`;
  a.click();
  statusEl.textContent = '已下載 JSON！';
};

document.getElementById('btn-md').onclick = async () => {
  const resp = await sendToTab({ action: 'markdown' });
  if (!resp?.ok) return (statusEl.textContent = resp?.error || '匯出失敗');
  await navigator.clipboard.writeText(resp.data);
  statusEl.textContent = '已複製 Markdown 到剪貼簿！';
};
