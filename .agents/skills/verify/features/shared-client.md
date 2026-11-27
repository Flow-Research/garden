# Shared skills read and session boundary

This scenario covers the first portable client slice. It does not qualify a
native client or execution-host launch.

## Automated proof

Run from the repository root:

```bash
pnpm --filter @garden/web test src/lib/api/skills-client.test.ts src/lib/api/skills.test.ts src/lib/api/session-cache.test.tsx src/features/skills/components/skills-client.integration.test.tsx src/features/skills/components/skills-page.test.tsx
```

The portable tests have no browser globals. The loopback HTTP fixture checks
transport, host-supplied credentials, allowed workspace reads and server refusal.
It does not replace Garden server membership tests. The UI integration tests use
the real list adapter and typed decoder with a controlled HTTP response.

Expected evidence:

- The Skills page shows the authorized catalog from the existing typed endpoint.
- A 403 shows a recoverable error and no catalog; it does not sign the member out.
- A current 401 clears session/workspace state through existing handling.
- Switching account or workspace invalidates pending reads, including A→B→A.
- An old 401 cannot clear the new session. Private Query data is cleared on an
  account change or logout.
- API reconfiguration uses the new origin. Web requests retain cookie credentials.
- Cancellation reaches Fetch and prevents the result from entering Query.

## Local app check

Use the standard profile from the [verification skill](../SKILL.md). Run doctor
first. Reuse an existing local app. Do not migrate retained data or start remote
model calls for this read-only scenario.

1. Sign in as a member with Skills access and open Skills.
2. Confirm the catalog and select a skill.
3. Switch workspaces while delaying the old catalog response. Release the old
   response. Confirm it does not replace the new workspace catalog.
4. Repeat with logout and another account. Confirm no old private catalog remains.
5. Refuse access on the server. Confirm the visible error and retry control.
6. Expire the active session. Confirm the existing sign-in recovery path.

Record PASS, FAIL or INCONCLUSIVE in `~/.garden/evidence/`. Component tests and
HTTP fixtures are distinct from this full local-app check. Physical-device and
native lifecycle tests remain release gates in the client proposal.
