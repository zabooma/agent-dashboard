# Agent Dashboard

A local portfolio board for parallel agent work. It is deliberately not an orchestration system and it does not require GitHub issues.

The central model is a **work session**: one human-visible card for a piece of work. A work session may carry an issue number, linked issue, project, worktree, and branch, but each is optional. It contains one or more **agent sessions**, each with its own provider, role, status, messages, and session link. That lets an implementer and reviewer work on the same task without pretending they share the same native-app conversation.

The same Node project exposes two local surfaces:

- a browser dashboard at `http://127.0.0.1:4380`;
- a standard stdio MCP server through which agents register themselves and report meaningful state changes.

All state is local: the board writes it to the user data directory (`~/.local/share/agent-dashboard/dashboard.json`; `AGENT_DASHBOARD_DATA` overrides the path). The browser server binds only to `127.0.0.1`.

## Run the board

From a checkout:

```bash
npm install
npm start
```

Or run the published package without a checkout:

```bash
npx -y @zabooma/agent-dashboard --dashboard
```

Open `http://127.0.0.1:4380`. To inspect the visual prototype before any agents have registered, open `http://127.0.0.1:4380/?demo=1`.

## Connect an MCP host

Register the `mcp` command with each desktop or CLI host that supports stdio MCP. The exact configuration shape varies by host, but the command is:

```json
{
  "command": "npx",
  "args": ["-y", "@zabooma/agent-dashboard"]
}
```

From a checkout, use `"command": "node"` and pass the absolute path of `server.mjs` as the only argument instead.

An MCP process starts the browser board if it is not already running. If `npm start` already owns the port, agent-launched MCP processes share its local data file and continue normally.

## Give agents the protocol

The portable [Agent Dashboard skill](.agents/skills/agent-dashboard/SKILL.md) tells an agent when to create or join a card, which changes are worth reporting, and how to leave a handoff before a context limit. Add that skill to each host's skill discovery path, then connect the MCP server above. It is deliberately provider-neutral: a session URL is optional and must be verified, never guessed.

The skill ships inside the npm package, so an install carries it too. Copy it into each host's skill directory, for example:

```bash
mkdir -p ~/.agents/skills
cp -R node_modules/@zabooma/agent-dashboard/.agents/skills/agent-dashboard ~/.agents/skills/
```

Each host reads one or more of these directories (project-local variants such as `.agents/skills/` work too):

- OpenCode: `~/.agents/skills/`, `~/.claude/skills/`, or `~/.config/opencode/skills/`
- Claude Code: `~/.claude/skills/`
- Codex: `~/.codex/skills/`
- DSH: `~/.agents/skills/`

With `npx` there is no persistent install; copy the folder from the repository instead.

The short version: create one work session per human-visible task, register each participating agent under it, and report state changes rather than tool-by-tool activity.

## Pilot policy

This repository is the rollout test bed. Its [project policy](AGENT_DASHBOARD_TESTING.md) makes dashboard registration mandatory before real task work whenever the MCP tools are available. The short `AGENTS.md` and `CLAUDE.md` entrypoints make that requirement visible to OpenCode and Claude; DSH receives the same pilot-only condition from its persistent session guidance. This lets the MCP capability stay global while the behavior is intentionally limited to this project until it proves reliable.

## Cleanup

Done cards stay as local history until a human selects **Delete** on the card and confirms it. That removes the work session and its nested agent and message history; agents have no deletion tool.

Available tools:

- `register_work_session`
- `update_work_session`
- `register_agent`
- `update_agent_progress`
- `add_message`
- `list_work_sessions`

## Session links

Every agent in the detail panel has an **Open** button. Its target resolves through a local `/open/<work-session-id>/<agent-id>` route, which leaves provider mechanics out of the UI:

- Each agent records its provider session reference when it registers: `providerSessionId` is the id the provider resumes that conversation from, and `sessionName` is the session's human-readable name when the host shows one.
- DSH can register its normal browser session URL now.
- A desktop provider can register a verified native deep link once that provider exposes one. Codex does: `codex://threads/<session-id>` opens that conversation in Codex Desktop (the `ChatGPT.app` bundle, `com.openai.codex`, whose registered scheme is `codex:`). A Codex session id *is* its thread id — `state_5.sqlite`'s `threads.id` matches the rollout's `session_meta.session_id` — so a Codex agent reads `$CODEX_SESSION_ID` and registers that id plus `codex://threads/<id>`. Verified 2026-09-16 on codex-cli 0.153.4: the deep link removed exactly that thread from Codex Desktop's unread list, which is the switch. Without the desktop app, the CLI equivalent is `codex resume <session-id>`.
- Claude Code does too, and its host hands the link over rather than making the agent derive it: `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` returns a `link` of the form `claude://claude.ai/epitaxy/<host-session-id>`, plus the `title` the app shows in its sidebar. That host id is a `local_…` value the desktop app validates against `/^local_[A-Za-z0-9-]{1,64}$/`, and it is deliberately *not* `$CLAUDE_CODE_SESSION_ID` — the latter names the transcript and is what `claude --resume` takes, so a hand-built link carrying it is rejected. A Claude agent therefore registers `$CLAUDE_CODE_SESSION_ID` as its `providerSessionId` and the host's `link` verbatim as its `sessionUrl`. Verified 2026-09-19 on Claude Code 2.1.275 in Claude Desktop 2.2553.1. A terminal or SDK session has no `mcp__ccd_session_mgmt__*` tools and an organisation can disable app links, so `link` is absent in both cases and the card keeps the reference page.
- Until a native deep link is proven, the page lists the agent, provider, session name, session id, and worktree, with copy-to-clipboard buttons on the session id and the worktree. The worktree remains the stable resume path.

This keeps the dashboard useful today: a provider contributes an Open target only after that target is proven on the machine.

The board's own **Inspect** sheet is the other half of that resume path: it lists the work session's repository, branch, and worktree, each with a copy button, plus the issue as a link and the last update. Values wrap rather than ellipsize — a path a human cannot read is a path they cannot check — and the three pasteable ones copy in full. The fallback clipboard path anchors its scratch textarea inside the open `<dialog>`, because a modal dialog makes the rest of the document inert and an inert selection copies nothing while `execCommand('copy')` still reports success.

When that URL is an `http:`/`https:` address, a plain click on **Open here** renders the session in a panel over the board rather than a new tab, so the board is never lost. Because the browser will not let a page retarget an already-open tab on another origin, this is the only way to reach a local web GUI without either losing the board or accumulating tabs. The panel keeps an **Open in a new tab** link for the plain browser behaviour, and a modified click (⌘, Ctrl, or middle) still opens a tab. Providers whose `sessionUrl` uses a custom scheme (`codex:`, `vscode:`, …) keep the plain link, since a custom scheme has no framed form.

For a custom scheme the button points at the provider URL itself — `codex://threads/<id>`, `claude://claude.ai/epitaxy/<host-session-id>` — and not at `/open/…`. The OS handoff belongs to the activating click, while a redirect gives the browser a redirect to act on instead of a click, which it can drop. `/open/…` remains the target for an agent with no recorded link, where it serves the reference page. Codex Desktop was confirmed switching to the recorded thread this way on 2026-09-16, and Claude Desktop to the recorded session on 2026-09-19.

The page's service worker never answers an `/open/…` navigation from its shell cache. Claiming that navigation replaced a handoff the browser could not follow with the cached board — an empty-looking dashboard in a new tab — so the redirector always goes to the network, like `/api/`.

Framing a local GUI is safe for the two things that usually break it: the panel only ever frames a same-host address, and a `SameSite=Strict` cookie from the framed origin is still sent because a port does not change the site.

Known limit: the panel opens the session **tool**, not the specific conversation. The DSH Web GUI has no per-session route — no client bundle reads a session query parameter or path — so one DSH `sessionUrl` serves every DSH card and the panel lands on whatever session that GUI is showing. Closing that gap needs the DSH Web shell itself to accept a session parameter at boot and open that session; a DSH agent would then register `${DSH_WEB_URL}/?session=${DSH_SESSION_ID}`, and this dashboard would need no change, because `http:` is already an allowed scheme.

A host that spawns the MCP server with `AGENT_DASHBOARD_SESSION_ID` (and optionally `AGENT_DASHBOARD_SESSION_NAME`) gets those values recorded for every agent that registers without them. DSH scrubs `DSH_*` names from MCP children, so a DSH agent passes `providerSessionId` itself — read from `$DSH_SESSION_ID`, never guessed.

## Lanes

The board is four equal columns — Attention, Active, Handoff, Done — and a card is placed by its status through one shared map (`laneFor`), never by a timer or a heuristic. The columns are `repeat(4, minmax(0, 1fr))`, and both halves of that matter: the board used to split them `1.08fr 1fr 1fr .88fr`, which made Attention and Done 20% apart by construction, and a bare `1fr` track keeps an automatic minimum size, so one card carrying a long unbreakable worktree path could widen its own lane and restore the difference the ratio was removed to fix. `test/lane-layout.test.mjs` pins both.

Each lane's title carries the card's own collapse control, acting on every card in that lane: a lane of thirty-six cards is one click away from thirty-six titles, and one click back. It is literally the same box — one rule shared by `.card-collapse` and `.lane-collapse`, so the two cannot drift — and it rides on the title line instead of a row of its own, which is why a heading still measures 83px whether the lane is full or empty. It offers to expand only when nothing in the lane is left open: a lane where the human already shut two cards by hand collapses the remaining ones rather than reopening those two. The control is hidden while the lane is empty — a button that does nothing when clicked is worse than no button — and it writes to the same set as each card's own control, so the two can never disagree about what is open. Both are static markup, so a re-render replaces the cards and never the button that was just clicked.

## Attention and alerts

A card whose lead agent reports `needs_input`, `blocked`, or `stale` sits in the **Attention** lane. The board also tracks which of those cards the human has actually opened: a card nobody has looked at since it last moved gets an amber rail and a **New** badge, the lane header offers **Mark n seen**, and the unread count rides in the tab title — the only part of the board still visible while another app has the keyboard.

Two facts are kept deliberately apart. A card is *waiting* according to its agents; it is *unread* according to this browser's `localStorage`. Opening a card clears the highlight and nothing else: the card stays in Attention until an agent moves it, so acknowledging can never hide work that is still waiting. The record lives per browser profile and is pruned when cards are deleted.

**Get alerts** in the masthead asks for the browser's notification permission, then shows a desktop notification when a card becomes unread. Three rules keep it from becoming noise:

- **One banner per arrival in Attention.** An agent that posts twice while its card waits has not arrived twice, so the banner is latched until the card leaves the lane or the human acknowledges it.
- **No banner while the board is the focused window.** The amber card already said it — but the arrival is still latched, so walking away afterwards does not produce a stale banner for something that was on screen.
- **The banner is actionable.** It carries the card's next action, and clicking it focuses an open board on that card, or opens one at `/?work-session=<id>` if none is running. The service worker's `notificationclick` handler only ever focuses a window on its own origin.

Known limits:

- Alerts need the board open somewhere; there is no push service, so closing the browser closes the alerts. A banner that has to reach a machine with no board running would need either a local native notifier on the server side or Web Push with its own keys.
- The board polls every five seconds and browsers throttle timers in a hidden tab, so a banner can lag behind the card by up to about a minute.
- Permission and intent are stored separately: the browser remembers that notifications are allowed, and the board remembers whether the human actually asked for them, so turning alerts off never needs a browser trip.

`public/board-state.js` holds the lane mapping, the unread rule, and the banner latch as pure functions with no DOM, storage, or network access, which is what lets `test/board-state.test.mjs` drive them case by case. The page keeps only the wiring: storage, the badge, and the `Notification` call.

## Stalled cards

An agent that hits a context or usage limit, or that is stopped mid-command, cannot report anything afterwards — the card it was working on keeps saying `working` and sits in **Active** forever. The board cannot see a provider process, so the only honest signal available to it is silence: a card whose lead agent still reports `working` and whose last update is **15 minutes** old gets a dashed amber **Stalled** chip. The chip carries a tooltip, and the card's own timestamp beside it already says how long the quiet has run, so neither repeats the other.

Three deliberate constraints:

- **It never moves the card between lanes.** Attention means *an agent says it needs you*; if a timer could promote a card into it, that lane would also mean *an agent has not typed for a while*, and a long build would page you through the opt-in desktop alerts. A stalled card stays in Active and grows a chip.
- **Only a card that still claims to be working.** A card already in Attention, Handoff, or Done has said what it wants; re-flagging a 43-minute-old handoff as "stalled" would be noise about a clean stop.
- **One threshold, one place.** `STALL_AFTER_MS` lives in `public/board-state.js`; neither the page nor the chip's copy restates the number, and `test/stall-flag.test.mjs` fails if either starts to.

Because the flag is derived rather than declared, the agent-declared `stale` status still exists and still means something different: an agent that can still write is telling you it is stuck, and that lands in Attention.

**It clears itself.** Nothing latches and there is no dismissal gesture: the chip is recomputed on every poll from the card's last update, so one ordinary `update_agent_progress` or `add_message` from the agent removes it on the next refresh. Verified end to end on 2026-09-16 — a working card backdated 20 minutes showed the chip, and a single ordinary progress write cleared it (real MCP write → store → `/api` payload → chip).

The counterpart is an operational rule rather than a code one. The portable skill and this repo's policy ask an agent to post one short `note` before any step expected to keep it silent for more than about ten minutes, and to report `status: stale` itself when it knows it is stuck rather than waiting to be inferred. Heartbeats are what turn the chip from a guess about a busy agent into evidence of a dead one — though a single blocking command gives an agent no moment to report mid-step, which is why the announcement is asked for *beforehand*.

The extra chip forced a layout change worth knowing about: at the four-lane band (~1081–1400px) a lane is 250–330px, and the status chip plus any badge needs 153px of the 244px of card content that the 84px timestamp also wants. Measured, the chip was clipped and printed over the time, so `.card-topline` now wraps and the timestamp drops to its own right-aligned line. Only cards in that band grow, and cards never overlap.

Known limits:

- Silence is not proof. A 20-minute build, a long test run, or a session the human left open at a prompt all look exactly like a limit hit. This is why the flag is advisory rather than a lane move, and why the skill asks for a heartbeat before a long step.
- The heartbeat only helps when an agent gets control between steps. A single blocking command cannot be interrupted to report, so a genuinely busy agent can still be flagged; the rule is to announce that step first.
- A card only ages out while the board is open somewhere: the timer is the page's five-second poll, and browsers throttle timers in a hidden tab, so the chip can appear a little late.
- The threshold is fixed rather than per-agent. A tool that legitimately runs for 40 minutes has no way to say so, and will be flagged from minute 15.

## Theme

The board ships a light and a dark palette with a **System / Light / Dark** control in the masthead. `System` is stored as an absent key rather than a literal, so a page left on it follows the OS live; an explicit choice pins the page and survives reloads.

The control is a segmented radio group rather than a select, and that is load-bearing twice over. It needs no visible group label — the legend is visually hidden but kept for its accessible name — so it costs no extra row; and at 25px it keeps the stacked tools column (78px) under the signal strip (85px), which is what actually sets the masthead height. A labelled select pushed that column past the strip and grew the masthead. The **Get alerts** button shares that row for the same reason: a control of its own would add a third row and grow the masthead again. Native radios also give arrow-key traversal for free. The radio values `system`/`light`/`dark` are a contract with the resolver, which only persists the latter two literally; `test/theme.test.mjs` pins them.

The resolved theme is written to `<html data-theme>`. Light is the CSS base and `:root[data-theme='dark']` overrides it — deliberately not a `prefers-color-scheme` media query, because a media query cannot share a declaration block with an attribute selector, which would force the whole dark palette to be written twice.

The palette tokens are `--bg`, `--fg`, `--fg-lead`, `--fg-body`, `--muted`, `--surface`, `--surface-card`, `--surface-sheet`, the three `--line` weights, the five semantic colours (`--accent`, `--amber`, `--red`, `--blue`, `--purple`), and the wash/shadow tokens. They were previously named `--paper`/`--ink`/`--panel`/`--lime`, which read as colours rather than roles and inverted in light mode. Both palettes define the same 24 tokens; a token defined in only one would silently inherit the other theme's value. Every colour in the sheet is a token — a literal in a rule cannot flip.

`test/theme.test.mjs` enforces that parity, the absence of stray colour literals, that the light palette is genuinely lighter, and that the resolution rule behaves as documented — `System` follows the OS, an explicit choice beats it, an unrecognised or unreadable stored value falls back to the OS. `test/http-server.test.mjs` pins the fallback page's copy of the rule to the same cases.

Two things are load-bearing:

- The boot script stays **inline and ahead of the stylesheet link**. `app.js` is a deferred module, so it cannot prevent a first paint in the wrong palette.
- There are **two copies** of the resolution rule — the board's inline script and the server-rendered `/open/` fallback in `server.mjs` — because an inline script cannot import a module. The tests pin both to the same cases so they cannot drift apart.

Known limits:

- The web app manifest's `theme_color` and `background_color` are static, so an installed PWA shows a dark splash before the board paints. Following the chosen theme would need a second manifest swapped at boot. The `apple-mobile-web-app-status-bar-style` hint was dropped rather than left pinned to `black-translucent`, which is unreadable on a light board; the status bar now follows `theme-color`, which the boot script keeps current.
- The app icon is deliberately brand-dark in both themes — one icon, not two.
- The `/open/` 404 for an unknown id ("Agent session not found") is a bare unstyled fragment and renders as a white page regardless of theme. That page was never styled; the themed reference page beside it is what a real agent without a session link gets.

## Checks

```bash
npm test
```

The MCP surface uses the official JavaScript/TypeScript MCP SDK over stdio, intended for local process-spawned integrations.
