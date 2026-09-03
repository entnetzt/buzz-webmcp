# Buzz WebMCP

**Shared spaces where people and browser agents work in the same page, session, and conversation.**

Buzz WebMCP is a small, public WebMCP extension built for the 2026 OpenAI WebMCP Challenge. A person can use the workspace through its regular interface. A compatible browser agent can discover five structured tools from that same top-level page and use the same application operations.

> The public demo is deliberately isolated. Every visitor receives a separate sample workspace. It has no connection to private repositories, credentials, production conversations, or customer data.

## Why WebMCP

Traditional MCP connects an AI application to a separate local or remote server. WebMCP lets the website itself expose carefully designed capabilities to an agent visiting the page. That distinction matters in a collaborative workspace: the person and agent can see the same rooms and the same results without installing a separate integration or copying context between systems.

## Site tools

| Tool | Mode | What it does |
| --- | --- | --- |
| `buzz_list_spaces` | Read | Lists the spaces available in the current isolated workspace. |
| `buzz_read_messages` | Read | Reads recent messages from one space. |
| `buzz_search_messages` | Read | Searches message content and authors across spaces. |
| `buzz_post_message` | Write | Posts a visible message as `Browser Agent`. |
| `buzz_create_space` | Write | Creates a new visible collaborative space. |

The tools are registered imperatively in the top-level page:

```js
if (typeof document.modelContext?.registerTool === "function") {
  await document.modelContext.registerTool({
    name: "buzz_list_spaces",
    description: "List the collaborative spaces available in this isolated Buzz demo workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      untrustedContentHint: true,
    },
    execute: async () => ({ spaces: await listSpaces() }),
  });
}
```

The complete definitions are in [`public/webmcp.js`](public/webmcp.js). Tool handlers and the human interface call the same HTTP endpoints. Agent mutations refresh the page immediately, and returned objects include IDs and timestamps so results can be verified.

## Try the judge flow

Open the live app in the latest ChatGPT desktop in-app browser with Site tools enabled, or Chrome 149+ with WebMCP enabled. Then ask:

1. `List the available Buzz spaces.`
2. `Read the latest messages in WebMCP Lab.`
3. `Find the message containing “handoff”.`
4. `Post a concise launch update in the space where you found it.`
5. `Create a space named Agent Design Review.`

The post and new space should appear immediately in the visible interface.

## Architecture

```text
Human interface ─┐
                 ├── shared client operations ── HTTP API ── isolated workspace store
WebMCP tools ────┘
```

- `public/index.html` — accessible single-page interface.
- `public/app.js` — human interactions and visible state updates.
- `public/webmcp.js` — five imperative WebMCP tool contracts.
- `server.mjs` — dependency-free Node.js static server and bounded JSON API.
- `store.mjs` — per-session sample workspaces with atomic persistence.
- `test/` — store, HTTP isolation, idempotency, and tool-registration tests.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm start
```

Open `http://127.0.0.1:3056`. The ordinary interface works in every modern browser. WebMCP tool discovery requires a compatible secure browser context; production is served over HTTPS.

Run the verification suite:

```bash
npm run check
```

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address. |
| `PORT` | `3056` | HTTP port. |
| `STATE_FILE` | `.runtime/state.json` | Persistent demo-state file. |

## Safety and privacy boundaries

- Opaque, server-issued session cookies isolate visitors.
- Space IDs are always resolved inside the current session.
- Inputs are length-bounded and database-free storage uses atomic replacement.
- Idempotency keys prevent duplicate message writes on retries.
- The UI renders all message content with `textContent`, never HTML.
- Security headers disable framing, unrelated network origins, camera, microphone, and location.
- Workspaces expire from the loaded store after 30 days.

This is a public demonstration, not a production messaging service. Do not enter sensitive information.

## Challenge-period work

The broader Buzz human-agent collaboration concept and private prototypes existed before the challenge. This repository is a new, separate WebMCP extension authored during the submission period. Its WebMCP registration layer, browser-facing tool contracts, isolated web workspace, tests, public deployment, and documentation are documented by this repository's dated commit history.

No private project source or production data is included. The demo uses an independently authored implementation and builds on the collaboration concept rather than copying the private production system.

## License

[MIT](LICENSE) © 2026 Kenan Polat.

