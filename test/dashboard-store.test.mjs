import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DashboardStore } from '../lib/dashboard-store.mjs';

test('groups independently reported agent sessions under optional issue metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-'));
  const store = new DashboardStore(path.join(directory, 'dashboard.json'));
  try {
    const workSession = await store.createWorkSession({
      title: 'Trace a toolpath regression',
      project: 'PureCutCNC',
      worktree: '/worktrees/surface-clean',
      summary: 'The shared task is being investigated.',
    });
    const { agent: implementer } = await store.registerAgent(workSession.id, {
      provider: 'codex', role: 'implementer', summary: 'Fixture selected.',
    });
    const { agent: reviewer } = await store.registerAgent(workSession.id, {
      name: 'Claude geometry review', provider: 'claude', role: 'reviewer', summary: 'Reviewing the seam.',
    });
    await store.updateAgentProgress(workSession.id, reviewer.id, {
      status: 'needs_input', nextAction: 'Choose the accepted toolpath behaviour.',
    });
    await store.addMessage(workSession.id, implementer.id, {
      kind: 'progress', text: 'The focused fixture now reproduces the defect.',
    });

    const [stored] = await store.listWorkSessions();
    assert.equal(stored.issueNumber, null);
    assert.equal(stored.agents.length, 2);
    assert.equal(stored.agents.find((agent) => agent.id === reviewer.id).status, 'needs_input');
    assert.equal(stored.agents.find((agent) => agent.id === implementer.id).messages[0].kind, 'progress');
    assert.match(await readFile(path.join(directory, 'dashboard.json'), 'utf8'), /Claude geometry review/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('removes one work session and all of its nested agent history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-'));
  const store = new DashboardStore(path.join(directory, 'dashboard.json'));
  try {
    const removable = await store.createWorkSession({ title: 'Temporary session' });
    const retained = await store.createWorkSession({ title: 'Retained session' });
    const { agent } = await store.registerAgent(removable.id, { provider: 'codex', role: 'implementer' });
    await store.addMessage(removable.id, agent.id, { kind: 'progress', text: 'This history should leave with its session.' });

    const deleted = await store.deleteWorkSession(removable.id);
    const remaining = await store.listWorkSessions();

    assert.equal(deleted.id, removable.id);
    assert.deepEqual(remaining.map((workSession) => workSession.id), [retained.id]);
    assert.equal(await store.deleteWorkSession(removable.id), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps a provider session name alongside the provider session id', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-'));
  const store = new DashboardStore(path.join(directory, 'dashboard.json'));
  try {
    const workSession = await store.createWorkSession({ title: 'Resume path' });
    const { agent } = await store.registerAgent(workSession.id, {
      provider: 'dsh',
      role: 'implementer',
      providerSessionId: 'session-abc',
      sessionName: 'First pass',
    });
    assert.equal(agent.providerSessionId, 'session-abc');
    assert.equal(agent.sessionName, 'First pass');

    await store.updateAgentProgress(workSession.id, agent.id, { sessionName: 'Second pass' });

    const [stored] = await store.listWorkSessions();
    assert.equal(stored.agents[0].sessionName, 'Second pass');
    assert.equal(stored.agents[0].providerSessionId, 'session-abc');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
