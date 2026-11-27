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

The agent-proposal continuation, `continueAfterGardenApproval`, is browser callable.
It starts a turn on the calling connection, so the source is that connection and its server tags.
The browser supplies the proposal identifiers and the decision as data only.
Garden compares them with the recorded proposal row, its resolver and the pending agent before the turn persists a message.
The turn also retains the source of the `propose_agent` tool call that made the proposal.
A completed continuation releases that record, and a second call for the same proposal is refused.

`AgentDO.runThreadFixtureTurn` is a native method for server callers and tests.
Its caller names the live session of the thread owner.
Garden reads the scope of that session from the database and passes it as an explicit handoff source.
The method is not browser callable.

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

A tool decision requires the current Garden permission rows of that tool call and the matching retained SDK decision.
The runtime records the chat thread on each connector approval row that a chat turn raises.
The approval routes decide who can resolve a row: a workspace approver or the owner of the Team whose policy held the call.
The thread owner resolves in the chat only with one of those two authorities.
The check accepts the recorded decision of that resolver while the resolver is a member of the thread's workspace.
It does not read the resolver's role again.
One Executor call can name several connectors and thus have several rows.
An effect needs an approval on each row. One recorded denial is sufficient for a refusal.
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
The SDK deletes the record of a tool call when that call settles.
A call settles on its output, its error, its denial or the applied result of a client tool.
At the end of a stream, the SDK also deletes the records of server tools that have no output.
Records remain for a client tool without a result, an approval without a decision and a paused execution.
An abandoned interaction of those three types keeps its record until SDK history clearing.
SDK history clearing cancels pending turns and removes all retained references.
Capacity does not trigger silent eviction or an unbound continuation.

Two results of one turn can arrive over different connections, for example after a reconnect or from a second tab.
The SDK compares the server-bound tags and application context of the two sources.
It ignores the connection ID, which PartyServer also puts in the tag list.
The merged continuation keeps both sources, and Garden checks each one.
A different principal still causes a refusal.

`addMessages` and the extension host message entry now pass the `persist-messages` check.
Garden has no production caller for either entry.

## Qualification limits

Focused tests use installed Think and Agents code, actual local Workers, Durable Object SQLite and disposable PostgreSQL.
The controlled model and tool ports use loopback HTTP.
They do not contact a real model or provider.
The Worker fixture admits synthetic session identifiers through a test-only socket boundary.
Separate outer-boundary tests cover actual Better Auth cookies.

The proposal continuation has three local proofs: browser dispatch to the production method, the SDK path with the same options, and the Garden policy.
The gated Brain suite runs the production chat facet in a Worker for one native handoff turn with a controlled model.
No test sends a browser socket turn to the production facet in a Worker.
The SDK facet bridge passes its local source-retention test.
Full Garden facet startup and all deferred product interactions remain required before merge readiness.
Server warmup does not acquire authority from cached thread lookups.
Without an actual connection or explicit current handoff, private chat operations refuse access.

## Known design limits

These limits are intended behavior of this decision. The [known-gap register](../reference/known-gaps.md) tracks them.

A pending approval, tool result or recovery keeps its initiating browser session as a source.
Garden refuses the continuation if that session has no current authority.
Thus a sign-out followed by a sign-in strands each pending approval of the thread.
The same applies to a pending client tool result and to an expired session.
The user must send the request again in a new turn.
No reauthorization rule exists, and this decision does not add one.

Garden refuses direct SDK execution approval and rejection.
The patch also removes the SDK fallback that continued a turn through any open connection.
This removal applies to each Think subclass, which includes the run and Brain sub-agents.
A server-side `approveExecution` or `rejectExecution` call without its own connection does not continue the turn.
Garden has no caller for those methods today.

A chat decision applies to one thread and agent. Different threads can receive the same provider tool call ID. The chat route, Inbox batch, approval reuse and action check all retain the thread scope. A competing decision cannot change a terminal row or append a second audit record.

A connector approval row from before this change has no thread, so its decision is refused.
The chat card resolves the rows of one capability for each call.
An Executor call that names two connectors therefore needs a second decision in the Inbox before its effect.
A recovery snapshot from before this change has no request source.
At deployment, the recovery of such an in-flight turn ends in a terminal refusal or `recovery_error`. The turn does not resume.

The [verification map](../../.agents/skills/verify/features/browser-chat-authority.md) lists the focused commands and remaining app checks.
