const CACHE_NAME = 'mindflow-offline-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/tokens.css',
  './styles/layout.css',
  './styles/components.css',
  './src/main.js',
  './src/core/schema.js',
  './src/core/store.js',
  './src/core/zip.js',
  './src/core/mediaDb.js',
  './src/core/localFile.js',
  './src/core/gdrive.js',
  './src/layout/engine.js',
  './src/render/canvas.js',
  './src/render/themes.js',
  './src/importers/notebooklm.js',
  './src/importers/formats.js',
  './src/exporters/index.js',
  './src/views/outliner.js',
  './src/views/gantt.js',
  './src/views/pitch.js',
  './src/ui/toast.js',
  './src/ui/toolbar.js',
  './src/ui/inspector.js',
  './src/ui/modals.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first with offline cache fallback so updates arrive promptly yet offline always works
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
