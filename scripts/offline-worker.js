const CACHE_NAME = __CACHE_NAME__;
const FILES = __PRECACHE_FILES__;
const APP_ROOT = new URL('./', self.registration.scope);
const INDEX_URL = new URL('index.html', APP_ROOT);
const VERSION_URL = new URL('version.json', APP_ROOT);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(FILES.map(path => new Request(new URL(path, APP_ROOT), { cache: 'reload' })));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Older open tabs may still request assets from an earlier release.
    // Keep their caches until browser storage management evicts them.
    await self.clients.claim();
  })());
});

async function cachedOrNetwork(request, url) {
  // The app root and explicit index path alias to the cached entry page; other
  // navigations, such as the player guide, must retain their own document URL.
  const isAppEntry = url.pathname === APP_ROOT.pathname || url.pathname === INDEX_URL.pathname;
  const cacheKey = isAppEntry ? INDEX_URL : request;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(cacheKey);
    if (response) return response;
  } catch { /* Storage may be unavailable; still try the other sources. */ }
  try {
    const response = await caches.match(cacheKey);
    if (response) return response;
  } catch { /* A storage failure must not prevent a network request. */ }
  try {
    return await fetch(request);
  } catch {
    // Return a real HTTP response instead of rejecting respondWith(). Missing
    // resources must remain failures rather than masquerading as cached HTML.
    return new Response('This resource is unavailable offline. Reconnect and try again.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== APP_ROOT.origin || !url.pathname.startsWith(APP_ROOT.pathname)) return;
  // Version discovery must reach the server even when the running app is cached.
  // Never fall back to an old version number while offline.
  if (url.pathname === VERSION_URL.pathname) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() =>
      new Response('Version unavailable', { status: 503 })));
    return;
  }
  event.respondWith(cachedOrNetwork(event.request, url));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
