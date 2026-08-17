const CACHE_NAME = 'devtoolkit-static-v2';
const MAX_CACHE_ENTRIES = 80;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

function isStaticAsset(request) {
  if (request.destination === 'style' || request.destination === 'script' || request.destination === 'font' || request.destination === 'image') return true;
  try {
    const url = new URL(request.url);
    return url.origin === self.location.origin && /\.(?:css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_CACHE_ENTRIES).map(request => cache.delete(request)));
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/progress/') || url.pathname === '/healthz' || url.pathname === '/readyz') return;

  // Never serve cached HTML/navigation responses. Tool pages and the dashboard are
  // server-rendered and may contain per-request CSP nonces and fresh tool metadata.
  if (request.mode === 'navigate' || request.destination === 'document' || !isStaticAsset(request)) {
    event.respondWith(fetch(request));
    return;
  }

  // Static assets use stale-while-revalidate. This keeps repeat visits fast while
  // allowing deployments to refresh CSS/JS without a stale cached application shell.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request).then(async response => {
      if (response.ok) {
        await cache.put(request, response.clone());
        await trimCache(cache);
      }
      return response;
    }).catch(() => null);

    return cached || await network || new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});
