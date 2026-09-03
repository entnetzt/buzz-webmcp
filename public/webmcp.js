const emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const spaceId = {
  type: "string",
  description: "The exact space ID returned by gatherwire_list_spaces.",
  minLength: 1,
  maxLength: 80,
};

function receiptTarget(args, result) {
  if (result?.target_space?.name) return `#${result.target_space.name}`;
  if (result?.space?.name) return `#${result.space.name}`;
  if (args?.target_space_id) return args.target_space_id;
  if (args?.space_id) return args.space_id;
  if (args?.query) return `“${args.query}”`;
  return "workspace";
}

function instrument(definition, recordReceipt) {
  const execute = definition.execute;
  return {
    ...definition,
    execute: async (args = {}, context = {}) => {
      const receiptId = args.request_id || crypto.randomUUID();
      const createdAt = new Date().toISOString();
      try {
        const result = await execute(args, { ...context, operationId: receiptId });
        const receipt = {
          id: receiptId,
          tool: definition.name,
          mode: definition.annotations.readOnlyHint ? "read" : "write",
          target: receiptTarget(args, result),
          success: true,
          createdAt,
          ...(result?.handoff?.taskId ? { taskId: result.handoff.taskId } : {}),
          ...(result?.handoff?.correlationId ? { correlationId: result.handoff.correlationId } : {}),
        };
        try { recordReceipt?.(receipt); } catch {}
        return { ...result, tool_receipt: receipt };
      } catch (error) {
        try {
          recordReceipt?.({
            id: receiptId,
            tool: definition.name,
            mode: definition.annotations.readOnlyHint ? "read" : "write",
            target: receiptTarget(args),
            success: false,
            createdAt,
          });
        } catch {}
        throw error;
      }
    },
  };
}

export function gatherwireToolDefinitions({ api, refresh, notify, recordReceipt }) {
  const definitions = [
    {
      name: "gatherwire_list_spaces",
      title: "List Gatherwire spaces",
      description: "List the collaborative spaces available in this isolated Gatherwire demo workspace. This only reads data.",
      inputSchema: emptyObjectSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_, { signal } = {}) => {
        const data = await api("/api/spaces", { signal });
        return { count: data.spaces.length, spaces: data.spaces };
      },
    },
    {
      name: "gatherwire_read_messages",
      title: "Read Gatherwire messages",
      description: "Read recent messages and recorded handoff capsules from one Gatherwire space in this isolated demo workspace. This only reads data.",
      inputSchema: {
        type: "object",
        properties: {
          space_id: spaceId,
          limit: { type: "integer", description: "Maximum messages to return, from 1 to 10.", minimum: 1, maximum: 10, default: 5 },
        },
        required: ["space_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ space_id, limit = 5 }, { signal } = {}) => {
        const data = await api(`/api/spaces/${encodeURIComponent(space_id)}/messages?limit=${limit}`, { signal });
        return {
          space: data.space,
          message_count: data.messages.length,
          handoff_count: data.handoffs.length,
          messages: data.messages,
          handoffs: data.handoffs,
        };
      },
    },
    {
      name: "gatherwire_search_messages",
      title: "Search Gatherwire messages",
      description: "Search message text and author names across this isolated Gatherwire demo workspace. This only reads data.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to find in message content or author names.", minLength: 1, maxLength: 120 },
          space_id: { ...spaceId, description: "Optional exact space ID to restrict the search." },
          limit: { type: "integer", description: "Maximum matches to return, from 1 to 10.", minimum: 1, maximum: 10, default: 5 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ query, space_id, limit = 5 }, { signal } = {}) => {
        const params = new URLSearchParams({ q: query, limit: String(limit) });
        if (space_id) params.set("space_id", space_id);
        const data = await api(`/api/search?${params}`, { signal });
        return { query, count: data.results.length, matches: data.results };
      },
    },
    {
      name: "gatherwire_post_message",
      title: "Post a Gatherwire message",
      description: "Post a plain-text demo-operator message to one Gatherwire space. This changes the shared demo workspace and the message will immediately appear on the page.",
      inputSchema: {
        type: "object",
        properties: {
          space_id: spaceId,
          content: { type: "string", description: "The message to post, plain text only.", minLength: 1, maxLength: 1000 },
          request_id: { type: "string", description: "Optional stable ID to reuse if the same post is retried.", minLength: 1, maxLength: 100 },
        },
        required: ["space_id", "content"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async ({ space_id, content, request_id }, { signal, operationId } = {}) => {
        const result = await api(`/api/spaces/${encodeURIComponent(space_id)}/messages`, {
          method: "POST",
          body: { content, source: "webmcp", idempotency_key: request_id || operationId },
          signal,
        });
        await refresh(space_id);
        notify(`Site tool posted in #${result.space.name}.`, "webmcp");
        return {
          success: true,
          created: result.created,
          side_effect: result.created ? "A message was added to the visible demo workspace." : "The earlier message was returned without creating a duplicate.",
          space: result.space,
          message: result.message,
        };
      },
    },
    {
      name: "gatherwire_create_space",
      title: "Create a Gatherwire space",
      description: "Create a new collaborative space in this isolated Gatherwire demo workspace. This changes the workspace and the new space will immediately appear in the sidebar.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short space name. It will be normalized to lowercase kebab-case.", minLength: 1, maxLength: 50 },
          description: { type: "string", description: "Optional purpose of the new space.", maxLength: 180 },
        },
        required: ["name"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async ({ name, description = "" }, { signal } = {}) => {
        const result = await api("/api/spaces", { method: "POST", body: { name, description }, signal });
        await refresh(result.space.id);
        notify(`Site tool created #${result.space.name}.`, "webmcp");
        return {
          success: true,
          side_effect: "A space was added to the visible demo workspace.",
          space: result.space,
        };
      },
    },
    {
      name: "gatherwire_list_project_agents",
      title: "List demo project agents",
      description: "List the fixed synthetic project agents that can receive a recorded handoff in this isolated demo. This does not inspect or start any external agent.",
      inputSchema: emptyObjectSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (_, { signal } = {}) => {
        const data = await api("/api/project-agents", { signal });
        return { count: data.agents.length, agents: data.agents };
      },
    },
    {
      name: "gatherwire_publish_handoff",
      title: "Publish a source-linked handoff",
      description: "Publish a structured handoff from one Gatherwire space to another. Evidence message IDs must exist in the selected source space. The handoff becomes a visible capsule in the target space.",
      inputSchema: {
        type: "object",
        properties: {
          source_space_id: { ...spaceId, description: "The exact source space ID containing the evidence messages." },
          target_space_id: { ...spaceId, description: "The exact target space ID where the handoff capsule should appear." },
          target_agent_id: { type: "string", description: "The exact synthetic project-agent ID returned by gatherwire_list_project_agents.", minLength: 1, maxLength: 80 },
          summary: { type: "string", description: "What the next participant needs to know, in plain text.", minLength: 1, maxLength: 500 },
          next_action: { type: "string", description: "The single next action expected from the receiving participant.", minLength: 1, maxLength: 300 },
          evidence_message_ids: {
            type: "array",
            description: "From 1 to 5 exact message IDs returned by a read or search call. Every message must belong to the source space.",
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
          request_id: { type: "string", description: "Optional stable ID to reuse if the same handoff is retried.", minLength: 1, maxLength: 100 },
        },
        required: ["source_space_id", "target_space_id", "target_agent_id", "summary", "next_action", "evidence_message_ids"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async ({ source_space_id, target_space_id, target_agent_id, summary, next_action, evidence_message_ids, request_id }, { signal, operationId } = {}) => {
        const result = await api("/api/handoffs", {
          method: "POST",
          body: {
            source_space_id,
            target_space_id,
            target_agent_id,
            summary,
            next_action,
            evidence_message_ids,
            request_id: request_id || operationId,
          },
          signal,
        });
        await refresh(result.targetSpace.id);
        notify(`Site tool published a handoff to #${result.targetSpace.name}.`, "webmcp");
        return {
          success: true,
          created: result.created,
          side_effect: result.created ? "A source-linked handoff capsule was added to the visible target space." : "The earlier handoff was returned without creating a duplicate.",
          source_space: result.sourceSpace,
          target_space: result.targetSpace,
          target_agent: result.targetAgent,
          handoff: result.handoff,
        };
      },
    },
  ];
  return definitions.map((definition) => instrument(definition, recordReceipt));
}

export async function registerGatherwireWebMCP(dependencies) {
  if (typeof document === "undefined" || typeof document.modelContext?.registerTool !== "function") return { available: false, count: 0 };
  const tools = gatherwireToolDefinitions(dependencies);
  const controller = new AbortController();
  try {
    for (const tool of tools) {
      await document.modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort();
    throw error;
  }
  return { available: true, count: tools.length };
}
