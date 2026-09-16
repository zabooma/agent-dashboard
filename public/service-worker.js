const CACHE_NAME = 'agent-dashboard-shell-v4';
const APP_SHELL = [
  '/',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/app-icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  // /open/… hands the browser to a provider session; it is not an app navigation. Claiming it
  // would replace a handoff that cannot be followed with the cached board, so the redirector
  // always goes straight to the network.
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/open/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
      return response;
    } catch {
      return (await caches.match(event.request)) ?? new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
