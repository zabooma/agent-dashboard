import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

// The sheet is the resume surface, so its workspace facts are structured rows rather than pills in a
// header: a pill row has room for a project name and a branch, and that is how the worktree went
// missing in the first place.
test('the inspect sheet carries a labelled list of workspace facts', () => {
  const sheet = html.slice(html.indexOf('id="session-sheet"'), html.indexOf('</dialog>'));
  assert.match(sheet, /class="sheet-workspace"/, 'the sheet should carry a workspace block');
  assert.match(sheet, /<dl class="sheet-facts" id="sheet-facts"><\/dl>/, 'the facts belong in a description list the page fills in');
  assert.match(sheet, /id="sheet-workspace-title"/, 'the block needs a heading to be a labelled region');
  assert.doesNotMatch(html, /sheet-meta/, 'the old pill row is what hid the worktree');
});

// A fact that is clipped is a fact the human cannot check before pasting it into a terminal.
test('a workspace fact wraps instead of clipping its value', () => {
  const rule = css.match(/\.sheet-fact-value\s*\{[^}]*\}/)?.[0];
  assert.ok(rule, '.sheet-fact-value should be declared');
  assert.match(rule, /overflow-wrap:\s*anywhere/, 'a long worktree path has to wrap inside its column');
  assert.doesNotMatch(rule, /text-overflow:\s*ellipsis/, 'an ellipsized path cannot be checked');
  assert.doesNotMatch(rule, /white-space:\s*nowrap/, 'nowrap would push the value out of the row');
});

// The clipboard API is missing on a plain-http LAN origin, so the fallback carries the feature. Its
// scratch textarea has to live inside the open modal dialog: everything outside one is inert, and an
// inert selection copies nothing while `execCommand('copy')` still returns true — a copy button that
// silently does nothing, which is the failure this pins.
test('the clipboard fallback survives the sheet being a modal dialog', () => {
  assert.match(app, /document\.execCommand\('copy'\)/, 'the fallback path should still exist for insecure origins');
  assert.match(
    app,
    /\(document\.querySelector\('dialog\[open\]'\) \?\? document\.body\)\.append\(field\)/,
    'the scratch field must be anchored inside the open dialog, not inert <body>',
  );
});

// Which facts carry a button is the requirement, not an accident of rendering: exactly the three
// values a human pastes into a terminal.
test('repository, branch and worktree are the copyable facts', () => {
  const render = app.match(/function renderSheetFacts[\s\S]*?\n\}/)?.[0];
  assert.ok(render, 'renderSheetFacts should exist');
  const copyable = [...render.matchAll(/createFactRow\('([^']+)'[^\n]*copyable: true/g)].map((match) => match[1]);
  assert.deepEqual(copyable, ['Repository', 'Branch', 'Worktree']);
});
