# Verification record

Verified on September 3, 2026 against the public challenge build.

## Automated checks

`npm run check` passes 11 tests with zero failures, errors, or skips. The suite covers:

- visitor-session isolation;
- bounded and type-checked inputs;
- unknown-resource privacy;
- persistence and inert rendering of untrusted markup;
- idempotent message retries;
- fixed-origin HTTP-to-HTTPS redirection and HSTS;
- five narrow WebMCP definitions and annotated registration.

The same suite passed locally and on the isolated Google Cloud deployment.

## Public endpoint

- `http://buzz-webmcp.zeitfuereincoaching.de` returns a fixed-origin `308` redirect to HTTPS.
- `https://buzz-webmcp.zeitfuereincoaching.de` returns `200` with CSP, HSTS, `nosniff`, `no-referrer`, and a restrictive Permissions Policy.
- The demo requires no account or credentials.

## Live WebMCP client test

ChatGPT's desktop in-app browser discovered these five site tools from the public top-level page:

1. `buzz_list_spaces`
2. `buzz_read_messages`
3. `buzz_search_messages`
4. `buzz_post_message`
5. `buzz_create_space`

All five were executed successfully in one isolated visitor session. Read/search results matched the seeded visible workspace. The write flow created one `Browser Agent` message and one `agent-design-review` space, both of which appeared immediately in the human interface. The resulting state is shown in [the live-test screenshot](docs/live-demo.png).

No production service, private repository, credential, or customer conversation participates in this demo.
