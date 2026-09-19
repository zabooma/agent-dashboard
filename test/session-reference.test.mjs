import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

const openLink = app.match(/function createAgentOpenLink[\s\S]*?\n\}/)?.[0] ?? '';
const showReference = app.match(/function showSessionReference[\s\S]*?\n\}/)?.[0] ?? '';

// An agent with no recorded link has nothing to hand off to. Sending the human to a page that says
// so opens a tab they then have to close — and closing it was never the board's to do: the browser
// only lets a page close a tab whose whole history is that page. The board holds every fact that
// page prints, so it answers the click in place and the tab never opens.
test('an agent with no link is answered in the board, not in a new tab', () => {
  assert.ok(openLink, 'createAgentOpenLink should exist');
  const noLinkBranch = openLink.slice(openLink.lastIndexOf('} else {'));
  assert.match(noLinkBranch, /showSessionReference\(workSession, agent\)/, 'the click should open the reference panel');
  assert.match(noLinkBranch, /event\.preventDefault\(\)/, 'the navigation to /open/… is what opened the tab');
  assert.match(showReference, /sessionReference\.showModal\(\)/, 'the panel is a dialog on the board');
});

// The panel is still a link. A middle or modified click has to keep the browser's own behaviour, and
// the standalone page is what it should land on — that URL is the one an MCP result hands out.
test('the open control stays a real link to the reference page', () => {
  assert.match(openLink, /open\.href = agentOpenUrl\(workSession, agent\)/, 'the anchor keeps a real destination');
  const noLinkBranch = openLink.slice(openLink.lastIndexOf('} else {'));
  assert.match(noLinkBranch, /event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/, 'a modified click belongs to the browser');
});

// Two surfaces now print the same reference: this panel and the page at /open/…. They are written in
// different files, in different languages, and a fact added to one and forgotten in the other is a
// reference that depends on which way the human arrived.
test('the panel and the standalone page show the same facts', () => {
  const fallback = server.match(/function openFallback[\s\S]*?\n\}/)?.[0] ?? '';
  const pageLabels = [...fallback.matchAll(/referenceRow\('([^']+)'/g)].map((match) => match[1]);
  const panelLabels = [...showReference.matchAll(/createFactRow\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(panelLabels, pageLabels, 'the board panel should carry the page\'s rows, in its order');
  assert.ok(pageLabels.includes('Session ID'), 'the resume id is the point of both surfaces');
});

// The two values a human pastes into a terminal to resume the agent.
test('the session id and the worktree are copyable in the panel', () => {
  const copyable = [...showReference.matchAll(/createFactRow\('([^']+)'[^\n]*copyable: true/g)].map((match) => match[1]);
  assert.deepEqual(copyable, ['Session ID', 'Worktree']);
});

test('the board carries the reference dialog the panel fills in', () => {
  const dialog = html.slice(html.indexOf('id="session-reference"'));
  assert.ok(html.includes('id="session-reference"'), 'the dialog should exist in the shell');
  assert.match(dialog, /<dl class="sheet-facts" id="reference-facts"><\/dl>/, 'the facts belong in a list the board fills');
  assert.match(dialog, /id="reference-close"/, 'a dialog needs a way out that is not the Escape key');
  assert.match(app, /#reference-close'\)\.addEventListener\('click', \(\) => sessionReference\.close\(\)\)/, 'and that control has to be wired');
  assert.match(css, /\.session-reference \{/, 'the panel needs its own width; the sheet is sized for a full card');
});
