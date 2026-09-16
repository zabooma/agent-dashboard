import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { STALL_AFTER_MS } from '../public/board-state.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const template = html.slice(html.indexOf('<template id="session-card-template">'), html.indexOf('</template>'));
const card = app.match(/function createCard\([\s\S]*?\n\}/)?.[0];
const render = app.match(/function render\(\)[\s\S]*?\n\}/)?.[0];

test('the card template carries a stall chip that starts hidden', () => {
  assert.match(template, /class="stall-chip"[^>]*hidden/, 'a chip built anywhere else is a second copy of the markup');
});

// The same trap .new-badge already documents: the chip's own `display: inline-flex` outranks the
// browser's rule for [hidden], so a card with no stall would show the chip anyway.
test('the hidden stall chip is really hidden', () => {
  assert.match(css, /\.stall-chip\[hidden\]\s*\{\s*display:\s*none/, 'without this every card reads as stalled');
});

// A second badge in a topline that had no room to spare. At the four-lane band (~1081-1400px) a lane
// is 250-330px and the badges need 153px of the 244px of card content the 84px timestamp also wants;
// measured, the chip printed over the time and was clipped. The wrap is what buys the room.
test('the topline wraps rather than printing the badge over the timestamp', () => {
  const topline = css.match(/\.card-topline\s*\{[^}]*\}/)?.[0];
  assert.ok(topline, '.card-topline should be declared');
  assert.match(topline, /flex-wrap:\s*wrap/, 'without the wrap the badge overlaps and clips the time');
  const time = css.match(/\.card-topline time\s*\{[^}]*\}/)?.[0];
  assert.ok(time, '.card-topline time should be declared');
  assert.match(time, /margin-left:\s*auto/, 'a wrapped timestamp belongs on the right, not under the badges');
});

// The design decision this feature turns on: the flag is advisory. If it could choose a lane, "the
// agent has not typed for a while" would become indistinguishable from "the agent needs you", and a
// long build would page the human — which is exactly what the flag is not allowed to do.
test('the stall flag never picks a lane', () => {
  assert.ok(render, 'render should exist');
  assert.doesNotMatch(render, /isStalled/, 'lanes are chosen from the status alone');
  assert.match(render, /laneFor\(workSession\.status\)/, 'the lane mapping must stay the only source of a lane');
});

test('the chip is driven by the shared pure rule', () => {
  assert.ok(card, 'createCard should exist');
  assert.match(card, /isStalled\(workSession\)/, 'the page must not reimplement the threshold');
  assert.match(card, /stallChip\.hidden = !stalled/, 'the chip follows the rule');
});

// One threshold, one place. A second copy in the page either in the arithmetic or in the wording
// drifts the moment the constant is tuned, and a chip that lies about its own rule is worse than none.
test('the threshold lives only in board-state.js', () => {
  assert.equal(STALL_AFTER_MS, 15 * 60_000);
  assert.doesNotMatch(app, /15 \* 60_000/, 'the page must not carry the arithmetic too');
  assert.doesNotMatch(app, /15 minutes/, 'nor the number in its copy');
});

// The page is not allowed to repeat the threshold, but the prose that an *agent* plans its silence
// around has to state it — which makes those docs a third place it can go stale. An agent budgeting
// ten silent minutes against a number the board no longer uses is the failure this pins.
test('every doc that quotes the threshold quotes the real one', async () => {
  const minutes = STALL_AFTER_MS / 60_000;
  const docs = [
    '../.agents/skills/agent-dashboard/SKILL.md',
    '../AGENT_DASHBOARD_TESTING.md',
    '../README.md',
  ];
  for (const doc of docs) {
    const text = await readFile(new URL(doc, import.meta.url), 'utf8');
    assert.match(text, new RegExp(`${minutes} minutes`), `${doc} should quote the real threshold`);
  }
});
