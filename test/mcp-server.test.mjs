import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = (result) => JSON.parse(result.content.find((item) => item.type === 'text').text);

test('the MCP server registers a work session and independent implementer/reviewer agents', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'server.mjs')],
    cwd: projectRoot,
    env: {
      ...process.env,
      AGENT_DASHBOARD_DATA: path.join(directory, 'dashboard.json'),
      AGENT_DASHBOARD_DISABLE_HTTP: '1',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'agent-dashboard-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'register_work_session'));
    assert.ok(tools.tools.some((tool) => tool.name === 'register_agent'));

    const workResult = await client.callTool({
      name: 'register_work_session',
      arguments: { title: 'Independent review of a prototype' },
    });
    const workSession = payload(workResult).workSession;
    assert.ok(workSession.id, JSON.stringify(payload(workResult)));
    const implementer = await client.callTool({
      name: 'register_agent',
      arguments: { workSessionId: workSession.id, provider: 'codex', role: 'implementer' },
    });
    const reviewer = await client.callTool({
      name: 'register_agent',
      arguments: { workSessionId: workSession.id, provider: 'claude', role: 'reviewer' },
    });
    assert.ok(payload(reviewer).agent.id, JSON.stringify(payload(reviewer)));
    const update = await client.callTool({
      name: 'update_agent_progress',
      arguments: {
        workSessionId: workSession.id,
        agentId: payload(reviewer).agent.id,
        status: 'needs_input',
        nextAction: 'Choose which interface direction to keep.',
      },
    });
    assert.notEqual(update.isError, true, JSON.stringify(update));
    assert.equal(payload(update).agent.status, 'needs_input');
    assert.equal(payload(update).workSession.status, 'needs_input');
    const sessions = await client.callTool({ name: 'list_work_sessions', arguments: {} });
    assert.equal(payload(sessions).workSessions[0].agents.length, 2);
    assert.equal(payload(implementer).agent.role, 'implementer');
    assert.equal(payload(sessions).workSessions[0].status, 'needs_input');
  } finally {
    await client.close();
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('the MCP server records the provider session reference, including host environment defaults', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-mcp-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, 'server.mjs')],
    cwd: projectRoot,
    env: {
      ...process.env,
      AGENT_DASHBOARD_DATA: path.join(directory, 'dashboard.json'),
      AGENT_DASHBOARD_DISABLE_HTTP: '1',
      AGENT_DASHBOARD_SESSION_ID: 'session-from-host-env',
      AGENT_DASHBOARD_SESSION_NAME: 'Host session title',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'agent-dashboard-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const registerAgentTool = tools.tools.find((tool) => tool.name === 'register_agent');
    assert.ok(registerAgentTool.inputSchema.properties.sessionName, JSON.stringify(registerAgentTool.inputSchema));

    const workSession = payload(await client.callTool({
      name: 'register_work_session',
      arguments: { title: 'Keep the resume path' },
    })).workSession;

    const fromHost = payload(await client.callTool({
      name: 'register_agent',
      arguments: { workSessionId: workSession.id, provider: 'dsh', role: 'implementer' },
    })).agent;
    assert.equal(fromHost.providerSessionId, 'session-from-host-env');
    assert.equal(fromHost.sessionName, 'Host session title');

    const explicit = payload(await client.callTool({
      name: 'register_agent',
      arguments: {
        workSessionId: workSession.id,
        provider: 'codex',
        role: 'reviewer',
        providerSessionId: 'codex-thread-1',
        sessionName: 'Codex review',
      },
    })).agent;
    assert.equal(explicit.providerSessionId, 'codex-thread-1');
    assert.equal(explicit.sessionName, 'Codex review');

    const renamed = payload(await client.callTool({
      name: 'update_agent_progress',
      arguments: { workSessionId: workSession.id, agentId: explicit.id, sessionName: 'Codex review, second pass' },
    })).agent;
    assert.equal(renamed.sessionName, 'Codex review, second pass');
    assert.equal(renamed.providerSessionId, 'codex-thread-1');
  } finally {
    await client.close();
    await transport.close();
    await rm(directory, { recursive: true, force: true });
  }
});
