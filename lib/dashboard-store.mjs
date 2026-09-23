import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROVIDERS = ['codex', 'claude', 'dsh', 'opencode', 'other'];
export const ROLES = ['implementer', 'reviewer', 'researcher', 'tester', 'coordinator', 'other'];
export const STATUSES = ['working', 'needs_input', 'blocked', 'handoff', 'done', 'stale'];
export const MESSAGE_KINDS = ['progress', 'question', 'blocker', 'handoff', 'review', 'note'];
// The board's four columns, in board order. A status is what an agent reports; a lane is where the
// card ends up. They are one-to-many (three statuses share the Attention lane), which is why a human
// placing a card by hand has to name a lane rather than a status. public/board-state.js holds the
// status-to-lane map and test/lane-override.test.mjs pins the two lists together.
export const LANES = ['attention', 'active', 'handoff', 'done'];

const EMPTY_DASHBOARD = Object.freeze({ schemaVersion: 2, workSessions: [] });
const lockDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function copy(value) {
  return structuredClone(value);
}

export class DashboardStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
  }

  async listWorkSessions() {
    const dashboard = await this.#read();
    return dashboard.workSessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createWorkSession(input) {
    return this.#write((dashboard) => {
      const now = new Date().toISOString();
      const workSession = {
        id: randomUUID(),
        title: input.title,
        issueNumber: input.issueNumber ?? null,
        issueUrl: input.issueUrl ?? null,
        project: input.project ?? null,
        worktree: input.worktree ?? null,
        branch: input.branch ?? null,
        summary: input.summary ?? 'Work session registered. Waiting for its first agent.',
        nextAction: input.nextAction ?? null,
        // Where a human put this card by hand, or null while the agents' statuses decide. It is a
        // placement, never a status: the card still reports what the agents said, so "the human moved
        // this" can never be mistaken for "an agent finished this".
        laneOverride: null,
        createdAt: now,
        updatedAt: now,
        agents: [],
      };
      dashboard.workSessions.push(workSession);
      return workSession;
    });
  }

  async updateWorkSession(workSessionId, patch) {
    return this.#write((dashboard) => {
      const workSession = this.#findWorkSession(dashboard, workSessionId);
      const fields = ['title', 'issueNumber', 'issueUrl', 'project', 'worktree', 'branch', 'summary', 'nextAction'];
      for (const field of fields) {
        if (patch[field] !== undefined) workSession[field] = patch[field];
      }
      workSession.updatedAt = new Date().toISOString();
      return workSession;
    });
  }

  // Moving a card by hand is a placement, never a status report: nothing here touches an agent, so the
  // card keeps saying what the agents actually said. `lane: null` returns it to them. Two deliberate
  // omissions: no `updatedAt` stamp, because the card's time is when an agent last wrote and a human
  // moving a card is not agent activity — and no clearing on the next `update_agent_progress`, because
  // a move that a live session can silently undo is worse than no move at all.
  async setLaneOverride(workSessionId, lane) {
    if (lane !== null && !LANES.includes(lane)) {
      throw new Error(`No lane is named ${lane}. Use one of ${LANES.join(', ')}, or null to return the card to its agents.`);
    }
    return this.#write((dashboard) => {
      const workSession = dashboard.workSessions.find((candidate) => candidate.id === workSessionId);
      if (!workSession) return null;
      workSession.laneOverride = lane ? { lane, at: new Date().toISOString() } : null;
      return workSession;
    });
  }

  async deleteWorkSession(workSessionId) {
    return this.#write((dashboard) => {
      const index = dashboard.workSessions.findIndex((candidate) => candidate.id === workSessionId);
      if (index === -1) return null;
      return dashboard.workSessions.splice(index, 1)[0];
    });
  }

  async registerAgent(workSessionId, input) {
    return this.#write((dashboard) => {
      const workSession = this.#findWorkSession(dashboard, workSessionId);
      const now = new Date().toISOString();
      const agent = {
        id: randomUUID(),
        name: input.name ?? `${input.provider} ${input.role}`,
        provider: input.provider,
        role: input.role,
        providerSessionId: input.providerSessionId ?? null,
        sessionName: input.sessionName ?? null,
        sessionUrl: input.sessionUrl ?? null,
        status: input.status ?? 'working',
        summary: input.summary ?? 'Agent registered. Waiting for its first update.',
        nextAction: input.nextAction ?? null,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      workSession.agents.push(agent);
      workSession.updatedAt = now;
      return { workSession, agent };
    });
  }

  async updateAgentProgress(workSessionId, agentId, patch) {
    return this.#write((dashboard) => {
      const workSession = this.#findWorkSession(dashboard, workSessionId);
      const agent = this.#findAgent(workSession, agentId);
      const fields = ['name', 'status', 'summary', 'nextAction', 'sessionUrl', 'providerSessionId', 'sessionName', 'role'];
      for (const field of fields) {
        if (patch[field] !== undefined) agent[field] = patch[field];
      }
      agent.updatedAt = new Date().toISOString();
      workSession.updatedAt = agent.updatedAt;
      return { workSession, agent };
    });
  }

  async addMessage(workSessionId, agentId, input) {
    return this.#write((dashboard) => {
      const workSession = this.#findWorkSession(dashboard, workSessionId);
      const agent = this.#findAgent(workSession, agentId);
      const message = {
        id: randomUUID(),
        kind: input.kind,
        text: input.text,
        author: input.author ?? agent.name,
        createdAt: new Date().toISOString(),
      };
      agent.messages.push(message);
      agent.updatedAt = message.createdAt;
      workSession.updatedAt = message.createdAt;
      return { workSession, agent, message };
    });
  }

  #findWorkSession(dashboard, workSessionId) {
    const workSession = dashboard.workSessions.find((candidate) => candidate.id === workSessionId);
    if (!workSession) throw new Error(`No work session exists with id ${workSessionId}.`);
    return workSession;
  }

  #findAgent(workSession, agentId) {
    const agent = workSession.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`No agent exists with id ${agentId} in this work session.`);
    return agent;
  }

  async #read() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.schemaVersion !== 2 || !Array.isArray(parsed.workSessions)) {
        throw new Error('The dashboard data file has an unsupported format. Delete it to start a fresh prototype board.');
      }
      return copy(parsed);
    } catch (error) {
      if (error.code === 'ENOENT') return copy(EMPTY_DASHBOARD);
      throw error;
    }
  }

  async #write(mutator) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const release = await this.#acquireLock();
    try {
      const dashboard = await this.#read();
      const result = mutator(dashboard);
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(dashboard, null, 2)}\n`, 'utf8');
      await rename(temporaryPath, this.filePath);
      return copy(result);
    } finally {
      await release();
    }
  }

  async #acquireLock() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const handle = await open(this.lockPath, 'wx');
        return async () => {
          await handle.close();
          await rm(this.lockPath, { force: true });
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const lockStats = await stat(this.lockPath).catch(() => null);
        if (lockStats && Date.now() - lockStats.mtimeMs > 10_000) {
          await rm(this.lockPath, { force: true });
          continue;
        }
        await lockDelay(25);
      }
    }
    throw new Error('The dashboard is busy. Please retry the update.');
  }
}
