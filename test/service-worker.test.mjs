import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:4380';

// The worker is loaded into a bare VM context with just the globals it touches, so a fetch
// handler can be driven for one request at a time without a browser.
async function loadWorker({ fetchImpl, cached = {}, windowClients = [] }) {
  const listeners = new Map();
  const opened = [];
  const focused = [];
  const posted = [];
  const clients = {
    claim: () => {},
    matchAll: async () => windowClients.map((client) => ({
      url: client.url,
      focus: async () => { focused.push(client.url); },
      postMessage: (message) => { posted.push({ url: client.url, message }); },
    })),
    openWindow: async (target) => { opened.push(target); return null; },
  };
  const context = {
    URL,
    Response,
    Request,
    fetch: fetchImpl,
    caches: {
      open: async () => ({ put: async () => {} }),
      match: async (key) => cached[typeof key === 'string' ? key : key.url],
      keys: async () => [],
      delete: async () => true,
    },
    self: {
      location: new URL(`${ORIGIN}/service-worker.js`),
      addEventListener: (type, handler) => listeners.set(type, handler),
      skipWaiting: () => {},
      clients,
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { listeners, opened, focused, posted };
}

// Returns the response the worker claimed the navigation, or undefined when it stayed out of
// the way and let the browser perform the request itself.
async function handleFetch(listeners, request) {
  let claimed;
  const event = { request, respondWith: (response) => { claimed = response; } };
  listeners.get('fetch')(event);
  return claimed === undefined ? undefined : await claimed;
}

const offline = async () => { throw new Error('network down'); };
const shell = () => new Response('<!doctype html><title>Agent Dashboard</title>', { headers: { 'Content-Type': 'text/html' } });

test('a failed app-shell navigation still falls back to the cached shell', async () => {
  const { listeners } = await loadWorker({ fetchImpl: offline, cached: { '/': shell() } });
  const response = await handleFetch(listeners, { url: `${ORIGIN}/`, method: 'GET', mode: 'navigate' });
  assert.ok(response, 'the worker should claim an app-shell navigation');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Agent Dashboard/);
});

test('the /open/ redirector is never answered from the shell cache', async () => {
  const { listeners } = await loadWorker({ fetchImpl: offline, cached: { '/': shell() } });
  const request = { url: `${ORIGIN}/open/work-session-id/agent-id`, method: 'GET', mode: 'navigate' };
  const response = await handleFetch(listeners, request);
  assert.equal(response, undefined, 'a provider handoff must reach the browser, not the cached board');
});

test('API requests bypass the worker', async () => {
  const { listeners } = await loadWorker({ fetchImpl: offline, cached: {} });
  const response = await handleFetch(listeners, { url: `${ORIGIN}/api/work-sessions`, method: 'GET', mode: 'cors' });
  assert.equal(response, undefined);
});

// The board claims its own origin from another port hosting an unrelated app; a banner for this
// board must never focus a stranger's tab or open the wrong origin.
async function clickNotification(listener, { id = 'work-session-7', notification = true } = {}) {
  const notificationObject = notification
    ? { data: id ? { workSessionId: id } : {}, close: () => { notificationObject.closed = true; }, closed: false }
    : null;
  let pending;
  // The click handler hands its work to waitUntil; awaiting the listener alone would return before
  // the worker had focused or opened anything.
  await listener({ notification: notificationObject, waitUntil: (work) => { pending = work; } });
  await pending;
  return notificationObject;
}

test('a banner click focuses an open board and tells it which card to reveal', async () => {
  const worker = await loadWorker({
    fetchImpl: offline,
    windowClients: [{ url: `${ORIGIN}/?demo=1` }, { url: 'http://127.0.0.1:5000/other-app' }],
  });
  const notification = await clickNotification(worker.listeners.get('notificationclick'));

  assert.equal(notification.closed, true, 'the clicked banner should be dismissed');
  assert.deepEqual(worker.focused, [`${ORIGIN}/?demo=1`], 'only the board on this origin may be focused');
  // Rebuilt field by field: the message object is constructed inside the worker's realm, so a whole
  // object comparison would fail on the prototype rather than on the payload.
  assert.deepEqual(
    worker.posted.map(({ url, message }) => ({ url, type: message.type, workSessionId: message.workSessionId })),
    [{ url: `${ORIGIN}/?demo=1`, type: 'open-work-session', workSessionId: 'work-session-7' }],
  );
  assert.deepEqual(worker.opened, [], 'an open board needs no new window');
});

test('a banner click with no board open opens one on that card', async () => {
  const worker = await loadWorker({ fetchImpl: offline });
  await clickNotification(worker.listeners.get('notificationclick'));

  assert.deepEqual(worker.opened, ['/?work-session=work-session-7'], 'a cold board has to be told in the URL');
  assert.deepEqual(worker.focused, []);
});

test('a banner with no recorded card still opens the board', async () => {
  const worker = await loadWorker({ fetchImpl: offline });
  await clickNotification(worker.listeners.get('notificationclick'), { id: null });
  assert.deepEqual(worker.opened, ['/']);
});
