// Pure board rules shared by the page and its tests. Nothing here touches the DOM, storage, or the
// network, so the decisions that are easy to get wrong — which cards count as new, and which of them
// deserve one desktop banner — can be driven case by case from node.
//
// Three facts are deliberately kept apart:
//   * "this card is waiting on a human" lives in the work session's status (the Attention lane);
//   * "the human has not looked at this one yet" lives in the read state below;
//   * "this card has gone quiet" is derived from elapsed time by `isStalled`, and is advisory only.
// A card the human just read is still asking for something until it actually moves.

// Statuses that put a card in the human's lane. The page, the lane headings, and the banner rule all
// read this one map, so "attention" cannot come to mean two different things.
export const laneByStatus = {
  needs_input: 'attention',
  blocked: 'attention',
  stale: 'attention',
  working: 'active',
  handoff: 'handoff',
  done: 'done',
};

export const ATTENTION_LANE = 'attention';

export function laneFor(status) {
  return laneByStatus[status] ?? ATTENTION_LANE;
}

// A card can also be stuck without saying so. The board cannot see a provider process — there is no
// heartbeat in the model — so the only honest signal is silence: an agent that hits a context or
// usage limit stops writing and, by definition, cannot report that afterwards. Fifteen minutes is
// long enough to outlast a build or a test run and short enough to intervene.
export const STALL_AFTER_MS = 15 * 60_000;

// Only a card that still claims to be working can be stalled: one already in Attention, Handoff, or
// Done has said what it wants, and re-flagging it would be noise. This never moves a card between
// lanes. A heuristic that could promote a card to Attention would collapse "the agent says it needs
// you" into "the agent has not typed for a while", and Attention is the lane the human trusts.
export function isStalled(workSession, now = Date.now()) {
  if (workSession.status !== 'working') return false;
  const updatedAt = Date.parse(workSession.updatedAt ?? '');
  if (Number.isNaN(updatedAt)) return false;
  return now - updatedAt >= STALL_AFTER_MS;
}

export function emptyReadState() {
  return { seen: {}, notified: [] };
}

// The update stamp a card is asking about, or null when it is not asking for anything. Storing null
// rather than deleting on acknowledgement is what lets a record survive: no later stamp can compare
// greater than an absent one, so an acknowledged card stays read until the card actually moves again.
export function attentionStamp(workSession) {
  if (laneFor(workSession.status) !== ATTENTION_LANE) return null;
  return workSession.updatedAt ?? null;
}

export function parseReadState(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return emptyReadState();
    const seen = parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {};
    const notified = Array.isArray(parsed.notified) ? parsed.notified.filter((id) => typeof id === 'string') : [];
    return { seen: { ...seen }, notified: [...new Set(notified)] };
  } catch {
    // Unreadable or hand-edited storage is not an error worth surfacing; it means "nothing read yet".
    return emptyReadState();
  }
}

export function serializeReadState(readState) {
  return JSON.stringify({ seen: readState.seen, notified: readState.notified });
}

export function isUnread(readState, workSession) {
  const stamp = attentionStamp(workSession);
  return stamp !== null && (readState.seen[workSession.id] ?? '') < stamp;
}

export function unreadWorkSessions(readState, workSessions) {
  return workSessions.filter((workSession) => isUnread(readState, workSession));
}

export function acknowledge(readState, workSession) {
  const stamp = attentionStamp(workSession);
  if (stamp === null) return readState;
  return { ...readState, seen: { ...readState.seen, [workSession.id]: stamp } };
}

export function acknowledgeAll(readState, workSessions) {
  return workSessions.reduce((next, workSession) => acknowledge(next, workSession), readState);
}

// Nothing else prunes these maps, and a long-lived board accumulates a record per card ever seen.
export function pruneReadState(readState, workSessions) {
  const live = new Set(workSessions.map((workSession) => workSession.id));
  return {
    seen: Object.fromEntries(Object.entries(readState.seen).filter(([id]) => live.has(id))),
    notified: readState.notified.filter((id) => live.has(id)),
  };
}

// "Collapse all" is one button per lane, so it still has to mean something when the lane is mixed.
// Counting is what makes the label honest: the lane offers "Expand all" only once there is nothing
// left to collapse, so the button always names what the next click will do. Expanding on the first
// click instead would leave the cards the human already shut closed under an "Expand all" label.
export function laneCollapseState(collapsedIds, workSessionIds) {
  const total = workSessionIds.length;
  const collapsed = workSessionIds.filter((id) => collapsedIds.has(id)).length;
  return { total, collapsed, allCollapsed: total > 0 && collapsed === total };
}

export function toggleLaneCollapse(collapsedIds, workSessionIds) {
  const next = new Set(collapsedIds);
  const { allCollapsed } = laneCollapseState(next, workSessionIds);
  workSessionIds.forEach((id) => (allCollapsed ? next.delete(id) : next.add(id)));
  return next;
}

// Deleting a card is confirmed with a native modal dialog, and the renderer is blocked for as long as
// that dialog is on screen. A second click — the stray half of a double-click, or a click that was
// already on its way when the dialog opened — waits in the input queue and is replayed the moment the
// dialog closes. By then the deleted card is gone and the board has repainted, so the click is
// hit-tested against a board that no longer holds what the human aimed at. Cards share one height, so
// the next card's Delete button sits at exactly those pixels: without a guard, one gesture asks the
// human to confirm two deletions, the second one for a card they never pointed at.
//
// One gesture therefore earns one confirmation. A repeat click at the same point, inside the burst, is
// the same instruction arriving twice; a click anywhere else is a new one, however fast it comes. The
// window spans the slowest double-click Chrome still recognizes, and the radius is small enough that
// no two Delete buttons are ever inside it.
export const DELETE_GESTURE_MS = 1000;
export const DELETE_GESTURE_RADIUS_PX = 8;

export function isRepeatedDeleteClick(previous, point, now = Date.now()) {
  if (!previous) return false;
  if (now - previous.at > DELETE_GESTURE_MS) return false;
  return Math.hypot(point.x - previous.x, point.y - previous.y) <= DELETE_GESTURE_RADIUS_PX;
}

// One banner per arrival in Attention. An agent that posts twice while its card waits has not
// arrived twice, so the latch is what stops a banner on every poll. Acknowledging a card releases
// its latch (the next plan no longer sees it as unread) but opening it deliberately does not, and
// neither does a later update on a card that never left the lane.
export function notificationPlan(readState, workSessions) {
  const latched = new Set(readState.notified);
  const send = [];
  const notified = [];
  for (const workSession of workSessions) {
    if (!isUnread(readState, workSession)) continue;
    notified.push(workSession.id);
    if (!latched.has(workSession.id)) send.push(workSession);
  }
  return { send, readState: { ...readState, notified } };
}
