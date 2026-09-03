import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StoreError, WorkspaceStore } from "./store.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3056);
const HOST = process.env.HOST || "127.0.0.1";
const STATE_FILE = process.env.STATE_FILE || path.join(ROOT, ".runtime", "state.json");
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : null;
const SESSION_COOKIE = "__Host-gatherwire_webmcp_session";
const SESSION_RE = /^[a-f0-9]{48}$/;
const BODY_LIMIT = 16 * 1024;
const HSTS = "max-age=31536000; includeSubDomains";

const store = await new WorkspaceStore(STATE_FILE).load();

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, ...value]) => [key, decodeURIComponent(value.join("="))]),
  );
}

function sessionFor(req, headers) {
  const candidate = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (SESSION_RE.test(candidate || "") && store.hasSession(candidate)) return candidate;
  const sessionId = randomBytes(24).toString("hex");
  store.ensure(sessionId);
  headers["Set-Cookie"] = `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
  return sessionId;
}

function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": HSTS,
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function forwardedScheme(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwarded) return forwarded;
  try {
    return JSON.parse(String(req.headers["cf-visitor"] || "{}"))?.scheme?.toLowerCase();
  } catch {
    return undefined;
  }
}

function redirectToPublicHttps(req, res, url) {
  if (!PUBLIC_ORIGIN || forwardedScheme(req) !== "http") return false;
  const destination = new URL(`${url.pathname}${url.search}`, PUBLIC_ORIGIN);
  res.writeHead(308, {
    Location: destination.toString(),
    "Cache-Control": "no-store",
    "Strict-Transport-Security": HSTS,
  });
  res.end();
  return true;
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > BODY_LIMIT) throw new StoreError(413, "Request body is too large.");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new StoreError(400, "Request body must be valid JSON.");
  }
}

function requireExactFields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new StoreError(400, "Request body must be a JSON object.");
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length) throw new StoreError(400, `Unknown request field: ${unknown[0]}.`);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, service: "gatherwire-webmcp" });
  }
  const responseHeaders = {};
  const sessionId = sessionFor(req, responseHeaders);
  if (req.method === "GET" && url.pathname === "/api/workspace") {
    return json(res, 200, { workspace: store.snapshot(sessionId) }, responseHeaders);
  }
  if (req.method === "GET" && url.pathname === "/api/spaces") {
    return json(res, 200, { spaces: store.listSpaces(sessionId) }, responseHeaders);
  }
  if (req.method === "GET" && url.pathname === "/api/project-agents") {
    return json(res, 200, { agents: store.listProjectAgents(sessionId) }, responseHeaders);
  }
  if (req.method === "GET" && url.pathname === "/api/search") {
    const results = store.searchMessages(sessionId, url.searchParams.get("q"), url.searchParams.get("space_id"), url.searchParams.get("limit"));
    return json(res, 200, { query: url.searchParams.get("q"), results }, responseHeaders);
  }
  if (req.method === "POST" && url.pathname === "/api/spaces") {
    const space = await store.createSpace(sessionId, await body(req));
    return json(res, 201, { space }, responseHeaders);
  }
  if (req.method === "POST" && url.pathname === "/api/handoffs") {
    const payload = await body(req);
    requireExactFields(payload, new Set(["source_space_id", "target_space_id", "target_agent_id", "summary", "next_action", "evidence_message_ids", "request_id"]));
    const result = await store.publishHandoff(sessionId, {
      sourceSpaceId: payload.source_space_id,
      targetSpaceId: payload.target_space_id,
      targetAgentId: payload.target_agent_id,
      summary: payload.summary,
      nextAction: payload.next_action,
      evidenceMessageIds: payload.evidence_message_ids,
      idempotencyKey: payload.request_id || req.headers["idempotency-key"],
    });
    return json(res, result.created ? 201 : 200, result, responseHeaders);
  }
  if (req.method === "POST" && url.pathname === "/api/reset") {
    return json(res, 200, { workspace: await store.reset(sessionId) }, responseHeaders);
  }

  const messageMatch = url.pathname.match(/^\/api\/spaces\/([a-f0-9-]+)\/messages$/i);
  if (messageMatch && req.method === "GET") {
    return json(res, 200, store.readMessages(sessionId, messageMatch[1], url.searchParams.get("limit")), responseHeaders);
  }
  if (messageMatch && req.method === "POST") {
    const payload = await body(req);
    requireExactFields(payload, new Set(["content", "source", "idempotency_key"]));
    const result = await store.postMessage(sessionId, {
      spaceId: messageMatch[1],
      content: payload.content,
      source: payload.source,
      idempotencyKey: payload.idempotency_key || req.headers["idempotency-key"],
    });
    return json(res, result.created ? 201 : 200, result, responseHeaders);
  }
  return json(res, 404, { error: "API route not found." }, responseHeaders);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function handleStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path.resolve(PUBLIC, `.${requested}`);
  if (!resolved.startsWith(`${PUBLIC}${path.sep}`)) throw new StoreError(404, "Not found.");
  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("not file");
    const content = await readFile(resolved);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(resolved)] || "application/octet-stream",
      "Cache-Control": path.extname(resolved) === ".html" ? "no-cache" : "public, max-age=300",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": HSTS,
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (redirectToPublicHttps(req, res, url)) return;
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") await handleStatic(req, res, url);
    else json(res, 405, { error: "Method not allowed." });
  } catch (error) {
    const status = error instanceof StoreError ? error.status : 500;
    if (status === 500) console.error(error);
    json(res, status, { error: status === 500 ? "Unexpected server error." : error.message });
  }
});

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  server.listen(PORT, HOST, () => console.log(`Gatherwire WebMCP listening on http://${HOST}:${PORT}`));
}
