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
pnpm --filter @garden/agent-runtime exec vitest run src/think-request-context.test.ts src/chat-request-authority.integration.test.ts src/think-request-worker.integration.test.ts
```

These tests load the installed maintained SDK patch.
The Worker fixture uses actual SDK dispatch, Durable Object SQLite and disposable PostgreSQL.
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

These local results do not establish a real-provider exploit, deployed behavior or full native chat acceptance.
Fresh decision semantics, actual Garden facet dispatch and all deferred interaction paths remain open qualification work.
