const CACHE_NAME = 'devtoolkit-v1';
const MAX_CACHE_ENTRIES = 50;
const STATIC_ASSETS = [
  '/',
  '/css/style.css',
  '/js/toast.js',
  '/js/utils.js',
  '/js/settings.js',
  '/js/virtual-tree.js',
  '/js/tool-runner.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  // Don't cache POST requests or SSE
  if (request.method !== 'GET' || request.url.includes('/progress/')) return;

  e.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, clone);
            // Trim cache to max entries
            cache.keys().then(keys => {
              if (keys.length > MAX_CACHE_ENTRIES) {
                cache.delete(keys[0]);
              }
            });
          });
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));

      return cached || fetchPromise;
    })
  );
});
