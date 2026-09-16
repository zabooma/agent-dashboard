const CACHE_NAME = 'agent-dashboard-shell-v6';
const APP_SHELL = [
  '/',
  '/app.js',
  '/board-state.js',
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

// A banner is only worth showing if it takes the human to the card it is about. An already-open
// board is focused and told which card to reveal; otherwise the id rides the URL, so a board that
// has to start cold still lands on it.
self.addEventListener('notificationclick', (event) => {
  const workSessionId = event.notification?.data?.workSessionId ?? null;
  event.notification?.close();
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const board = windowClients.find((client) => new URL(client.url).origin === self.location.origin);
    if (board) {
      await board.focus();
      board.postMessage({ type: 'open-work-session', workSessionId });
      return;
    }
    const target = workSessionId ? `/?work-session=${encodeURIComponent(workSessionId)}` : '/';
    await self.clients.openWindow(target);
  })());
});
