// Pure board rules shared by the page and its tests. Nothing here touches the DOM, storage, or the
// network, so the decisions that are easy to get wrong — which cards count as new, and which of them
// deserve one desktop banner — can be driven case by case from node.
//
// Two facts are deliberately kept apart:
//   * "this card is waiting on a human" lives in the work session's status (the Attention lane);
//   * "the human has not looked at this one yet" lives in the read state below.
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
