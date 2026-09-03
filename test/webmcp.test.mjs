import assert from "node:assert/strict";
import test from "node:test";
import { gatherwireToolDefinitions, registerGatherwireWebMCP } from "../public/webmcp.js";

function harness() {
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/spaces") return options.method === "POST" ? { space: { id: "new", name: "design-review" } } : { spaces: [{ id: "lab", name: "webmcp-lab" }] };
    if (path === "/api/project-agents") return { agents: [{ id: "demo:project-agent:atlas", name: "Atlas", synthetic: true }] };
    if (path === "/api/handoffs") return { created: true, sourceSpace: { id: "lab", name: "webmcp-lab" }, targetSpace: { id: "product", name: "product" }, targetAgent: { id: "demo:project-agent:atlas", name: "Atlas" }, handoff: { id: "h1", taskId: "task:one", correlationId: "corr-one", targetAgentId: "demo:project-agent:atlas" } };
    if (path.startsWith("/api/search")) return { results: [{ id: "m1", spaceId: "lab", content: "handoff" }] };
    if (path.includes("/messages") && options.method === "POST") return { created: true, space: { id: "lab", name: "webmcp-lab" }, message: { id: "m2", content: options.body.content } };
    if (path.includes("/messages")) return { space: { id: "lab", name: "webmcp-lab" }, messages: [], handoffs: [] };
    throw new Error(`Unexpected path ${path}`);
  };
  return { calls, api, refresh: async () => {}, notify: () => {}, recordReceipt: () => {} };
}

test("defines seven narrow top-level imperative tools", () => {
  const tools = gatherwireToolDefinitions(harness());
  assert.deepEqual(tools.map((tool) => tool.name), [
    "gatherwire_list_spaces",
    "gatherwire_read_messages",
    "gatherwire_search_messages",
    "gatherwire_post_message",
    "gatherwire_create_space",
    "gatherwire_list_project_agents",
    "gatherwire_publish_handoff",
  ]);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 7);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.execute, "function");
  }
  assert.equal(tools.filter((tool) => tool.annotations.readOnlyHint).length, 4);
  assert.ok(tools.every((tool) => tool.annotations.untrustedContentHint));
});

test("write tools use the same API and return verifiable results", async () => {
  const h = harness();
  const tools = gatherwireToolDefinitions(h);
  const result = await tools.find((tool) => tool.name === "gatherwire_post_message").execute({ space_id: "lab", content: "Launch update", request_id: "stable-demo-post" });
  assert.equal(result.success, true);
  assert.equal(result.message.content, "Launch update");
  assert.equal(h.calls.at(-1).options.body.source, "webmcp");
  assert.equal(h.calls.at(-1).options.body.idempotency_key, "stable-demo-post");
});

test("generated operation IDs correlate receipts and server writes", async () => {
  const h = harness();
  const tool = gatherwireToolDefinitions(h).find((item) => item.name === "gatherwire_post_message");
  const result = await tool.execute({ space_id: "lab", content: "One correlated write" });
  assert.equal(h.calls.at(-1).options.body.idempotency_key, result.tool_receipt.id);
});

test("publishes an addressable source-linked handoff and emits a verifiable tool receipt", async () => {
  const receipts = [];
  const h = { ...harness(), recordReceipt: (receipt) => receipts.push(receipt) };
  const tool = gatherwireToolDefinitions(h).find((item) => item.name === "gatherwire_publish_handoff");
  const result = await tool.execute({
    source_space_id: "lab",
    target_space_id: "product",
    target_agent_id: "demo:project-agent:atlas",
    summary: "Evidence is ready.",
    next_action: "Review it.",
    evidence_message_ids: ["m1"],
    request_id: "handoff-receipt",
  });
  assert.equal(result.success, true);
  assert.equal(result.target_agent.name, "Atlas");
  assert.equal(result.tool_receipt.tool, "gatherwire_publish_handoff");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].mode, "write");
  assert.equal(receipts[0].taskId, "task:one");
  assert.equal(receipts[0].correlationId, "corr-one");
  assert.equal(h.calls.at(-1).options.body.target_agent_id, "demo:project-agent:atlas");
});

test("registration feature-detects document.modelContext", async (t) => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  globalThis.document = {};
  assert.deepEqual(await registerGatherwireWebMCP(harness()), { available: false, count: 0 });

  const registered = [];
  globalThis.document = { modelContext: { registerTool: async (tool, options) => registered.push({ tool, options }) } };
  assert.deepEqual(await registerGatherwireWebMCP(harness()), { available: true, count: 7 });
  assert.equal(registered.length, 7);
  assert.ok(registered.every(({ options }) => options.signal instanceof AbortSignal));
});
