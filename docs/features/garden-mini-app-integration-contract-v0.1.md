# Garden Mini-App Integration Contract v0.1

**Date:** 2026-11-05. **Status:** Proposed implementation contract. **Implementation:** Not built.

This contract defines the first reusable app boundary for Garden. The Learning Management System (LMS) is the reference app. Garden owns the host experience, Garden identity, workspace context, app registration, app launch, and Garden capabilities. The LMS owns learning data and learning behavior.

The contract uses the current Garden primitives where they fit. Better Auth remains the identity system. Better Auth organizations remain Garden workspaces. The existing request context and workspace access checks remain the server boundary. The existing Effect HTTP API remains the typed API composition point. The existing shell remains the host shell.

The contract does not make the LMS a Garden module. It gives any independently deployed web product the same integration path.

## Decision summary and rationale

| Decision | Why Garden makes it |
| --- | --- |
| Use a cross-origin iframe as the only v0.1 hosting mode | The LMS has its own frontend, backend, release cycle, and dependencies. The iframe keeps those concerns out of the Garden bundle and gives Garden a clear DOM and failure boundary. Shopify uses a developer-hosted iframe for most App Home apps and pairs it with App Bridge. Zoho Creator also embeds external widgets and websites through iframe embed code. These are reference patterns, not proof that Garden should copy their full platforms. |
| Use a host bridge plus a small HTTP API | Identity and shell actions belong to Garden. Domain data belongs to the app. The bridge handles parent-owned UI actions, while HTTP handles the validated app session and future Garden resources. This keeps the SDK from becoming a renderer or a second app runtime. |
| Use a short-lived bearer session stored by hash | Better Auth cookies do not cross an independent app origin. A scoped session lets Garden keep Better Auth as the identity authority while giving the app a bounded delegation. The server can revoke it and can recheck workspace membership on every request. |
| Use a static server registry in v0.1 | The current repo has no app installation table or developer account flow. A static registry gives engineers discovery, URL validation, ownership, and capability policy with one small lookup. It avoids adding installation state before a product needs it. |
| Add one Effect HTTP API group | Garden already composes typed API groups through `GardenApi` and the `/api/$` host route. A mini-app group follows that boundary instead of creating a parallel router or an untyped public API. |
| Add a browser-safe protocol package beside the private core package | `@garden/core` imports database and server-oriented packages and is private. A small contract package lets the Garden host and `@garden/sdk` share schemas without shipping Garden server dependencies to app frontends. |
| Keep app capabilities separate from Better Auth permissions | Better Auth protects Garden resources such as teams, agents, skills, and connections. Mini-app capabilities describe what the app may ask Garden to expose. Keeping the lists separate prevents a browser app from turning a capability name into a workspace permission. |
| Keep learning data in the LMS | The LMS owns courses, lessons, assessments, progress, completion, and competence. Garden can host the LMS without learning those concepts or becoming a second learning database. |

## 1. Goals

The v0.1 platform must:

- Host an independently deployed web frontend inside the authenticated Garden workspace.
- Give the mini-app a verified Garden user and workspace context.
- Give the mini-app a small, explicit set of Garden capabilities.
- Keep Garden domain-neutral. Garden must not understand courses, lessons, assessments, or competence.
- Give app teams a stable manifest, launch flow, HTTP contract, TypeScript SDK, and host bridge.
- Keep the first implementation small enough for the API, SDK, host, and LMS teams to build in order.

## 2. Non-goals

Version 0.1 does not include:

- Module Federation or shared JavaScript bundles.
- More than one rendering mode. The only mode is a cross-origin embedded web app.
- Native code loading, arbitrary code execution, or Garden plugin code running in the Garden Worker.
- A marketplace, self-service app installation, app billing, or developer accounts.
- Workspace-specific installation records. The registry is platform-controlled in v0.1.
- A Garden copy of LMS data or an LMS-specific Garden API.
- Garden ownership of learning permissions, course progression, assessment results, or competence.
- A second identity system. The mini-app session is a scoped delegation of the existing Garden session.
- A second retry, queue, Workflow, Durable Object, or agent runtime for app launch.
- Full navigation, files, tasks, notifications, or connector access. The contract names the capability slots, but v0.1 enables only identity and workspace reads plus the small host UI commands required by the embedded frame.

## 3. Mini-App Definition

A Garden mini-app is an independently deployed web frontend and its own backend service that:

1. Has one registered Garden manifest.
2. Has one HTTPS launch URL on an origin different from the Garden origin.
3. Runs inside a Garden-owned iframe.
4. Implements the Garden Mini-App Bridge Protocol v0.1.
5. Uses the Garden SDK for Garden context and host commands.
6. Uses its own service for product data and product rules.

A mini-app is not a connector. A connector gives Garden agents access to an external provider. A mini-app gives a person an external product surface inside Garden. Do not add mini-apps to `packages/connectors/src/registry.ts`.

A mini-app is also not a Garden route. Garden owns the route that hosts the iframe. The mini-app owns the routes inside the iframe.

## 4. App Identity

Garden uses two identifiers.

| Field | Rule | Example |
| --- | --- | --- |
| `id` | Immutable, globally unique, assigned by the platform owner | `com.flowresearch.lms` |
| `slug` | URL-safe identifier used by Garden navigation | `learning` |

The app ID is the stable identity used in sessions, audit fields, capability checks, and future installation records. The slug is the Garden route and navigation key. Version 0.1 treats the slug as stable. A future slug change must use an explicit redirect or alias record.

The manifest also has these identity fields:

- `name` is the user-facing name. It may change without changing `id`.
- `owner` identifies the team responsible for the app. Ownership in the manifest does not grant Garden permissions.
- `protocolVersion` identifies the Garden integration protocol. Version 0.1 accepts only `0.1`.
- `appVersion` is an optional app release string. Garden does not compare or interpret it.

The LMS registration will use the LMS team ID and deployed launch URL supplied by Bashir. This document does not invent that URL.

**Why separate `id` and `slug`.** The app ID must survive an app rename, route rename, or future installation record. The slug gives Garden a readable navigation path. Keeping both prevents a user-facing label from becoming the security or storage identity.

## 5. Registration and manifest

Version 0.1 uses a server-side static registry. A platform maintainer adds a manifest to the Garden deployment. End users cannot register or install apps.

**Why.** Garden has a static connector registry, but it has no mini-app installation table, developer account flow, or marketplace. The static registry is the smallest shape that gives the host one authoritative app lookup. It also makes origin and capability changes reviewable in the Garden codebase. A later installation table can replace the registry when user-managed app visibility becomes a real requirement.

This choice reuses the shape of the connector registry without reusing connector behavior. The registry gives Garden one lookup table for discovery, route launch, origin validation, and capability policy. A database-backed installation model can replace the registry later without changing the app protocol.

The minimum manifest is:

```ts
export const gardenMiniAppCapabilities = [
  'identity:read',
  'workspace:read',
  'navigation:request',
  'ui:resize',
  'ui:notify',
] as const

export type GardenMiniAppCapability =
  (typeof gardenMiniAppCapabilities)[number]

export interface GardenMiniAppManifest {
  protocolVersion: '0.1'
  id: string
  name: string
  slug: string
  owner: string
  launchUrl: string
  capabilities: readonly GardenMiniAppCapability[]
  description?: string
  iconUrl?: string
  appVersion?: string
}
```

Required fields are `protocolVersion`, `id`, `name`, `slug`, `owner`, `launchUrl`, and `capabilities`.

Optional fields are `description`, `iconUrl`, and `appVersion`.

The registry normalizes and validates each manifest at startup. It derives `allowedOrigin` from `new URL(launchUrl).origin`. The manifest does not accept a second origin field because two origin fields can disagree.

The registry rejects these values:

- `launchUrl` with a non-HTTPS scheme. Local development may allow `http://localhost` through an explicit development-only configuration.
- A launch URL with a fragment. Garden owns the fragment because it carries the short-lived launch token.
- An empty or duplicate app ID or slug.
- A capability outside the shared capability union.
- An `iconUrl` with a different origin unless the implementation adds an explicit image allowlist.
- A launch URL whose origin is the Garden origin. Version 0.1 relies on a cross-origin iframe boundary.

Every registered app must request `identity:read` and `workspace:read`. Garden adds those capabilities to the effective session only when the manifest requests both. They are required because the session endpoint returns the verified launch context. A manifest that does not need that context is outside the v0.1 mini-app contract.

**Why derive the origin.** The launch URL is the one registered location that Garden actually loads. Deriving the origin from it prevents a manifest from authorizing one origin while loading another. The same derived value drives CORS, `postMessage`, and the frame policy.

The public discovery response excludes internal registration details. It may include `id`, `name`, `slug`, `description`, `iconUrl`, `appVersion`, and `capabilities`. It must not include raw session tokens, token hashes, database fields, or deployment secrets.

## 6. Launch flow

The launch flow is:

1. The user opens Garden. The `_authenticated` route guard requires a Better Auth session.
2. The user selects a registered mini-app from the Garden app list.
3. Garden resolves the app by its immutable ID or registered slug. The server reads the registry. The browser does not supply a trusted launch URL.
4. Garden resolves the active workspace through the existing request context. An explicit `X-Workspace-ID` is accepted only after `requireWorkspaceAccess` confirms that the current user belongs to that workspace.
5. Garden creates a short-lived mini-app session. The session stores the app ID, user ID, workspace ID, effective capabilities, issued time, expiry time, and a hash of the bearer token.
6. Garden renders the registered launch URL inside a sandboxed iframe. Garden puts the raw launch token in the URL fragment, never in the query string.
7. The mini-app loads `@garden/sdk`. The SDK removes the fragment from its own history, keeps the token in memory, and sends a `ready` bridge request to the Garden host.
8. Garden validates the message source, message origin, protocol version, app registration, and iframe instance. Garden sends an `init` response with verified user, workspace, app, capability, and expiry context. The response does not contain the raw token.
9. The SDK calls `GET /api/mini-apps/v1/session` with the in-memory bearer token. This confirms that the token is valid and gives the app a current context. The SDK rejects initialization when this request fails.
10. The mini-app frontend calls its own backend for product data. The LMS frontend calls the LMS service for courses, lessons, assessments, progress, and competence.

### Trust boundaries

| Boundary | Trusted input | Untrusted input |
| --- | --- | --- |
| Garden host route | Better Auth session and server registry | Browser app slug and workspace hints until the server checks them |
| Garden API | Garden session row and current membership query | Bearer token until the server looks up its hash |
| Garden iframe host | Registered iframe window and registered app origin | Every `postMessage` payload |
| Mini-app frontend | Garden bridge response after origin and source checks | Browser-visible context before validation |
| Mini-app backend | Successful Garden API response | User ID, workspace ID, role, and capability values sent by the browser |
| LMS domain service | LMS session and LMS database | Garden context until the LMS backend validates it |

**Why.** Garden creates the session on the server because the browser must not choose the app URL, user subject, workspace subject, or capabilities. Garden stores a hash because the raw bearer value is useful only to the holder and must not become a database secret. The fragment carries the token because browsers do not send URL fragments in HTTP requests or normal referrer headers. The SDK removes the fragment after startup because a short-lived credential should not remain in browser history.

The app backend may pass the Garden bearer token to Garden from a server-to-server request. The app backend must validate the response before it creates an app session. It must not trust user, workspace, role, or capability values posted directly by the browser.

The launch response also includes a non-secret session ID. The Garden host keeps that ID, never the bearer token, so it can revoke the launch session when the iframe closes or the workspace changes.

## 7. Rendering and hosting

### Recommendation

Version 0.1 uses a cross-origin iframe. Garden owns the iframe and its frame policy. The mini-app owns the document inside the iframe.

**Why Garden chooses this boundary.** The LMS is an independently developed web product. Its frontend may use a different framework, CSS system, build pipeline, and release schedule. An iframe lets Garden host that product without importing its code or sharing its JavaScript runtime. The cross-origin boundary prevents the LMS from reading the Garden DOM or Garden cookies. The host bridge gives the LMS the small set of Garden actions it needs without exposing those internals.

**Reference evidence.** [Shopify App Home](https://shopify.dev/docs/apps/build/app-home) documents a developer-hosted iframe as the recommended model for most embedded apps and pairs it with App Bridge. [Shopify's cross-frame security guidance](https://shopify.dev/docs/apps/build/security/app-server/validate-cross-frame-messages) documents exact `event.origin` and `event.source` checks. [Zoho Creator's Embed Element](https://help.zoho.com/portal/en/kb/creator/developer-guide/pages/snippets/articles/add-and-configure-an-embed-element) documents iframe embedding for external forms, widgets, and websites. [Telegram Mini Apps](https://core.telegram.org/bots/webapps) documents host initialization data, host events, viewport controls, and server-side validation of initialization data. These references support the boundary pattern. They do not define Garden's identity or capability contract.

Garden renders:

- The Garden shell, sidebar, workspace menu, top bar, and app navigation.
- The iframe container, loading state, error state, focus state, and close behavior.
- The host bridge and the Garden session API.

The mini-app renders:

- Its full product interface inside the iframe.
- Its own loading, empty, error, and domain states.
- Its own backend calls and domain data.

The user sees one Garden shell with the mini-app content in the main content area. The browser does not merge the two JavaScript runtimes.

### Iframe decision and security properties

The current repo already uses iframe isolation for document previews and an internal document editor. That code proves that Garden can own an iframe lifecycle and bridge. The document bridge uses `postMessage` with `'*'` because its source is a same-page `srcdoc` sandbox. Mini-apps require a stricter protocol with an exact origin. The document bridge is a precedent for lifecycle ownership, not a protocol to copy unchanged.

The iframe keeps the independent frontend, CSS, dependency graph, and release cycle outside the Garden bundle. It also gives Garden a clear boundary for XSS, DOM access, and app failure.

**Why Garden does not choose a shared runtime.** Module Federation and hosted UI extensions can reduce frame overhead, but they move dependency and failure ownership into a shared runtime. Garden has no current loader, extension manifest, or runtime compatibility policy. The LMS does not need those features to prove the product boundary. The iframe solves the current integration problem with fewer new platform rules.

### Rejected alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| Render the LMS as a Garden route | Reject | It couples Garden routing, bundling, domain data, and LMS release work. It does not define a reusable external app boundary. |
| Module Federation | Reject for v0.1 | It shares runtime and dependency state across independently released products. It adds version, loading, and failure rules before the LMS needs them. |
| Open the app in a new tab | Reject as the primary mode | It loses the Garden shell, host bridge, and workspace continuity. It can remain a future fallback for apps that cannot run in a frame. |
| Same-origin reverse proxy | Reject for v0.1 | It reduces one browser boundary, but it adds deployment, cookie, cache, and path ownership rules that the current repo does not have. |
| Arbitrary plugin code in the Worker | Reject | It gives external app code access to the Garden runtime and secrets. It is outside the current security model. |

### Frame rules

The host uses:

```html
<iframe
  sandbox="allow-forms allow-scripts allow-same-origin"
  referrerpolicy="no-referrer"
  title="Learning"
  src="https://registered-app.example/garden#garden_launch=...&garden_origin=https%3A%2F%2Fgarden.example"
></iframe>
```

The actual launch URL comes from the normalized registry. Garden adds no `allow-top-navigation` permission in v0.1. The app asks the host to navigate through the bridge.

`allow-same-origin` is required for the app to keep its own origin and for origin checks to work. The registry rejects a same-origin app, so the app cannot combine `allow-scripts` and same-origin access to escape the sandbox against the Garden document.

**Why these frame attributes.** `sandbox` limits the app document even after Garden has approved its origin. `allow-popups` is omitted because v0.1 has no approved new-tab flow. `referrerpolicy="no-referrer"` prevents the Garden route from becoming referrer data at the app origin. The host keeps navigation in the bridge so the app cannot replace the Garden document or leave the workspace without an explicit host action.

Garden sets the Content Security Policy `frame-src` allowlist from registered app origins. The policy must not use `*`.

The mini-app response must set `Content-Security-Policy: frame-ancestors <garden-origin>` for each deployed Garden origin that may host it. The mini-app must not send `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN`, because those values would reject the approved cross-origin Garden frame. Garden's `frame-src` policy controls what Garden may load. The app's `frame-ancestors` policy controls which parent may embed it.

## 8. Authentication and identity

### Garden identity

Garden keeps the current identity path:

- Better Auth owns the browser session and session cookie.
- `apps/web/src/lib/server/context.ts` binds auth to the incoming request.
- `apps/web/src/lib/server/control-plane.ts` resolves the current user and workspace.
- `requireWorkspaceAccess` in `apps/web/src/lib/server/control-plane.ts` and the `WorkspaceAccess` service in `apps/web/src/lib/server/workspace-access.ts` enforce membership.
- Better Auth organizations remain the Garden workspace model.

The mini-app session is a delegated Garden session. It does not replace Better Auth and it does not become a general Garden login token.

**Why.** Better Auth already owns sign-in, cookies, users, organizations, and active organization state in Garden. Replacing that path for mini-apps would create two identity lifecycles and two revocation rules. A scoped session preserves the existing authority and limits the new credential to one app, one user, and one workspace.

### Session token

Garden issues one high-entropy opaque bearer token for each launch. Garden stores only a SHA-256 hash of the token. Garden does not put the token in a query parameter, log field, referrer, analytics event, or bridge `init` payload.

The v0.1 session row has this shape:

```text
mini_app_session
  id             UUID primary key
  app_id         text not null
  user_id        UUID not null
  workspace_id   UUID not null
  token_hash     text not null unique
  capabilities   text[] not null
  issued_at      timestamp with time zone not null
  expires_at     timestamp with time zone not null
  revoked_at     timestamp with time zone null
```

The database schema must reference the existing `user` and `organization` rows. The app ID is checked against the server registry because v0.1 has no app table.

The initial token lifetime is ten minutes. This covers iframe load and the mini-app backend bootstrap. It is a launch lifetime, not an app session lifetime. The value must be one named configuration value. After bootstrap, the app creates its own session or uses a server-side Garden token holder. Garden can shorten the value after launch latency evidence exists. Every request also checks the current workspace membership, so removing a member invalidates access before the expiry time.

Version 0.1 supports explicit revocation. The host calls `POST /api/mini-apps/:appId/session/revoke` with the launch session ID when it closes the iframe or changes workspace. The operation is idempotent. It checks the current Garden user, app ID, and session owner before setting `revoked_at`. A close operation remains safe if the revoke request fails because the bearer still expires and every bearer request checks membership.

The host keeps the token in the iframe fragment only until SDK initialization. The SDK removes the fragment with `history.replaceState` and keeps the token in memory. The SDK never writes the token to `localStorage`, IndexedDB, URL query parameters, or analytics. The host keeps only the non-secret session ID for revocation.

**Why the app does not use the Garden cookie.** The app runs on another origin, so it cannot rely on Garden's cookie session. Browser third-party cookie rules also vary by browser and deployment. The bearer session gives the app API an explicit credential and lets the LMS backend validate Garden identity without receiving the Better Auth cookie.

**Why email is excluded.** The LMS can map a learner with the stable Garden user ID. Email is personally identifiable data and is not required for the platform boundary. Version 0.1 therefore returns no email field. A future `identity:email` capability must be approved before Garden sends email to an app.

### Context fields

The validated session context contains:

```ts
interface GardenMiniAppContext {
  protocolVersion: '0.1'
  app: {
    id: string
    name: string
    slug: string
  }
  user: {
    id: string
    name: string
    avatarUrl: string | null
  }
  workspace: {
    id: string
    name: string
    slug: string
  }
  membership: {
    role: 'owner' | 'admin' | 'member'
  }
  capabilities: readonly GardenMiniAppCapability[]
  issuedAt: string
  expiresAt: string
}
```

Garden reads the current user and workspace fields when it serves the session endpoint. The app must use the stable Garden user ID for identity mapping. The LMS must decide whether it stores that ID as its external subject or maps it to its own learner ID.

The app must treat the context as verified input from Garden only after the bridge and HTTP session checks succeed. The app must not treat a user ID or workspace ID from its own URL, form, or request body as an authority.

### Backend identity

The LMS backend must validate the Garden bearer token with `GET /api/mini-apps/v1/session` before it creates or refreshes an LMS session. It must then use its own session and its own authorization checks for LMS data. Garden does not receive LMS cookies, LMS access tokens, course data, assessment data, progress data, or competence data.

## 9. Permissions

Garden calls these app capabilities. The existing Better Auth workspace permissions remain the authorization model for Garden product resources. The two models must not be merged into one unstructured permission list.

**Why.** A Garden permission answers whether a user may change a Garden resource. An app capability answers whether a registered app may ask for a Garden capability. The actor and the resource differ. Separate types keep those checks at the correct boundary.

Version 0.1 defines these capability names:

| Capability | v0.1 status | Meaning |
| --- | --- | --- |
| `identity:read` | Enabled | Read the current Garden user from the session context |
| `workspace:read` | Enabled | Read the current Garden workspace and membership role |
| `navigation:request` | Enabled | Ask the Garden host to open an allowed internal Garden path |
| `ui:resize` | Enabled | Ask the Garden host to resize the iframe within host limits |
| `ui:notify` | Enabled | Ask the Garden host to show a bounded notification |
| `tasks:read` | Reserved | No v0.1 endpoint |
| `tasks:write` | Reserved | No v0.1 endpoint |
| `files:read` | Reserved | No v0.1 endpoint |
| `notifications:write` | Reserved | Use `ui:notify` for host UI feedback in v0.1 |
| `identity:email` | Reserved | Email is excluded from the v0.1 context |

The effective capability set is the intersection of the manifest capabilities and the capabilities enabled by the v0.1 platform. A session never gains a capability because the browser asks for it.

**Why this small set.** The LMS needs identity and workspace context. It does not need Garden tasks, files, connectors, or notifications to prove the app boundary. The host UI commands solve frame integration problems. Adding data capabilities later requires a real Garden resource contract, a Garden permission check, and an app use case that justifies the new authority.

All signed-in workspace members may launch a registered app in v0.1. Garden checks membership for the selected workspace. The platform owner controls which apps appear in the registry. Garden does not add an `app:manage` Better Auth permission until it adds user-managed installation or app administration.

Every future Garden API endpoint must check the session capability and the existing workspace permission that protects the underlying Garden resource. An app capability alone must never bypass a workspace permission.

## 10. Garden API

### API placement

The existing Garden API uses `/api/...` routes. New mini-app endpoints use the same base and a dedicated namespace. The namespace is versioned only for app-facing capability calls:

- Host control calls use `/api/mini-apps/...` and the current Garden session cookie.
- App capability calls use `/api/mini-apps/v1/...` and the short-lived bearer token.

The app-facing endpoint does not reuse `/api/me` or `/api/workspaces`. Those endpoints use Garden's browser cookie and return host-oriented shapes. The mini-app session endpoint returns one verified, app-scoped context and avoids a second browser identity flow.

**Why one session endpoint.** Identity and workspace are one launch context. Returning them together prevents the app from combining values from two requests with different workspace state. It also gives the SDK one refresh operation and gives the backend one validation call.

The new contract belongs in an Effect `HttpApi` group in apps/web/src/lib/api/mini-apps-contract.ts. `apps/web/src/lib/api/garden-api-contract.ts` composes that group into `GardenApi`. The existing `/api/$` route remains the thin TanStack Start host. Request schemas, response schemas, and error schemas are defined once in the group.

**Why.** The repo already uses this path for typed API groups, request-scoped services, and generated clients. Adding a second router would make auth, errors, CORS, and schema ownership harder to trace. The app API stays in the same Worker request context and can reuse the existing workspace access services.

### Endpoint summary

| Method | Path | Caller | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/mini-apps` | Garden session cookie | Discover registered apps available to the current workspace |
| `GET` | `/api/mini-apps/:appId` | Garden session cookie | Read one sanitized registered manifest |
| `POST` | `/api/mini-apps/:appId/launch` | Garden session cookie | Create a scoped mini-app session for the active workspace |
| `POST` | `/api/mini-apps/:appId/session/revoke` | Garden session cookie | Revoke one launch session on close or workspace change |
| `GET` | `/api/mini-apps/v1/session` | `Authorization: Bearer <token>` | Validate the session and return current Garden context |
| `OPTIONS` | `/api/mini-apps/v1/session` | Browser preflight | Return CORS headers for the registered app origin |

No endpoint accepts an arbitrary launch URL. No endpoint accepts a user ID or workspace ID as an authority.

### `GET /api/mini-apps`

Purpose: populate the Garden app list and app navigation.

Authentication: Better Auth session cookie. A valid workspace membership is required.

Request: No body. The existing `X-Workspace-ID` header may select a workspace. The server validates the header with `requireWorkspaceAccess`. If the header is absent, Garden uses the current active organization.

Response:

```ts
interface MiniAppListResponse {
  apps: Array<{
    id: string
    name: string
    slug: string
    description?: string
    iconUrl?: string
    appVersion?: string
    capabilities: readonly GardenMiniAppCapability[]
  }>
}
```

Errors: `401 unauthenticated`, `403 workspace_access_denied`, and `404 workspace_not_found`.

### `GET /api/mini-apps/:appId`

Purpose: resolve one registered app before navigation or display a detail state.

Authentication: Better Auth session cookie and workspace membership.

Request: The path uses the immutable app ID. The server ignores any browser-provided launch URL.

Response: The sanitized manifest plus the derived `origin`. The response does not include a token or session row.

Errors: `401 unauthenticated`, `403 workspace_access_denied`, and `404 mini_app_not_found`.

### `POST /api/mini-apps/:appId/launch`

Purpose: create the session that allows one app launch.

Authentication: Better Auth session cookie. The request must have an `Origin` header equal to the Garden origin. The server resolves workspace membership before it creates a session.

Request: Empty JSON object. The selected workspace travels through the existing `X-Workspace-ID` request header. This keeps workspace selection consistent with `ApiTransport` and the current workspace store.

Response:

```ts
interface MiniAppLaunchResponse {
  app: {
    id: string
    name: string
    slug: string
    launchUrl: string
    origin: string
  }
  sessionId: string
  sessionToken: string
  context: GardenMiniAppContext
}
```

The host uses `sessionToken` once to build the iframe fragment. It must not store or log the response. The API response uses `Cache-Control: no-store`.

Errors: `400 invalid_origin`, `401 unauthenticated`, `403 workspace_access_denied` or `mini_app_capability_denied`, `404 mini_app_not_found`, and `503 mini_app_session_unavailable`.

### `POST /api/mini-apps/:appId/session/revoke`

Purpose: revoke one launch session after the host closes the app or before it replaces the iframe for a workspace change.

Authentication: Better Auth session cookie and an exact Garden `Origin` header. The current user must own the session. The request does not use the new workspace ID because it revokes the old session by its stored session ID.

Request:

```ts
interface MiniAppRevokeRequest {
  sessionId: string
}
```

Response: `204 No Content`. Repeating the request for the same session is successful. The host does not retry with the bearer token.

Errors: `400 invalid_origin`, `401 unauthenticated`, `403 mini_app_session_owner_mismatch`, and `404 mini_app_session_not_found`.

**Why this endpoint exists in v0.1.** Workspace changes and app close events should stop a still-valid launch credential. The session ID gives the host a revocation handle without retaining the bearer token. The endpoint is host-only and does not create a general app logout API.

### `GET /api/mini-apps/v1/session`

Purpose: validate the in-memory bearer token and return current context to the app frontend or app backend.

Authentication: `Authorization: Bearer <sessionToken>`. Garden does not accept the Better Auth cookie for this endpoint. The server hashes the bearer value, loads the session row, checks expiry and revocation, checks current user membership in the stored workspace, resolves the registered app, and checks the requested capability for the endpoint.

This endpoint is the bootstrap exception to ordinary capability dispatch. It requires both `identity:read` and `workspace:read`, which are mandatory manifest capabilities in v0.1. It does not accept a browser-supplied capability name.

Request: No body.

Response: `GardenMiniAppContext`.

Response headers for browser callers:

```text
Access-Control-Allow-Origin: <registered app origin>
Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-ID
Access-Control-Allow-Methods: GET, OPTIONS
Vary: Origin
Cache-Control: no-store
```

Garden returns an exact registered origin. It never returns `Access-Control-Allow-Origin: *` for a bearer endpoint.

Errors: `401 mini_app_session_missing`, `401 mini_app_session_expired`, `401 mini_app_session_revoked`, `403 workspace_membership_revoked`, `403 capability_denied`, and `404 mini_app_not_found`.

### Error schema and wire shape

Mini-app errors use tagged Effect error schemas in the browser-safe contract package. The HTTP group attaches an explicit status to each tagged error. The wire encoder returns the existing Garden `{ error, code }` shape used by the host routes:

```ts
interface GardenApiError {
  error: string
  code: string
}
```

The v0.1 error table is:

| Status | Code | Tagged error meaning |
| --- | --- | --- |
| 400 | `invalid_origin` | Garden request origin or manifest input is invalid |
| 401 | `mini_app_session_missing`, `mini_app_session_expired`, `mini_app_session_revoked` | The Garden session is not usable |
| 403 | `workspace_access_denied`, `workspace_membership_revoked`, `capability_denied`, `mini_app_session_owner_mismatch` | The actor or app is not allowed |
| 404 | `mini_app_not_found`, `mini_app_session_not_found` | The registered app or session does not exist |
| 503 | `mini_app_session_unavailable` | Garden cannot create or load the session row |

Each tagged error has a stable literal `code` and a safe `message`. The HTTP handler maps `message` to `error`. Provider secrets, raw SQL, bearer tokens, and internal stack traces never reach the response. The API contract defines these error variants in the same contract package as the success schemas.

## 11. Garden SDK

The SDK is a new browser package named `@garden/sdk`. It has no React dependency and does not render UI. It provides a typed client for the Garden session and the host bridge.

**Why.** Garden hosts more than React surfaces in the future, and the LMS frontend is independently owned. A browser-only, framework-neutral package keeps the integration contract smaller. The host runtime renders the app. The SDK only reads platform context, calls the app-facing API, and sends validated host requests.

The first public shape is:

```ts
import { Garden } from '@garden/sdk'

const garden = await Garden.init({
  gardenOrigin: 'https://garden.example',
})

const user = garden.identity.currentUser()
const workspace = garden.workspace.current()

await garden.navigation.open('/home')
garden.ui.resize({ height: 720 })
garden.ui.notify({ level: 'success', message: 'Saved' })
```

The SDK must reject initialization if the protocol version, token, app identity, parent origin, or session response is invalid.

### SDK methods

| Method | Transport | v0.1 behavior |
| --- | --- | --- |
| `Garden.init({ gardenOrigin })` | HTTP plus host bridge | Read the launch fragment, validate the configured Garden origin and session, complete the bridge handshake, and return a client |
| `garden.session.refresh()` | HTTP API | Call `GET /api/mini-apps/v1/session` with the in-memory token and replace the cached context |
| `garden.identity.currentUser()` | Cached validated context | Return the current Garden user |
| `garden.workspace.current()` | Cached validated context | Return the current Garden workspace and membership role |
| `garden.navigation.open(path)` | Host bridge | Ask the host to open a validated Garden-relative path |
| `garden.ui.resize(input)` | Host bridge | Ask the host to resize the frame within host limits |
| `garden.ui.notify(input)` | Host bridge | Ask the host to show a bounded Garden notification |
| `garden.ui.close()` | Host bridge | Ask the host to close the app route |
| `garden.events.on(name, listener)` | Host bridge | Subscribe to `focus`, `blur`, `workspaceChanged`, or `close` |

The SDK has no `garden.courses`, `garden.lessons`, `garden.assessments`, or `garden.competence` namespace. Those belong to the LMS SDK and LMS API.

`Garden.init` accepts one optional app-owned bootstrap callback:

```ts
const garden = await Garden.init({
  bootstrap: async ({ sessionToken, context }) => {
    await appApi.createSessionFromGarden(sessionToken, context)
  },
})
```

The SDK invokes the callback once during initialization and then clears the token from the launch fragment. The SDK does not return the raw token from the initialized client. The callback exists so an app backend can validate the Garden session and create an app-owned session without each app reimplementing fragment parsing.

The callback must send the token to the app backend over the app's own secure transport. The app backend must validate the token with Garden. The context argument is a convenience value and is not an authorization source.

The SDK must keep the token in memory. The SDK must expose no method that returns the raw token after initialization. The v0.1 bootstrap callback is the app-owned path for passing the token to the app backend. The SDK team may add a higher-level app helper later, but that does not change the Garden protocol.

## 12. Host bridge

The host bridge is a JSON `postMessage` protocol between the Garden host window and the mini-app iframe. The SDK implements the app side. Garden implements the host side.

**Why.** Parent-owned actions such as Garden navigation, resize, notifications, and close must not depend on the LMS knowing Garden component internals. `postMessage` crosses the frame boundary without sharing the Garden DOM. Request IDs make concurrent calls and late responses distinguishable. Exact origins and source checks keep the transport from becoming an ambient message bus.

The channel is:

```text
garden:mini-app
```

Every message uses this envelope:

```ts
interface GardenBridgeMessage {
  channel: 'garden:mini-app'
  protocolVersion: '0.1'
  kind: 'request' | 'response' | 'event'
  requestId?: string
  method?: string
  ok?: boolean
  payload?: unknown
  error?: {
    code: string
    message: string
  }
}
```

The app sends a request ID for every request. The host returns exactly one response for every supported request. Events do not use a request ID.

The shared contract narrows this envelope into a discriminated union. It defines `ready`, `resize`, `notify`, `navigate`, and `close` as app-to-host requests. It defines `init` as the host response method. It defines `focus`, `blur`, `workspaceChanged`, and `close` as host-to-app events. A method schema fixes the payload shape for each member. `payload: unknown` exists only on the outer transport envelope and is never used without method-specific validation.

The minimum request union is:

```ts
type GardenBridgeRequest =
  | { kind: 'request'; method: 'ready'; requestId: string; payload: { sdkVersion: string; nonce: string } }
  | { kind: 'request'; method: 'resize'; requestId: string; payload: { height: number } }
  | { kind: 'request'; method: 'notify'; requestId: string; payload: { level: 'info' | 'success' | 'warning' | 'error'; message: string } }
  | { kind: 'request'; method: 'navigate'; requestId: string; payload: { path: string } }
  | { kind: 'request'; method: 'close'; requestId: string; payload: Record<string, never> }

type GardenBridgeResponse =
  | { kind: 'response'; method: 'init' | GardenBridgeRequest['method']; requestId: string; ok: true; payload: unknown }
  | { kind: 'response'; method: 'init' | GardenBridgeRequest['method']; requestId: string; ok: false; error: { code: string; message: string } }
```

The implementation must add the corresponding event union and replace `unknown` with method-specific response payloads where a method has a response. The SDK and host validate the same schemas from the browser-safe contract package.

### Handshake

1. The host creates the iframe and records the iframe window, app ID, and registered app origin.
2. The SDK reads the `garden_launch` fragment and the `garden_origin` value. The latter is a non-secret target hint. The SDK compares it to the `gardenOrigin` value supplied in its deployment configuration before it uses it.
3. The SDK sends `ready` to the configured Garden origin.
4. Garden accepts the request only when `event.source === iframe.contentWindow` and `event.origin === registered app origin`.
5. Garden validates the request schema and sends `init` with the verified context.
6. The SDK accepts `init` only when `event.source === window.parent` and `event.origin === the configured Garden origin.
7. The SDK validates the context and completes `Garden.init()`.

The initial app-to-parent message may use the origin hint only when it equals the configured Garden origin. Garden still validates the actual `MessageEvent.origin`. The host never accepts `'*'` as an incoming origin.

**Why the SDK needs configured origin data.** A URL fragment is browser-visible input. It cannot choose which parent origin the SDK trusts. Deployment configuration gives each app environment an allowlisted Garden origin before the app receives any runtime message.

### v0.1 bridge methods

| Direction | Method or event | Payload | Host rule |
| --- | --- | --- | --- |
| App to host | `ready` | SDK version and a random handshake nonce | Starts initialization. The nonce is correlation data, not authentication. |
| Host to app | `init` response | `GardenMiniAppContext` | Sends verified context. Never sends the raw session token. |
| App to host | `resize` | `{ height: number }` | Clamp to host bounds. Ignore invalid or excessive values. |
| App to host | `notify` | `{ level, message }` | Validate the level and message length. Garden renders the notification. |
| App to host | `navigate` | `{ path: string }` | Accept only a Garden-relative path in the host allowlist. Reject absolute URLs and protocol-relative URLs. |
| App to host | `close` | `{}` | Close the app route and return to the Garden home route. |
| Host to app | `focus` | `{}` | Report iframe focus. |
| Host to app | `blur` | `{}` | Report iframe blur. |
| Host to app | `workspaceChanged` | `{ workspaceId: string }` | Tell the app that the old session is no longer valid. Garden then reloads or closes the iframe. |
| Host to app | `close` | `{ reason: string }` | Tell the app that the host removed it. |

Bridge methods are host operations. They do not make the SDK a renderer. Garden remains responsible for the shell and the actual navigation, notification, resize, and close behavior.

### Validation

Garden validates every incoming message at the browser boundary. The SDK validates every incoming host message. The implementation uses the shared protocol schema from the browser-safe contract package. The host does not cast `event.data` to a message type.

The host ignores messages that fail any of these checks:

- `channel` and `protocolVersion` match.
- `kind` is supported.
- `requestId` is present and matches `^[A-Za-z0-9_-]{1,64}$` for a request or response.
- The event source is the current iframe window.
- The event origin matches the registered app origin.
- The method is enabled by the app capability set.
- The payload matches the method schema.

The message union is discriminated by `kind`, `method`, and direction. Version 0.1 defines these exact request payloads:

| Direction | Method | Payload schema |
| --- | --- | --- |
| App to host | `ready` | `{ sdkVersion: string, nonce: string }`, with a nonce of 16 to 128 characters |
| App to host | `resize` | `{ height: integer }`, with `240 <= height <= 2400` |
| App to host | `notify` | `{ level: 'info' | 'success' | 'warning' | 'error', message: string }`, with 1 to 240 characters |
| App to host | `navigate` | `{ path: string }`, matching the host Garden path allowlist |
| App to host | `close` | `{}` |

Responses require the same `requestId` as the request. A successful response has `ok: true` and a method-specific payload. A failed response has `ok: false` and exactly one `{ code, message }` error. Events have no `requestId`, `ok`, or `error`. Unknown methods, extra authorization fields, invalid payloads, and late responses are ignored or rejected with a typed bridge error.

The v0.1 navigation allowlist accepts Garden-relative paths for `/home`, `/tasks`, `/inbox`, `/files`, `/teams`, `/agents`, `/skills`, `/connectors`, and `/workflows`, including one dynamic child segment and a query string. It rejects absolute URLs, protocol-relative URLs, fragments, and paths outside this list. The host stores the allowlist in one constant shared by bridge validation and tests.

**Why these bounds.** The height range prevents an app from collapsing its content or taking over the shell. The notification bound protects the host UI from unbounded app text. The path allowlist prevents a bridge request from becoming an open redirect or an app-controlled navigation API.

## 13. Lifecycle

Version 0.1 has these lifecycle states:

```text
registered -> launching -> ready -> active
active -> backgrounded
active -> closing -> closed
launching -> failed
ready -> expired
```

Garden owns the host state. The app observes events. The app cannot move itself back to `ready` by sending an arbitrary event.

The user-visible events are:

- `launch` when Garden creates the iframe.
- `ready` when the bridge handshake and HTTP session validation succeed.
- `focus` and `blur` when the iframe gains or loses focus.
- `workspaceChanged` when the Garden workspace changes. Garden revokes the old app session, closes the old iframe, and creates a new session for the new workspace.
- `close` when the app or Garden closes the host route.

`install` and `uninstall` are not v0.1 lifecycle states because registration is platform-controlled and there is no installation table. A future installation model can add them without changing the launch protocol.

**Why.** The lifecycle lists only states that change host behavior or app authorization. A larger lifecycle would describe future product concepts without giving the host a rule to enforce.

## 14. Security

### Origin validation

The registry derives one allowed origin from the launch URL. Garden uses that origin for the iframe `src`, `frame-src` policy, CORS response, and bridge message validation. The host compares the actual `MessageEvent.origin` to this value. The app compares the parent origin to the configured Garden origin, not to a browser-provided fragment value.

The host never uses `'*'` for a mini-app bridge response. The host never accepts a message because it has the correct channel name alone.

**Why.** Shopify's embedded app security guidance makes the same exact-origin and source checks. The current Garden document editor uses `'*'` because its internal `srcdoc` frame has an opaque origin and the bridge carries no app credential. Mini-apps carry a bearer credential and user context, so they need the stricter rule.

### Iframe isolation

Every mini-app is cross-origin and sandboxed. Garden does not mount app React components, import app bundles, or expose Garden DOM nodes. A mini-app cannot read the parent DOM or Garden cookies.

### Token leakage

The session token is a bearer credential. The implementation must:

- Put it in the fragment, not the query string.
- Set `referrerpolicy="no-referrer"` on the iframe.
- Return `Cache-Control: no-store` from launch and session responses.
- Hash it before database storage.
- Keep it in memory only.
- Redact it from logs, traces, analytics, error messages, and support output.
- Never send it in the bridge `init` response.
- The host calls the v0.1 revoke endpoint on iframe close and workspace change. Expiry and membership checks remain the authority if that call fails.

An app's own JavaScript can read the token while it initializes. Garden treats the app origin as the token holder. An XSS bug in the app can therefore access the app's Garden capabilities until the token expires or is revoked. The app team owns that risk.

### XSS and content boundaries

Garden treats the app as untrusted HTML and JavaScript. Garden does not interpolate app content into Garden HTML. Bridge payloads use structured cloneable JSON values. The host validates notification text and navigation paths. The app must protect its own DOM with its own Content Security Policy.

### CSRF

The cookie-authenticated launch endpoint requires an exact Garden `Origin` header and a JSON content type. It does not accept cross-site form posts. The bearer-authenticated session endpoint does not use cookies, so CSRF does not authorize a request to that endpoint.

Garden must keep the existing Better Auth and request-context auth checks. The `Origin` check adds a boundary guard. It does not replace user authentication or workspace membership checks.

### Permission enforcement

The session response is informative. The server enforces capabilities and workspace membership on every app API request. A browser-supplied capability list, role, user ID, or workspace ID never grants access.

Garden must check the stored app session and the current membership row on every bearer request. Workspace switching revokes the old app session through the host-only revoke endpoint, closes the old iframe, and creates a new session for the new workspace. If the revoke request fails, the host still closes the iframe; expiry and membership checks remain server-side protections.

### App isolation and trust

Every registered app is treated as untrusted relative to Garden, even when the app is built by the same organization. Registration means that a platform maintainer accepted its origin and requested capabilities. Registration does not give the app Garden Worker access, database access, R2 access, Durable Object access, agent access, connector tokens, or secrets.

### Backend-to-backend calls

The LMS backend may call the Garden session endpoint with the short-lived token. Garden returns only the app context allowed by the manifest. Garden does not call the LMS backend with Garden secrets. The LMS service owns its service credentials, database, data retention, and authorization.

## 15. LMS walkthrough

The LMS is the reference implementation.

1. The user opens the Garden Learning entry.
   - Garden owns the sidebar, app label, workspace selection, and route.
2. Garden resolves the LMS manifest.
   - Garden uses the immutable LMS app ID and registered launch URL.
3. Garden launches the LMS frontend.
   - Garden verifies Better Auth identity and workspace membership, creates the scoped mini-app session, and mounts the iframe.
4. The LMS initializes the Garden SDK.
   - The LMS SDK completes the bridge handshake and validates `GET /api/mini-apps/v1/session`.
   - The LMS backend may validate the same token once and create an LMS-owned learner session.
5. The LMS fetches courses.
   - The LMS frontend calls the LMS API. Garden does not call or model the LMS course API.
6. The user opens a lesson.
   - The LMS route, LMS API, and LMS database own the lesson lookup and authorization.
7. The LMS renders the lesson UI.
   - The LMS owns all lesson components and state inside the iframe.
8. The user completes an assessment.
   - The LMS validates and stores the assessment attempt.
9. The LMS stores progress and competence.
   - The LMS owns progress, completion, and competence records. Garden receives none of these records in v0.1.
10. Workstream later consumes competence.
   - Workstream reads an authorized LMS contract. Garden is not the competence broker unless a later product decision assigns it that role.

The only Garden data required for the LMS pilot is the stable Garden user ID, the current workspace ID, the current workspace role, and the display identity fields approved by David's identity specification.

**Why.** This keeps the pilot at the platform boundary. Garden supplies identity and workspace context. The LMS remains the authority for all learning entities and outcomes. Workstream can later consume competence from the LMS without coupling either service to Garden's internal learning model.

## 16. Repo mapping

### Reuse now

| Concern | Existing Garden primitive | Contract use |
| --- | --- | --- |
| Browser identity | Better Auth in `apps/web/src/lib/auth/instance.ts` and `apps/web/src/lib/auth/client.ts` | Keep Garden sign-in and cookie sessions. |
| Request auth | `apps/web/src/lib/server/context.ts` and `apps/web/src/lib/server/session.ts` | Resolve the current Garden session from the incoming request. |
| Workspace resolution | `apps/web/src/lib/server/control-plane.ts` | Reuse active organization and `X-Workspace-ID` handling. |
| Workspace membership | `requireWorkspaceAccess` in `apps/web/src/lib/server/control-plane.ts` for route handlers; `WorkspaceAccess` in `apps/web/src/lib/server/workspace-access.ts` for Effect handlers | Enforce the workspace boundary for discovery, launch, and typed API requests. |
| Workspace client state | `packages/app-state/src/workspace/store.ts` and `apps/web/src/lib/api/state.ts` | Keep the host header aligned with the active workspace. |
| API transport | `apps/web/src/lib/api/transport.ts` | Add host-side mini-app discovery and launch calls. |
| Typed API composition | apps/web/src/lib/api/mini-apps-contract.ts, `apps/web/src/lib/api/garden-api-contract.ts`, and `apps/web/src/lib/server/garden-api.server.ts` | Define the mini-app group in its own contract file, compose it into `GardenApi`, and register its handlers in the existing router. |
| API route host | `apps/web/src/routes/api/$.ts` | Keep one Effect router under the existing splat route. |
| Shell | `apps/web/src/components/shell/app-shell.tsx` and `packages/ui/components/shell/app-sidebar.tsx` | Add a dynamic Garden Apps group without changing the presentational sidebar contract. |
| Navigation | `apps/web/src/features/navigation/nav-items.tsx`, `context.tsx`, and `app-link.tsx` | Use the existing link and navigation behavior for the host route. |
| Iframe precedent | `apps/web/src/features/artifacts/workspace-docs-editor.tsx` | Reuse lifecycle ownership and request correlation ideas. Tighten origin and schema validation for mini-apps. |
| Static registry pattern | `packages/connectors/src/registry.ts` | Reuse the registry shape and lookup approach only. Keep app registry semantics separate from connectors. |
| Permissions | Better Auth access control in `apps/web/src/lib/auth/instance.ts` and `apps/web/src/lib/server/workspace-permissions.ts` | Keep Garden resource permissions separate from app capabilities. |

### New modules

The implementation should add these focused boundaries:

- packages/mini-app-contract/src/ for manifest, capability, context, bridge, success, and tagged error schemas shared by Garden and `@garden/sdk`. This package has no database, server, or Garden runtime dependency.
- packages/db/src/schema/mini-apps.ts for the `mini_app_session` table. Generate the migration from the Drizzle schema.
- apps/web/src/lib/server/mini-apps/registry.ts for the normalized server registry.
- apps/web/src/lib/server/mini-apps/session.ts for token creation, hashing, lookup, expiry, revocation, and current membership checks.
- apps/web/src/lib/api/mini-apps-contract.ts for the Effect HTTP group. `apps/web/src/lib/api/garden-api-contract.ts` only composes this group into `GardenApi`.
- apps/web/src/lib/server/mini-apps-api.server.ts for request-scoped handlers and CORS response logic.
- apps/web/src/lib/api/mini-apps.ts for host-side discovery and launch calls.
- apps/web/src/features/mini-apps/mini-app-host.tsx for the iframe, bridge, loading state, error state, and close behavior.
- apps/web/src/routes/_authenticated/_app/apps.$appSlug.tsx for the authenticated host route.
- packages/sdk/src/ for the publishable `@garden/sdk` browser package. It depends on the browser-safe contract package and has no React, database, or server dependency.

Do not add mini-app behavior to `packages/agent-runtime`, `packages/connectors`, `WorkspaceRealtimeDO`, `AgentDO`, or a Workflow. Mini-app launch is a control-plane and browser-host concern.

### Data ownership

Garden owns the registry and launch session rows. The LMS owns all learning tables and learning APIs. Garden's shared types contain only platform context and protocol shapes. They must not contain LMS types.

## 17. Implementation plan

The API and SDK teams can work from these vertical slices.

### Phase 1. Contract and types

- Add the manifest, capability, context, bridge discriminated union, API response, and tagged error schemas in the browser-safe contract package.
- Add validation tests for duplicate IDs, invalid origins, unsupported capabilities, and malformed bridge messages.
- Add this decision record and the feature page.

Exit check: the host and SDK teams can import the same protocol types without importing app code.

### Phase 2. Static registry and discovery

- Add the normalized registry and the LMS manifest behind deployment configuration.
- Add `GET /api/mini-apps` and `GET /api/mini-apps/:appId`.
- Add the Garden Apps navigation group and the app route lookup.

Exit check: an authenticated workspace member sees the registered app metadata, and an unknown app ID returns the typed not-found error.

### Phase 3. Launch session

- Add the Drizzle `mini_app_session` schema and generated migration.
- Add token generation and hash lookup in the server service.
- Add `POST /api/mini-apps/:appId/launch`.
- Add `POST /api/mini-apps/:appId/session/revoke` and call it on close and workspace change.
- Add `GET /api/mini-apps/v1/session` with exact-origin CORS.
- Add tests for unauthenticated requests, foreign workspaces, expired sessions, revoked sessions, and membership removal.

Exit check: the host can create a session, and the app-facing endpoint returns the current user and workspace only for the registered bearer token.

### Phase 4. Host runtime and bridge

- Add the authenticated `apps.$appSlug` route.
- Add the iframe with the registered URL, sandbox, referrer policy, and frame origin policy.
- Implement the bridge handshake, request IDs, origin checks, capability checks, and host actions.
- Close and recreate the iframe when the Garden workspace changes.

Exit check: a test app can initialize, read Garden context, resize, notify, navigate to an allowed path, and close without access to the Garden DOM.

### Phase 5. SDK

- Publish `@garden/sdk` from the packages/sdk workspace package.
- Implement `Garden.init`, cached identity and workspace access, session refresh, bridge methods, lifecycle events, and typed errors.
- Keep the package browser-only and framework-neutral.

Exit check: the SDK integration test passes against the host bridge and a real `/api/mini-apps/v1/session` response.

### Phase 6. LMS proof

- Register the LMS launch URL and final app ID.
- Add the LMS frontend bootstrap and Garden SDK integration.
- Add LMS backend token validation and learner session creation.
- Verify course, lesson, assessment, progress, and completion flows entirely through the LMS service.
- Verify that Garden never receives LMS domain payloads.

Exit check: the LMS works inside Garden for two users in one workspace and one user in two workspaces. The second case proves that the launch session does not cross workspace boundaries.

## 18. Open decisions

### Must be decided before the LMS proof

- The immutable LMS app ID, Garden slug, deployed launch origin, and launch path.
- The exact Garden user fields approved by David for `identity:read`.
- Whether the LMS maps Garden workspace ID directly to an LMS tenant or uses a separate mapping table.
- Whether the LMS backend uses a short-lived Garden bearer token for each request or exchanges it once for an LMS-owned session.
- The initial app registry owner and the person who approves new app origins and capabilities.
- Security review of the ten-minute launch lifetime before production. Implementation uses ten minutes as the v0.1 configuration value.

### Can remain open in v0.1

- Whether app discovery later uses a database installation table.
- Whether apps can open in a new tab as an explicit fallback.
- Whether Garden adds server-to-server app credentials in addition to scoped bearer sessions.
- Whether the SDK later exposes React bindings.
- Whether the bridge later supports richer notifications, deep-link return paths, or app badges.
- Whether Garden adds per-workspace app visibility or per-role launch rules.

### Future extensions

- A database-backed app and installation registry.
- App review, marketplace, billing, and version upgrade policy.
- Multiple hosting modes such as new tab, same-origin proxy, or a controlled shared runtime.
- Signed protocol negotiation and a public key discovery endpoint if external app scale requires it.
- Capability grants for Garden tasks, files, connectors, and notifications.
- A platform event stream. The current bridge is request and event based only and does not become a second durable data channel.

The future extensions do not block the v0.1 iframe contract.

**Why.** The open items change installation, distribution, or capability breadth. They do not change the minimum fact that Garden hosts an app, authenticates the launch, validates the bridge, and leaves domain data with the app. Keeping them outside v0.1 prevents the LMS pilot from waiting on a marketplace or shared runtime.

## 19. First five engineering tickets

1. **Define shared mini-app protocol types.** Add the manifest, capability union, context, bridge discriminated union, API response, and tagged error schemas in packages/mini-app-contract/src/. Add validation tests. No database or UI work.

2. **Add the static registry and discovery API.** Add the normalized registry in apps/web/src/lib/server/mini-apps/registry.ts. Add the `miniApps` Effect API group in apps/web/src/lib/api/mini-apps-contract.ts, compose it into `GardenApi`, and add host discovery methods and tests.

3. **Add scoped launch sessions.** Add packages/db/src/schema/mini-apps.ts, generate the Drizzle migration, implement token hashing and lookup, and add the launch, revoke, and session endpoints. Prove membership, expiry, revocation, and workspace-switch checks with integration tests.

4. **Add the Garden host route and bridge.** Add the authenticated app route, dynamic app navigation, sandboxed iframe, exact-origin message validation, and host actions. Prove the lifecycle with a test app.

5. **Publish `@garden/sdk`.** Implement `Garden.init`, session refresh, context access, bridge methods, lifecycle subscriptions, and typed errors. Run the SDK against the real Garden host route and session API.

The LMS proof is ticket 6. It depends on tickets 1 through 5 and needs Bashir's LMS service contract.

**Why this order.** Shared types remove shape drift first. The registry then supplies an authoritative app identity. The session API proves the trust boundary before the host renders an app. The host and SDK can then test the same protocol. The LMS comes last because it is the consumer that proves the whole path.

## 20. Dependency order

```text
Ticket 1: shared contract types
    |
    +--> Ticket 2: registry and discovery
    |        |
    +--> Ticket 3: launch sessions and app API
             |
             +--> Ticket 4: host route and bridge
    |
    +--> Ticket 5: @garden/sdk
             |
             +--> Ticket 6: LMS proof of concept
```

Tickets 2 and 3 share the registry and contract types but should land in order because ticket 3 needs the normalized app identity and capability policy. Ticket 4 depends on the launch response. Ticket 5 can start after ticket 1, but the integration test needs ticket 4. Ticket 6 waits for the host, API, and SDK.

## 21. Missing information from Bashir and David

### Bashir

- The LMS launch origin and launch path for each environment.
- The LMS backend endpoint that will validate the Garden session and create an LMS learner session.
- The LMS user mapping rule. Confirm whether Garden `user.id` is the stable external subject.
- The LMS tenant mapping rule for Garden `workspace.id`.
- The identity fields the LMS needs beyond `user.id`, `name`, and `avatarUrl`. Email is excluded by the v0.1 contract.
- Whether LMS navigation needs Garden deep links or only the host `close` and `notify` commands.
- The LMS browser session choice for an iframe. Do not assume that an ordinary third-party cookie will work in every browser.

### David

- The authoritative identity field names and stability guarantees.
- The approved workspace context fields and membership role semantics.
- The required audit retention policy. v0.1 already defines ten-minute expiry and host-triggered revocation.
- The mapping between the mini-app capability names and the shared identity or permission specification.
- Whether a future `identity:email` capability is acceptable. It is not part of v0.1.
- The minimum user and workspace privacy policy for registered mini-apps.

## 22. Assumptions

- Garden and the LMS use HTTPS in deployed environments.
- The LMS frontend is deployed on an origin different from Garden.
- The first registered apps are platform-reviewed and configured by Garden maintainers.
- Every workspace member may launch the LMS in v0.1.
- Garden workspace identity is the current Better Auth organization identity.
- Garden can add one transient session table without changing the existing Better Auth session table.
- The LMS owns its own authentication after it validates the Garden launch session.
- Workstream consumes competence from the LMS through a later LMS-owned contract.
- The current Garden API error convention `{ error, code }` is acceptable for new mini-app endpoints.
- The API team can add one Effect `HttpApi` group to the current `/api/$` router.
- Each deployed mini-app environment has an explicit configured Garden origin for SDK trust validation.
- The browser-safe `@garden/mini-app-contract` package can be added as a workspace package without database or server dependencies.

## Sources used

- `docs/core/technical.md`
- `docs/core/connectors.md`
- `docs/features/skills-effect-http-api.md`
- `docs/known-gaps/auth-and-access.md`
- `docs/development/maintainer-workflow.md`
- `apps/web/src/lib/server/context.ts`
- `apps/web/src/lib/server/control-plane.ts`
- `apps/web/src/lib/server/workspace-access.ts`
- `apps/web/src/lib/server/workspace-permissions.ts`
- `apps/web/src/lib/api/garden-api-contract.ts`
- `apps/web/src/lib/server/garden-api.server.ts`
- `apps/web/src/lib/api/transport.ts`
- `apps/web/src/components/shell/app-shell.tsx`
- `apps/web/src/features/navigation/nav-items.tsx`
- `apps/web/src/features/artifacts/workspace-docs-editor.tsx`
- `packages/connectors/src/registry.ts`
- `packages/app-state/src/workspace/store.ts`
- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/users.ts`
- `packages/db/src/schema/workspaces.ts`

## External reference architectures

These references support the hosting and bridge decisions. They do not define Garden's contract.

- [Shopify App Home](https://shopify.dev/docs/apps/build/app-home) documents a developer-hosted iframe model for most embedded apps. It also documents App Bridge APIs for actions outside the iframe, such as navigation and admin UI.
- [Shopify cross-frame message validation](https://shopify.dev/docs/apps/build/security/app-server/validate-cross-frame-messages) requires exact `event.origin` and `event.source` checks and warns against sensitive messages sent to `'*'`. Garden follows this security rule.
- [Zoho Creator Embed Element](https://help.zoho.com/portal/en/kb/creator/developer-guide/pages/snippets/articles/add-and-configure-an-embed-element) documents iframe embedding for external forms, widgets, and websites. Garden uses this only as evidence that iframe hosting is a common product integration shape. Zoho's embed element does not define Garden's identity or capability contract.
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps) documents host initialization data, host events, viewport controls, and server-side validation of initialization data. Garden follows the host-bridge pattern but uses its own Garden session endpoint and origin checks.
