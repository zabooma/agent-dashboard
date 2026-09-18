import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DELETE_GESTURE_MS, DELETE_GESTURE_RADIUS_PX, isRepeatedDeleteClick } from '../public/board-state.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

const NOON = Date.parse('2026-09-17T12:00:00.000Z');
const at = (offsetMs) => NOON + offsetMs;
const DELETE_BUTTON = { x: 669, y: 460 };
const confirmed = { ...DELETE_BUTTON, at: NOON };

// Reproduced over CDP on 2026-09-17, against a board whose cards are all one height: a click on Delete
// opened the confirm, and a second click that arrived while the dialog was up was replayed the moment
// it closed. By then the first card was gone and the board had repainted, so the same pixels were the
// next card's Delete button — the second dialog named a card the pointer had never been on, and
// accepting it deleted that one too. One gesture, two deletions.
test('the first click of a gesture is never a repeat', () => {
  assert.equal(isRepeatedDeleteClick(null, DELETE_BUTTON, NOON), false);
});

test('a click replayed at the same spot inside the burst is the same instruction', () => {
  assert.equal(isRepeatedDeleteClick(confirmed, DELETE_BUTTON, at(120)), true, 'the queued half of a double-click');
  assert.equal(isRepeatedDeleteClick(confirmed, DELETE_BUTTON, at(DELETE_GESTURE_MS)), true, 'the window is inclusive');
});

test('a click anywhere else on the board is a new instruction, however fast it comes', () => {
  assert.equal(isRepeatedDeleteClick(confirmed, { x: DELETE_BUTTON.x, y: DELETE_BUTTON.y + 120 }, at(20)), false);
  assert.equal(isRepeatedDeleteClick(confirmed, { x: DELETE_BUTTON.x + 200, y: DELETE_BUTTON.y }, at(20)), false);
});

test('a deliberate repeat at the same spot is only ever delayed, never dropped', () => {
  assert.equal(isRepeatedDeleteClick(confirmed, DELETE_BUTTON, at(DELETE_GESTURE_MS + 1)), false);
});

// The radius has two jobs: survive a few pixels of hand jitter between the two halves of a
// double-click, and never reach the neighbouring card, whose own Delete button is a card height away.
test('the radius is jitter-tolerant and never spans two buttons', () => {
  assert.equal(DELETE_GESTURE_RADIUS_PX, 8);
  assert.equal(isRepeatedDeleteClick(confirmed, { x: DELETE_BUTTON.x + 8, y: DELETE_BUTTON.y }, at(50)), true);
  assert.equal(isRepeatedDeleteClick(confirmed, { x: DELETE_BUTTON.x + 9, y: DELETE_BUTTON.y }, at(50)), false);
  assert.ok(DELETE_GESTURE_RADIUS_PX < 40, 'a radius that could reach the next card refuses honest clicks');
});

test('the card Delete button consults the shared rule before it asks anything', () => {
  assert.match(app, /isRepeatedDeleteClick\(confirmedDelete, point\)/, 'the page must not reimplement the guard');
  assert.equal((app.match(/window\.confirm\(/g) ?? []).length, 1, 'a second confirm dialog is the bug');
  assert.equal((app.match(/await deleteWorkSession\(/g) ?? []).length, 1, 'the guarded click stays the only way in');
});

// Recorded on acceptance, not on the click: a Cancel must not swallow the human's next deliberate
// click, which is still aimed at the same tiny button and lands inside the same window.
test('only an accepted confirmation arms the guard', () => {
  assert.match(app, /if \(!confirmed\) return;\s*\n\s*confirmedDelete = /);
});

test('the guard is armed before the deletion awaits, or the replay wins the race', () => {
  const deletion = app.match(/async function deleteWorkSession\([\s\S]*?\n\}/)?.[0];
  assert.ok(deletion, 'deleteWorkSession should exist');
  const armed = deletion.indexOf('confirmedDelete = ');
  const awaited = deletion.indexOf('await fetch(');
  assert.ok(armed !== -1 && awaited !== -1 && armed < awaited, 'the window must be open before the first await');
});

// A card that is already gone is what the human asked for. Reporting it as a failure is how a replayed
// click turns into a scary note under a board that did exactly what it was told.
test('a card that is already deleted is not an error', () => {
  const deletion = app.match(/async function deleteWorkSession\([\s\S]*?\n\}/)?.[0];
  assert.match(deletion, /response\.status !== 404/);
});

// One window, one place to tune it: a copy of the number in the page drifts the first time it moves.
test('the gesture window lives only in board-state.js', () => {
  assert.equal(DELETE_GESTURE_MS, 1000);
  assert.doesNotMatch(app, /DELETE_GESTURE_MS\s*=/, 'the page must not carry its own copy');
});
