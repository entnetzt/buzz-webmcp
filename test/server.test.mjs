import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function serverFixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "buzz-webmcp-server-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      STATE_FILE: path.join(dir, "state.json"),
      PUBLIC_ORIGIN: "https://buzz-webmcp.zeitfuereincoaching.de",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { base };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Test server did not start");
}

test("HTTP API keeps visitor workspaces isolated and validates writes", async (t) => {
  const { base } = await serverFixture(t);
  const first = await fetch(`${base}/api/workspace`);
  const cookieA = first.headers.get("set-cookie").split(";")[0];
  const workspaceA = (await first.json()).workspace;
  const space = workspaceA.spaces[0];

  const post = await fetch(`${base}/api/spaces/${space.id}/messages`, {
    method: "POST",
    headers: { cookie: cookieA, "content-type": "application/json" },
    body: JSON.stringify({ content: "Only session A sees this", source: "webmcp", idempotency_key: "api-once" }),
  });
  assert.equal(post.status, 201);

  const retry = await fetch(`${base}/api/spaces/${space.id}/messages`, {
    method: "POST",
    headers: { cookie: cookieA, "content-type": "application/json" },
    body: JSON.stringify({ content: "Only session A sees this", source: "webmcp", idempotency_key: "api-once" }),
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).created, false);

  const sessionB = await fetch(`${base}/api/workspace`);
  const workspaceB = (await sessionB.json()).workspace;
  assert.equal(workspaceB.messages.some((message) => message.content === "Only session A sees this"), false);

  const invalid = await fetch(`${base}/api/spaces/${space.id}/messages`, {
    method: "POST",
    headers: { cookie: cookieA, "content-type": "application/json" },
    body: JSON.stringify({ content: "" }),
  });
  assert.equal(invalid.status, 400);
});

test("forwarded HTTP requests redirect to the fixed public HTTPS origin", async (t) => {
  const { base } = await serverFixture(t);
  const response = await fetch(`${base}/api/workspace?from=http`, {
    headers: { host: "attacker.invalid", "x-forwarded-proto": "http" },
    redirect: "manual",
  });

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://buzz-webmcp.zeitfuereincoaching.de/api/workspace?from=http");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("secure responses advertise HSTS", async (t) => {
  const { base } = await serverFixture(t);
  const response = await fetch(`${base}/api/health`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});
