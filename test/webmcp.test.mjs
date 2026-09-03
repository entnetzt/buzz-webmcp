import assert from "node:assert/strict";
import test from "node:test";
import { buzzToolDefinitions, registerBuzzWebMCP } from "../public/webmcp.js";

function harness() {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/spaces") return options.method === "POST" ? { space: { id: "new", name: "design-review" } } : { spaces: [{ id: "lab", name: "webmcp-lab" }] };
    if (path.startsWith("/api/search")) return { results: [{ id: "m1", spaceId: "lab", content: "handoff" }] };
    if (path.includes("/messages") && options.method === "POST") return { created: true, space: { id: "lab", name: "webmcp-lab" }, message: { id: "m2", content: options.body.content } };
    if (path.includes("/messages")) return { space: { id: "lab", name: "webmcp-lab" }, messages: [] };
    throw new Error(`Unexpected path ${path}`);
  };
  return { calls, api, refresh: async () => {}, notify: () => {} };
}

test("defines five narrow top-level imperative tools", () => {
  const tools = buzzToolDefinitions(harness());
  assert.deepEqual(tools.map((tool) => tool.name), [
    "buzz_list_spaces",
    "buzz_read_messages",
    "buzz_search_messages",
    "buzz_post_message",
    "buzz_create_space",
  ]);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 5);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.execute, "function");
  }
  assert.equal(tools.filter((tool) => tool.annotations.readOnlyHint).length, 3);
  assert.ok(tools.every((tool) => tool.annotations.untrustedContentHint));
});

test("write tools use the same API and return verifiable results", async () => {
  const h = harness();
  const tools = buzzToolDefinitions(h);
  const result = await tools.find((tool) => tool.name === "buzz_post_message").execute({ space_id: "lab", content: "Launch update", request_id: "stable-demo-post" });
  assert.equal(result.success, true);
  assert.equal(result.message.content, "Launch update");
  assert.equal(h.calls.at(-1).options.body.source, "webmcp");
  assert.equal(h.calls.at(-1).options.body.idempotency_key, "stable-demo-post");
});

test("registration feature-detects document.modelContext", async (t) => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  globalThis.document = {};
  assert.deepEqual(await registerBuzzWebMCP(harness()), { available: false, count: 0 });

  const registered = [];
  globalThis.document = { modelContext: { registerTool: async (tool, options) => registered.push({ tool, options }) } };
  assert.deepEqual(await registerBuzzWebMCP(harness()), { available: true, count: 5 });
  assert.equal(registered.length, 5);
  assert.ok(registered.every(({ options }) => options.signal instanceof AbortSignal));
});
