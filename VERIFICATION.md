# Verification record

Local verification was completed on September 3, 2026. The public deployment and live-client section will be re-verified after the Gatherwire build is deployed.

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

## Expected public endpoint

- `http://gatherwire.vistua.de` redirects to the fixed HTTPS origin.
- `https://gatherwire.vistua.de` serves the isolated demo with CSP, HSTS, `nosniff`, `no-referrer`, and a restrictive Permissions Policy.
- The demo requires no account or credentials.

## Live WebMCP client acceptance flow

The final live-client check must discover and execute these seven site tools from the public top-level page:

1. `gatherwire_list_spaces`
2. `gatherwire_read_messages`
3. `gatherwire_search_messages`
4. `gatherwire_list_project_agents`
5. `gatherwire_publish_handoff`
6. `gatherwire_post_message`
7. `gatherwire_create_space`

The acceptance mission lists spaces, searches for the seeded handoff message, reads the source space, lists the synthetic project agent, and publishes one source-linked handoff capsule. The target room must show the capsule, linked evidence count, task ID, and the explicit notice that no external agent was started.

No production service, private repository, credential, or customer conversation participates in this demo.
