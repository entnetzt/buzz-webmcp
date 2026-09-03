import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { StoreError, WorkspaceStore } from "../store.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "buzz-webmcp-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new WorkspaceStore(path.join(dir, "state.json")).load();
}

test("new sessions receive isolated starter workspaces", async (t) => {
  const store = await fixture(t);
  const a = store.snapshot("a");
  const b = store.snapshot("b");
  assert.equal(a.spaces.length, 3);
  assert.equal(a.messages.length, 4);
  assert.equal("sessionId" in a, false);
  assert.notEqual(a.spaces[0].id, b.spaces[0].id);
});

test("human and WebMCP operations share one workspace", async (t) => {
  const store = await fixture(t);
  const session = "shared";
  const space = store.listSpaces(session)[0];
  const post = await store.postMessage(session, {
    spaceId: space.id,
    content: "Launch marker 9f from the browser agent",
    source: "webmcp",
    idempotencyKey: "one",
  });
  assert.equal(post.created, true);
  assert.equal(post.message.author, "Browser Agent");
  assert.equal(post.message.source, "webmcp");
  assert.match(store.readMessages(session, space.id).messages.at(-1).content, /Launch marker 9f/);
  assert.equal(store.searchMessages(session, "Launch marker 9f").length, 1);
});

test("idempotency keys prevent duplicate messages", async (t) => {
  const store = await fixture(t);
  const space = store.listSpaces("retry")[0];
  const input = { spaceId: space.id, content: "Post once", source: "webmcp", idempotencyKey: "stable-call" };
  assert.equal((await store.postMessage("retry", input)).created, true);
  const retried = await store.postMessage("retry", input);
  assert.equal(retried.created, false);
  assert.equal("idempotencyKey" in retried.message, false);
  assert.equal(store.searchMessages("retry", "Post once").length, 1);
});

test("inputs are bounded and unknown resources stay private", async (t) => {
  const store = await fixture(t);
  await assert.rejects(() => store.createSpace("limits", { name: "" }), (error) => error instanceof StoreError && error.status === 400);
  await assert.rejects(() => store.createSpace("limits", { name: { nested: true } }), (error) => error instanceof StoreError && error.status === 400);
  await assert.rejects(() => store.createSpace("limits", { name: "valid", description: ["not", "text"] }), (error) => error instanceof StoreError && error.status === 400);
  await assert.rejects(
    () => store.postMessage("limits", { spaceId: "not-from-this-session", content: "x", source: "ui" }),
    (error) => error instanceof StoreError && error.status === 404 && !error.message.includes("session"),
  );
  const space = store.listSpaces("limits")[0];
  await assert.rejects(() => store.postMessage("limits", { spaceId: space.id, content: { nested: true } }), (error) => error instanceof StoreError && error.status === 400);
  assert.throws(() => store.readMessages("limits", space.id, 2.5), (error) => error instanceof StoreError && error.status === 400);
});

test("stored markup remains inert plain text and persists", async (t) => {
  const store = await fixture(t);
  const session = "persist";
  const space = store.listSpaces(session)[0];
  const payload = '<img src=x onerror="globalThis.pwned=true">';
  await store.postMessage(session, { spaceId: space.id, content: payload, source: "ui" });
  const reloaded = await new WorkspaceStore(store.filePath).load();
  assert.equal(reloaded.readMessages(session, space.id).messages.at(-1).content, payload);
  assert.equal(globalThis.pwned, undefined);
});
