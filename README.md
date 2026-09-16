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
- Until a native deep link is proven, the page lists the agent, provider, session name, session id, and worktree, with copy-to-clipboard buttons on the session id and the worktree. The worktree remains the stable resume path.

This keeps the dashboard useful today: a provider contributes an Open target only after that target is proven on the machine.

When that URL is an `http:`/`https:` address, a plain click on **Open here** renders the session in a panel over the board rather than a new tab, so the board is never lost. Because the browser will not let a page retarget an already-open tab on another origin, this is the only way to reach a local web GUI without either losing the board or accumulating tabs. The panel keeps an **Open in a new tab** link for the plain browser behaviour, and a modified click (⌘, Ctrl, or middle) still opens a tab. Providers whose `sessionUrl` uses a custom scheme (`codex:`, `vscode:`, …) keep the plain link, since a custom scheme has no framed form.

For a custom scheme the button points at the provider URL itself — `codex://threads/<id>`, `claude://claude.ai/<session>` — and not at `/open/…`. The OS handoff belongs to the activating click, while a redirect gives the browser a redirect to act on instead of a click, which it can drop. `/open/…` remains the target for an agent with no recorded link, where it serves the reference page. Codex Desktop and Claude Desktop were both confirmed switching to the recorded session this way on 2026-09-16.

The page's service worker never answers an `/open/…` navigation from its shell cache. Claiming that navigation replaced a handoff the browser could not follow with the cached board — an empty-looking dashboard in a new tab — so the redirector always goes to the network, like `/api/`.

Framing a local GUI is safe for the two things that usually break it: the panel only ever frames a same-host address, and a `SameSite=Strict` cookie from the framed origin is still sent because a port does not change the site.

Known limit: the panel opens the session **tool**, not the specific conversation. The DSH Web GUI has no per-session route — no client bundle reads a session query parameter or path — so one DSH `sessionUrl` serves every DSH card and the panel lands on whatever session that GUI is showing. Closing that gap needs the DSH Web shell itself to accept a session parameter at boot and open that session; a DSH agent would then register `${DSH_WEB_URL}/?session=${DSH_SESSION_ID}`, and this dashboard would need no change, because `http:` is already an allowed scheme.

A host that spawns the MCP server with `AGENT_DASHBOARD_SESSION_ID` (and optionally `AGENT_DASHBOARD_SESSION_NAME`) gets those values recorded for every agent that registers without them. DSH scrubs `DSH_*` names from MCP children, so a DSH agent passes `providerSessionId` itself — read from `$DSH_SESSION_ID`, never guessed.

## Checks

```bash
npm test
```

The MCP surface uses the official JavaScript/TypeScript MCP SDK over stdio, intended for local process-spawned integrations.
