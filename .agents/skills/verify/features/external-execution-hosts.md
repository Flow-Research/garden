# External execution-host controls

This scenario covers the pilot receiver and its member and signed-host boundaries.
It also covers operator decisions and host status at `/settings/execution-hosts`.
It does not qualify an installed host, a deployed browser screen or a native device.
The pilot remains disabled unless its existing Garden operator ID is explicitly configured.

## Automated proof

Run these commands from the repository root with Docker available:

```sh
pnpm --filter @garden/server exec vitest run src/execution-hosts/service.integration.test.ts src/execution-hosts/interventions.integration.test.ts
pnpm --filter @garden/web exec vitest run src/lib/server/execution-hosts.http.test.ts src/lib/server/service-error-response.test.ts src/routes/api/-authorization.test.ts
pnpm --filter @garden/db exec vitest run src/__tests__/brain-write-proposal-migration.test.ts
pnpm verify:host-contract
pnpm --filter @garden/db db:check
```

The first two commands use disposable PostgreSQL databases.
The HTTP tests use actual Better Auth sessions and request contexts.
They do not replace browser, device or deployed-host evidence.

Required observations include these results:

- A current pilot administrator can enroll a public key in the explicit workspace.
- A missing, revoked, expired or ordinary-member session cannot perform an administrator effect.
- Session or grant expiry during a database wait refuses the effect and rolls back its writes.
- A host signature cannot cross the enrolled workspace, host, key or request identity.
- A duplicate launch retains its immutable inputs and logical run ID.
- Two hosts cannot hold the same operator execution slot.
- Cancellation receipt remains separate from confirmed termination.
- A signed pre-start decline cannot settle an acknowledged run or release another reservation.
- A reconnect follows the returned page cursor and retains the current event head.
- A signed intervention is stored once. A forged, replayed, out-of-scope or expired intervention is refused.
- Only the pilot operator with a current owner or admin role can answer an intervention.
- A pull reply carries the answer with the exact intervention digest and run bindings.
- An answer for an expired or closed intervention is refused, and a closed run receives no answer.

The migration fixture isolates migration 0069 and retains its original populated-data and rollback checks.
The current database fixtures also apply the later checked-in migrations.
The contract check makes sure that copied Harnessy bytes match their recorded source hashes.
A hash identifies bytes. It does not establish runtime qualification.

## Status page proof

Run this command from the repository root:

```sh
pnpm --filter @garden/web exec vitest run src/features/execution-hosts
```

Required observations include these results:

- Each read sends the current workspace ID, and the client refuses an answer for another workspace.
- The page shows the disabled, signed-out, refused, empty and failed-load states as separate states.
- A refused refresh removes host data from the page.
- A stale, revoked or never-reported host does not show "Reported recently".
- A run on a stale host shows "Stale", and a failed refresh shows "Unknown". Neither shows "Running".
- "Cancellation requested" stays separate from termination that the host confirmed.
- "Load more events" sends the returned cursor and shows events beyond the first 200.
- The page has only the "Refresh", "Show run", "Load more events" and "Load more hosts" controls.

The HTTP suite in the first section proves the server refusals with actual sessions.
It includes the exact 503 message that selects the disabled state.

For a local preview, use a separate local database and synthetic data:

1. Apply the migrations to an empty local PostgreSQL database with `pnpm --filter @garden/db db:migrate`.
2. Start `pnpm --filter @garden/web dev:offline` and open `/settings/execution-hosts`. Expect the disabled state.
3. Set `ENGINEERING_PILOT_OPERATOR_ID` in the local root `.env` to the ID of the local owner, then start the server again.
4. Open the page in a workspace without a host. Expect the empty state.
5. Enroll a synthetic host key, launch one run and send signed events through the real routes.
6. Open the page with the `launch` search parameter. Expect the run state and the ordered events.
7. Stop host requests for more than 120 seconds. Expect "Stale" for the host and the run.
8. Request cancellation, then send the confirmed terminal event. Expect the two separate states.

Record `INCONCLUSIVE` for a deployed environment. No deployed check of the status page exists.

## App and host release proof

Use the [verification workflow](../SKILL.md) before a later app journey.
Reuse an existing authorized local stack and synthetic data.
Do not enable model calls or migrate retained data for these receiver fixtures.

For an approved host journey, record each result separately:

1. Sign in through the current Garden authority.
2. Select the explicit workspace and enrolled host.
3. Review the exact task, source revision, authority and host limits.
4. Launch once and retain the same identity after an uncertain reply.
5. Reconnect to the same run and read every event page.
6. Request cancellation and observe the separate termination result.
7. Record the exact source and evidence for the final outcome.

Record `INCONCLUSIVE` when the app surface, provider control or host proof is unavailable.
A controlled execution port cannot establish a real agent run.
Physical devices, current provider allowance, WorkStream proof, retained-target migration and deployment remain separate gates.
