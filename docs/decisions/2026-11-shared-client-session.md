---
title: Bind portable skills reads to an explicit client session
description: The first shared client slice reuses the skills contract and fences responses by client lifetime.
status: current
owner: Unassigned
last_reviewed: 2026-11-11
---

## Decision

Use `apps/web/src/lib/api/skills-client.ts` for the first portable read. Keep it
beside the existing `skills-contract.ts` until another product client needs a
package. The implementation uses the existing Effect HttpApi generated client.
Do not add a second response schema or change the server endpoint.

Each client binds an absolute HTTP origin, workspace ID and local session ID.
The host supplies Fetch, request IDs and an optional unauthorized callback.
A session ID identifies local scope; it is not a credential or permission grant.
The module uses standard Fetch, URL and AbortController APIs, including
`AbortSignal.any`. A prospective native adapter must supply these APIs and prove
its authentication transport before it can claim compatibility.

The client has a permanent invalidation operation. Invalidation aborts pending
reads and rejects late results, including results from a transport that ignores
abort. Each result must also match the selected workspace. Server membership
and permission checks remain authoritative.

The web adapter keeps cookie credentials in the browser boundary. Workspace
changes, auth-store account changes and API reconfiguration invalidate pending
reads. The app-state provider also clears private Query data when a signed-in
account changes or signs out. A workspace generation changes even when the member switches away and
back. An old 401 cannot clear a newer session. A current 401 ends the client
session and invokes existing sign-out handling. A 403 reports refusal and leaves
the session intact. Caller cancellation ends only that read.

## Why this boundary

Previously, the skills client cached the first API origin in a process-wide
Promise. It ignored the list call's workspace parameter and resolved unauthorized
handling through the current global transport. A delayed request could therefore
use old configuration or affect newer local state.

A small instance boundary removes those assumptions without a native framework,
an authentication rewrite or a new SDK dependency. The web API also keeps its
other skills endpoints; their generated clients are cached per transport rather
than per process. Other product APIs are outside this slice.

## Evidence and limits

`apps/web/src/lib/api/skills-client.test.ts` exercises the portable client in a
Node test environment with no browser globals. It includes a real loopback HTTP
fixture with host-supplied authentication and server refusal. This fixture proves
client transport behavior, not Garden production authorization.

`apps/web/src/lib/api/skills.test.ts` exercises the web adapter, cookie transport,
origin changes, workspace/account changes, denied access and expiry. The
[verification scenario](../../.agents/skills/verify/features/shared-client.md)
records the remaining browser and device proof. No native app, native sign-in,
offline cache or execution-host service is delivered by this change.

The [client proposal](../proposals/cross-platform-clients.md) retains the agreed
product scope. The [host contract proposal](../proposals/execution-host-contract.md)
defines the later launch path. Neither proposal selects a native framework.
