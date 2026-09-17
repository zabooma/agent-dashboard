import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
const cardHover = rules.filter((rule) => /\.session-card:hover/.test(rule.selector));

// The card used to jump 2px up and left under the pointer, toward its own hard shadow. On a board the
// human mostly scans rather than clicks, that reads as the card sliding out from under the cursor,
// and it moves the target of the click that is about to land. Hover feedback is colour only.
test('a hovered card does not move under the pointer', () => {
  assert.ok(cardHover.length, 'the card still needs a hover state');
  for (const rule of cardHover) {
    assert.doesNotMatch(rule.body, /transform|translate/, 'hover must not move the card');
  }
});

// Removing the movement must not remove the feedback: the accent border is the whole of what is left
// to say the pointer is on a card.
test('hover still says which card the pointer is on', () => {
  assert.ok(cardHover.some((rule) => /border-color:\s*var\(--accent\)/.test(rule.body)), 'a hover with no visible change is worse than no hover at all');
});

// A transition on a property that no longer changes costs a frame of work on every hover and is the
// half of a removal that gets forgotten — the card would keep animating nothing.
test('the card transitions only what hovering changes', () => {
  const card = rules.find((rule) => rule.selector === '.session-card');
  assert.ok(card, '.session-card should be declared');
  const transition = card.body.match(/transition:\s*([^;]+)/)?.[1] ?? '';
  assert.match(transition, /border-color/, 'the colour change should still animate');
  assert.doesNotMatch(transition, /transform/, 'nothing transforms on hover any more');
});
