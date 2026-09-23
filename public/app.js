import {
  acknowledge,
  acknowledgeAll,
  effectiveLane,
  isRepeatedDeleteClick,
  isStalled,
  isUnread,
  laneCollapseState,
  laneOverrideFor,
  notificationPlan,
  parseReadState,
  pruneReadState,
  serializeReadState,
  toggleLaneCollapse,
  unreadWorkSessions,
} from './board-state.js';

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
    id: 'demo-stalled', title: 'Flaky fixture: reruns that stopped mid-command', issueNumber: 791,
    issueUrl: null, project: 'PureCutCNC', worktree: '/Projects/worktrees/purecutcnc/issue-791-flaky-fixture', branch: 'fix/issue-791-flaky-fixture',
    status: 'working', summary: 'The implementer logged seven reruns of the same fixture and then went quiet mid-command. Silence is what a hit context limit looks like from the board; nothing here proves it was one.',
    nextAction: 'Check the session — resume it, or take the fixture over in a fresh one.',
    createdAt: '2026-09-15T21:30:00.000Z', updatedAt: new Date(Date.now() - 24 * 60_000).toISOString(),
    agents: [{ id: 'demo-codex-stalled', name: 'Codex / fixture reruns', provider: 'codex', role: 'implementer', providerSessionId: 'codex-demo-791', sessionUrl: null, status: 'working', summary: 'Seven reruns, the same failure, then no further update.', nextAction: 'Resume the rerun loop or hand the fixture over.', createdAt: '2026-09-15T21:30:00.000Z', updatedAt: new Date(Date.now() - 24 * 60_000).toISOString(), messages: [{ id: 'demo-message-5', kind: 'progress', author: 'Codex / fixture reruns', text: 'Rerun 7 failed identically. Capturing the seed and the toolpath dump next.', createdAt: '2026-09-15T21:34:00.000Z' }] }],
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

// The two things a human needs to tell apart on this board: a card that is waiting on them, and a
// card they have not looked at yet. The first is derived from the agent statuses, the second is
// stored here. Neither is allowed to overwrite the other.
const READ_STATE_KEY = 'agent-dashboard-read-state';
const ALERTS_KEY = 'agent-dashboard-alerts';

const state = {
  workSessions: [],
  selected: null,
  demo: new URLSearchParams(location.search).has('demo'),
  deferredInstallPrompt: null,
  collapsedWorkSessionIds: new Set(),
  // Which card has its Move panel open. The board repaints every five seconds, so this is what lets
  // an open panel survive a poll instead of folding itself up under the pointer.
  openMovePanelId: null,
  readState: parseReadState(null),
  alerts: false,
  // Set from a notification click or a `?work-session=` link, consumed by the first load that can
  // find the card. Held here rather than read from the address bar every poll, which would reopen
  // the panel over and over.
  pendingWorkSessionId: new URLSearchParams(location.search).get('work-session'),
};
const template = document.querySelector('#session-card-template');
const sheet = document.querySelector('#session-sheet');
const installButton = document.querySelector('#install-button');
const installStatus = document.querySelector('#install-status');
const alertButton = document.querySelector('#alert-button');
const attentionAck = document.querySelector('#attention-ack');
const sessionFrame = document.querySelector('#session-frame');
const sessionFrameTitle = document.querySelector('#session-frame-title');
const sessionFrameExternal = document.querySelector('#session-frame-external');
const sessionFrameView = document.querySelector('#session-frame-view');
const sessionReference = document.querySelector('#session-reference');
const sessionReferenceLede = document.querySelector('#reference-lede');
const sessionReferenceFacts = document.querySelector('#reference-facts');
const themeSwitch = document.querySelector('.theme-switch');
const themeInputs = [...document.querySelectorAll('input[name="theme"]')];

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

// An agent with no recorded link has nothing to hand off to, and everything its reference page
// prints — provider, session name, session id, worktree — is already on the board. Opening a tab to
// be told there is no link, and then having to close that tab again, is the long way round to five
// facts the card is holding. /open/… stays a real page for anyone who arrives with its URL.
function showSessionReference(workSession, agent) {
  sessionReferenceLede.textContent = `Open this agent in ${agent.provider} and resume from the saved session reference.`;
  sessionReferenceFacts.replaceChildren(
    createFactRow('Agent', agent.name, { missing: 'no agent name was registered' }),
    createFactRow('Provider', agent.provider, { missing: 'no provider recorded' }),
    createFactRow('Session name', agent.sessionName ?? null, { missing: 'no session name was registered' }),
    createFactRow('Session ID', agent.providerSessionId ?? null, { missing: 'no provider session reference was registered', copyable: true }),
    createFactRow('Worktree', workSession.worktree ?? null, { missing: 'no worktree recorded', copyable: true }),
  );
  sessionReference.showModal();
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
  } else if (agent.sessionUrl) {
    // A custom scheme (codex:, vscode:, …) has to be navigated to directly. The OS handoff
    // is tied to the activating click, and routing it through /open/… gives the browser a
    // redirect to act on instead, which it may swallow.
    open.href = agent.sessionUrl;
    open.textContent = 'Open ↗';
  } else {
    // Nothing to open: the saved reference is the whole answer, and it opens in place. The anchor
    // keeps pointing at /open/… so a modified or middle click still gets the standalone page.
    open.textContent = 'Open ⧉';
    open.title = 'No verified app link: show the saved session reference';
    open.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      showSessionReference(workSession, agent);
    });
  }
  return open;
}

// The last deletion the human actually confirmed, and where the pointer was when they asked for it.
// `isRepeatedDeleteClick` reads it: a modal confirm blocks the renderer, so a click that arrives while
// the dialog is up is replayed after the board has repainted, onto whatever card now occupies those
// pixels. Recorded when the confirmation is accepted rather than when the button is clicked, so a
// Cancel can still be followed immediately by a deliberate second attempt.
let confirmedDelete = null;

async function deleteWorkSession(workSession, point) {
  const confirmed = window.confirm(`Delete “${workSession.title}”? This permanently removes its agents and message history.`);
  if (!confirmed) return;
  confirmedDelete = { ...point, at: Date.now() };
  const response = await fetch(`/api/work-sessions/${encodeURIComponent(workSession.id)}`, { method: 'DELETE' });
  // A card that is already gone is the state the human asked for, not a failure: a second tab, or a
  // click replayed out of the dialog, can arrive here after the deletion has already happened.
  if (!response.ok && response.status !== 404) throw new Error('Dashboard deletion failed');
  if (state.selected?.id === workSession.id) sheet.close();
  await loadWorkSessions();
}

// Moving a card by hand. The four columns this control offers are read back out of the markup the
// board actually drew, in board order, rather than from a list here — a lane renamed in index.html is
// renamed in the control too, and the two can never disagree about what the board holds.
function laneTargets() {
  return [...document.querySelectorAll('.lane')].map((lane) => ({
    lane: lane.dataset.lane,
    label: lane.querySelector('h2')?.textContent?.trim() || lane.dataset.lane,
  }));
}

function setMovePanelOpen(card, open) {
  const panel = card.querySelector('.card-move');
  const button = card.querySelector('.move-session');
  if (!panel || !button) return;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

function closeMovePanels() {
  state.openMovePanelId = null;
  document.querySelectorAll('.session-card').forEach((card) => setMovePanelOpen(card, false));
}

// One row per lane, with the card's current lane marked rather than hidden: the human needs to see
// where it is to know what moving it would change.
function buildMovePanel(workSession, panel) {
  const current = effectiveLane(workSession);
  panel.querySelector('.card-move-lanes').replaceChildren(...laneTargets().map(({ lane, label }) => {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'move-target';
    // Deliberately not `data-lane`: a card lives inside a lane, so a lane-named attribute on a control
    // sits *earlier* in the document than the column it names. `document.querySelector('[data-lane=…]')`
    // then finds this button instead of the lane — which cost the board every lane after the first, and
    // reported OFFLINE with one card drawn, on the throwaway board this was built against.
    target.dataset.moveTo = lane;
    target.textContent = label;
    if (lane === current) {
      target.setAttribute('aria-current', 'true');
      target.setAttribute('aria-label', `${label}, the lane this card is in`);
      target.title = `This card is already in ${label}.`;
    } else {
      target.setAttribute('aria-label', `Move this card to ${label}`);
      target.title = `Move this card to ${label}`;
    }
    target.addEventListener('click', () => {
      if (lane === effectiveLane(workSession)) {
        closeMovePanels();
        return;
      }
      void moveWorkSession(workSession, lane);
    });
    return target;
  }));
  const reset = panel.querySelector('.card-move-reset');
  reset.hidden = !laneOverrideFor(workSession);
  reset.title = 'Hand this card back to its agents, so their statuses decide its lane again.';
  reset.addEventListener('click', () => void moveWorkSession(workSession, null));
}

function reportMoveFailure(error) {
  const note = document.querySelector('#board-note');
  if (error.status === 405) {
    note.textContent = 'This dashboard process is older than the page and cannot move cards yet. Restart it, then reload.';
    return;
  }
  if (error.status === 404) {
    note.textContent = 'That card is no longer on the board.';
    return;
  }
  note.textContent = 'The board could not move that card. It is still where you left it.';
}

// A move is a placement and nothing else: the request carries a lane, the server stores it beside the
// card, and no agent is touched. Nothing is redrawn optimistically — the board repaints from the
// server's answer, so a failed move leaves the card where the human found it rather than showing a
// position it never took.
async function moveWorkSession(workSession, lane) {
  state.openMovePanelId = null;
  if (state.demo) {
    workSession.laneOverride = lane ? { lane, at: new Date().toISOString() } : null;
  } else {
    let payload = null;
    try {
      const response = await fetch(`/api/work-sessions/${encodeURIComponent(workSession.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lane }),
      });
      if (!response.ok) {
        const error = new Error('Dashboard move failed');
        error.status = response.status;
        throw error;
      }
      payload = await response.json();
    } catch (error) {
      reportMoveFailure(error);
      if (error.status === 404) await loadWorkSessions();
      return;
    }
    workSession.laneOverride = payload.workSession?.laneOverride ?? null;
  }
  // A card the human just moved is not news to them: without this, one placed in Attention would
  // arrive wearing the "New" badge the board raises for a card that got there on its own.
  state.readState = acknowledge(state.readState, workSession);
  persistReadState();
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

function storedReadState() {
  try {
    return parseReadState(localStorage.getItem(READ_STATE_KEY));
  } catch (error) {
    // Storage can be blocked outright; the board still works, it just forgets what was read.
    return parseReadState(null);
  }
}

function persistReadState() {
  try {
    localStorage.setItem(READ_STATE_KEY, serializeReadState(state.readState));
  } catch (error) {
    // Nothing to do: the highlight is still correct for this page view.
  }
}

function storeValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function setStoreValue(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (error) {
    // The preference applies to this page view only.
  }
}

function notificationsAvailable() {
  return typeof window.Notification === 'function';
}

function notificationPermission() {
  return notificationsAvailable() ? window.Notification.permission : 'denied';
}

// Permission and intent are separate: the browser remembers the permission, the board remembers
// whether the human actually wants banners. Turning alerts off must not need a browser trip.
function alertsWanted() {
  return storeValue(ALERTS_KEY) === 'on' && notificationPermission() === 'granted';
}

function refreshAlertControl() {
  if (!notificationsAvailable()) {
    alertButton.hidden = true;
    return;
  }
  alertButton.hidden = false;
  const permission = notificationPermission();
  if (permission === 'denied') {
    alertButton.disabled = true;
    alertButton.textContent = 'Alerts blocked';
    alertButton.title = 'This browser is blocking notifications for the board. Allow them in the site settings, then reload.';
    alertButton.removeAttribute('aria-pressed');
    return;
  }
  alertButton.disabled = false;
  alertButton.setAttribute('aria-pressed', String(state.alerts));
  alertButton.textContent = state.alerts ? 'Alerts on' : 'Get alerts';
  alertButton.title = state.alerts
    ? 'Stop desktop notifications for cards that land in Attention'
    : 'Show a desktop notification when a card lands in Attention';
}

async function toggleAlerts() {
  if (state.alerts) {
    state.alerts = false;
    setStoreValue(ALERTS_KEY, null);
    refreshAlertControl();
    return;
  }
  if (notificationPermission() !== 'granted') {
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') {
      refreshAlertControl();
      if (permission === 'denied') alertButton.title = 'This browser is blocking notifications for the board.';
      return;
    }
  }
  state.alerts = true;
  setStoreValue(ALERTS_KEY, 'on');
  refreshAlertControl();
}

// A banner is only worth the interruption if the human is looking at something else. When the board
// is the focused window, the new highlight has already said it — and the card is latched either way,
// so walking away afterwards does not produce a stale banner for something already on screen.
async function showAttentionNotification(workSession) {
  const title = `${statusLabel(workSession.status)} · ${workSession.title}`;
  const options = {
    body: workSession.nextAction ?? workSession.summary ?? 'This card is waiting on you.',
    tag: `agent-dashboard-${workSession.id}`,
    data: { workSessionId: workSession.id },
    icon: '/app-icon.svg',
    badge: '/app-icon.svg',
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
    const notification = new window.Notification(title, options);
    notification.onclick = () => { window.focus(); focusWorkSession(workSession.id); };
  } catch (error) {
    // A refused banner is not a board failure; the card keeps its highlight in the lane.
  }
}

// Opening a card is the acknowledgement gesture. The card stays in Attention, because "I have seen
// this" and "this still needs me" are different facts, and only the second one clears the highlight.
function markSeen(workSession) {
  if (!isUnread(state.readState, workSession)) return false;
  state.readState = acknowledge(state.readState, workSession);
  persistReadState();
  return true;
}

function focusWorkSession(workSessionId) {
  const workSession = state.workSessions.find((candidate) => candidate.id === workSessionId);
  if (workSession) showWorkSession(workSession);
}

// Runs after every successful load: forget records for cards that no longer exist, take the
// notification latch, then repaint. Taking the latch whether or not a banner is shown is what keeps
// the banner to one per arrival in Attention.
function afterLoad() {
  const before = serializeReadState(state.readState);
  state.readState = pruneReadState(state.readState, state.workSessions);
  const plan = notificationPlan(state.readState, state.workSessions);
  state.readState = plan.readState;
  if (serializeReadState(state.readState) !== before) persistReadState();
  render();
  if (state.pendingWorkSessionId) {
    const target = state.pendingWorkSessionId;
    state.pendingWorkSessionId = null;
    focusWorkSession(target);
  }
  if (state.demo || !state.alerts || document.hasFocus()) return;
  plan.send.forEach((workSession) => void showAttentionNotification(workSession));
}

function createCard(workSession, unread) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.session-card');
  const main = fragment.querySelector('.card-main');
  const collapseButton = fragment.querySelector('.card-collapse');
  const cardDetails = fragment.querySelector('.card-details');
  const chip = fragment.querySelector('.status-chip');
  chip.dataset.status = workSession.status;
  chip.textContent = statusLabel(workSession.status);
  fragment.querySelector('.new-badge').hidden = !unread;
  card.classList.toggle('is-new', unread);
  // Derived from silence rather than declared, so it is advisory and never moves the card: the lane
  // below is chosen from the status alone. The title deliberately states no threshold — a number
  // written here would drift away from STALL_AFTER_MS the first time someone tunes it.
  const stalled = isStalled(workSession);
  const stallChip = fragment.querySelector('.stall-chip');
  stallChip.hidden = !stalled;
  if (stalled) {
    stallChip.title = 'Still reporting working, but no agent has updated this card for a while. The session may have hit a limit or been stopped.';
  }
  // A card a human placed by hand says so, in its own chip, next to the status chip that still reports
  // what the agents said. Without it the board would quietly pass a human's placement off as an
  // agent's own report — which is the one thing this board must never do.
  const override = laneOverrideFor(workSession);
  const movedChip = fragment.querySelector('.moved-chip');
  movedChip.hidden = !override;
  if (override) {
    const laneName = laneTargets().find((target) => target.lane === override)?.label ?? override;
    movedChip.title = `You moved this card to ${laneName} by hand ${relativeTime(workSession.laneOverride?.at ?? workSession.updatedAt)}. Agent updates will not move it back until you return it to them.`;
  }
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
      const point = { x: event.clientX, y: event.clientY };
      // The second half of a double-click is one instruction, not two: without this the dialog opens
      // again for whichever card slid into those pixels while the first one was being read.
      if (isRepeatedDeleteClick(confirmedDelete, point)) return;
      try {
        await deleteWorkSession(workSession, point);
      } catch {
        document.querySelector('#board-note').textContent = 'The local dashboard could not delete that work session.';
      }
    });
  }
  const moveButton = fragment.querySelector('.move-session');
  const movePanel = fragment.querySelector('.card-move');
  movePanel.id = `card-move-${workSession.id}`;
  moveButton.setAttribute('aria-controls', movePanel.id);
  moveButton.setAttribute('aria-label', `Move ${workSession.title} to another lane`);
  buildMovePanel(workSession, movePanel);
  moveButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = state.openMovePanelId !== workSession.id;
    closeMovePanels();
    if (open) {
      state.openMovePanelId = workSession.id;
      setMovePanelOpen(card, true);
    }
  });
  // The panel is part of the card, so the board's own repaint closes it. State is what reopens it on
  // the other side of a poll, which is the difference between a control that survives five seconds and
  // one that folds itself up under the pointer.
  if (state.openMovePanelId === workSession.id) setMovePanelOpen(card, true);
  main.addEventListener('click', () => showWorkSession(workSession));
  const collapsed = state.collapsedWorkSessionIds.has(workSession.id);
  setCardCollapsed(card, collapseButton, collapsed);
  collapseButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextCollapsed = !card.classList.contains('is-collapsed');
    if (nextCollapsed) {
      state.collapsedWorkSessionIds.add(workSession.id);
      // The footer is hidden while a card is collapsed, so its Move panel goes with it.
      if (state.openMovePanelId === workSession.id) closeMovePanels();
    } else {
      state.collapsedWorkSessionIds.delete(workSession.id);
    }
    setCardCollapsed(card, collapseButton, nextCollapsed);
    // A single card reopening leaves the lane no longer entirely shut, and the lane's own button has
    // to stop offering "Expand all" the moment that becomes true rather than at the next poll.
    refreshLaneToggles(groupSessionsByLane());
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

// The board's own layout decides the lanes, so every lane the markup carries gets an entry even
// when it holds nothing — an unknown status still lands somewhere, because `laneFor` defaults to
// Attention rather than dropping the card. A card a human placed by hand is grouped by that
// placement: the override is the whole reason the control exists.
//
// Every lookup names the lane element, not just the attribute: a card sits inside a lane, so any
// control inside a card that carries a lane name would be matched first for a lane that comes later.
function laneElement(laneName) {
  return document.querySelector(`.lane[data-lane="${laneName}"]`);
}

function groupSessionsByLane() {
  const sessionsByLane = new Map([...document.querySelectorAll('.lane')].map((lane) => [lane.dataset.lane, []]));
  state.workSessions.forEach((workSession) => sessionsByLane.get(effectiveLane(workSession)).push(workSession));
  return sessionsByLane;
}

// The lane buttons are static markup, so a re-render replaces the cards they act on but never the
// buttons themselves — which is what keeps focus on the button through the click. Only the state,
// the tooltip, and the hidden flag are refreshed here, after the cards behind them are rebuilt.
//
// The control is the card's collapse button, so it carries no visible label: the lane's own count
// badge sits beside it and the tooltip states the number, which keeps the heading exactly as tall as
// it is without the control.
function refreshLaneToggles(sessionsByLane) {
  sessionsByLane.forEach((workSessions, laneName) => {
    const lane = laneElement(laneName);
    const button = lane?.querySelector('.lane-collapse');
    if (!button) return;
    const { total, allCollapsed } = laneCollapseState(state.collapsedWorkSessionIds, workSessions.map((workSession) => workSession.id));
    // A lane with nothing in it has nothing to collapse, and a control that does nothing when
    // clicked is worse than no control at all.
    button.hidden = total === 0;
    lane.classList.toggle('is-collapsed', allCollapsed);
    const cards = `${total} card${total === 1 ? '' : 's'}`;
    button.setAttribute('aria-expanded', String(!allCollapsed));
    button.setAttribute('aria-label', allCollapsed ? `Expand all ${cards} in this lane` : `Collapse all ${cards} in this lane`);
    button.title = allCollapsed ? `Expand all ${cards} in this lane` : `Collapse all ${cards} in this lane`;
  });
}

function render() {
  clearLanes();
  const unread = new Set(unreadWorkSessions(state.readState, state.workSessions).map((workSession) => workSession.id));
  const sessionsByLane = groupSessionsByLane();
  sessionsByLane.forEach((workSessions, laneName) => {
    const lane = laneElement(laneName);
    lane.querySelector('.lane-count').textContent = workSessions.length;
    if (workSessions.length === 0) {
      addEmptyState(lane, laneName === 'attention' ? 'Nothing is waiting on you.' : 'No work sessions in this lane.');
      return;
    }
    workSessions.forEach((workSession) => lane.querySelector('.card-stack').append(createCard(workSession, unread.has(workSession.id))));
  });
  refreshLaneToggles(sessionsByLane);
  const agents = state.workSessions.flatMap((workSession) => workSession.agents);
  // Counted by lane rather than by status, so the tally agrees with the columns the human is looking
  // at: a card they moved out of Attention is one they have taken off that list themselves.
  const attention = state.workSessions.filter((workSession) => effectiveLane(workSession) === 'attention').length;
  document.querySelector('#total-count').textContent = state.workSessions.length;
  document.querySelector('#active-count').textContent = agents.filter((agent) => agent.status === 'working').length;
  document.querySelector('#attention-count').textContent = attention;
  // The tab is the only part of the board visible while another app has focus, so the unread count
  // rides in the title as well as on the cards.
  document.title = unread.size ? `(${unread.size}) Agent Dashboard` : 'Agent Dashboard';
  attentionAck.hidden = unread.size === 0;
  attentionAck.textContent = `Mark ${unread.size} seen`;
  document.querySelector('#board-note').textContent = state.demo
    ? 'Preview mode — these cards are illustrative only.'
    : unread.size
      ? `${unread.size} card${unread.size === 1 ? '' : 's'} arrived since you last looked.`
      : attention ? 'An amber card means at least one agent is waiting on your judgment.' : 'The board is quiet. Agents will surface exceptions here.';
}

function allMessages(workSession) {
  return workSession.agents.flatMap((agent) => (agent.messages ?? []).map((message) => ({ ...message, agentName: agent.name })))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

// The clipboard API needs a secure context, and the board can be reached over a LAN address where
// `navigator.clipboard` does not exist. The textarea path is what keeps the copy buttons working
// there — a copy control that silently does nothing is worse than no button.
async function copyText(value, anchor = null) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (error) {
    // Fall through to the legacy path: the API can also reject on a permission or focus problem.
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '-1000px';
  // The sheet is a modal <dialog>, which makes everything outside it inert — and a selection inside
  // an inert subtree is empty, so a scratch field parked in <body> copies nothing while
  // `execCommand('copy')` still reports success. Anchor it inside the dialog the human clicked in:
  // with the reference panel stacked over the sheet, the first open dialog in the document is the
  // inert one underneath.
  (anchor?.closest('dialog[open]') ?? document.querySelector('dialog[open]') ?? document.body).append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (error) {
    copied = false;
  }
  field.remove();
  return copied;
}

function createCopyButton(label, value) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sheet-copy';
  button.textContent = 'Copy';
  button.title = `Copy ${label}`;
  button.setAttribute('aria-label', `Copy ${label}`);
  button.addEventListener('click', async () => {
    const copied = await copyText(value, button);
    button.dataset.copied = String(copied);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    button.setAttribute('aria-label', copied ? `Copied ${label}` : `Could not copy ${label}`);
    window.setTimeout(() => {
      delete button.dataset.copied;
      button.textContent = 'Copy';
      button.setAttribute('aria-label', `Copy ${label}`);
    }, 1600);
  });
  return button;
}

// One row per recorded fact. The value wraps instead of clipping, and the pasteable ones carry a
// copy button, so the sheet is a resume surface: whatever it shows can be handed straight to a
// terminal.
function createFactRow(label, value, { missing = 'not recorded', href = null, copyable = false } = {}) {
  const row = document.createElement('div');
  row.className = 'sheet-fact';
  const term = document.createElement('dt');
  term.textContent = label;
  const detail = document.createElement('dd');
  if (value) {
    const field = document.createElement(href ? 'a' : 'code');
    field.className = 'sheet-fact-value';
    field.textContent = value;
    if (href) {
      field.href = href;
      field.target = '_blank';
      field.rel = 'noopener noreferrer';
    } else {
      field.title = value;
    }
    detail.append(field);
    if (copyable) detail.append(createCopyButton(label.toLowerCase(), value));
  } else {
    const absent = document.createElement('span');
    absent.className = 'sheet-fact-missing';
    absent.textContent = missing;
    detail.append(absent);
  }
  row.append(term, detail);
  return row;
}

function renderSheetFacts(workSession) {
  // Only the three values a human pastes into a terminal get a copy button; the issue is a link and
  // the timestamp is read, not reused.
  const issueValue = workSession.issueNumber ? `#${workSession.issueNumber}` : workSession.issueUrl ?? null;
  document.querySelector('#sheet-facts').replaceChildren(
    createFactRow('Repository', workSession.project ?? null, { missing: 'no repository recorded', copyable: true }),
    createFactRow('Branch', workSession.branch ?? null, { missing: 'no branch recorded', copyable: true }),
    createFactRow('Worktree', workSession.worktree ?? null, { missing: 'no worktree recorded', copyable: true }),
    createFactRow('Issue', issueValue, { missing: 'no issue recorded', href: workSession.issueUrl ?? null }),
    createFactRow('Updated', relativeTime(workSession.updatedAt)),
  );
}

function showWorkSession(workSession) {
  state.selected = workSession;
  // Reading a card is what clears its highlight; the card itself stays in Attention until an agent
  // moves it, so acknowledging can never hide work that is still waiting.
  if (markSeen(workSession)) render();
  document.querySelector('#sheet-kicker').textContent = `${issueLabel(workSession)} / ${statusLabel(workSession.status).toUpperCase()}`;
  document.querySelector('#sheet-title').textContent = workSession.title;
  renderSheetFacts(workSession);
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
    afterLoad();
    return;
  }
  try {
    const response = await fetch('/api/work-sessions', { cache: 'no-store' });
    if (!response.ok) throw new Error('Dashboard API failed');
    const payload = await response.json();
    state.workSessions = payload.workSessions;
    document.querySelector('#refresh-state').textContent = 'LIVE';
    afterLoad();
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

// The inline boot script in index.html has already applied the theme for first paint; this half
// owns the control. "system" is stored as an absent key rather than a literal, so an OS change
// reaches every page that follows the system. The resolution rule is duplicated there because an
// inline script cannot import a module — test/theme.test.mjs pins both copies to the same cases.
const THEME_STORAGE_KEY = 'agent-dashboard-theme';
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

function storedThemeMode() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch (error) {
    return 'system';
  }
}

function resolvedTheme(mode) {
  return mode === 'system' ? (systemPrefersDark.matches ? 'dark' : 'light') : mode;
}

function applyTheme(mode, { persist = false } = {}) {
  const theme = resolvedTheme(mode);
  document.documentElement.dataset.theme = theme;
  themeInputs.forEach((input) => { input.checked = input.value === mode; });
  // Read the address-bar colour back out of the palette rather than repeating it here, so
  // changing a surface cannot leave the browser chrome on the old value. The inline boot script
  // keeps its own literals because it runs before the stylesheet has been applied.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (!persist) return;
  try {
    if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch (error) {
    // Storage is unavailable; the choice still applies to this page view.
  }
}

// Delegated, so the handler reads the radio that actually changed rather than re-deriving it.
themeSwitch.addEventListener('change', (event) => {
  if (event.target.name === 'theme') applyTheme(event.target.value, { persist: true });
});
// Only a page still following the system should react to the OS flipping.
systemPrefersDark.addEventListener('change', () => { if (storedThemeMode() === 'system') applyTheme('system'); });
window.addEventListener('storage', (event) => { if (event.key === THEME_STORAGE_KEY) applyTheme(storedThemeMode()); });

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
  // A banner click focuses the board in the worker; which card it was about arrives here.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'open-work-session') focusWorkSession(event.data.workSessionId);
  });
}

alertButton.addEventListener('click', () => void toggleAlerts());
attentionAck.addEventListener('click', () => {
  state.readState = acknowledgeAll(state.readState, state.workSessions);
  persistReadState();
  render();
});

// Collapsing a lane writes to the same set the individual card buttons do, so the two can never
// disagree: a card reopened by hand inside a collapsed lane simply drops out of the set, and the
// lane button drops back to "Collapse all" because the lane is no longer entirely shut.
document.querySelectorAll('.lane-collapse').forEach((button) => {
  button.addEventListener('click', () => {
    const laneName = button.closest('.lane').dataset.lane;
    const workSessionIds = (groupSessionsByLane().get(laneName) ?? []).map((workSession) => workSession.id);
    state.collapsedWorkSessionIds = toggleLaneCollapse(state.collapsedWorkSessionIds, workSessionIds);
    render();
  });
});

// One move panel at a time, and it closes the way every other transient control does: Escape, or a
// click that lands anywhere else. Both are delegated, because the panels themselves are rebuilt with
// every poll and a listener bound to one of them would go with it.
document.addEventListener('click', (event) => {
  if (!state.openMovePanelId) return;
  if (event.target.closest('.card-move') || event.target.closest('.move-session')) return;
  closeMovePanels();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.openMovePanelId) closeMovePanels();
});

document.querySelector('#sheet-close').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', (event) => { if (event.target === sheet) sheet.close(); });
document.querySelector('#session-frame-close').addEventListener('click', () => sessionFrame.close());
sessionFrame.addEventListener('click', (event) => { if (event.target === sessionFrame) sessionFrame.close(); });
document.querySelector('#reference-close').addEventListener('click', () => sessionReference.close());
sessionReference.addEventListener('click', (event) => { if (event.target === sessionReference) sessionReference.close(); });
// Dropping the src on close stops the embedded session, its streams, and its polling.
sessionFrame.addEventListener('close', () => sessionFrameView.removeAttribute('src'));
updateClock();
applyTheme(storedThemeMode());
state.readState = storedReadState();
state.alerts = alertsWanted();
refreshAlertControl();
void loadWorkSessions();
setInterval(updateClock, 1_000);
if (!state.demo) setInterval(() => void loadWorkSessions(), 5_000);
