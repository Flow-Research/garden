---
title: External execution hosts
description: Workspace controls for approved work on an enrolled Harnessy host.
status: proposal
owner: Unassigned
last_reviewed: 2026-11-22
---

Garden delivers scoped commands to an enrolled Harnessy host through outbound HTTPS requests.
An enrolled host is a machine with an approved public key.
Harnessy owns execution, local repository aliases, credentials, process recovery and evidence.
WorkStream owns task policy, submissions and acceptance.

## Authority and delivery

A workspace administrator enrolls a host public key and its allowed repositories.
Enrollment does not expose a shell or create a WorkStream credential.
The host signs requests with its private key.
Garden checks the signature, current enrollment, operator membership and a durable request nonce.
A nonce is a request identity that prevents replay.
The host checks Garden's HTTPS origin and current grant before it acts.

The pilot operator submits a launch for an approved task and host. The receiver verifies the workspace and the submitted digests. WorkStream owns independent task approval. A Garden grant expires within 24 hours, the maximum allowed by the Harnessy approval command.
Garden binds the launch to the workspace, member, host, task content, source revision and evaluator.
The host reserves the stable launch identity before it creates any execution resource.
A lost response does not authorize another launch identity.
Before it starts work, the host can decline a reserved offer through a signed, immutable receipt.
The host must first establish that no local run or start exists.
Garden accepts the decline only before acknowledgment or run events.
An exact retry returns the same decline receipt.
A decline cannot settle an acknowledged or uncertain run.
The next pull returns the same pending launch until the host acknowledges it.

The host sends events with increasing sequence numbers.
Garden stores those events and exposes an authorized snapshot.
Client reconnection reads that snapshot and the events after its last cursor.
Client disconnection does not cancel host work.

## Interventions

An intervention is a signed host request for a decision about one acknowledged run.
The Harnessy controller raises it when an included allowance is unavailable or a run needs reconciliation.
Garden applies the same signature, nonce, enrollment and membership checks as other host requests.
Garden stores the intervention once by host and intervention ID.
An exact retry returns the same receipt.
Garden refuses an intervention that differs from the launch, run, grant, source revision or task revision.
Garden also refuses an expired intervention or an intervention for a closed run.

The pilot operator reads the interventions of a run and answers `resume` or `stop`.
The operator must have a fresh session and a current owner or admin role.
Garden copies every binding of the answer from the stored intervention.
The answer names the intervention digest, which is the SHA-256 of the signed intervention record.
The answer expires with the intervention.
An answer cannot approve a job, issue a grant or extend an expiry.

Garden returns each answer as an `answer` entry in later pull replies.
The entry repeats with identical bytes until it expires or the run ends.
The host applies one answer identity once, so a lost reply needs no other recovery.
Garden does not send an answer to a pull that the host signed before the answer time.
A Garden answer is not proof that the host resumed or stopped the run.

## Controls and privacy

Enrollment requires workspace permission management.
Launch and cancellation require current workspace authority for the selected host and run.
Member operations require a fresh session from the existing Garden authority.
The database transaction locks that session and current membership before a member effect.
A revoked, expired or foreign session cannot authorize a member operation.
The server rechecks membership before command delivery and grant refresh.
Signed host grants remain independent of a browser session.
Logging out of the client does not cancel an approved host run.
Revocation prevents new dispatch and grant refresh.
Cancellation acknowledges the command separately from confirmed process termination.

Only repository aliases and fixed agent identifiers cross this boundary.
Paths, shell commands, provider credentials, task prose and private process output do not belong in control events.
Included allowance, isolation and resource checks remain host requirements.
Missing evidence pauses execution.

## Status page

The settings section at `/settings/execution-hosts` shows the status of the hosts of the current workspace.
`ExecutionHostsPage` in `apps/web/src/features/execution-hosts/components/execution-hosts-page.tsx` owns this page.
The Run needs attention list opens a run with a pending question. The authorized operator can record Resume or Stop. Garden shows the recorded choice and the latest host evidence separately. Resume releases the hold for permission and allowance checks. Stop requests cancellation. The host confirms when the worker has stopped.

The directory and snapshot use these member routes: `GET /api/execution-hosts/` and `GET /api/execution-hosts/runs/$launchId/`.
Each request sends the current workspace in the `X-Workspace-ID` header.
The server applies the same fresh-session, pilot-operator and workspace-administration checks as before.
The attention view filters the directory by open question. The run detail reads questions and posts decisions through the interventions route using the same workspace and session.

The host list shows these facts for each host: host ID, enrollment state, last signed contact, repositories, agent, key generation and capability digest.
The page shows a separate state for each server answer:

- 503 with the pilot-disabled message: "Execution hosts are disabled".
- 401: "Sign in again".
- 403: "You cannot view execution hosts".
- An empty directory: "No host is enrolled".
- Any other failure: a failed load with a retry control.

The receiver has no route that lists the runs of a host.
The operator enters a launch ID, and the page keeps that ID in the `launch` search parameter.
The run section shows the run state, cancellation, termination, delivery, job facts, the host and the ordered events.
"Load more events" requests the next page with the cursor that the snapshot returned.
Each section shows the time of its last successful read and repeats the read every 60 seconds.

`runStatus` in `apps/web/src/features/execution-hosts/status.ts` derives the run state. These rules apply:

- The page shows a result as final only when the server reports `termination: host-confirmed`.
- "Cancellation requested" means that the host did not confirm termination.
- The page shows the last reported state as current only when the last signed contact of the host is 120 seconds old or less.
- An older contact, a host that never reported, or a revoked host or delivery shows "Stale" with the last reported state.
- A failed refresh of an unconfirmed run shows "Unknown".

The 120-second window is `HOST_REPORT_WINDOW_MS`. It is twice the signed request window and is a starting value for display.
The contract does not define a host polling interval.
The host list compares the last contact with the server time in the directory answer.
The run section compares it with the browser time of the read, because the snapshot has no server time.

## Verification and current limits

The implementation must prove signatures, workspace separation, nonce replay refusal and durable duplicate handling.
PostgreSQL tests must prove concurrent reservations and event sequence enforcement.
Cross-product tests must exercise the same contract through Garden and Harnessy.
Tests must cover revoked membership, expired grants, lost acknowledgments, host restart and cancellation.

This work is under implementation.
No deployed host enrollment, direct launch, native approval journey or device qualification is established.
The execution-host page shows open decisions for the signed-in pilot operator. A recorded answer confirms Garden received the choice. Host events supply evidence of the subsequent run state. Deployment qualification remains open.
Existing Garden managed runs keep their current Workflow owner.
See the [execution-host proposal](../../proposals/execution-host-contract.md) for the complete delivery gates.
