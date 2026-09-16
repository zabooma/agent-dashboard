# Agent Dashboard pilot policy

This repository is an explicit Agent Dashboard test bed. When the Agent Dashboard MCP tools are available, tracking is a required start condition for every actual task: implementation, investigation, review, or test work. A casual clarification that ends in a short answer is the only exception.

Before repository discovery, planning, an edit, or a test:

1. Call `register_work_session` for the task, unless the prompt supplies an existing work-session ID to join.
2. Call `register_agent` for yourself with the correct provider and role.
3. Save both returned IDs and use `update_agent_progress` only for meaningful changes: a changed next action, a question, a blocker, a handoff, or your completed responsibility.

This is mandatory even for small tasks. Do not wait for the user to remind you, and do not infer a session URL. If the MCP tools are unavailable, say that immediately instead of pretending an update happened.

Before a long exploration, risky experiment, or likely context-limit boundary, record a `handoff` with the exact next action and a short `add_message`. A session that reaches its limit cannot create its own handoff afterward.

A long silent step needs a heartbeat. If a step will stop you reporting for more than about ten minutes — a full test sweep, a long build, a large scaffold — post one short `note` before it starts and update again when it lands. The board flags a card that still reports `working` after **15 minutes** without an update, and it cannot tell a long build from a session that died. If you are running but stuck, report `status: stale` yourself; that reaches the Attention lane, where an inferred stall only earns a chip in Active.

Use the portable [Agent Dashboard skill](.agents/skills/agent-dashboard/SKILL.md) for the complete protocol. Agents may never delete dashboard cards; that remains a human action.
