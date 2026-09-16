const laneByStatus = {
  needs_input: 'attention',
  blocked: 'attention',
  stale: 'attention',
  working: 'active',
  handoff: 'handoff',
  done: 'done',
};

const demoWorkSessions = [
  {
    id: 'demo-surface-clean', title: 'Surface clean rings: isolate the roughing regression', issueNumber: 789,
    issueUrl: null, project: 'PureCutCNC', worktree: '/Projects/worktrees/purecutcnc/issue-789-surface-clean', branch: 'fix/issue-789-surface-clean',
    status: 'working', summary: 'The implementer is tracing the path while the reviewer holds a separate, read-only critique of the geometry seam.',
    nextAction: 'Compare the live trace against the expected ring order.', createdAt: '2026-09-15T22:00:00.000Z', updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    agents: [
      { id: 'demo-codex-implementer', name: 'Codex / geometry pass', provider: 'codex', role: 'implementer', providerSessionId: 'codex-demo-789', sessionUrl: null, status: 'working', summary: 'Focused fixture passes. Inspecting the live toolpath trace.', nextAction: 'Compare the next geometry trace.', createdAt: '2026-09-15T22:00:00.000Z', updatedAt: new Date(Date.now() - 6 * 60_000).toISOString(), messages: [{ id: 'demo-message-1', kind: 'progress', author: 'Codex / geometry pass', text: 'Registered the isolated worktree and chose a focused regression fixture.', createdAt: '2026-09-15T22:05:00.000Z' }] },
      { id: 'demo-claude-reviewer', name: 'Claude / review pass', provider: 'claude', role: 'reviewer', providerSessionId: 'claude-demo-789', sessionUrl: null, status: 'working', summary: 'Reading the current contract without touching the implementation.', nextAction: 'Review the proposed transition after the trace lands.', createdAt: '2026-09-15T22:08:00.000Z', updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(), messages: [{ id: 'demo-message-2', kind: 'review', author: 'Claude / review pass', text: 'The transition seam needs a live-output assertion, not a snapshot-only test.', createdAt: '2026-09-15T22:12:00.000Z' }] },
    ],
  },
  {
    id: 'demo-close-flow', title: 'Desktop close flow: confirm the unsaved-work prompt', issueNumber: null,
    issueUrl: null, project: 'PureCutCNC', worktree: '/Projects/worktrees/purecutcnc/desktop-close-flow', branch: 'fix/desktop-close-flow', status: 'needs_input',
    summary: 'The native flow has two reasonable choices and the implementer needs a product decision before changing behaviour.', nextAction: 'Choose whether Cancel restores the exact editing state.',
    createdAt: '2026-09-15T21:00:00.000Z', updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
    agents: [{ id: 'demo-dsh-implementer', name: 'DSH / browser and desktop pass', provider: 'dsh', role: 'implementer', providerSessionId: 'dsh-demo-790', sessionUrl: 'https://example.com/session/demo-790', status: 'needs_input', summary: 'Browser fallback is clear; native close behaviour needs confirmation.', nextAction: 'Choose the Cancel state restoration rule.', createdAt: '2026-09-15T21:00:00.000Z', updatedAt: new Date(Date.now() - 18 * 60_000).toISOString(), messages: [{ id: 'demo-message-3', kind: 'question', author: 'DSH / browser and desktop pass', text: 'Should Cancel preserve selected item and open panel, or only preserve the document?', createdAt: '2026-09-15T21:52:00.000Z' }] }],
  },
  {
    id: 'demo-docs', title: 'Generation-pipeline ownership note', issueNumber: 786, issueUrl: null, project: 'PureCutCNC', worktree: '/Projects/worktrees/purecutcnc/issue-786-docs', branch: 'docs/issue-786-generation-note', status: 'handoff',
    summary: 'The first agent stopped cleanly after recording enough context for a fresh reviewer or editor to finish.', nextAction: 'Resume from the handoff and make the final wording decision.',
    createdAt: '2026-09-15T20:00:00.000Z', updatedAt: new Date(Date.now() - 43 * 60_000).toISOString(),
    agents: [{ id: 'demo-claude-docs', name: 'Claude / documentation pass', provider: 'claude', role: 'implementer', providerSessionId: 'claude-demo-786', sessionUrl: null, status: 'handoff', summary: 'Docs check is green. A new session can finish the final review.', nextAction: 'Review the legacy worker-path wording.', createdAt: '2026-09-15T20:00:00.000Z', updatedAt: new Date(Date.now() - 43 * 60_000).toISOString(), messages: [{ id: 'demo-message-4', kind: 'handoff', author: 'Claude / documentation pass', text: 'Only remaining question: mention the legacy worker path in the diagram, or leave it code-adjacent?', createdAt: '2026-09-15T21:11:00.000Z' }] }],
  },
  {
    id: 'demo-design', title: 'Top and bottom machining setup semantics', issueNumber: 783, issueUrl: null, project: 'PureCutCNC', worktree: null, branch: 'design/issue-783-top-bottom', status: 'done',
    summary: 'The design review closed with a documented setup model.', nextAction: null, createdAt: '2026-09-15T17:00:00.000Z', updatedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    agents: [{ id: 'demo-opencode-design', name: 'OpenCode / design read-through', provider: 'opencode', role: 'reviewer', providerSessionId: 'opencode-demo-783', sessionUrl: null, status: 'done', summary: 'The design note is ready for the next review window.', nextAction: null, createdAt: '2026-09-15T17:00:00.000Z', updatedAt: new Date(Date.now() - 90 * 60_000).toISOString(), messages: [] }],
  },
];

const state = {
  workSessions: [],
  selected: null,
  demo: new URLSearchParams(location.search).has('demo'),
  deferredInstallPrompt: null,
  collapsedWorkSessionIds: new Set(),
};
const template = document.querySelector('#session-card-template');
const sheet = document.querySelector('#session-sheet');
const installButton = document.querySelector('#install-button');
const installStatus = document.querySelector('#install-status');
const sessionFrame = document.querySelector('#session-frame');
const sessionFrameTitle = document.querySelector('#session-frame-title');
const sessionFrameExternal = document.querySelector('#session-frame-external');
const sessionFrameView = document.querySelector('#session-frame-view');

function relativeTime(value) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const ranges = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.34524, 'week'], [12, 'month'], [Number.POSITIVE_INFINITY, 'year']];
  let duration = seconds;
  for (const [amount, unit] of ranges) {
    if (Math.abs(duration) < amount) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.trunc(duration), unit);
    duration /= amount;
  }
  return 'now';
}

function statusLabel(status) {
  return ({ working: 'working', needs_input: 'needs you', blocked: 'blocked', handoff: 'handoff', done: 'done', stale: 'quiet' })[status] ?? status;
}

function issueLabel(workSession) {
  return workSession.issueNumber ? `ISSUE #${workSession.issueNumber}` : 'WORK SESSION';
}

function agentOpenUrl(workSession, agent) {
  return agent.openUrl ?? `/open/${encodeURIComponent(workSession.id)}/${encodeURIComponent(agent.id)}`;
}

// Only a web GUI can be rendered in the panel. Custom schemes (codex:, vscode:, …) have no
// framed form, so those keep the plain new-tab link.
function isFrameableSessionUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function openSessionFrame(workSession, agent) {
  const target = agentOpenUrl(workSession, agent);
  sessionFrameTitle.textContent = agent.name;
  sessionFrameExternal.href = target;
  sessionFrameView.src = target;
  sessionFrame.showModal();
}

function createAgentOpenLink(workSession, agent, className = '') {
  const open = document.createElement('a');
  open.className = className;
  open.setAttribute('aria-label', `Open ${agent.name}`);
  if (state.demo) {
    open.textContent = 'Preview';
    open.setAttribute('aria-disabled', 'true');
    return open;
  }

  open.href = agentOpenUrl(workSession, agent);
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  if (isFrameableSessionUrl(agent.sessionUrl)) {
    open.textContent = 'Open here ⧉';
    open.title = 'Open the session inside the dashboard';
    // A plain click renders the session in the panel; modified clicks and middle clicks
    // keep the browser's own new-tab behaviour because the anchor is still a real link.
    open.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openSessionFrame(workSession, agent);
    });
  } else {
    // A custom scheme (codex:, vscode:, …) has to be navigated to directly. The OS handoff
    // is tied to the activating click, and routing it through /open/… gives the browser a
    // redirect to act on instead, which it may swallow. /open/… stays the target for an
    // agent with no recorded link, so its reference page still frees the session id.
    if (agent.sessionUrl) open.href = agent.sessionUrl;
    open.textContent = 'Open ↗';
  }
  return open;
}

async function deleteWorkSession(workSession) {
  const confirmed = window.confirm(`Delete “${workSession.title}”? This permanently removes its agents and message history.`);
  if (!confirmed) return;
  const response = await fetch(`/api/work-sessions/${encodeURIComponent(workSession.id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Dashboard deletion failed');
  if (state.selected?.id === workSession.id) sheet.close();
  await loadWorkSessions();
}

function clearLanes() {
  document.querySelectorAll('.lane').forEach((lane) => {
    lane.querySelector('.card-stack').replaceChildren();
    lane.querySelector('.lane-count').textContent = '0';
  });
}

function workspaceLabel(workSession) {
  return [workSession.branch, workSession.worktree].filter(Boolean).join(' · ') || 'no branch or worktree recorded';
}

function setCardCollapsed(card, collapseButton, collapsed) {
  card.classList.toggle('is-collapsed', collapsed);
  collapseButton.setAttribute('aria-expanded', String(!collapsed));
  collapseButton.setAttribute('aria-label', collapsed ? 'Expand card' : 'Collapse card');
  collapseButton.title = collapsed ? 'Expand card' : 'Collapse card';
}

function createCard(workSession) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.session-card');
  const main = fragment.querySelector('.card-main');
  const collapseButton = fragment.querySelector('.card-collapse');
  const cardDetails = fragment.querySelector('.card-details');
  const chip = fragment.querySelector('.status-chip');
  chip.dataset.status = workSession.status;
  chip.textContent = statusLabel(workSession.status);
  fragment.querySelector('time').textContent = relativeTime(workSession.updatedAt);
  fragment.querySelector('.issue-label').textContent = `${issueLabel(workSession)} · ${workSession.project ?? 'local'}`;
  fragment.querySelector('h3').textContent = workSession.title;
  fragment.querySelector('.summary').textContent = workSession.summary;
  cardDetails.id = `card-details-${workSession.id}`;
  collapseButton.setAttribute('aria-controls', cardDetails.id);
  const workspace = workspaceLabel(workSession);
  fragment.querySelector('.agent-summary-list').replaceChildren(...workSession.agents.map((agent) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = agent.name;
    const location = document.createElement('span');
    location.className = 'agent-workspace';
    location.textContent = workspace;
    location.title = workspace;
    details.append(name, location);
    item.append(details, createAgentOpenLink(workSession, agent, 'agent-summary-open'));
    return item;
  }));
  fragment.querySelector('.next-action').textContent = workSession.nextAction ?? 'No further action recorded';
  const openLink = fragment.querySelector('.open-link');
  openLink.href = `#work-session-${workSession.id}`;
  openLink.textContent = 'Inspect ↗';
  openLink.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showWorkSession(workSession); });
  const deleteButton = fragment.querySelector('.delete-session');
  if (state.demo) {
    deleteButton.remove();
  } else {
    deleteButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await deleteWorkSession(workSession);
      } catch {
        document.querySelector('#board-note').textContent = 'The local dashboard could not delete that work session.';
      }
    });
  }
  main.addEventListener('click', () => showWorkSession(workSession));
  const collapsed = state.collapsedWorkSessionIds.has(workSession.id);
  setCardCollapsed(card, collapseButton, collapsed);
  collapseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextCollapsed = !card.classList.contains('is-collapsed');
    if (nextCollapsed) {
      state.collapsedWorkSessionIds.add(workSession.id);
    } else {
      state.collapsedWorkSessionIds.delete(workSession.id);
    }
    setCardCollapsed(card, collapseButton, nextCollapsed);
  });
  card.dataset.workSessionId = workSession.id;
  return fragment;
}

function addEmptyState(lane, text) {
  const empty = document.createElement('p');
  empty.className = 'empty-lane';
  empty.textContent = text;
  lane.querySelector('.card-stack').append(empty);
}

function render() {
  clearLanes();
  const sessionsByLane = new Map([...document.querySelectorAll('.lane')].map((lane) => [lane.dataset.lane, []]));
  state.workSessions.forEach((workSession) => sessionsByLane.get(laneByStatus[workSession.status] ?? 'attention').push(workSession));
  sessionsByLane.forEach((workSessions, laneName) => {
    const lane = document.querySelector(`[data-lane="${laneName}"]`);
    lane.querySelector('.lane-count').textContent = workSessions.length;
    if (workSessions.length === 0) {
      addEmptyState(lane, laneName === 'attention' ? 'Nothing is waiting on you.' : 'No work sessions in this lane.');
      return;
    }
    workSessions.forEach((workSession) => lane.querySelector('.card-stack').append(createCard(workSession)));
  });
  const agents = state.workSessions.flatMap((workSession) => workSession.agents);
  const attention = state.workSessions.filter((workSession) => laneByStatus[workSession.status] === 'attention').length;
  document.querySelector('#total-count').textContent = state.workSessions.length;
  document.querySelector('#active-count').textContent = agents.filter((agent) => agent.status === 'working').length;
  document.querySelector('#attention-count').textContent = attention;
  document.querySelector('#board-note').textContent = state.demo
    ? 'Preview mode — these cards are illustrative only.'
    : attention ? 'An amber card means at least one agent is waiting on your judgment.' : 'The board is quiet. Agents will surface exceptions here.';
}

function allMessages(workSession) {
  return workSession.agents.flatMap((agent) => (agent.messages ?? []).map((message) => ({ ...message, agentName: agent.name })))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function showWorkSession(workSession) {
  state.selected = workSession;
  document.querySelector('#sheet-kicker').textContent = `${issueLabel(workSession)} / ${statusLabel(workSession.status).toUpperCase()}`;
  document.querySelector('#sheet-title').textContent = workSession.title;
  const meta = document.querySelector('#sheet-meta');
  meta.replaceChildren(...[workSession.project ?? 'local project', workSession.branch ?? 'no branch', relativeTime(workSession.updatedAt)].map((text) => {
    const tag = document.createElement('span'); tag.textContent = text; return tag;
  }));
  document.querySelector('#sheet-summary').textContent = workSession.summary;
  document.querySelector('#sheet-next-action').textContent = workSession.nextAction ?? 'No further action recorded.';
  const agentList = document.querySelector('#agent-list');
  document.querySelector('#agent-count').textContent = `${workSession.agents.length} agent${workSession.agents.length === 1 ? '' : 's'}`;
  agentList.replaceChildren(...workSession.agents.map((agent) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = agent.name;
    const subtitle = document.createElement('small'); subtitle.textContent = `${agent.provider} · ${agent.role} · ${statusLabel(agent.status)} · ${relativeTime(agent.updatedAt)}`;
    details.append(name, subtitle);
    item.append(details, createAgentOpenLink(workSession, agent));
    return item;
  }));
  const messages = allMessages(workSession);
  document.querySelector('#message-count').textContent = `${messages.length} message${messages.length === 1 ? '' : 's'}`;
  const list = document.querySelector('#message-list');
  list.replaceChildren(...messages.map((message) => {
    const item = document.createElement('li');
    item.dataset.kind = message.kind;
    const timestamp = document.createElement('time');
    timestamp.textContent = `${message.kind.toUpperCase()} · ${message.agentName} · ${relativeTime(message.createdAt)}`;
    item.append(timestamp, document.createTextNode(message.text));
    return item;
  }));
  const workSessionLink = document.querySelector('#sheet-open');
  if (workSession.issueUrl && !state.demo) {
    workSessionLink.href = workSession.issueUrl;
    workSessionLink.target = '_blank';
    workSessionLink.rel = 'noopener noreferrer';
    workSessionLink.textContent = 'Open linked issue ↗';
    workSessionLink.removeAttribute('aria-disabled');
  } else {
    workSessionLink.removeAttribute('href');
    workSessionLink.removeAttribute('target');
    workSessionLink.removeAttribute('rel');
    workSessionLink.textContent = state.demo ? 'Preview work-session card' : 'No work-session link recorded';
    workSessionLink.setAttribute('aria-disabled', 'true');
  }
  sheet.showModal();
}

async function loadWorkSessions() {
  if (state.demo) {
    state.workSessions = demoWorkSessions;
    document.querySelector('#refresh-state').textContent = 'PREVIEW';
    render();
    return;
  }
  try {
    const response = await fetch('/api/work-sessions', { cache: 'no-store' });
    if (!response.ok) throw new Error('Dashboard API failed');
    const payload = await response.json();
    state.workSessions = payload.workSessions;
    document.querySelector('#refresh-state').textContent = 'LIVE';
    render();
  } catch {
    document.querySelector('#refresh-state').textContent = 'OFFLINE';
    document.querySelector('#board-note').textContent = 'The local dashboard process is not responding.';
  }
}

function updateClock() {
  document.querySelector('#clock').textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function setInstallStatus(message) {
  installStatus.textContent = message;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  installButton.hidden = false;
  setInstallStatus('Ready to install');
});

installButton.addEventListener('click', async () => {
  const prompt = state.deferredInstallPrompt;
  if (!prompt) return;
  installButton.disabled = true;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setInstallStatus(outcome === 'accepted' ? 'Installing…' : 'Install dismissed');
  } finally {
    state.deferredInstallPrompt = null;
    installButton.hidden = true;
    installButton.disabled = false;
  }
});

window.addEventListener('appinstalled', () => {
  state.deferredInstallPrompt = null;
  installButton.hidden = true;
  setInstallStatus('Installed');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {
      setInstallStatus('Offline support unavailable');
    });
  });
}

document.querySelector('#sheet-close').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.close(); });
document.querySelector('#session-frame-close').addEventListener('click', () => sessionFrame.close());
sessionFrame.addEventListener('click', (event) => { if (event.target === sessionFrame) sessionFrame.close(); });
// Dropping the src on close stops the embedded session, its streams, and its polling.
sessionFrame.addEventListener('close', () => sessionFrameView.removeAttribute('src'));
updateClock();
void loadWorkSessions();
setInterval(updateClock, 1_000);
if (!state.demo) setInterval(() => void loadWorkSessions(), 5_000);
