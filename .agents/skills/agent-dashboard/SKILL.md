---
name: agent-dashboard
description: When Agent Dashboard MCP tools are available, register every real coding-agent task before repository work and keep its human-visible card current through meaningful status, question, blocker, handoff, completion, or verified session-link changes.
---

# Agent Dashboard

The dashboard is an awareness and handoff surface. It does not assign work, authorize changes, or replace the host's own task UI.

Use it only when its MCP tools are available. Do not substitute guessed tool calls or fake dashboard updates when it is not connected.

## Required start gate

When the Agent Dashboard MCP tools are visible, this skill applies to every actual implementation, investigation, review, or test task. Before repository discovery, planning, edits, or tests, create or join the work session and register yourself as its agent. This is required even for a small task; do not wait for the user to remind you.

If the initial prompt gives a work-session ID, join it. Otherwise create a new work session. A casual clarification that ends in a short answer does not need a card.

## Register once, then join

At the actual start of a new piece of work, call `register_work_session` with a concise title. Include an issue number or URL, project, worktree, and branch only when known; none is required.

Save the returned `workSession.id`. If another agent is already working on the same task, reuse that id rather than creating another card.

Each participating agent calls `register_agent` with its own provider, role, and provider session reference. The roles are `implementer`, `reviewer`, `researcher`, `tester`, `coordinator`, or `other`. Save the returned `agent.id` and update only that agent's record.

Always record the provider session reference, not only a URL:

- `providerSessionId` — the id the provider resumes this conversation from. DSH reads `$DSH_SESSION_ID`; Codex reads `$CODEX_SESSION_ID`, falling back to `$CODEX_THREAD_ID`. Never guess one.
- `sessionName` — the session's human-readable name or title, only when the host actually shows one.
- `sessionUrl` — a real, verified browser URL or provider deep link. DSH: read `$DSH_WEB_URL` in the shell and set it on every card; that is the local Web GUI serving you, so never guess a port. The card's Open button then reaches the GUI instead of the resume-reference page. It opens the GUI itself, not the exact conversation — the Web GUI has no per-session route — and it needs the browser's existing GUI cookie, so a fresh browser profile gets a 401.

Codex: the Codex session id *is* the thread id, so set `providerSessionId` to it and `sessionUrl` to `codex://threads/<session-id>`. Codex Desktop registers the `codex:` scheme and the dashboard already allows it, so Open switches the running desktop app to that thread. Verified 2026-09-16 on codex-cli 0.153.4 with Codex Desktop 26.901.51231. Without the desktop app, the CLI equivalent is `codex resume <session-id>`.

Never infer a native URL scheme. If you learn the reference after registering, record it with `update_agent_progress`.

## Report state changes, not activity noise

Use `update_agent_progress` when one of these changes becomes true:

- the agent starts meaningful work (`working`);
- the next useful action changes materially;
- a review, test, or research handoff is ready (`handoff`);
- user input or a decision is needed (`needs_input`);
- progress cannot continue without an external change (`blocked`);
- that agent's own responsibility is complete (`done`).

Use a short `summary` describing the current situation and a concrete `nextAction` when work remains. Use `add_message` for a short question, blocker, review finding, milestone, or handoff note. Do not report tool-by-tool progress, routine file reads, or unchanged polling.

## Do not go quiet for long

Two rules keep the board's own flags honest. Neither is progress chatter:

- **Announce a long silent step.** If a step you are about to run will stop you reporting for more than about ten minutes — a full test sweep, a large scaffold, a long build, a batch migration — post one short `note` first saying what is running and roughly how long it should take, and update again when it lands. The board cannot see your process, so a card whose agent still reports `working` and has not been touched for **15 minutes** is flagged **Stalled** on the board: from outside, a hit context limit and a long build look identical.
- **Say `stale` when you know you are stuck.** Still running but making no progress — a retry loop, a wait you cannot shorten, a failing approach you cannot abandon yet — report `status: stale` yourself. An agent-declared `stale` lands in the human's **Attention** lane, where an inferred stall only earns a chip in Active. Declaring it is louder and more honest than going quiet.

The aim is not more updates. A heartbeat before a long step is what makes silence *mean* something: if agents report during long runs, a Stalled chip becomes evidence of a dead session rather than a guess about a busy one. If a single blocking command gives you no chance to report mid-step, announce it beforehand — that is exactly the case the announcement is for.

## Protect resumability

Before a natural context boundary, a risky experiment, or a likely token-limit boundary, record a `handoff` with the current summary, the exact next action, and a short `add_message` explaining what a fresh session needs to do. Keep the original agent registered; the successor is a separate agent session with its own role and session reference.

If a session stops abruptly, no dashboard protocol can update it afterward. The purpose of the early handoff is to preserve the resume path before that happens.

## Keep shared framing accurate

Use `update_work_session` only when information shared by all participants changes: the title, issue metadata, project, worktree, branch, or overall summary. Do not mark the whole work session complete merely because one reviewer or implementer has finished; the dashboard derives the card's state from its participants.

## Finish honestly

Mark an agent `done` only after its own assigned work is actually complete. If it needs human review, a decision, or another agent's action, use `handoff`, `needs_input`, or `blocked` instead and say what is needed.
