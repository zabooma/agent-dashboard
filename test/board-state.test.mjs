import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledge,
  acknowledgeAll,
  attentionStamp,
  effectiveLane,
  emptyReadState,
  isStalled,
  isUnread,
  laneCollapseState,
  laneFor,
  laneOverrideFor,
  notificationPlan,
  parseReadState,
  pruneReadState,
  serializeReadState,
  STALL_AFTER_MS,
  toggleLaneCollapse,
  unreadWorkSessions,
} from '../public/board-state.js';

const card = (id, status, updatedAt) => ({ id, status, updatedAt, title: `Card ${id}` });
const moved = (workSession, lane) => ({ ...workSession, laneOverride: { lane, at: '2026-09-16T11:00:00.000Z' } });
const NOON = Date.parse('2026-09-16T12:00:00.000Z');
const ago = (milliseconds) => new Date(NOON - milliseconds).toISOString();

test('every status maps to a lane, and an unknown one still asks for a human', () => {
  assert.equal(laneFor('needs_input'), 'attention');
  assert.equal(laneFor('blocked'), 'attention');
  assert.equal(laneFor('stale'), 'attention');
  assert.equal(laneFor('working'), 'active');
  assert.equal(laneFor('handoff'), 'handoff');
  assert.equal(laneFor('done'), 'done');
  assert.equal(laneFor('status-invented-later'), 'attention', 'a status the page does not know must not vanish from the board');
});

// A human placing a card by hand is the only other source of a lane, and it only ever decides
// placement: `effectiveLane` is the status mapping with their choice in front of it, nothing more.
test('a hand-made placement decides the lane, and only the lane', () => {
  const board = card('a', 'needs_input', '2026-09-16T10:00:00.000Z');
  assert.equal(effectiveLane(board), 'attention', 'with no placement the statuses decide');
  assert.equal(effectiveLane(moved(board, 'done')), 'done');
  assert.equal(effectiveLane(moved(board, 'active')), 'active');
  assert.equal(moved(board, 'done').status, 'needs_input', 'the status the agents reported is untouched');

  // A lane the page does not know is not a lane it can draw: the agents' own is the honest fallback,
  // and the card stays on the board.
  assert.equal(laneOverrideFor({ laneOverride: { lane: 'recycling' } }), null);
  assert.equal(effectiveLane({ ...board, laneOverride: { lane: 'recycling' } }), 'attention');
  assert.equal(laneOverrideFor({ laneOverride: null }), null);
  assert.equal(laneOverrideFor(undefined), null);
});

// Moving a card out of Attention is the human taking it off their own list, so it stops asking — and
// the stamp it carries afterwards is still the agents' clock, not the moment of the move.
test('a card the human moved is asked about where it now is', () => {
  const asked = card('a', 'needs_input', '2026-09-16T10:00:00.000Z');
  assert.equal(attentionStamp(asked), '2026-09-16T10:00:00.000Z');
  assert.equal(attentionStamp(moved(asked, 'active')), null, 'the human has answered it by moving it');
  assert.equal(attentionStamp(moved(asked, 'handoff')), null);
  assert.equal(
    attentionStamp(moved(card('b', 'working', '2026-09-16T10:00:00.000Z'), 'attention')),
    '2026-09-16T10:00:00.000Z',
    'and a card they moved in asks until it moves again',
  );
});

test('a card the human moved out of Attention is not new, however stale its read record is', () => {
  const read = acknowledge(emptyReadState(), card('a', 'needs_input', '2026-09-16T10:00:00.000Z'));
  const parked = moved(card('a', 'needs_input', '2026-09-16T11:00:00.000Z'), 'done');
  assert.equal(isUnread(read, parked), false, 'it is still asking for a human by status, and no longer by lane');
  assert.equal(notificationPlan(read, [parked]).send.length, 0, 'so it must not raise a banner either');
});

test('only an attention card carries a stamp', () => {
  assert.equal(attentionStamp(card('a', 'needs_input', '2026-09-16T10:00:00.000Z')), '2026-09-16T10:00:00.000Z');
  assert.equal(attentionStamp(card('b', 'working', '2026-09-16T10:00:00.000Z')), null);
  assert.equal(attentionStamp(card('c', 'done', '2026-09-16T10:00:00.000Z')), null);
});

test('an unread card becomes read once acknowledged, and new again when it moves', () => {
  const board = card('a', 'needs_input', '2026-09-16T10:00:00.000Z');
  const fresh = emptyReadState();
  assert.equal(isUnread(fresh, board), true, 'a card nobody has looked at is new');
  assert.equal(unreadWorkSessions(fresh, [board]).length, 1);

  const read = acknowledge(fresh, board);
  assert.equal(isUnread(read, board), false, 'acknowledging must clear the highlight');
  assert.deepEqual(unreadWorkSessions(read, [board]), []);

  const moved = { ...board, updatedAt: '2026-09-16T10:05:00.000Z' };
  assert.equal(isUnread(read, moved), true, 'a card that moves again after being read is new again');
});

test('a card that leaves Attention is never new, however stale its read record is', () => {
  const read = acknowledge(emptyReadState(), card('a', 'needs_input', '2026-09-16T10:00:00.000Z'));
  const resumed = card('a', 'working', '2026-09-16T11:00:00.000Z');
  assert.equal(isUnread(read, resumed), false, 'only the Attention lane asks for a human');
  assert.equal(attentionStamp(resumed), null);
});

test('acknowledging a card that asks for nothing must not record anything', () => {
  const read = acknowledge(emptyReadState(), card('a', 'working', '2026-09-16T10:00:00.000Z'));
  assert.deepEqual(read, emptyReadState(), 'a null stamp cannot be acknowledged');
});

test('acknowledgeAll clears the whole lane without touching other cards', () => {
  const sessions = [
    card('a', 'needs_input', '2026-09-16T10:00:00.000Z'),
    card('b', 'blocked', '2026-09-16T10:01:00.000Z'),
    card('c', 'working', '2026-09-16T10:02:00.000Z'),
  ];
  const read = acknowledgeAll(emptyReadState(), sessions);
  assert.deepEqual(unreadWorkSessions(read, sessions), []);
  assert.deepEqual(Object.keys(read.seen).sort(), ['a', 'b'], 'only the Attention lane is recorded');
});

test('the first plan banners every unread card exactly once', () => {
  const sessions = [
    card('a', 'needs_input', '2026-09-16T10:00:00.000Z'),
    card('b', 'working', '2026-09-16T10:00:00.000Z'),
  ];
  const first = notificationPlan(emptyReadState(), sessions);
  assert.deepEqual(first.send.map((workSession) => workSession.id), ['a']);

  const second = notificationPlan(first.readState, sessions);
  assert.deepEqual(second.send, [], 'an unchanged card must not banner again on the next poll');
});

test('an agent posting again while its card waits is not a second arrival', () => {
  const waiting = card('a', 'blocked', '2026-09-16T10:00:00.000Z');
  const first = notificationPlan(emptyReadState(), [waiting]);
  const moved = { ...waiting, updatedAt: '2026-09-16T10:09:00.000Z' };
  const second = notificationPlan(first.readState, [moved]);
  assert.deepEqual(second.send, [], 'the card never left Attention, so it did not arrive again');
});

test('a card that leaves Attention and comes back banners on the way back', () => {
  const waiting = card('a', 'blocked', '2026-09-16T10:00:00.000Z');
  const first = notificationPlan(emptyReadState(), [waiting]);
  const resumed = notificationPlan(first.readState, [card('a', 'working', '2026-09-16T10:04:00.000Z')]);
  assert.deepEqual(resumed.send, []);
  assert.deepEqual(resumed.readState.notified, [], 'leaving the lane releases the latch');

  const again = notificationPlan(resumed.readState, [{ ...waiting, updatedAt: '2026-09-16T10:07:00.000Z' }]);
  assert.deepEqual(again.send.map((workSession) => workSession.id), ['a']);
});

test('acknowledging a card releases its latch without a second banner', () => {
  const waiting = card('a', 'blocked', '2026-09-16T10:00:00.000Z');
  const first = notificationPlan(emptyReadState(), [waiting]);
  const read = acknowledge(first.readState, waiting);
  const afterRead = notificationPlan(read, [waiting]);
  assert.deepEqual(afterRead.send, [], 'a card the human has read must not banner');
  assert.deepEqual(afterRead.readState.notified, []);
});

test('read state survives a storage round trip and tolerates junk', () => {
  const sessions = [card('a', 'needs_input', '2026-09-16T10:00:00.000Z')];
  const read = notificationPlan(emptyReadState(), sessions).readState;
  assert.deepEqual(parseReadState(serializeReadState(read)), read);

  for (const junk of [null, '', 'not json', '[]', '"a string"', '{"seen":null,"notified":"nope"}']) {
    assert.deepEqual(parseReadState(junk), emptyReadState(), `${JSON.stringify(junk)} should read as nothing seen`);
  }
  assert.deepEqual(
    parseReadState('{"seen":{"a":"2026-01-01T00:00:00.000Z"},"notified":["a","a",7]}'),
    { seen: { a: '2026-01-01T00:00:00.000Z' }, notified: ['a'] },
    'a hand-edited file should not produce duplicate or non-string ids',
  );
});

test('records for deleted cards are pruned', () => {
  const read = {
    seen: { kept: '2026-09-16T10:00:00.000Z', deleted: '2026-09-16T10:00:00.000Z' },
    notified: ['kept', 'deleted'],
  };
  const pruned = pruneReadState(read, [card('kept', 'needs_input', '2026-09-16T10:00:00.000Z')]);
  assert.deepEqual(pruned, { seen: { kept: '2026-09-16T10:00:00.000Z' }, notified: ['kept'] });
});

// Silence is the only stall signal the board has: an agent that hits a context or usage limit stops
// writing and cannot report anything afterwards, so the card would otherwise sit in Active forever.
// These cases pin both halves — the card that has gone quiet, and the ones that must be left alone.
test('only a card still claiming to be working can be stalled', () => {
  const quiet = ago(STALL_AFTER_MS + 60_000);
  assert.equal(isStalled(card('a', 'working', quiet), NOON), true, 'a silent working card is the case this exists for');
  for (const status of ['needs_input', 'blocked', 'stale', 'handoff', 'done']) {
    assert.equal(isStalled(card(status, status, quiet), NOON), false, `${status} has already said what it wants`);
  }
});

// A human who moved this card has already looked at it and decided where it belongs, so the derived
// "this went quiet" chip has nothing left to add — and second-guessing the one signal on the board
// that is not a guess is how a human stops trusting the chips.
test('a card the human placed by hand is not second-guessed about going quiet', () => {
  const quiet = card('a', 'working', ago(STALL_AFTER_MS + 60_000));
  assert.equal(isStalled(quiet, NOON), true, 'left alone, the silence is still the evidence it was');
  assert.equal(isStalled(moved(quiet, 'handoff'), NOON), false);
  assert.equal(isStalled(moved(quiet, 'done'), NOON), false, 'a card filed by hand does not nag');
});

test('the stall threshold is the boundary, not an approximation of it', () => {
  assert.equal(isStalled(card('a', 'working', ago(STALL_AFTER_MS - 1)), NOON), false, 'a millisecond short is still working');
  assert.equal(isStalled(card('a', 'working', ago(STALL_AFTER_MS)), NOON), true, 'the threshold itself counts as stalled');
});

test('an unreadable timestamp is not evidence of a stall', () => {
  for (const updatedAt of [undefined, null, '', 'not a date']) {
    assert.equal(isStalled({ id: 'a', status: 'working', updatedAt }, NOON), false, `${JSON.stringify(updatedAt)} proves nothing`);
  }
});

test('a stamp in the future does not flag a card', () => {
  const ahead = new Date(NOON + 60_000).toISOString();
  assert.equal(isStalled(card('a', 'working', ahead), NOON), false, 'negative silence is a clock skew, not a stall');
});

// The two flags a card can wear are mutually exclusive by construction: a stalled card is always in
// Active and only Attention cards are ever unread. That is what keeps the dashed stall chip and the
// solid amber "New" rail from appearing together and reading as one confusing signal.
test('a stalled card is never also an unread attention card', () => {
  const quietWorking = card('a', 'working', ago(STALL_AFTER_MS + 60_000));
  assert.equal(isStalled(quietWorking, NOON), true);
  assert.equal(attentionStamp(quietWorking), null, 'the two flags cannot both be set');
});

// A lane's button acts on every card in the lane at once, so the only interesting case is the mixed
// one: a lane where the human has already shut some cards by hand. "Collapse all" must mean the
// remaining ones too, and the label must flip to "Expand all" only when nothing is left open.
test('a lane button collapses everything left open, then reopens the lane', () => {
  const ids = ['a', 'b', 'c'];
  const partly = new Set(['a']);

  assert.deepEqual(laneCollapseState(partly, ids), { total: 3, collapsed: 1, allCollapsed: false }, 'one card shut is not a collapsed lane');
  const collapsed = toggleLaneCollapse(partly, ids);
  assert.deepEqual([...collapsed].sort(), ids, 'the click has to shut the two cards the human left open');
  assert.deepEqual(laneCollapseState(collapsed, ids), { total: 3, collapsed: 3, allCollapsed: true });

  const expanded = toggleLaneCollapse(collapsed, ids);
  assert.deepEqual([...expanded], [], 'the same button now opens the whole lane');
});

test('a lane toggle leaves the other lanes alone', () => {
  const next = toggleLaneCollapse(new Set(['elsewhere']), ['a']);
  assert.deepEqual([...next].sort(), ['a', 'elsewhere'], 'each lane owns only its own cards');
});

test('an empty lane has nothing to collapse, so its button must not offer to', () => {
  assert.deepEqual(laneCollapseState(new Set(), []), { total: 0, collapsed: 0, allCollapsed: false });
  assert.deepEqual([...toggleLaneCollapse(new Set(), [])], []);
});
