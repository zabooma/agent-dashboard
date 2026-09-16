import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

// The inline scripts without attributes: the theme boot script in the head, and the watchdog at the
// end of the body. The charset-independent regex is deliberate — an attributed tag such as the
// deferred module is not one of these.
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

// Loads the real watchdog with just the globals it touches, then fires its timer, so both the
// "the board never started" and "the board reported for duty" paths can be driven without a browser.
function runWatchdog({ refreshState = 'SYNCING', note = '', missingState = false } = {}) {
  const state = { textContent: refreshState, dataset: {} };
  const boardNote = { textContent: note };
  const timers = [];
  const context = {
    window: { setTimeout: (handler) => { timers.push(handler); } },
    document: {
      querySelector: (selector) => {
        if (selector === '#refresh-state') return missingState ? null : state;
        if (selector === '#board-note') return boardNote;
        return null;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(inlineScripts[1], context);
  timers.forEach((handler) => handler());
  return { state, boardNote };
}

test('the watchdog runs after the module it is watching for', () => {
  assert.equal(inlineScripts.length, 2, 'index.html should carry exactly the boot script and the watchdog');
  const moduleAt = html.indexOf('type="module"');
  const watchdogAt = html.indexOf(inlineScripts[1]);
  assert.ok(moduleAt !== -1 && watchdogAt !== -1, 'both the module and the watchdog should be in the document');
  assert.ok(moduleAt < watchdogAt, 'the watchdog must be registered after the module tag it reports on');
});

// The marker is written by the first successful load. A marker still reading SYNCING means app.js
// never executed, which paints an empty board — the failure that reads as lost cards.
test('a board whose page script never ran says so instead of looking empty', () => {
  const { state, boardNote } = runWatchdog();
  assert.equal(state.textContent, 'SCRIPT FAILED');
  assert.equal(state.dataset.status, 'failed', 'the failure colour is selected by this marker');
  assert.match(boardNote.textContent, /Nothing is lost/);
  assert.match(boardNote.textContent, /restart it, then reload/, 'the message has to name the fix');
});

test('a board that reported for duty is left alone', () => {
  for (const refreshState of ['LIVE', 'OFFLINE', 'PREVIEW']) {
    const { state, boardNote } = runWatchdog({ refreshState, note: 'unchanged' });
    assert.equal(state.textContent, refreshState, `${refreshState} must not be overwritten`);
    assert.equal(state.dataset.status, undefined);
    assert.equal(boardNote.textContent, 'unchanged');
  }
});

test('a missing marker is not turned into a second failure', () => {
  assert.doesNotThrow(() => runWatchdog({ missingState: true }));
});

test('the failure state is painted with a palette token', () => {
  assert.match(css, /\[data-status='failed'\]\s*\{[^}]*var\(--amber\)/, 'a hardcoded colour could not flip with the theme');
});
