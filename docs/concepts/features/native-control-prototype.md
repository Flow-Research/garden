---
title: Native control prototype
description: Source boundaries, local commands, and missing release evidence for the Expo client.
status: current
owner: Unassigned
last_reviewed: 2026-11-21
---

## Current behavior

Garden includes an Expo development prototype in `apps/mobile`.
It reads existing Garden workspaces, issues, chat thread titles, managed run status, and skills.
The shared package `packages/client` supplies these reads and explicit chat creation.
The native chat uses the existing Cloudflare SDK and the owned Garden chat service.
The web application retains its existing paths through reexports of the shared skills client and contract.

The prototype supports password sign-in through the existing Garden server.
It stores credentials through the official Expo client plugin and SecureStore.
The prototype does not expose a social sign-in control.
Native device tests and a framework decision remain open.

## Authority and private data

Each client binds an origin, account, workspace, and local session generation.
A session generation identifies one period of local access.
Account changes, workspace changes, and access refusals invalidate earlier reads.
Late responses cannot replace a later session.
Each refresh reads the current server session and workspace memberships before private workspace data.

The prototype stores one private read snapshot in SecureStore, with its origin, account, workspace, and last successful synchronization time.
An explicit offline control opens that snapshot after a process restart.
The view displays the saved account, server, workspace, expiry, and stale status.
The server's actual session expiry bounds every private view. Expired content is removed.
Workspace selection is unavailable offline. A failed connection cannot remove the previous expiry deadline.
Offline reads never establish current authority. Every action requires a fresh online session and workspace access.
Observed revocation, logout, and identity changes remove the saved snapshot.

The snapshot contains at most 50 task previews and 100 thread previews.
Its serialized size cannot exceed 24,576 UTF-16 code units.
SecureStore receives at most 64 chunks, each with at most 384 Unicode code points.
Each chunk therefore uses at most 1,536 UTF-8 bytes.
The adapter publishes its chunk count only after every write succeeds.
Interrupted writes cannot expose a mixed snapshot. Cleanup removes the manifest before its chunks.
Storage failure leaves online reads available with a visible warning.
The prototype stores private notes and one conversation-bound chat draft in SecureStore.
Each text field has a 2,000-character limit. The draft record uses at most 16 small chunks.
The record includes its origin, account, and workspace identities. The chat draft also includes its conversation ID.
Selecting another chat does not send an earlier draft. Editing that chat replaces the one saved chat draft.
Logout, account change, workspace change, and observed membership revocation remove the prior scope's private data.

Draft text never becomes an automatic launch, approval, or cancellation.
The application does not send a cancellation when it suspends.
The execution host retains ownership of its run.
When the client reconnects, it reads the selected managed run by its stable ID.
It does not silently switch to a newer active run.
Run completion, WorkStream acceptance, deployment, and payment remain separate facts.

## Native chat

The prototype creates a chat through the existing `POST /api/chat/threads` endpoint.
The client supplies a stable UUID. A UUID is a unique identifier.
If acknowledgement is unknown, the client reads the thread list before another creation attempt.
It never repeats the POST automatically.

A current owned thread identifies its existing `ChatSubAgent` service.
The existing `useAgent` and `useAgentChat` hooks read history and stream text.
The first send waits for connection history. Every send checks the current session, membership, and owned thread target.
The native WebSocket adapter sends cookies only to the selected origin and exact thread path.
It supplies the exact native Origin header. Credentials never enter React state or the read cache.
Offline sends and transfer of buffered messages are disabled.
Leaving the view disconnects locally. It does not cancel the server turn.
Interrupted delivery stays unconfirmed until the member reloads and inspects history.

The server checks private chat ownership when the connection opens.
Its current chat runtime does not independently check the initiating session on every later WebSocket frame.
The native checks do not close this server enforcement gap. Security qualification remains open.
Tool details, approvals, attachments, and offline chat history remain separate unfinished native surfaces.
Private chat drafts can be restored and edited offline. Drafts never send automatically.

## Authentication boundary

Garden accepts the exact native origin `garden-mobile://` for password authentication.
The native adapter sends that origin explicitly.
Server membership checks and operation permissions remain authoritative.
The adapter sends credentials only to its configured origin.
HTTPS is required except for a loopback development server.
Each origin uses a separate credential namespace.

Garden's current Better Auth server remains pinned to `1.6.26`.
The prototype does not install the Expo server plugin.
That plugin is vulnerable below `1.7.16`, as described in [GHSA-4wq4-2ppv-q3hg](https://github.com/better-auth/better-auth/security/advisories/GHSA-4wq4-2ppv-q3hg).
The native client and its Expo client plugin use `1.7.16`.

Better Auth `1.7.16` changes generic OAuth callback contracts used by existing Garden connectors.
A server upgrade needs separate connector migration and regression evidence.
Do not enable an older Expo server proxy to bypass that migration.
The current password-only prototype does not require that proxy.

## Run the prototype

Use Node and pnpm versions declared by the repository.
The mobile package retains the repository's native TypeScript toolchain.
Expo path aliases are disabled because the prototype uses relative imports and package exports.
This avoids Expo's JavaScript compiler API requirement without changing the repository toolchain.
The Babel configuration enables Expo's documented `import.meta` transform for Effect on Hermes.
The root Vite dependency matches the web application's pinned `8.0.16` version.
This prevents a new peer resolution from changing test alias behavior.
The reviewed React Native Gradle patch uses Foojay `1.0.0` with Gradle `9.0.0`.
Earlier Foojay versions reference `IBM_SEMERU`, which Gradle `9.0.0` removes.

1. At the repository root, run `pnpm install --frozen-lockfile --ignore-scripts`.
2. Run `pnpm --filter @garden/mobile typecheck`.
3. Run `pnpm --filter @garden/mobile test`.
4. Run `pnpm --filter @garden/mobile exec expo export --platform ios --platform android --output-dir dist`.
5. With an authorized Android device attached, run `pnpm --filter @garden/mobile android`.
6. With Xcode and authorized signing available, run `pnpm --filter @garden/mobile ios`.
7. Enter the verified Garden origin in the application.
8. Sign in with an existing test account.
9. Select a workspace.
10. Read tasks, open a managed run, and save a private draft.
11. Suspend the application, then return and refresh access.
12. Close the process, open saved offline reads, and make sure that the view identifies stale content.
13. Reconnect and refresh authority before any action.
14. Sign out and make sure that the application removes private data.

Do not use hosted build commands or publish an application from this prototype.
A JavaScript bundle proves module resolution, not a signed native installation.
The [native verification map](../../../.agents/skills/verify/features/native-control.md) records the required device journeys.

## Remaining scope

The prototype does not implement external Harnessy host enrollment or transport.
It does not expose external launch, approval, cancellation, or notification controls.
These operations need their existing owner interfaces and revision-bound authority before native controls can use them.
The application displays their unavailable state.
It does not substitute a Garden managed run for an external Harnessy run.

Signed installation, deep links, notifications, accessibility, and native lifecycle qualification remain open.
Source tests cover persistent cached reads, offline cold start, owned chat creation, SDK text streaming, and interrupted-delivery handling.
No live server or model run qualifies native chat yet.
SecureStore behavior, timer delivery, and credential isolation require physical iOS and Android tests.
Expo remains a framework candidate until those tests pass.
The first desktop release still requires macOS, Windows, and Linux evidence together.

References: [client scope](../../proposals/cross-platform-clients.md), [host contract](../../proposals/execution-host-contract.md), [Better Auth Expo integration](https://www.better-auth.com/docs/integrations/expo), and [Expo SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/), [Cloudflare chat SDK](https://developers.cloudflare.com/agents/api-reference/chat-agents/), and [React Native WebSocket source](https://github.com/facebook/react-native/blob/v0.83.10/packages/react-native/Libraries/WebSocket/WebSocket.js).
