import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SPACES = 12;
const MAX_MESSAGES = 200;
const MAX_HANDOFFS = 60;
const MAX_ACTIVE_SESSIONS = 1000;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;
const DEMO_PROJECT_AGENTS = Object.freeze([
  Object.freeze({
    id: "demo:project-agent:atlas",
    name: "Atlas",
    project: "WebMCP Lab",
    status: "synthetic",
    synthetic: true,
  }),
]);

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, field, max) {
  if (typeof value !== "string") throw new StoreError(400, `${field} must be a string.`);
  const text = value.trim();
  if (!text) throw new StoreError(400, `${field} is required.`);
  if (text.length > max) throw new StoreError(400, `${field} must be ${max} characters or fewer.`);
  return text;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new StoreError(400, `${field} must be a string.`);
  const text = value.trim();
  if (text.length > max) throw new StoreError(400, `${field} must be ${max} characters or fewer.`);
  return text;
}

function boundedInteger(value, fallback, max, field = "limit") {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new StoreError(400, `${field} must be an integer from 1 to ${max}.`);
  }
  return parsed;
}

function objectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError(400, "Request body must be a JSON object.");
  return value;
}

function publicMessage(message) {
  const clone = structuredClone(message);
  delete clone.idempotencyKey;
  return clone;
}

function publicHandoff(handoff) {
  const clone = structuredClone(handoff);
  delete clone.idempotencyKey;
  return clone;
}

function publicWorkspace(workspace) {
  const clone = structuredClone(workspace);
  delete clone.sessionId;
  clone.messages = clone.messages.map(publicMessage);
  clone.handoffs = (clone.handoffs || []).map(publicHandoff);
  return clone;
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function idempotencyConflict() {
  throw new StoreError(409, "request_id was already used with different input.");
}

function starterWorkspace(sessionId) {
  const createdAt = isoNow();
  const lab = randomUUID();
  const product = randomUUID();
  const launch = randomUUID();
  return {
    sessionId,
    createdAt,
    updatedAt: createdAt,
    participants: structuredClone(DEMO_PROJECT_AGENTS),
    spaces: [
      { id: lab, name: "webmcp-lab", description: "Build and test the shared human-agent interface.", createdAt },
      { id: product, name: "product", description: "Product decisions, research, and open questions.", createdAt },
      { id: launch, name: "launch-room", description: "Coordinate the public demo and release checklist.", createdAt },
    ],
    messages: [
      {
        id: randomUUID(),
        spaceId: lab,
        author: "Maya",
        role: "human",
        source: "seed",
        content: "The WebMCP tools should use the exact same actions as the visible interface.",
        createdAt,
      },
      {
        id: randomUUID(),
        spaceId: lab,
        author: "Atlas (sample)",
        role: "agent",
        source: "seed",
        content: "Sample note: return IDs and timestamps so every tool result can be verified on screen.",
        createdAt,
      },
      {
        id: randomUUID(),
        spaceId: product,
        author: "Noah",
        role: "human",
        source: "seed",
        content: "A browser agent should be able to find context without a separate integration or copied transcript.",
        createdAt,
      },
      {
        id: randomUUID(),
        spaceId: launch,
        author: "Maya",
        role: "human",
        source: "seed",
        content: "Handoff: verify tool discovery, run the clean-session demo, then freeze the public build.",
        createdAt,
      },
    ],
    handoffs: [],
  };
}

export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class WorkspaceStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.workspaces = new Map();
    this.writeQueue = Promise.resolve();
    this.lastPrunedAt = 0;
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      const cutoff = Date.now() - SESSION_MAX_AGE_MS;
      const recent = (raw.workspaces || [])
        .filter((workspace) => Date.parse(workspace.updatedAt) >= cutoff)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, MAX_ACTIVE_SESSIONS);
      for (const workspace of recent) {
        if (!Array.isArray(workspace.participants)) workspace.participants = structuredClone(DEMO_PROJECT_AGENTS);
        if (!Array.isArray(workspace.handoffs)) workspace.handoffs = [];
        this.workspaces.set(workspace.sessionId, workspace);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this;
  }

  ensure(sessionId) {
    if (!this.workspaces.has(sessionId)) {
      this.prune();
      if (this.workspaces.size >= MAX_ACTIVE_SESSIONS) {
        const oldest = [...this.workspaces.values()].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))[0];
        if (oldest) this.workspaces.delete(oldest.sessionId);
      }
      this.workspaces.set(sessionId, starterWorkspace(sessionId));
    }
    return this.workspaces.get(sessionId);
  }

  hasSession(sessionId) {
    return this.workspaces.has(sessionId);
  }

  prune(now = Date.now()) {
    if (now - this.lastPrunedAt < PRUNE_INTERVAL_MS) return;
    const cutoff = now - SESSION_MAX_AGE_MS;
    for (const [sessionId, workspace] of this.workspaces) {
      if (Date.parse(workspace.updatedAt) < cutoff) this.workspaces.delete(sessionId);
    }
    this.lastPrunedAt = now;
  }

  snapshot(sessionId) {
    return publicWorkspace(this.ensure(sessionId));
  }

  listSpaces(sessionId) {
    return this.snapshot(sessionId).spaces;
  }

  listProjectAgents(sessionId) {
    return this.snapshot(sessionId).participants;
  }

  readMessages(sessionId, spaceId, limit = 10) {
    const workspace = this.ensure(sessionId);
    const space = this.findSpace(workspace, spaceId);
    const safeLimit = boundedInteger(limit, 10, 10);
    const messages = workspace.messages
      .filter((message) => message.spaceId === space.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-safeLimit);
    const handoffs = workspace.handoffs
      .filter((handoff) => handoff.targetSpaceId === space.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-safeLimit);
    return {
      space: structuredClone(space),
      messages: messages.map(publicMessage),
      handoffs: handoffs.map(publicHandoff),
    };
  }

  searchMessages(sessionId, query, spaceId, limit = 10) {
    const workspace = this.ensure(sessionId);
    const needle = cleanText(query, "query", 120).toLocaleLowerCase();
    if (spaceId) this.findSpace(workspace, spaceId);
    const safeLimit = boundedInteger(limit, 10, 10);
    const spaces = new Map(workspace.spaces.map((space) => [space.id, space]));
    return workspace.messages
      .filter((message) => !spaceId || message.spaceId === spaceId)
      .filter((message) => `${message.author}\n${message.content}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit)
      .map((message) => ({ ...publicMessage(message), spaceName: spaces.get(message.spaceId)?.name || "unknown" }));
  }

  async createSpace(sessionId, input) {
    input = objectInput(input);
    const workspace = this.ensure(sessionId);
    if (workspace.spaces.length >= MAX_SPACES) throw new StoreError(409, `This demo supports up to ${MAX_SPACES} spaces.`);
    const name = cleanText(input.name, "name", 50)
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!name) throw new StoreError(400, "name must include a letter or number.");
    if (workspace.spaces.some((space) => space.name === name)) throw new StoreError(409, `A space named ${name} already exists.`);
    const space = {
      id: randomUUID(),
      name,
      description: optionalText(input.description, "description", 180),
      createdAt: isoNow(),
    };
    workspace.spaces.push(space);
    workspace.updatedAt = space.createdAt;
    await this.persist();
    return structuredClone(space);
  }

  async postMessage(sessionId, input) {
    input = objectInput(input);
    const workspace = this.ensure(sessionId);
    const space = this.findSpace(workspace, input.spaceId);
    const content = cleanText(input.content, "content", 1000);
    const idempotencyKey = optionalText(input.idempotencyKey, "request_id", 100);
    if (idempotencyKey) {
      const existing = workspace.messages.find((message) => message.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.spaceId !== space.id || existing.content !== content) idempotencyConflict();
        return {
          message: publicMessage(existing),
          created: false,
          space: structuredClone(this.findSpace(workspace, existing.spaceId)),
        };
      }
    }
    if (workspace.messages.length >= MAX_MESSAGES) {
      const pinnedEvidenceIds = new Set(workspace.handoffs.flatMap((handoff) => handoff.evidenceMessageIds));
      const removableIndex = workspace.messages.findIndex((message) => !pinnedEvidenceIds.has(message.id));
      if (removableIndex < 0) throw new StoreError(409, "This demo cannot store another message while all retained messages are linked evidence.");
      workspace.messages.splice(removableIndex, 1);
    }
    const message = {
      id: randomUUID(),
      spaceId: space.id,
      author: input.source === "webmcp" ? "Demo operator" : "You",
      role: input.source === "webmcp" ? "agent" : "human",
      source: "shared-api",
      content,
      createdAt: isoNow(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };
    workspace.messages.push(message);
    workspace.updatedAt = message.createdAt;
    await this.persist();
    return { message: publicMessage(message), created: true, space: structuredClone(space) };
  }

  async publishHandoff(sessionId, input) {
    input = objectInput(input);
    const workspace = this.ensure(sessionId);
    const sourceSpace = this.findSpace(workspace, input.sourceSpaceId);
    const targetSpace = this.findSpace(workspace, input.targetSpaceId);
    const targetAgent = workspace.participants.find((participant) => participant.id === input.targetAgentId);
    if (!targetAgent) throw new StoreError(404, "Project agent not found in this demo workspace.");
    const summary = cleanText(input.summary, "summary", 500);
    const nextAction = cleanText(input.nextAction, "next_action", 300);
    const idempotencyKey = optionalText(input.idempotencyKey, "request_id", 100);

    if (!Array.isArray(input.evidenceMessageIds) || input.evidenceMessageIds.length < 1 || input.evidenceMessageIds.length > 5) {
      throw new StoreError(400, "evidence_message_ids must contain from 1 to 5 message IDs.");
    }
    if (new Set(input.evidenceMessageIds).size !== input.evidenceMessageIds.length) {
      throw new StoreError(400, "evidence_message_ids must not contain duplicates.");
    }
    const evidenceMessages = input.evidenceMessageIds.map((messageId) => {
      if (typeof messageId !== "string" || !messageId || messageId.length > 80) {
        throw new StoreError(400, "Each evidence message ID must be a valid string.");
      }
      const message = workspace.messages.find((item) => item.id === messageId && item.spaceId === sourceSpace.id);
      if (!message) throw new StoreError(400, "Every evidence message must exist in the selected source space.");
      return message;
    });

    if (idempotencyKey) {
      const existing = workspace.handoffs.find((handoff) => handoff.idempotencyKey === idempotencyKey);
      if (existing) {
        if (
          existing.sourceSpaceId !== sourceSpace.id
          || existing.targetSpaceId !== targetSpace.id
          || existing.targetAgentId !== targetAgent.id
          || existing.summary !== summary
          || existing.nextAction !== nextAction
          || !sameStringArray(existing.evidenceMessageIds, evidenceMessages.map((message) => message.id))
        ) idempotencyConflict();
        return {
          handoff: publicHandoff(existing),
          created: false,
          sourceSpace: structuredClone(this.findSpace(workspace, existing.sourceSpaceId)),
          targetSpace: structuredClone(this.findSpace(workspace, existing.targetSpaceId)),
          targetAgent: structuredClone(workspace.participants.find((participant) => participant.id === existing.targetAgentId)),
        };
      }
    }
    if (workspace.handoffs.length >= MAX_HANDOFFS) workspace.handoffs.splice(0, workspace.handoffs.length - MAX_HANDOFFS + 1);
    const handoff = {
      id: randomUUID(),
      taskId: `task:${randomUUID()}`,
      correlationId: randomUUID(),
      sourceSpaceId: sourceSpace.id,
      targetSpaceId: targetSpace.id,
      targetAgentId: targetAgent.id,
      summary,
      nextAction,
      evidenceMessageIds: evidenceMessages.map((message) => message.id),
      author: "Demo operator",
      source: "shared-api",
      status: "recorded",
      synthetic: true,
      createdAt: isoNow(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };
    workspace.handoffs.push(handoff);
    workspace.updatedAt = handoff.createdAt;
    await this.persist();
    return {
      handoff: publicHandoff(handoff),
      created: true,
      sourceSpace: structuredClone(sourceSpace),
      targetSpace: structuredClone(targetSpace),
      targetAgent: structuredClone(targetAgent),
    };
  }

  async reset(sessionId) {
    const workspace = starterWorkspace(sessionId);
    this.workspaces.set(sessionId, workspace);
    await this.persist();
    return publicWorkspace(workspace);
  }

  findSpace(workspace, spaceId) {
    if (typeof spaceId !== "string" || !spaceId || spaceId.length > 80) throw new StoreError(400, "space_id must be a valid string.");
    const space = workspace.spaces.find((item) => item.id === spaceId);
    if (!space) throw new StoreError(404, "Space not found in this demo workspace.");
    return space;
  }

  persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify({ workspaces: [...this.workspaces.values()] }, null, 2)}\n`, "utf8");
      await rename(temp, this.filePath);
    });
    return this.writeQueue;
  }
}
