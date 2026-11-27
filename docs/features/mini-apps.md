Garden hosts independently deployed web products inside the workspace. The first product is the Learning Management System. Garden owns identity, workspace context, navigation, app registration, launch, and platform capabilities. Each mini-app owns its frontend, backend, domain data, and domain permissions.

Status: proposed

The full implementation contract is [Garden Mini-App Integration Contract v0.1](./garden-mini-app-integration-contract-v0.1.md).

## Why it works this way

Garden uses one cross-origin iframe in v0.1. The iframe keeps an app's frontend and release cycle outside the Garden bundle. A small `postMessage` bridge gives the app host-owned actions such as context initialization, resize, notification, navigation, and close. A short-lived session token gives the app access to the typed Garden session endpoint without replacing Better Auth.

Garden does not render or model app-specific concepts. The LMS owns courses, pathways, modules, lessons, enrollment, assessments, progress, completion, and competence.

## Scope

In scope:

- A server-side manifest registry.
- App discovery for authenticated workspace members.
- A workspace-scoped launch session.
- A sandboxed cross-origin iframe.
- A typed Garden API group and a framework-neutral `@garden/sdk` package.
- A validated host bridge.

Out of scope:

- Module Federation, native plugin code, a marketplace, billing, self-service installation, and multiple render modes.
- Garden storage or API models for LMS learning data.
- Garden ownership of Workstream competence consumption.

## What the user sees

1. The user selects a registered app in the Garden app navigation.
2. Garden opens the app inside the existing shell and workspace.
3. The app initializes with the current Garden user and workspace context.
4. Garden shows app launch, session, bridge, and close failures in the host area.
5. The app shows its own domain loading, empty, success, and failure states.

## Planned implementation locations

- Manifest and bridge types should live in packages/mini-app-contract/src/.
- The session table should live in packages/db/src/schema/mini-apps.ts.
- The server registry and session service should live in apps/web/src/lib/server/mini-apps/.
- The typed API group should live in apps/web/src/lib/api/mini-apps-contract.ts and join `apps/web/src/lib/api/garden-api-contract.ts`.
- The host route lives under `apps/web/src/routes/_authenticated/_app/`.
- The iframe host and bridge should live in apps/web/src/features/mini-apps/.
- The browser SDK should live in packages/sdk as `@garden/sdk`.

## Data and permissions

Garden reads the Better Auth session, the current organization membership, the registered manifest, and the mini-app session row. Garden writes a mini-app session row for each launch. The session row stores a token hash and never stores the raw bearer token.

All workspace members may launch a registered app in v0.1. Garden checks membership on launch and on each app API request. The app capability set is separate from Better Auth workspace permissions. The app backend owns domain authorization.

## How to verify it

- Test manifest and bridge schemas with invalid origin, capability, and message cases.
- Test discovery, launch, expiry, invalid sessions, and workspace membership with API integration tests.
- Test a real app route with an iframe, an exact-origin bridge, context initialization, resize, notification, navigation, and close.
- Test the LMS in two workspaces and with two users in one workspace.
- Confirm that the LMS owns learning data and that Garden receives no course, lesson, assessment, progress, completion, or competence payload.

## Gaps and follow-up

- Bashir must provide the LMS launch origin, backend bootstrap endpoint, and user and workspace mapping rules.
- David must provide the authoritative identity fields, privacy rules, and token policy.
- App installation, marketplace review, per-workspace visibility, and richer Garden capabilities remain future work.
