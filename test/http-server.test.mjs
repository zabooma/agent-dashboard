import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  // Generous on purpose: the budget is for a server that never binds, not for a busy machine. A node
  // process importing this project's dependencies took over a second to listen at load average 32,
  // which failed every spawning test for a reason that had nothing to do with the code under test.
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
// app.js imports a sibling module, which the browser fetches as its own request. A missing static
// route or a missing shell entry fails only at runtime, in the page, as an unresolved import.
test('every module the board imports is served and precached', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-http-'));
  const { child, baseUrl } = await startDashboard(path.join(directory, 'dashboard.json'));

  try {
    const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
    const shell = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
    const specifiers = [...appSource.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]);
    assert.ok(specifiers.length > 0, 'app.js should import its board rules from a module');

    for (const specifier of specifiers) {
      const modulePath = `/${specifier.replace(/^\.\//, '')}`;
      const response = await fetch(`${baseUrl}${modulePath}`);
      assert.equal(response.status, 200, `${modulePath} must be served to the browser`);
      assert.match(response.headers.get('content-type'), /javascript/, `${modulePath} must be served as a module`);
      assert.match(shell, new RegExp(`'${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `${modulePath} must be in the offline shell`);
    }
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

// A card the agents never move is the reason this endpoint exists. The human's placement is stored
// beside the card, not written into an agent: the status the agents reported has to survive the move,
// or the board would be printing the human's decision as the session's own report.
test('the board moves one card to a lane the human chose, and leaves its agents alone', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-move-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const moved = await store.createWorkSession({ title: 'Codex stopped reporting hours ago' });
  const { agent } = await store.registerAgent(moved.id, {
    name: 'Codex / silent pass',
    provider: 'codex',
    role: 'implementer',
    status: 'working',
  });
  const untouched = await store.createWorkSession({ title: 'A card nobody moved' });
  const { child, baseUrl } = await startDashboard(dataPath);
  const move = (id, body) => fetch(`${baseUrl}/api/work-sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    const response = await move(moved.id, { lane: 'handoff' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.workSession.laneOverride.lane, 'handoff');
    assert.ok(Date.parse(payload.workSession.laneOverride.at), 'a placement records when it was made');
    assert.equal(payload.workSession.agents[0].status, 'working', 'the agent still reports what it reported');
    assert.equal(payload.workSession.agents[0].id, agent.id);

    // Written, not just echoed: the next read of the board has to agree with the answer.
    const sessions = await fetch(`${baseUrl}/api/work-sessions`).then((read) => read.json());
    const stored = sessions.workSessions.find((workSession) => workSession.id === moved.id);
    assert.equal(stored.laneOverride.lane, 'handoff');
    assert.equal(sessions.workSessions.find((workSession) => workSession.id === untouched.id).laneOverride, null);

    // And handing the card back is the same request with nothing in it.
    const cleared = await (await move(moved.id, { lane: null })).json();
    assert.equal(cleared.workSession.laneOverride, null, 'null is how a card returns to its agents');
    assert.equal(cleared.workSession.agents[0].status, 'working');
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});

// Every one of these is a request the human got wrong, and each has to leave the board exactly as it
// was: a move that half-applies because a body was malformed is worse than one that is refused.
test('a move that cannot be carried out says why and changes nothing', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-move-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const workSession = await store.createWorkSession({ title: 'Leave me where I am' });
  const { child, baseUrl } = await startDashboard(dataPath);
  const patch = (id, body) => fetch(
    `${baseUrl}/api/work-sessions/${id}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body },
  );

  try {
    const unknownLane = await patch(workSession.id, JSON.stringify({ lane: 'recycling' }));
    assert.equal(unknownLane.status, 400);
    assert.match((await unknownLane.json()).error, /attention, active, handoff, done/, 'the refusal should name the lanes there are');

    assert.equal((await patch(workSession.id, JSON.stringify({ title: 'Renamed by a move' }))).status, 400, 'a body with no lane is not a move');
    assert.equal((await patch(workSession.id, '{not json')).status, 400);
    assert.equal((await patch('3f1c2f9e-0000-4000-8000-000000000000', JSON.stringify({ lane: 'done' }))).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/work-sessions/${workSession.id}`, { method: 'POST' })).status, 405, 'a move is a PATCH, and the board still refuses everything else');

    const sessions = await fetch(`${baseUrl}/api/work-sessions`).then((read) => read.json());
    assert.equal(sessions.workSessions.find((candidate) => candidate.id === workSession.id).laneOverride, null);
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});

// Nothing on the board sends a human here any more, but the openUrl an MCP result hands back does
// travel — into a terminal, a message, another agent's summary. Followed from there, this page is
// the only surface that carries the reference, so it still has to lead back to the board.
test('the standalone reference page still leads back to the board', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-open-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const workSession = await store.createWorkSession({ title: 'Resume without a link' });
  const { agent } = await store.registerAgent(workSession.id, { provider: 'claude', role: 'implementer' });
  const { child, baseUrl } = await startDashboard(dataPath);

  try {
    const html = await fetch(`${baseUrl}/open/${workSession.id}/${agent.id}`).then((response) => response.text());
    assert.match(html, /<a href="\/">Return to dashboard<\/a>/, 'the way back should be a plain link to the board');
    assert.doesNotMatch(html, /window\.close\(\)/, 'a page reached by its own URL is not a tab the board opened');
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});

// A deep link is only useful if the redirector will actually follow it. The docs name the exact
// links an agent should register, so a scheme documented but not allow-listed would hand every
// card of that provider an Open button that goes nowhere.
test('every deep link the docs tell an agent to register is one the board opens', async () => {
  const docs = ['.agents/skills/agent-dashboard/SKILL.md', 'README.md'];
  const schemes = new Map();
  for (const doc of docs) {
    const text = await readFile(path.join(projectRoot, doc), 'utf8');
    for (const [, link, scheme] of text.matchAll(/`(([a-z][a-z0-9+.-]*):\/\/[^`\s]+)`/g)) {
      if (!schemes.has(scheme)) schemes.set(scheme, { doc, link });
    }
  }
  assert.ok(schemes.has('claude'), 'the docs should name the Claude Code deep link');
  assert.ok(schemes.has('codex'), 'the docs should name the Codex deep link');

  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-scheme-'));
  const dataPath = path.join(directory, 'dashboard.json');
  const store = new DashboardStore(dataPath);
  const workSession = await store.createWorkSession({ title: 'Open every documented link' });
  const registered = [];
  for (const [scheme, { doc, link }] of schemes) {
    // The documented forms carry <placeholders>, which are not part of a real recorded link.
    const sessionUrl = link.replaceAll(/<[^>]+>/g, 'documented-session-id');
    const { agent } = await store.registerAgent(workSession.id, { provider: 'other', role: 'implementer', sessionUrl });
    registered.push({ scheme, doc, sessionUrl, agentId: agent.id });
  }
  const { child, baseUrl } = await startDashboard(dataPath);

  try {
    for (const { scheme, doc, sessionUrl, agentId } of registered) {
      const response = await fetch(`${baseUrl}/open/${workSession.id}/${agentId}`, { redirect: 'manual' });
      await response.arrayBuffer();
      assert.equal(response.status, 302, `${doc} documents ${scheme}: but the board will not open it`);
      assert.equal(response.headers.get('location'), sessionUrl);
    }
  } finally {
    await stopDashboard(child);
    await rm(directory, { recursive: true, force: true });
  }
});
