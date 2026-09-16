import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { DashboardStore } from '../lib/dashboard-store.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The temporary dashboard server did not become healthy.');
}

async function startDashboard(dataPath) {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(projectRoot, 'server.mjs'), '--dashboard'], {
    cwd: projectRoot,
    env: { ...process.env, AGENT_DASHBOARD_DATA: dataPath, AGENT_DASHBOARD_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    child.kill();
    throw error;
  }
  return { child, baseUrl };
}

async function stopDashboard(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

test('the local dashboard deletes exactly the selected work session', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-http-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const removable = await store.createWorkSession({ title: 'Discard this completed task' });
  const retained = await store.createWorkSession({ title: 'Keep this task' });
  const { child, baseUrl } = await startDashboard(dataPath);

  try {
    const deletion = await fetch(`${baseUrl}/api/work-sessions/${removable.id}`, { method: 'DELETE' });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), {
      dashboardUrl: baseUrl,
      deletedWorkSession: { id: removable.id, title: removable.title },
    });

    const sessions = await fetch(`${baseUrl}/api/work-sessions`).then((response) => response.json());
    assert.deepEqual(sessions.workSessions.map((workSession) => workSession.id), [retained.id]);
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});
test('the open fallback lists the saved session reference with copy controls', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-open-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const workSession = await store.createWorkSession({ title: 'Resume a paused session', worktree: '/worktrees/issue-789' });
  const { agent } = await store.registerAgent(workSession.id, {
    name: 'Codex / resume pass',
    provider: 'codex',
    role: 'implementer',
    providerSessionId: 'codex-thread-789',
    sessionName: 'Surface clean pass',
  });
  const { child, baseUrl } = await startDashboard(dataPath);

  try {
    const response = await fetch(`${baseUrl}/open/${workSession.id}/${agent.id}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<dt>Agent<\/dt><dd><code>Codex \/ resume pass<\/code>/);
    assert.match(html, /codex-thread-789/);
    assert.match(html, /Surface clean pass/);
    assert.match(html, /\/worktrees\/issue-789/);
    assert.equal((html.match(/class="copy"/g) ?? []).length, 2);
    assert.doesNotMatch(html, /No provider session reference was registered/);
    assert.doesNotMatch(html, /No worktree recorded/);
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('the open fallback reports missing values and escapes recorded ones', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-open-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const workSession = await store.createWorkSession({ title: 'Untitled resume path' });
  const { agent } = await store.registerAgent(workSession.id, {
    provider: 'codex',
    role: 'implementer',
    providerSessionId: '<script>alert(1)</script>',
  });
  const { child, baseUrl } = await startDashboard(dataPath);

  try {
    const html = await fetch(`${baseUrl}/open/${workSession.id}/${agent.id}`).then((response) => response.text());

    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)/);
    assert.match(html, /<dt>Agent<\/dt><dd><code>codex implementer<\/code>/);
    assert.match(html, /No session name was registered/);
    assert.match(html, /No worktree recorded/);
    assert.equal((html.match(/class="copy"/g) ?? []).length, 1);
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});

// The fallback page carries its own copy of the theme resolution rule, because an inline script
// cannot import the board's module. This pins that copy to the same semantics.
test('the open fallback resolves the theme with the board rule', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-open-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const workSession = await store.createWorkSession({ title: 'Resume a paused session' });
  const { agent } = await store.registerAgent(workSession.id, { provider: 'codex', role: 'implementer' });
  const { child, baseUrl } = await startDashboard(dataPath);

  try {
    const html = await fetch(`${baseUrl}/open/${workSession.id}/${agent.id}`).then((response) => response.text());
    const themeScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(themeScript, 'the fallback page should resolve the theme before its stylesheet');
    assert.match(html, /:root\[data-theme=dark\]\{/, 'the fallback page should carry the dark palette');
    assert.match(html, /:root\{color-scheme:light/, 'the fallback page should carry the light palette');

    const resolve = (stored, systemPrefersDark) => {
      const root = { dataset: {} };
      const context = {
        matchMedia: () => ({ matches: systemPrefersDark }),
        localStorage: { getItem: () => stored },
        document: { documentElement: root },
      };
      vm.createContext(context);
      vm.runInContext(themeScript, context);
      return root.dataset.theme;
    };

    assert.equal(resolve(null, true), 'dark', 'no preference should follow a dark OS');
    assert.equal(resolve(null, false), 'light', 'no preference should follow a light OS');
    assert.equal(resolve('light', true), 'light', 'an explicit choice should beat the OS');
    assert.equal(resolve('dark', false), 'dark', 'an explicit choice should beat the OS');
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});
