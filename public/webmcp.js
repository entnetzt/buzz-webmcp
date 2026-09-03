const emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const spaceId = {
  type: "string",
  description: "The exact space ID returned by buzz_list_spaces.",
  minLength: 1,
  maxLength: 80,
};

export function buzzToolDefinitions({ api, refresh, notify }) {
  return [
    {
      name: "buzz_list_spaces",
      description: "List the collaborative spaces available in this isolated Buzz demo workspace. This only reads data.",
      inputSchema: emptyObjectSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async () => {
        const data = await api("/api/spaces");
        return { count: data.spaces.length, spaces: data.spaces };
      },
    },
    {
      name: "buzz_read_messages",
      description: "Read recent messages from one Buzz space in this isolated demo workspace. This only reads data.",
      inputSchema: {
        type: "object",
        properties: {
          space_id: spaceId,
          limit: { type: "integer", description: "Maximum messages to return, from 1 to 100.", minimum: 1, maximum: 100, default: 20 },
        },
        required: ["space_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ space_id, limit = 20 }) => {
        const data = await api(`/api/spaces/${encodeURIComponent(space_id)}/messages?limit=${limit}`);
        return { space: data.space, count: data.messages.length, messages: data.messages };
      },
    },
    {
      name: "buzz_search_messages",
      description: "Search message text and author names across this isolated Buzz demo workspace. This only reads data.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to find in message content or author names.", minLength: 1, maxLength: 120 },
          space_id: { ...spaceId, description: "Optional exact space ID to restrict the search." },
          limit: { type: "integer", description: "Maximum matches to return, from 1 to 50.", minimum: 1, maximum: 50, default: 20 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async ({ query, space_id, limit = 20 }) => {
        const params = new URLSearchParams({ q: query, limit: String(limit) });
        if (space_id) params.set("space_id", space_id);
        const data = await api(`/api/search?${params}`);
        return { query, count: data.results.length, matches: data.results };
      },
    },
    {
      name: "buzz_post_message",
      description: "Post a new message as Browser Agent to one Buzz space. This changes the shared demo workspace and the message will immediately appear on the page.",
      inputSchema: {
        type: "object",
        properties: {
          space_id: spaceId,
          content: { type: "string", description: "The message to post, plain text only.", minLength: 1, maxLength: 1000 },
        },
        required: ["space_id", "content"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async ({ space_id, content }) => {
        const result = await api(`/api/spaces/${encodeURIComponent(space_id)}/messages`, {
          method: "POST",
          body: { content, source: "webmcp", idempotency_key: crypto.randomUUID() },
        });
        await refresh(space_id);
        notify(`Browser Agent posted in #${result.space.name}.`, "webmcp");
        return {
          success: true,
          side_effect: "A message was added to the visible demo workspace.",
          space: result.space,
          message: result.message,
        };
      },
    },
    {
      name: "buzz_create_space",
      description: "Create a new collaborative space in this isolated Buzz demo workspace. This changes the workspace and the new space will immediately appear in the sidebar.",
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
      execute: async ({ name, description = "" }) => {
        const result = await api("/api/spaces", { method: "POST", body: { name, description } });
        await refresh(result.space.id);
        notify(`Browser Agent created #${result.space.name}.`, "webmcp");
        return {
          success: true,
          side_effect: "A space was added to the visible demo workspace.",
          space: result.space,
        };
      },
    },
  ];
}

export async function registerBuzzWebMCP(dependencies) {
  if (typeof document.modelContext?.registerTool !== "function") return { available: false, count: 0 };
  const tools = buzzToolDefinitions(dependencies);
  for (const tool of tools) {
    await document.modelContext.registerTool(tool);
  }
  return { available: true, count: tools.length };
}
