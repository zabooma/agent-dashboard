#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  DashboardStore,
  LANES,
  MESSAGE_KINDS,
  PROVIDERS,
  ROLES,
  STATUSES,
} from './lib/dashboard-store.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');

function defaultDataPath() {
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
      'agent-dashboard',
      'dashboard.json',
    );
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const base = xdgDataHome && path.isAbsolute(xdgDataHome)
    ? xdgDataHome
    : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'agent-dashboard', 'dashboard.json');
}

const port = Number.parseInt(process.env.AGENT_DASHBOARD_PORT ?? '4380', 10);
const host = process.env.AGENT_DASHBOARD_HOST ?? '127.0.0.1';
const dashboardUrl = `http://${host}:${port}`;
const store = new DashboardStore(process.env.AGENT_DASHBOARD_DATA ?? defaultDataPath());

const optionalText = (maximum) => z.string().trim().min(1).max(maximum).nullable().optional();

// A host that spawns this server with a session-scoped environment can supply the
// session reference once instead of every agent supplying it. DSH scrubs DSH_*
// names from MCP children, so hosts must pass these two names explicitly.
const hostSessionId = () => process.env.AGENT_DASHBOARD_SESSION_ID?.trim() || null;
const hostSessionName = () => process.env.AGENT_DASHBOARD_SESSION_NAME?.trim() || null;
const withHostSessionDefaults = (input) => ({
  ...input,
  providerSessionId: input.providerSessionId ?? hostSessionId(),
  sessionName: input.sessionName ?? hostSessionName(),
});
const workSessionSchema = z.object({
  title: z.string().trim().min(1).max(180),
  issueNumber: z.number().int().positive().nullable().optional(),
  issueUrl: optionalText(2_000),
  project: optionalText(500),
  worktree: optionalText(1_000),
  branch: optionalText(300),
  summary: optionalText(2_000),
  nextAction: optionalText(1_000),
});

const agentSchema = z.object({
  workSessionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  provider: z.enum(PROVIDERS),
  role: z.enum(ROLES),
  providerSessionId: optionalText(300),
  sessionName: optionalText(200),
  sessionUrl: optionalText(2_000),
  status: z.enum(STATUSES).optional(),
  summary: optionalText(2_000),
  nextAction: optionalText(1_000),
});

const agentProgressInputSchema = z.object({
  workSessionId: z.string().uuid(),
  agentId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(ROLES).optional(),
  providerSessionId: optionalText(300),
  sessionName: optionalText(200),
  sessionUrl: optionalText(2_000),
  status: z.enum(STATUSES).optional(),
  summary: optionalText(2_000),
  nextAction: optionalText(1_000),
});

const agentProgressSchema = agentProgressInputSchema.refine(
  ({ workSessionId, agentId, ...patch }) => Object.values(patch).some((candidate) => candidate !== undefined),
  'Provide at least one field to update.',
);

const messageSchema = z.object({
  workSessionId: z.string().uuid(),
  agentId: z.string().uuid(),
  kind: z.enum(MESSAGE_KINDS),
  text: z.string().trim().min(1).max(4_000),
  author: optionalText(120),
});

const updateWorkSessionInputSchema = z.object({
  workSessionId: z.string().uuid(),
  title: z.string().trim().min(1).max(180).optional(),
  issueNumber: z.number().int().positive().nullable().optional(),
  issueUrl: optionalText(2_000),
  project: optionalText(500),
  worktree: optionalText(1_000),
  branch: optionalText(300),
  summary: optionalText(2_000),
  nextAction: optionalText(1_000),
});

const updateWorkSessionSchema = updateWorkSessionInputSchema.refine(
  ({ workSessionId, ...patch }) => Object.values(patch).some((candidate) => candidate !== undefined),
  'Provide at least one field to update.',
);

const statusPriority = { blocked: 0, needs_input: 1, stale: 2, working: 3, handoff: 4, done: 5 };

function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function latestTimestamp(workSession) {
  return workSession.agents.reduce(
    (latest, agent) => (agent.updatedAt > latest ? agent.updatedAt : latest),
    workSession.updatedAt,
  );
}

function sessionOverview(workSession) {
  const agents = [...workSession.agents]
    .sort((left, right) => statusPriority[left.status] - statusPriority[right.status])
    .map((agent) => ({
      ...agent,
      openUrl: `${dashboardUrl}/open/${workSession.id}/${agent.id}`,
    }));
  const leadAgent = agents[0] ?? null;
  return {
    ...workSession,
    agents,
    status: leadAgent?.status ?? 'handoff',
    updatedAt: latestTimestamp(workSession),
    summary: workSession.summary || leadAgent?.summary || 'No summary recorded.',
    nextAction: leadAgent?.status === 'blocked' || leadAgent?.status === 'needs_input'
      ? leadAgent.nextAction ?? workSession.nextAction
      : workSession.nextAction ?? leadAgent?.nextAction ?? null,
    openUrl: `${dashboardUrl}/#work-session-${workSession.id}`,
  };
}

function sessionAndAgentOverview(workSession, agent) {
  const overview = sessionOverview(workSession);
  return {
    workSession: overview,
    agent: overview.agents.find((candidate) => candidate.id === agent.id),
  };
}

function createMcpServer() {
  const server = new McpServer(
    { name: 'agent-dashboard', version: '0.2.0' },
    {
      instructions: [
        'A work session is a human-visible task card. An optional GitHub issue and worktree are attributes, not requirements.',
        'A work session can contain several agent sessions with distinct roles, such as implementer and reviewer.',
        'Call register_work_session once when the work begins, then register_agent once for each participating agent and retain both returned ids.',
        'Call update_agent_progress only for meaningful state changes. Use add_message for concise questions, blockers, reviews, or handoffs; never stream routine tool output.',
        'Each agent should record its provider session reference when it registers: providerSessionId, the id its provider uses to resume that conversation, plus sessionName when the host exposes a human-readable name. Never guess a session id or invent a URL.',
        'A human can place a card in a lane by hand from the board; that placement travels as laneOverride on the work session, and only the human clears it. Keep reporting your own status as usual — the override does not change it.',
        `The local dashboard is ${dashboardUrl}.`,
      ].join(' '),
    },
  );

  server.registerTool(
    'register_work_session',
    {
      title: 'Register a work session',
      description: 'Create one dashboard card for a unit of work. GitHub issue, project, worktree, and branch are optional metadata.',
      inputSchema: workSessionSchema.shape,
    },
    async (input) => {
      const workSession = await store.createWorkSession(workSessionSchema.parse(input));
      return toolResult({
        workSession: sessionOverview(workSession),
        dashboardUrl,
        reminder: 'Register each participating agent next and keep this workSession.id.',
      });
    },
  );

  server.registerTool(
    'update_work_session',
    {
      title: 'Update work-session context',
      description: 'Update shared work-session metadata or its human-facing summary and next action. This does not change any individual agent status.',
      inputSchema: updateWorkSessionInputSchema.shape,
    },
    async (input) => {
      const parsed = updateWorkSessionSchema.parse(input);
      const { workSessionId, ...patch } = parsed;
      const workSession = await store.updateWorkSession(workSessionId, patch);
      return toolResult({ workSession: sessionOverview(workSession), dashboardUrl });
    },
  );

  server.registerTool(
    'register_agent',
    {
      title: 'Register an agent in a work session',
      description: 'Add one participating agent. Record the reference a human needs to resume that conversation: providerSessionId (the provider resume id) and sessionName when the host exposes one. Set sessionUrl only to a real, verified browser URL or provider deep link.',
      inputSchema: agentSchema.shape,
    },
    async (input) => {
      const parsed = agentSchema.parse(input);
      const { workSessionId, ...agentInput } = parsed;
      const { workSession, agent } = await store.registerAgent(workSessionId, withHostSessionDefaults(agentInput));
      return toolResult({
        ...sessionAndAgentOverview(workSession, agent),
        dashboardUrl,
        reminder: 'Keep agent.id and use it in update_agent_progress and add_message.',
      });
    },
  );

  server.registerTool(
    'update_agent_progress',
    {
      title: 'Update an agent status',
      description: 'Report a meaningful status, summary, next action, or session-link change for one agent in the work session. This also records or refreshes providerSessionId, sessionName, and sessionUrl.',
      inputSchema: agentProgressInputSchema.shape,
    },
    async (input) => {
      const parsed = agentProgressSchema.parse(input);
      const { workSessionId, agentId, ...patch } = parsed;
      const { workSession, agent } = await store.updateAgentProgress(workSessionId, agentId, patch);
      return toolResult({ ...sessionAndAgentOverview(workSession, agent), dashboardUrl });
    },
  );

  server.registerTool(
    'add_message',
    {
      title: 'Add an agent message',
      description: 'Append a concise progress, question, blocker, review, handoff, or note to one agent in a work session.',
      inputSchema: messageSchema.shape,
    },
    async (input) => {
      const parsed = messageSchema.parse(input);
      const { workSessionId, agentId, ...messageInput } = parsed;
      const { workSession, agent, message } = await store.addMessage(workSessionId, agentId, messageInput);
      return toolResult({ ...sessionAndAgentOverview(workSession, agent), message, dashboardUrl });
    },
  );

  server.registerTool(
    'list_work_sessions',
    {
      title: 'List work sessions',
      description: 'Read the current dashboard cards, participating agents, and their messages.',
    },
    async () => toolResult({
      dashboardUrl,
      workSessions: (await store.listWorkSessions()).map(sessionOverview),
    }),
  );

  return server;
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(body)}\n`);
}

// A request the human got wrong, as opposed to one this process failed at. The two are answered
// differently on purpose: a bad lane name is a 400 with the list, not a 500 that blames the board.
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAXIMUM_BODY_BYTES = 16_384;

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAXIMUM_BODY_BYTES) throw new HttpError(413, 'The request body is too large.');
    chunks.push(chunk);
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request body must be JSON.');
  }
}

function writeHtml(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(body);
}

function canOpenSessionUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return ['http:', 'https:', 'codex:', 'claude:', 'opencode:', 'vscode:', 'cursor:'].includes(protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const copyIcon = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"></rect><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"></path></svg>';

function copyControl(label) {
  return `<button class="copy" type="button" data-label="${escapeHtml(label)}" aria-label="Copy ${escapeHtml(label)}">${copyIcon}<span class="sr-only">Copy ${escapeHtml(label)}</span></button>`;
}

function referenceRow(label, value, missing, { copyable = false } = {}) {
  const content = value
    ? `<code>${escapeHtml(value)}</code>`
    : `<span class="missing">${escapeHtml(missing)}</span>`;
  return `<div class="ref"><dt>${escapeHtml(label)}</dt><dd>${content}${value && copyable ? copyControl(label) : ''}</dd></div>`;
}

// Values mirror the board's two palettes in public/styles.css. This page is served on its own and
// never links that stylesheet, so the tokens are repeated here rather than shared.
const fallbackStyles = [
  ':root{color-scheme:light;--bg:#dfe2cf;--fg:#101714;--surface:#e8ead8;--line:#b0b9a0;--muted:#55665c;--accent:#3f6420;--code:#8a5205;--wash:#dde1cc}',
  ':root[data-theme=dark]{color-scheme:dark;--bg:#101714;--fg:#e8ead8;--surface:#17211d;--line:#405148;--muted:#94a69a;--accent:#b9e481;--code:#f6bd61;--wash:#1f2c27}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 ui-monospace,monospace;padding:48px}',
  'main{max-width:720px;border:1px solid var(--line);padding:28px;background:var(--surface)}',
  'h1{font-size:26px;margin:12px 0 20px}',
  '.eyebrow{margin:0;color:var(--muted);font-size:12px;letter-spacing:.12em}',
  'a{color:var(--accent)}',
  'code{overflow-wrap:anywhere;color:var(--code)}',
  '.refs{margin:24px 0 0;display:grid;gap:10px}',
  '.ref{display:grid;grid-template-columns:130px minmax(0,1fr);gap:12px;align-items:baseline}',
  '.ref dt{color:var(--muted);font-size:12px;letter-spacing:.08em;text-transform:uppercase}',
  '.ref dd{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
  '.missing{color:var(--muted)}',
  '.copy{display:inline-flex;align-items:center;gap:6px;padding:2px 7px;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--accent);font:inherit;font-size:12px;cursor:pointer}',
  '.copy:hover{background:var(--wash)}',
  '.copy[data-copied=true]{border-color:var(--accent);color:var(--fg)}',
  '.copy svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round}',
  '.hint{margin:22px 0 0;color:var(--muted);font-size:13px}',
  '.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
].join('');

// Same resolution rule as the board's inline boot script, kept ahead of the stylesheet so this
// interstitial does not flash the wrong palette either.
const fallbackThemeScript = `(()=>{let m=null;try{m=localStorage.getItem('agent-dashboard-theme')}catch(e){m=null}const d=m==='dark'||(m!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'})()`;

const fallbackScript = `
(() => {
  const copyText = async (value) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {
      // Fall through to the legacy path when the clipboard API is unavailable.
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '-1000px';
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    field.remove();
    return copied;
  };
  document.querySelectorAll('button.copy').forEach((button) => {
    const row = button.closest('.ref');
    const value = row ? row.querySelector('code') : null;
    if (!value) {
      button.remove();
      return;
    }
    button.addEventListener('click', async () => {
      const label = button.dataset.label || 'value';
      const status = button.querySelector('.sr-only');
      await copyText(value.textContent);
      button.dataset.copied = 'true';
      button.setAttribute('aria-label', 'Copied ' + label);
      status.textContent = 'Copied ' + label;
      window.setTimeout(() => {
        delete button.dataset.copied;
        button.setAttribute('aria-label', 'Copy ' + label);
        status.textContent = 'Copy ' + label;
      }, 1600);
    });
  });

})();
`.trim();

// The board answers its own Open button for a link-less agent, so nobody is sent here by a click on
// a card. This page is for a URL that travelled: the openUrl an MCP result hands back, pasted into a
// terminal or a message. It is a page, so it goes back to the board the ordinary way.
function openFallback(workSession, agent) {
  const rows = [
    referenceRow('Agent', agent.name, 'No agent name was registered.'),
    referenceRow('Provider', agent.provider, 'No provider recorded.'),
    referenceRow('Session name', agent.sessionName, 'No session name was registered.'),
    referenceRow('Session ID', agent.providerSessionId, 'No provider session reference was registered.', { copyable: true }),
    referenceRow('Worktree', workSession.worktree, 'No worktree recorded.', { copyable: true }),
  ].join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Session link unavailable</title><script>${fallbackThemeScript}</script><style>${fallbackStyles}</style></head>
    <body><main><p class="eyebrow">AGENT DASHBOARD / OPEN SESSION</p><h1>This agent has no verified app link.</h1>
    <p>Open this agent in ${escapeHtml(agent.provider)} and resume from the saved session reference.</p>
    <dl class="refs">${rows}</dl>
    <p class="hint">A missing value can be recorded with <code>register_agent</code> or <code>update_agent_progress</code>.</p>
    <p><a href="/">Return to dashboard</a></p></main>
    <script>${fallbackScript}</script></body></html>`;
}

async function serveStatic(response, fileName, contentType) {
  const body = await readFile(path.join(publicDir, fileName));
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(body);
}

async function handleHttp(request, response) {
  const requestUrl = new URL(request.url, dashboardUrl);
  try {
    const workSessionPrefix = '/api/work-sessions/';
    if (requestUrl.pathname.startsWith(workSessionPrefix)) {
      const workSessionId = decodeURIComponent(requestUrl.pathname.slice(workSessionPrefix.length));
      if (!workSessionId || workSessionId.includes('/')) {
        return writeJson(response, 400, { error: 'Provide one work-session id.' });
      }
      if (request.method === 'DELETE') {
        const deletedWorkSession = await store.deleteWorkSession(workSessionId);
        if (!deletedWorkSession) return writeJson(response, 404, { error: 'Work session not found.' });
        return writeJson(response, 200, {
          dashboardUrl,
          deletedWorkSession: { id: deletedWorkSession.id, title: deletedWorkSession.title },
        });
      }
      // The human moving a card by hand. The page is the only caller: an agent reports its status
      // through the MCP tools, and this endpoint deliberately cannot touch any of them.
      if (request.method === 'PATCH') {
        const body = await readJsonBody(request);
        if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'lane')) {
          throw new HttpError(400, 'Provide {"lane":"<lane>"} to place the card, or {"lane":null} to return it to its agents.');
        }
        if (body.lane !== null && !LANES.includes(body.lane)) {
          throw new HttpError(400, `No lane is named ${JSON.stringify(body.lane)}. Use one of ${LANES.join(', ')}, or null.`);
        }
        const workSession = await store.setLaneOverride(workSessionId, body.lane);
        if (!workSession) return writeJson(response, 404, { error: 'Work session not found.' });
        return writeJson(response, 200, { dashboardUrl, workSession: sessionOverview(workSession) });
      }
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: 'The local dashboard answers GET here; a work session can also be deleted or moved.' });
      return;
    }
    if (requestUrl.pathname === '/') return serveStatic(response, 'index.html', 'text/html; charset=utf-8');
    if (requestUrl.pathname === '/app.js') return serveStatic(response, 'app.js', 'text/javascript; charset=utf-8');
    if (requestUrl.pathname === '/board-state.js') return serveStatic(response, 'board-state.js', 'text/javascript; charset=utf-8');
    if (requestUrl.pathname === '/styles.css') return serveStatic(response, 'styles.css', 'text/css; charset=utf-8');
    if (requestUrl.pathname === '/manifest.webmanifest') return serveStatic(response, 'manifest.webmanifest', 'application/manifest+json; charset=utf-8');
    if (requestUrl.pathname === '/service-worker.js') return serveStatic(response, 'service-worker.js', 'text/javascript; charset=utf-8');
    if (requestUrl.pathname === '/app-icon.svg') return serveStatic(response, 'app-icon.svg', 'image/svg+xml');
    if (requestUrl.pathname === '/api/health') return writeJson(response, 200, { ok: true, dashboardUrl });
    if (requestUrl.pathname === '/api/work-sessions') {
      return writeJson(response, 200, {
        dashboardUrl,
        workSessions: (await store.listWorkSessions()).map(sessionOverview),
      });
    }
    if (requestUrl.pathname.startsWith('/open/')) {
      const [, , workSessionId, agentId] = requestUrl.pathname.split('/');
      const workSession = (await store.listWorkSessions()).find((candidate) => candidate.id === workSessionId);
      const agent = workSession?.agents.find((candidate) => candidate.id === agentId);
      if (!workSession || !agent) return writeHtml(response, 404, '<h1>Agent session not found</h1>');
      if (agent.sessionUrl && canOpenSessionUrl(agent.sessionUrl)) {
        response.writeHead(302, { Location: agent.sessionUrl, 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      return writeHtml(response, 200, openFallback(workSession, agent));
    }
    return writeJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    if (error instanceof HttpError) return writeJson(response, error.statusCode, { error: error.message });
    process.stderr.write(`[agent-dashboard] ${error.message}\n`);
    return writeJson(response, 500, { error: 'The dashboard could not complete that request.' });
  }
}

async function startDashboard() {
  const httpServer = createServer((request, response) => { void handleHttp(request, response); });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(`[agent-dashboard] Dashboard already available at ${dashboardUrl}\n`);
      return false;
    }
    throw error;
  });
  if (httpServer.listening) process.stderr.write(`[agent-dashboard] Dashboard available at ${dashboardUrl}\n`);
}

const dashboardOnly = process.argv.includes('--dashboard');
if (process.env.AGENT_DASHBOARD_DISABLE_HTTP === '1') {
  process.stderr.write('[agent-dashboard] HTTP dashboard disabled for this process.\n');
} else {
  await startDashboard();
}

if (!dashboardOnly) {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
