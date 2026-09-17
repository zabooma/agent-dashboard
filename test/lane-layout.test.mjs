import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

// A lane is sized by its content: an empty lane closes just under its empty-state box, and a lane
// with cards grows downward on its own. A min-height brings back four tall empty columns even when
// the board holds nothing, which is the look this rule exists to prevent — so no `.lane` rule may
// declare one, including in a media query.
test('no lane declares a minimum height', () => {
  const offenders = [...css.matchAll(/\.lane[^{}]*\{[^}]*\}/g)]
    .filter((match) => /min-height/.test(match[0]))
    .map((match) => `line ${css.slice(0, match.index).split('\n').length}: ${match[0].trim()}`);
  assert.deepEqual(offenders, [], 'a lane min-height makes an empty column tall again');
});

// Content sizing only holds because a grid item does not stretch to its row. With the default
// `stretch`, every lane would grow to match the tallest one and the min-height would come back in
// effect — this pair of rules is the actual contract.
test('the board does not stretch its lanes to the tallest one', () => {
  const board = css.match(/\.board\s*\{[^}]*\}/)?.[0];
  assert.ok(board, '.board should be declared');
  assert.match(board, /align-items:\s*start/, 'a stretching board silently restores the tall empty columns');
});

// The lanes started unequal on purpose (1.08fr / 1fr / 1fr / .88fr), which left Attention and Done
// 20% apart at the same row. `minmax(0, 1fr)` is the second half of the fix: a bare `1fr` track keeps
// an automatic minimum size, so one card carrying a long worktree path can widen its own lane and
// quietly restore the difference the ratio was removed to fix.
test('the four lanes are laid out the same width', () => {
  const board = css.match(/\.board\s*\{[^}]*\}/)?.[0];
  assert.ok(board, '.board should be declared');
  assert.match(board, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/, 'a fractional ratio or a bare 1fr makes the lanes unequal again');
  assert.doesNotMatch(board, /\d+\.\d+fr/, 'no lane may be given a bigger share than another');
});

// One toggle per lane, in the lane's own heading. The buttons are static markup rather than
// re-created with the cards, which is what lets a click keep focus where the human put it.
test('every lane heading offers one collapse control', () => {
  const lanes = [...html.matchAll(/<section class="lane lane--[\s\S]*?<\/section>/g)].map((match) => match[0]);
  assert.equal(lanes.length, 4, 'the board should carry four lanes');
  for (const lane of lanes) {
    const laneName = lane.match(/data-lane="([^"]+)"/)?.[1];
    assert.equal([...lane.matchAll(/class="lane-collapse"/g)].length, 1, `${laneName} needs exactly one collapse control`);
    assert.match(lane, /<button class="lane-collapse"[^>]*hidden/, `${laneName}'s control starts hidden and is revealed with the lane's first card`);
  }
});

// The control rides on the title line rather than in a row of its own, so adding it cost the heading
// nothing: an empty lane's heading measures what it did before the control existed. A labelled button
// cannot do that — its text needs a line of its own at these widths — and one placed after the
// heading grows every lane on the board.
test('the lane toggle shares the title line instead of adding a row', () => {
  const titles = [...html.matchAll(/<div class="lane-title">[\s\S]*?<\/div>/g)].map((match) => match[0]);
  assert.equal(titles.length, 4, 'each lane should carry one title line');
  for (const title of titles) {
    assert.match(title, /<h2>[^<]+<\/h2>[\s\S]*?<button class="lane-collapse"/, 'the toggle belongs beside the lane name');
  }
  // The h2's line box is 25.2px and the button is 26px; without this the title line grows a pixel.
  assert.match(css, /\.lane-title \.lane-collapse\s*\{[^}]*margin-block:\s*-1px/, 'the toggle must not add height to the title line');
});

// It is the card's control, not a lookalike: one box shared by both selectors, so the two cannot
// drift, and the triangle turns to point at the lane it has shut.
test('the lane toggle is the card collapse control', () => {
  const shared = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .find(([, selector]) => selector.includes('.card-collapse') && selector.includes('.lane-collapse'));
  assert.ok(shared, 'the lane toggle and the card toggle should share their box rules');
  for (const declaration of [/width:\s*26px/, /height:\s*26px/, /place-items:\s*center/, /border:\s*1px solid var\(--line\)/]) {
    assert.match(shared[2], declaration, `the shared box should declare ${declaration}`);
  }
  assert.match(css, /\.lane\.is-collapsed \.lane-collapse > span:first-child\s*\{[^}]*rotate\(-90deg\)/, 'a collapsed lane points its triangle at what is shut');
});

// The same trap the stall chip documents: the button's own `display` outranks the browser's rule for
// [hidden], so an empty lane would offer a control that does nothing.
test('the hidden lane toggle is really hidden', () => {
  assert.match(css, /\.lane-collapse\[hidden\]\s*\{\s*display:\s*none/, 'without this an empty lane shows a dead control');
});

// The rotation above only fires if the page marks the lane, which is the half of that contract a
// stylesheet cannot state on its own.
test('the page marks the lane it collapsed', () => {
  assert.match(app, /lane\.classList\.toggle\('is-collapsed', allCollapsed\)/, 'the triangle cannot turn without the class');
});

