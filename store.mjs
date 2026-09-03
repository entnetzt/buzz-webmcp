import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SPACES = 12;
const MAX_MESSAGES = 200;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, field, max) {
  const text = String(value ?? "").trim();
  if (!text) throw new StoreError(400, `${field} is required.`);
  if (text.length > max) throw new StoreError(400, `${field} must be ${max} characters or fewer.`);
  return text;
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
        source: "ui",
        content: "The WebMCP tools should use the exact same actions as the visible interface.",
        createdAt,
      },
      {
        id: randomUUID(),
        spaceId: lab,
        author: "Atlas",
        role: "agent",
        source: "webmcp",
        content: "Agreed. I will return IDs and timestamps so every tool result can be verified on screen.",
        createdAt,
      },
      {
        id: randomUUID(),
        spaceId: product,
        author: "Noah",
        role: "human",
        source: "ui",
        content: "A browser agent should be able to find context without a separate integration or copied transcript.",
        createdAt,
      },
      {
        id: randomUUID(),
        spaceId: launch,
        author: "Maya",
        role: "human",
        source: "ui",
        content: "Handoff: verify tool discovery, run the clean-session demo, then freeze the public build.",
        createdAt,
      },
    ],
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
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      const cutoff = Date.now() - SESSION_MAX_AGE_MS;
      for (const workspace of raw.workspaces || []) {
        if (Date.parse(workspace.updatedAt) >= cutoff) this.workspaces.set(workspace.sessionId, workspace);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this;
  }

  ensure(sessionId) {
    if (!this.workspaces.has(sessionId)) this.workspaces.set(sessionId, starterWorkspace(sessionId));
    return this.workspaces.get(sessionId);
  }

  snapshot(sessionId) {
    return structuredClone(this.ensure(sessionId));
  }

  listSpaces(sessionId) {
    return this.snapshot(sessionId).spaces;
  }

  readMessages(sessionId, spaceId, limit = 50) {
    const workspace = this.ensure(sessionId);
    const space = this.findSpace(workspace, spaceId);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const messages = workspace.messages
      .filter((message) => message.spaceId === space.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-safeLimit);
    return { space: structuredClone(space), messages: structuredClone(messages) };
  }

  searchMessages(sessionId, query, spaceId, limit = 30) {
    const workspace = this.ensure(sessionId);
    const needle = cleanText(query, "query", 120).toLocaleLowerCase();
    if (spaceId) this.findSpace(workspace, spaceId);
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 50);
    const spaces = new Map(workspace.spaces.map((space) => [space.id, space]));
    return workspace.messages
      .filter((message) => !spaceId || message.spaceId === spaceId)
      .filter((message) => `${message.author}\n${message.content}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, safeLimit)
      .map((message) => ({ ...structuredClone(message), spaceName: spaces.get(message.spaceId)?.name || "unknown" }));
  }

  async createSpace(sessionId, input) {
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
      description: String(input.description ?? "").trim().slice(0, 180),
      createdAt: isoNow(),
    };
    workspace.spaces.push(space);
    workspace.updatedAt = space.createdAt;
    await this.persist();
    return structuredClone(space);
  }

  async postMessage(sessionId, input) {
    const workspace = this.ensure(sessionId);
    const space = this.findSpace(workspace, input.spaceId);
    const content = cleanText(input.content, "content", 1000);
    const idempotencyKey = String(input.idempotencyKey ?? "").trim().slice(0, 100);
    if (idempotencyKey) {
      const existing = workspace.messages.find((message) => message.idempotencyKey === idempotencyKey);
      if (existing) return { message: structuredClone(existing), created: false, space: structuredClone(space) };
    }
    if (workspace.messages.length >= MAX_MESSAGES) workspace.messages.splice(0, workspace.messages.length - MAX_MESSAGES + 1);
    const message = {
      id: randomUUID(),
      spaceId: space.id,
      author: input.source === "webmcp" ? "Browser Agent" : "You",
      role: input.source === "webmcp" ? "agent" : "human",
      source: input.source === "webmcp" ? "webmcp" : "ui",
      content,
      createdAt: isoNow(),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };
    workspace.messages.push(message);
    workspace.updatedAt = message.createdAt;
    await this.persist();
    return { message: structuredClone(message), created: true, space: structuredClone(space) };
  }

  async reset(sessionId) {
    const workspace = starterWorkspace(sessionId);
    this.workspaces.set(sessionId, workspace);
    await this.persist();
    return structuredClone(workspace);
  }

  findSpace(workspace, spaceId) {
    const space = workspace.spaces.find((item) => item.id === String(spaceId ?? ""));
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
