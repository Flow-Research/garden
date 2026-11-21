---
title: Retain chat request sources through delayed work
description: Maintained SDK changes retain exact request sources and check current Garden authority before model and tool effects.
status: current
owner: Unassigned
last_reviewed: 2026-11-21
---

## Boundary

Request provenance identifies the source of one operation.
It does not grant current access.
Garden checks current session, member, agent and owned thread records before a private chat action.
The checks supplement the [outer socket boundary](2026-11-browser-chat-frame-authority.md).

Think 0.10.0 owns queue, submission, continuation and recovery behavior.
The maintained patch adds immutable request context and the public `beforeChatAction` hook to that owner.
Agents 0.17.3 retains opaque context in its existing continuation and recovery helpers.
Garden does not add another dispatch queue or recovery engine.

## Sources and propagation

A browser request captures actual server connection tags before queue admission.
A new user message starts a new request root.
Conversation history does not make every earlier session part of that new request.
A pending tool result, approval or recovery retains its original source separately from the current actor.
A new authenticated turn cannot replace that pending source.

Programmatic turns require explicit application context from server code.
An absent connection does not establish server authority.
Browser RPC cannot call native save or submission methods.
Client message fields, tool IDs and agent state cannot create retained SDK source records.

Decide delivery uses the exact claimed SDK submission row and its immutable submission identity.
Garden also requires the current terminal analysis run, exact attempt, current membership and owned active thread.
Issue and automation Workflows retain their existing task authority.
They do not acquire a browser-session requirement.

## Action checks

The patch checks authority before preparation, each model step and each actual model request or retry.
It also checks authority before queued history writes, tool execution, client tool dispatch and pending interaction updates.
Callable chat warmup and history reads use the actual browser connection at their own boundary.
Automatic compaction retains request context through `AsyncLocalStorage` and guards its own model calls.
This storage keeps each asynchronous invocation separate.

A tool decision requires its exact current Garden receipt and matching retained SDK decision.
A current session alone cannot approve a pending effect.
Garden currently refuses direct SDK execution approval and rejection because no supported Garden grant maps that execution ID.
The refusal remains until an exact grant mapping and its tests exist.

Checks read PostgreSQL immediately before the controlled boundary.
They do not make a database read and a later external call one atomic transaction.
Already accepted model output and diagnostic records do not represent a new grant.

## Bounds and cleanup

One context contains at most 8,192 bytes, 512 JSON nodes and eight nested levels.
One continuation retains at most 16 distinct sources, including its current source.
Repeated identical sources do not consume more entries.
An independent user request starts a new root instead of accumulating reconnects forever.
An excess source or byte count causes explicit refusal.
The SDK never discards an earlier source to admit a continuation.
Coalesced and deferred branches merge their bounded source sets.
Repeated callbacks do not append an unbounded second list of contexts.

The private source index uses existing SDK SQLite configuration records.
It retains at most 4,096 records and refuses further references at capacity.
SDK history clearing cancels pending turns and removes those retained references.
Capacity does not trigger silent eviction or an unbound continuation.

## Qualification limits

Focused tests use installed Think and Agents code, actual local Workers, Durable Object SQLite and disposable PostgreSQL.
The controlled model and tool ports use loopback HTTP.
They do not contact a real model or provider.
The Worker fixture admits synthetic session identifiers through a test-only socket boundary.
Separate outer-boundary tests cover actual Better Auth cookies.

Fresh approval semantics after the initiating session expires remain under review.
The current policy refuses the continuation if any retained initiating source lacks current authority.
This strict rule does not establish a new reauthorization policy.
The SDK facet bridge passes its local source-retention test.
Full Garden facet startup and all deferred product interactions remain required before merge readiness.
The existing `continueAfterGardenApproval` method is not browser callable.
This patch preserves that allowlist and does not qualify the proposal continuation as a working product flow.
Native fixture turns and server warmup do not acquire authority from cached thread lookups.
Without an actual connection or explicit current handoff, those private chat operations refuse access.

The [verification map](../../.agents/skills/verify/features/browser-chat-authority.md) lists the focused commands and remaining app checks.
