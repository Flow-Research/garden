# Personal Workstream MCP connection

Profile: `standard`. Feature: [Workstream](../../../../docs/concepts/features/workstream.md).

Use an existing invited Flow Identity account and Garden test member. Do not create accounts or enable self-registration for verification. Record only identifiers and outcomes; keep passwords, callback codes, access tokens, refresh tokens, cookies, and authorization state out of evidence.

1. Use Garden dev as the primary qualification target. Confirm its public Flow Identity client is `garden-dev`, requires S256, and permits only `https://garden-dev.flow-research.workers.dev/api/oauth/callback`. Confirm the target binds `WORKSTREAM_MCP_CLIENT_ID=garden-dev`. Other environments require their own exact registrations and bindings; the staging client stays separate.
2. Sign in at `https://garden-dev.flow-research.workers.dev` through Garden's existing login. Open the connector catalogue, select Workstream, and install its MCP source. Confirm it requests authorization, without a token or client-secret input.
3. In Workspace scope, confirm the drawer explains that Workstream requires Personal. A direct Workspace OAuth-start request must return 403 without an authorization redirect or credential write.
4. Switch to Personal and authorize. Confirm the browser reaches the Flow Identity realm, requests `workstream:access workstream-mcp-audience`, includes S256 PKCE and the exact MCP resource, and returns to the registered Garden callback. Complete any password action only on Flow Identity. Forged callback `domain` or `site` parameters must not move Workstream's code exchange or saved refresh endpoint to a sibling host.
5. Confirm a Personal Workstream connection is saved. Read an authorized Workstream task through the existing connector tool path; the tool result must reflect the same invited member. Use chat or a direct member request first. Issue runs currently resolve the agent owner's identity; qualifying a different triggering member requires separate run-authority work.
6. Open Garden as a second test member in the same workspace. Confirm the first member's Personal connection is not listed or callable. Connect the second member separately and confirm Workstream sees that member.
7. Confirm Flow Identity echoes both requested scopes, with **Include in token scope** enabled for the MCP audience client scope. Let the first member's access token expire, then repeat a read. Confirm refresh sends both saved scopes and the MCP resource, produces the signed MCP audience, and permits an actual MCP call. Confirm the second member's connection and credential remain unchanged. Reconnect/revoke one member and confirm the other can still read.
8. Attempt a Workstream action the connected member lacks permission to perform. Confirm Workstream refuses it and no task/submission/review state changes.
9. Cancel another authorization attempt. Confirm cancellation reports failure and leaves the existing connection intact. With no deployment client configured, OAuth start must return 503 and must not register a client dynamically.

Use the verify skill's evidence directory and mark each live scenario `PASS`, `FAIL`, or `INCONCLUSIVE`. Focused tests establish registration, route and ownership boundaries; they do not substitute for a browser callback, encrypted credential storage, refresh, or deployed MCP execution.
