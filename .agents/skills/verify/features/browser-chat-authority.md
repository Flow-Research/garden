# Browser chat frame authority

This scenario covers authentication at the outer socket boundary.
The separate request-authority tests cover delayed model and tool admission.
The [frame decision](../../../../docs/decisions/2026-11-browser-chat-frame-authority.md) and [request decision](../../../../docs/decisions/2026-11-chat-request-authority.md) record their boundaries.

## Automated proof

Run from the repository root with Docker available:

```sh
pnpm --filter @garden/web exec vitest run src/lib/server/browser-chat-authority.test.ts src/server.test.ts
```

The authority tests use actual Better Auth and disposable PostgreSQL records.
The SDK test uses the installed Agent and PartyServer code with controlled platform sockets.
The model and sandbox runtime are fixture leaves. No model call is required.

Required observations include these results:

- The fresh session and owned workspace/thread scope admit a frame.
- A signed cookie cache cannot revive a deleted database session.
- Expiry, member removal and owner, host or runtime changes refuse the next frame.
- Missing or foreign browser origins refuse an upgrade. The exact native origin succeeds.
- Client identity headers and client state frames cannot replace the authority tags.
- A forged `_pk` cannot add a nonchat authority tag to a private chat socket.
- The cloned SDK request receives a fresh second admission check.
- A failed second check exposes only the fixed public SDK error.
- A new isolate checks retained tags against current database authority.
- An old socket without complete authority tags must reconnect.

## Later app qualification

Retain queue, continuation and recovery tests when the SDK exposes trusted request origin to model and action hooks.
Require refusal before inference and tools if that initiating authority becomes invalid during a wait.
Require separate positive proof for explicit task-owned server turns.
Do not treat an absent connection as that proof.

Authenticated native chat, a real browser journey and deployed runtime behavior remain separate checks.
Use controlled providers until real model calls are explicitly authorized.

## Request authority proof

Run from the repository root with Docker available:

```sh
pnpm --filter @garden/agent-runtime exec vitest run src/think-request-context.test.ts src/chat-request-authority.integration.test.ts src/think-request-worker.integration.test.ts src/chat-sub-agent-authority.integration.test.ts
pnpm --filter @garden/web exec vitest run 'src/routes/api/chat/threads/-tool-approval-authority.integration.test.ts'
```

These tests load the installed maintained SDK patch.
The Worker fixture uses actual SDK dispatch, Durable Object SQLite and disposable PostgreSQL.
The `ChatSubAgent` suite bundles the production module for Node and replaces only the Cloudflare platform imports and the database pool.
The approval suite uses the production runtime insert, the production approval routes and the production decision check.
The two source-cap tests each run more than 4,096 tool calls and take about two minutes together.
Its synthetic socket admission does not replace the separate Better Auth proof.
Controlled loopback ports supply model responses and count tool effects.

Required observations include these results:

- A queued request retains its own source and checks current authority after the wait.
- A revoked session cannot persist incoming history or request options.
- A valid tool executes once. Revocation before the final tool boundary prevents its effect.
- Every actual model retry checks authority again.
- A supported native handoff and exact Decide submission retain explicit source authority.
- Automatic summaries retain the request source and check model access.
- Restart recovery retains its original source and reaches a terminal refusal after revocation.
- A new authenticated turn cannot adopt an older pending browser tool.
- Browser RPC cannot invoke native save or submission methods.
- An unmapped execution approval or rejection refuses before runtime effects.
- Context and durable index limits refuse explicitly. History clearing removes retained source records.
- A chat agent and a server-owned run turn each complete more than 4,096 tool calls, and no settled call keeps a source record.
- Two tool results of one turn continue it when they arrive over two connections of one principal.
- A connector approval from the runtime insert is admitted after a decision by the thread owner with approval permission, another workspace approver or the Team owner.
- A pending row, a row of another thread, the opposite decision and a resolver who left the workspace are refused.
- The production `ChatSubAgent` hooks refuse a revoked session, a tool that agent permissions exclude and a tool that Team policy removes or blocks.
- The proposal continuation is browser callable, needs the recorded decision and is refused on a second call.
- An unattributed native history write is refused before it persists.

These local results do not establish a real-provider exploit, deployed behavior or full native chat acceptance.
The gated Brain suite (`GARDEN_ITEST_HELIX=1`) runs the production chat facet in a Worker for the native fixture turn with its session handoff.
A local Chromium run on 27 November 2026 covered a signed-in text turn through the production Worker. The source commit was `b53ed2a99779dffc1bbb95333dc2d016db063b31`. The private thread ID was `f6da5ac2-8e00-41c7-86d5-7a190e85d69a`. The request ID was `06412224-339c-42c3-8bed-23aad91393b4`.

To repeat the local browser check:

1. Start disposable PostgreSQL. Set `DATABASE_URL` to that database and run its Garden migrations.
2. Set `BETTER_AUTH_URL` to the local app origin. Set a fresh `BETTER_AUTH_SECRET`. Set `GARDEN_MODEL_BASE_URL` to a loopback OpenAI-compatible service that streams a known text response. Run `pnpm --filter @garden/web dev:offline`.
3. Open that origin in a clean browser. Use the same-origin API to sign up with a test email. Create a workspace, agent and private chat thread.
4. Use the thread's `hostName` and `runtime_key` to open `/agents/agent-d-o/{hostName}/sub/chat-sub-agent/{runtime_key}` as a browser WebSocket. Use the browser session from step 3.
5. Send the SDK's `cf_agent_use_chat_request` frame with a new request ID and one user text message. Confirm that the local model receives the request.
6. Check the response frames for that request ID. Confirm that the known model text arrives before the final frame with `done: true`.

This run used the local model and temporary data. Deferred tool decisions, recovery and the deployed service still require separate browser checks.
The [request decision](../../../../docs/decisions/2026-11-chat-request-authority.md) lists the known design limits.
