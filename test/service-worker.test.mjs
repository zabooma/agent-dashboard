import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
const ORIGIN = 'http://127.0.0.1:4380';

// The worker is loaded into a bare VM context with just the globals it touches, so a fetch
// handler can be driven for one request at a time without a browser.
async function loadWorker({ fetchImpl, cached = {} }) {
  const listeners = new Map();
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
      clients: { claim: () => {} },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return listeners;
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
  const listeners = await loadWorker({ fetchImpl: offline, cached: { '/': shell() } });
  const response = await handleFetch(listeners, { url: `${ORIGIN}/`, method: 'GET', mode: 'navigate' });
  assert.ok(response, 'the worker should claim an app-shell navigation');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Agent Dashboard/);
});

test('the /open/ redirector is never answered from the shell cache', async () => {
  const listeners = await loadWorker({ fetchImpl: offline, cached: { '/': shell() } });
  const request = { url: `${ORIGIN}/open/work-session-id/agent-id`, method: 'GET', mode: 'navigate' };
  const response = await handleFetch(listeners, request);
  assert.equal(response, undefined, 'a provider handoff must reach the browser, not the cached board');
});

test('API requests bypass the worker', async () => {
  const listeners = await loadWorker({ fetchImpl: offline, cached: {} });
  const response = await handleFetch(listeners, { url: `${ORIGIN}/api/work-sessions`, method: 'GET', mode: 'cors' });
  assert.equal(response, undefined);
});
