import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

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
