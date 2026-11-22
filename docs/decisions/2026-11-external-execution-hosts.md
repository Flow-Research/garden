---
title: Deliver external host commands through one scoped receiver
description: The pilot reuses Garden authority and a durable signed transport without replacing either runtime owner.
status: current
owner: Unassigned
last_reviewed: 2026-11-21
---

## Decision

Garden owns member authority and command delivery for enrolled external hosts.
Harnessy owns worker execution, local repository aliases, credentials, resource limits and execution evidence.
WorkStream retains task policy, submission, evaluation and acceptance.
Existing Garden managed runs keep their Workflow owner.

The host initiates HTTPS requests to `/api/execution-hosts/receive`.
Garden authenticates the host through an enrolled Ed25519 public key.
The host authenticates Garden through its configured HTTPS origin.
A nonce is a request identity that prevents replay.
Garden consumes each nonce in the same transaction as the delivery effect.

Portable schemas come from the canonical Harnessy source.
The generation script copies exact contract and authentication bytes with their license and a source manifest.
Both receivers and consumers validate those schemas.
The source manifest distinguishes a working-tree snapshot from its base commit.

## Member authority

Member effects require the configured pilot operator and current workspace administration.
The server derives the actor from a fresh Better Auth session.
The caller must select the workspace explicitly.
An active workspace cookie cannot substitute for that selection.

The transaction locks the current session and membership before a member effect.
A separate time check runs after lock waits.
The receiver checks authority again before commit and rolls back writes if authority expires.
Signed host grants remain independent of browser sessions.
Client disconnection or logout does not cancel an approved run.

The existing service-error mapper preserves authorization refusals and immutable-identity conflicts.
Database failures retain a generic public message.
Control responses disable caching and omit database causes, credentials and process output.
The pilot is disabled by default.

## Delivery and recovery

A launch binds one workspace, host, member, task, source revision, evaluator, workload and grant.
Garden reserves one operator slot before it delivers the launch.
The host must retain the same launch ID as its logical run ID.
A lost reply does not permit a replacement launch.

The host acknowledges its retained launch before it starts work.
Events use increasing sequence numbers and exact source identities.
Snapshots distinguish the event head from the last delivered page cursor.
Host summaries report last contact without promising availability.
Cancellation receipt does not establish termination.

A signed pre-start decline has its own immutable identity.
Garden accepts it only for a reserved launch without acknowledgment or events.
An exact retry returns the same receipt and cannot release another reservation.
An acknowledged or uncertain run retains capacity until its outcome is established.

## Evidence and release limits

PostgreSQL and actual-auth HTTP fixtures cover permission refusal, expiry, concurrency, retries, cancellation and pagination.
The [verification map](../../.agents/skills/verify/features/external-execution-hosts.md) records commands and later app gates.
Source checks and controlled fixtures do not establish installed or deployed support.

Revoked-host cleanup and acknowledged-but-never-started recovery still need an explicit reconciliation path.
The receiver cannot infer termination from silence or elapsed time.
Real provider admission and complete client controls remain separate work.
The receiver stores host interventions and returns operator answers. A cross-product exchange with a running host is not established.
Retained-target migration, deployment and app publication require their existing human gates.
