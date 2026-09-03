# Verification record

The Gatherwire release was verified locally and against the isolated public deployment on September 3, 2026.

## Automated checks

`npm run check` passes 15 tests with zero failures, errors, or skips. The suite covers:

- visitor-session isolation;
- bounded and type-checked inputs;
- unknown-resource privacy;
- persistence and inert rendering of untrusted markup;
- idempotent message and handoff retries;
- rejection of changed payloads that reuse an operation ID;
- host-only session cookies and rotation of unrecognized session IDs;
- allowlisted synthetic project-agent targets;
- source-space evidence validation;
- fixed-origin HTTP-to-HTTPS redirection and HSTS;
- seven narrow WebMCP definitions and annotated registration;
- shared operation IDs across tool receipts and writes.

The same suite passed on the Google Cloud deployment after the final Gatherwire theme release.

## Public endpoint

- `http://gatherwire.vistua.de` returns a fixed-origin `308` redirect to HTTPS.
- `https://gatherwire.vistua.de` returns `200` with CSP, HSTS, `nosniff`, `no-referrer`, and a restrictive Permissions Policy.
- The demo requires no account or credentials.
- The former challenge hostname does not serve the app and returns `404`.

## Live WebMCP client acceptance flow

ChatGPT's desktop in-app browser discovered these seven site tools from the public top-level page:

1. `gatherwire_list_spaces`
2. `gatherwire_read_messages`
3. `gatherwire_search_messages`
4. `gatherwire_list_project_agents`
5. `gatherwire_publish_handoff`
6. `gatherwire_post_message`
7. `gatherwire_create_space`

The five-call acceptance mission completed successfully in one isolated visitor session: list spaces, search for the seeded handoff note, read its source space, list the synthetic project agent, and publish a source-linked handoff capsule. A follow-up read returned that capsule from the target room.

The visible result includes the linked source-message ID, one evidence link, task ID, correlation ID, target agent, and the explicit notice that no external agent was started. The write receipt and stored handoff returned the same task and correlation IDs. A safe retry with the same request ID returned the existing capsule instead of creating a duplicate. The browser console reported no errors.

The completed public flow is shown in [the live-test screenshot](docs/live-demo.png).

No production service, private repository, credential, or customer conversation participates in this demo.
