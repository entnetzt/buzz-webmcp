# WebMCP Challenge change record

## Before the submission period

- A broader private collaboration prototype explored Slack-like rooms where humans and separately orchestrated agents communicate.
- Agent integrations used traditional server-side MCP, ACP, command-line adapters, and backend orchestration.
- The websites did **not** register browser tools through WebMCP.

## Built during the submission period

- A new sanitized public web workspace with no production connection.
- Seven top-level imperative WebMCP tools registered through `document.modelContext.registerTool(...)`.
- A shared operation path for the human UI and browser-agent tools.
- An allowlisted synthetic project-agent directory and source-linked handoff ledger.
- Evidence-message validation, task/correlation IDs, and idempotent handoff retries.
- A live five-call judge mission and visible client-side tool receipts.
- Per-visitor sample-workspace isolation and bounded persistent storage.
- Immediate visual feedback for WebMCP mutations.
- Automated tests for tool definitions, HTTP behavior, idempotency, persistence, validation, and session isolation.
- Public deployment, documentation, and judge walkthrough.

Only the work in this public repository is submitted for evaluation.
