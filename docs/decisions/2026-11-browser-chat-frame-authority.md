---
title: Check browser chat authority before SDK frame dispatch
description: Private chat sockets retain server-derived identity and recheck current database authority before each incoming frame.
status: current
owner: Unassigned
last_reviewed: 2026-11-21
---

## Decision

The web package owns browser authentication before the runtime receives a frame.
Its exported `AgentDO` extends the existing runtime class and keeps the same Durable Object binding name.
The existing issue and automation Workflow entry points retain their own authority.

Private chat upgrades use the existing Better Auth verifier with `disableCookieCache: true`.
The server requires the current session, workspace membership, active agent and unarchived owned chat thread.
The browser origin must match Garden or the exact `garden-mobile://` origin.
Client identity headers do not supply authority.

The server checks the request again when the SDK accepts the socket.
Agents 0.17.3 clones the upgrade request before the connection-tag hook, so request-object identity cannot carry authorization.
The second check uses the preserved cookie and actual database records.
An SDK upgrade error carries a fixed public message and stack, without its database cause or request contents.

## Connection identity

Platform tags contain only session, user, workspace, agent, thread, runtime and named-host identifiers.
They contain no session token, cookie or message body.
Bounded chunks keep the tags within the platform limits.
The tags survive hibernation and remain separate from client-writable agent state.

PartyServer also adds the `_pk` connection ID as a tag.
The private-chat boundary therefore replaces that client value with a fresh server UUID before acceptance.
This prevents a client ID from impersonating an authority tag or colliding with another session's facet connection.
An old socket without a complete server binding must reconnect.

## Dispatch boundary

The public `webSocketMessage` entry checks current PostgreSQL authority before SDK dispatch.
It checks every message, including protocol, state, RPC and binary frames.
Session deletion or expiry, lost membership and changed thread or runtime scope refuse the frame.
A database failure also refuses the frame.
The server closes a refused socket with a generic reason.
The authority query does not lock the session or membership rows.
A change after that query can race with later dispatch.
This change does not make admission and a later model or tool action one atomic operation.

This boundary requires hibernation, which remains explicitly enabled.
Agents and Think install protocol handlers before a subclass `onMessage` callback.
A callback override alone cannot protect their history, inference and RPC paths.
The implementation uses public platform hooks and does not replace SDK methods or parse its private protocol.

## Remaining inference requirement

Frame admission does not establish authority after arbitrary queue or recovery waits.
Think 0.10.0 does not expose immutable request origin and identity in `TurnContext`.
The model and action boundary still needs that information for a fresh authority check.
A missing connection cannot establish trusted server origin.
Client body fields and a globally running submission cannot establish it either.

A future SDK context change must retain browser and explicit server-task provenance through the existing queue and recovery owner.
It must preserve durable Decide delivery and approved task-owned continuations.
No dependency patch or second recovery engine belongs to this boundary change.
The complete native chat security gate remains open until that later requirement is qualified.

## Evidence

The [verification map](../../.agents/skills/verify/features/browser-chat-authority.md) gives the focused commands and expected refusals.
The tests use actual Better Auth sessions, isolated PostgreSQL and installed SDK dispatch.
They replace platform socket leaves and the model runtime with controlled fixtures.
They do not run a model, qualify deployment or establish physical-device behavior.
