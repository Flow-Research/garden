# Browser chat frame authority

This scenario covers authentication at the outer socket boundary.
It does not close model-start authority after queue or recovery waits.
The [decision](../../../../docs/decisions/2026-11-browser-chat-frame-authority.md) records that remaining requirement.

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
