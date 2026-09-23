import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DashboardStore, LANES } from '../lib/dashboard-store.mjs';
import { LANES as BOARD_LANES, effectiveLane, laneOverrideFor } from '../public/board-state.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const template = html.slice(html.indexOf('<template id="session-card-template">'), html.indexOf('</template>'));
const card = app.match(/function createCard\([\s\S]*?\n\}/)?.[0];
const move = app.match(/async function moveWorkSession\([\s\S]*?\n\}/)?.[0];
const targets = app.match(/function laneTargets\(\)[\s\S]*?\n\}/)?.[0];

async function withStore(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-dashboard-lane-'));
  try {
    return await run(new DashboardStore(path.join(directory, 'dashboard.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('a placement is stored, cleared, and never written into an agent', async () => {
  await withStore(async (store) => {
    const workSession = await store.createWorkSession({ title: 'Parked by hand' });
    const { agent } = await store.registerAgent(workSession.id, { provider: 'codex', role: 'implementer' });

    const placed = await store.setLaneOverride(workSession.id, 'done');
    assert.equal(placed.laneOverride.lane, 'done');
    assert.ok(Date.parse(placed.laneOverride.at), 'the board says when the card was placed, not just where');
    assert.equal(placed.agents[0].status, 'working', 'the agents keep their own status through a move');
    assert.equal(placed.agents[0].id, agent.id);

    const cleared = await store.setLaneOverride(workSession.id, null);
    assert.equal(cleared.laneOverride, null);
    assert.equal(cleared.agents[0].status, 'working');
  });
});

test('a placement is not a status report, and not agent activity', async () => {
  await withStore(async (store) => {
    const workSession = await store.createWorkSession({ title: 'Quiet since yesterday' });
    await store.registerAgent(workSession.id, { provider: 'dsh', role: 'implementer' });
    const before = await store.listWorkSessions();
    const placed = await store.setLaneOverride(workSession.id, 'attention');
    // The card's own time is when an agent last wrote. Stamping it here would print "just now" beside a
    // session that has said nothing for a day, which is the board lying about the one fact it exists to
    // report — and it would also reorder every lane the human tidies.
    assert.equal(placed.updatedAt, before[0].updatedAt);
    assert.equal(placed.agents[0].updatedAt, before[0].agents[0].updatedAt);
  });
});

// The lifetime the human chose: a live session reporting every few seconds must not undo a deliberate
// move, or the control would appear to work and then quietly revert under the pointer.
test('an agent reporting again does not take the card back', async () => {
  await withStore(async (store) => {
    const workSession = await store.createWorkSession({ title: 'Still reporting' });
    const { agent } = await store.registerAgent(workSession.id, { provider: 'claude', role: 'implementer' });
    await store.setLaneOverride(workSession.id, 'done');
    const { workSession: updated } = await store.updateAgentProgress(workSession.id, agent.id, {
      status: 'working',
      summary: 'Still going.',
    });
    assert.equal(updated.laneOverride.lane, 'done', 'the human moves it back, not the next status update');
    // A store record is the raw card: `status` is folded in by the server's overview, so the lane rule
    // is asked the question the page asks it — the agents' status plus whatever the human placed.
    assert.equal(effectiveLane({ ...updated, status: 'working' }), 'done');
    // Giving the card back to them is what returns it to the lane its statuses name.
    const cleared = await store.setLaneOverride(workSession.id, null);
    assert.equal(effectiveLane({ ...cleared, status: 'working' }), 'active');
  });
});

test('a move the store cannot make is refused, and a card nobody has is nobody to move', async () => {
  await withStore(async (store) => {
    const workSession = await store.createWorkSession({ title: 'Still here' });
    await assert.rejects(() => store.setLaneOverride(workSession.id, 'later'), /No lane is named later/);
    assert.equal(await store.setLaneOverride('3f1c2f9e-0000-4000-8000-000000000000', 'done'), null);
    const sessions = await store.listWorkSessions();
    assert.equal(sessions[0].laneOverride, null, 'a refused move leaves the card where it was');
  });
});

test('one card moving leaves every other card alone', async () => {
  await withStore(async (store) => {
    const moved = await store.createWorkSession({ title: 'Moved' });
    const other = await store.createWorkSession({ title: 'Not moved' });
    await store.setLaneOverride(moved.id, 'handoff');
    const sessions = await store.listWorkSessions();
    assert.equal(sessions.find((workSession) => workSession.id === moved.id).laneOverride.lane, 'handoff');
    assert.equal(sessions.find((workSession) => workSession.id === other.id).laneOverride, null);
  });
});

// Three copies of one list: the store validates the endpoint's lane against its own, the page merges the
// human's choice against its own, and the markup decides what the control offers. A lane added to the
// markup alone would be a column the page draws, the control offers, and the server refuses.
test('the store, the page and the markup agree on the lanes, in board order', () => {
  const markupLanes = [...html.matchAll(/<section class="lane lane--[^"]*" data-lane="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(markupLanes, LANES, 'index.html is the board the human sees: it leads');
  assert.deepEqual(BOARD_LANES, LANES, 'the page and the store must validate against the same lanes');
});

// The move control offers the lanes the board drew, not from a list in app.js, so a lane renamed in
// the markup is renamed in the control too and the two can never disagree about what the board holds.
test('the move control offers the lanes the board drew', () => {
  assert.ok(targets, 'laneTargets should exist');
  assert.match(targets, /querySelectorAll\('\.lane'\)/, 'the lanes come from the board itself');
  assert.match(targets, /querySelector\('h2'\)/, 'and are named by the headings the human is reading');
});

// Reproduced against a throwaway board on 2026-09-23: the targets were built with `data-lane`, and a
// card lives inside a lane, so the buttons of an earlier card sat earlier in the document than the
// columns they named. `document.querySelector('[data-lane="active"]')` returned the button in the
// Attention lane's card, `render` threw on its missing counter, and the board — which draws lanes one
// at a time — showed a single card, zeroed counters, and OFFLINE. The attribute is renamed, and every
// lane lookup now names the lane element so no future control can hijack a whole column.
test('a control inside a card can never be mistaken for a lane', () => {
  assert.match(app, /target\.dataset\.moveTo = lane/, 'the targets carry a name of their own');
  assert.doesNotMatch(app, /dataset\.lane\s*=/, 'nothing but the markup may set the attribute the board looks lanes up by');
  assert.equal((app.match(/document\.querySelector\(`\[data-lane=/g) ?? []).length, 0, 'a bare attribute lookup finds cards, not columns');
  assert.match(app, /document\.querySelector\(`\.lane\[data-lane="\$\{laneName\}"\]`\)/, 'the one lane lookup names the lane element');
});

test('the card carries a move control, a hidden panel, and a chip that admits who moved it', () => {
  assert.match(template, /class="move-session"[^>]*aria-expanded="false"/, 'the control starts closed');
  assert.match(template, /class="card-move"[^>]*hidden/, 'the panel starts hidden, like the chips do');
  assert.match(template, /class="moved-chip"[^>]*hidden/, 'a card nobody moved shows no such chip');
  assert.match(template, /<div class="card-flags">[\s\S]*class="moved-chip"/, 'it belongs with the other flags, beside the status it qualifies');
  // Same trap as .stall-chip and .new-badge: the panel's own `display: grid` outranks [hidden].
  assert.match(css, /\.card-move\[hidden\]\s*\{\s*display:\s*none/, 'without this every card shows an open move panel');
  assert.match(css, /\.moved-chip\[hidden\]\s*\{\s*display:\s*none/, 'without this every card reads as moved by hand');
});

// The status chip is the board's report of what the agents said. A human's placement is a different
// fact, and the only place it may appear is its own chip: a move that rewrote the status chip would
// make "an agent finished this" and "a human filed this" the same pixels.
test('a move never rewrites the status the agents reported', () => {
  assert.ok(card, 'createCard should exist');
  assert.match(card, /chip\.dataset\.status = workSession\.status/, 'the chip keeps the agent status');
  assert.match(card, /movedChip\.hidden = !override/, 'the human placement gets its own chip');
  assert.ok(move, 'moveWorkSession should exist');
  assert.match(move, /method: 'PATCH'/, 'a move is a placement, not a new card');
  assert.match(move, /\/api\/work-sessions\/\$\{encodeURIComponent\(workSession\.id\)\}/, 'it names exactly one card');
  assert.match(move, /body: JSON\.stringify\(\{ lane \}\)/, 'the request carries a lane');
  assert.doesNotMatch(move, /JSON\.stringify\(\{[^}]*status/, 'and never a status: that would be an agent speaking');
  assert.match(move, /workSession\.laneOverride = payload\.workSession/, 'the board repaints from the server, not from hope');
});

// A failed move must not move anything. The page has no optimistic branch to unwind, which is what
// makes "it is still where you left it" a true sentence in the note the human reads.
test('a card only ever appears in its new lane after the server agrees', () => {
  assert.doesNotMatch(move, /laneOverride = \{ lane/, 'no local guess about where the card landed');
  assert.match(move, /if \(!response\.ok\)/, 'the answer is checked before anything is redrawn');
});

test('the page reads a hand-made placement through the shared rule', () => {
  assert.match(app, /effectiveLane\(workSession\)/, 'the lanes are grouped by the shared rule');
  assert.doesNotMatch(app, /laneFor\(/, 'the page must not reach past it to the status map');
  assert.equal(laneOverrideFor({ laneOverride: { lane: 'recycling' } }), null, 'an unknown lane is not a lane');
  assert.equal(laneOverrideFor({}), null);
  assert.equal(laneOverrideFor(null), null);
});
