---
title: Connect a personal Workstream account
description: Connect Workstream MCP through an invite-only Flow Identity account while keeping Garden sign-in and Workstream authorization separate.
status: current
owner: '@Flow-Research/security'
last_reviewed: 2026-11-16
---

## Outcome and boundary

Workstream appears in the MCP catalogue. A signed-in Garden member connects a **Personal** Workstream account through Flow Identity's browser authorization. Garden keeps its current sign-in system. Workstream owns its tasks, submissions, review decisions, and contribution records; a successful OAuth connection grants no additional product authority.

This bounded change adds catalogue metadata and a deployment-owned public OAuth registration to Garden's existing Executor flow. It does not add account creation, self-registration, a custom OAuth engine, token pasting, a new transport, or Workstream task UI.

## Authorization and credentials

The hosted MCP resource is `https://workstream.flowresearch.tech/mcp`. Its Flow Identity issuer is `https://identity.flowresearch.tech/realms/flow`; authorization and token endpoints use that realm's `/protocol/openid-connect/auth` and `/protocol/openid-connect/token` paths. Only the exact Workstream MCP discovery target can use Garden's Workstream registration. Client reuse requires the exact endpoints, resource, deployment client ID, and authorization-code grant, even when an older record names the same integration.

`WORKSTREAM_MCP_CLIENT_ID` supplies the public client registered for this Garden deployment. Executor represents public clients with an empty client secret and owns authorization code exchange, S256 PKCE, callback state, encrypted connection credentials, and refresh. The organization owns the public application registration; the member owns each connection and its refresh credential. Workspace connections are refused before OAuth starts. Other integrations retain their existing ownership choices.

For the exact Workstream resource, the installed SDK patch keeps code exchange and the saved refresh token endpoint on the configured issuer. Untrusted callback `domain` or `site` parameters cannot rebind them to a sibling host. Other providers retain their existing regional callback behavior. See the [Executor seams](../../../third_party/executor/PATCHES.md).

Executor discovers the requested scopes from Workstream's protected-resource metadata: `workstream:access workstream-mcp-audience`. These are access-token scopes; no OpenID identity token is requested. The audience scope binds this credential to MCP. Workstream exchanges it for its internal API credential and enforces existing product authorization. Garden never receives the MCP server's exchange secret and never forwards its primary sign-in credential to Workstream.

## What the member sees

1. Open the connector catalogue and select **Workstream**.
2. Install and connect it as **Personal**. Choosing **Workspace** is refused with an explanation.
3. Authorize at Flow Identity with an invited account. Complete a required temporary-password action there when applicable.
4. Return through Garden's existing `/api/oauth/callback`. Executor saves the personal connection and refresh credential.
5. Cancellation leaves the account disconnected. Unavailable OAuth discovery stops installation with an actionable failure instead of offering a manual token form. Missing deployment registration reports that OAuth is not configured. An expired or revoked OAuth session may require signing in again or reconnecting. Revoked Workstream permissions remain denied; reconnecting does not restore a product grant.

## Deployment registration

Garden dev is the primary live qualification target for this connector: `https://garden-dev.flow-research.workers.dev`. Configure `WORKSTREAM_MCP_CLIENT_ID=garden-dev` for that target. Its required Flow Identity registration is public, authorization-code enabled, requires S256, and permits only `https://garden-dev.flow-research.workers.dev/api/oauth/callback`. Confirm registration and binding before the live drill.

Set `WORKSTREAM_MCP_CLIENT_ID=garden-dev` in the dev Workers Builds or deployment environment that runs Alchemy. Alchemy derives optional plain Worker bindings from the deployment process environment; changing only the live Worker setting does not preserve that input for later deployments. Verify the resulting Worker binding after deployment.

Configure `WORKSTREAM_MCP_CLIENT_ID` independently for each deployed target. The existing staging registration, `garden-staging`, permits only `https://garden-staging.flow-research.workers.dev/api/oauth/callback`. Each environment needs its own exact registration; do not reuse either client for another target, preview, localhost, or a production origin. No wildcard callbacks or automatic dynamic registration are used for Workstream. An unset client ID disables new Workstream authorization even if old client metadata remains in storage.

The Workstream MCP audience client scope must have **Include in token scope** enabled in Flow Identity. Executor records the scopes returned by the token endpoint and requests that same set during refresh. Returning both `workstream:access` and `workstream-mcp-audience` keeps the audience mapping selected on refresh. The internal API audience and identity scopes retain their separate configuration. Verify the signed access token and an actual MCP call after refresh; a successful token response alone does not prove the refreshed credential is valid for MCP.

The deployment binding is optional, so an environment without a registered client can still run other connectors. Register and bind an appropriate client before enabling Workstream there. Merging into `dev` deploys `garden-dev`; staging promotion remains a separate maintainer action. See [deploy targets](../../reference/deploy-targets.md) and [environment and bindings](../../reference/environment-and-bindings.md).

## Implementation and proof

The existing owners are `apps/web/src/lib/server/executor-engine/presets.ts`, `auth-contract.ts`, `install.ts`, and `apps/web/src/routes/api/executor/oauth/start.ts`. The SDK discovery patch uses the OpenID Connect issuer-path convention while preserving the RFC 8414 OAuth metadata convention. The installation regression runs the actual catalogue-to-probe-to-registration path, including discovery failure. No schema or storage migration is required. See [connector architecture](../architecture/connectors.md).

Acceptance covers catalogue installation through real SDK discovery, strict public-client registration and reuse, refusal of foreign resources or issuers, missing configuration, and refusal of Workspace ownership before client writes or authorization. Workstream discovery failure must leave no new integration or credential and must not offer a manual token form. Focused registration, catalogue, installation, and route tests cover these boundaries. Deployment and code-policy checks cover binding propagation. Security review focuses on resource binding, callback/PKCE ownership, and personal credential isolation.

Chat's existing integration router keeps at most eight tools in the selected integration's scope. Explicitly requested discovered tool names must rank ahead of generic provider-prefix matches; other tools rank by relevant name and description matches. The selected-integration boundary, permission checks, and caller-owned connection remain in force. Router regression proof uses a large Workstream catalogue, including the own-profile and administrative-read tools, and checks the cap, unavailable names, and another provider.

Private chat HTTP and WebSocket handshakes require the current Garden member to own the requested thread, with matching parent agent and workspace. These checks query current membership and ownership even when parent-agent access was cached. Unsupported nested chat routing is refused. Browser warm-up uses the owned chat facet; parent thread methods remain available to trusted server RPC callers through existing owner-checked APIs and are not browser-callable. This handshake boundary does not claim to refresh membership on every message of an already-open socket.

Follow the [Workstream verification scenario](../../../.agents/skills/verify/features/workstream.md) for browser authorization, personal isolation, refresh, cancellation, and a permission refusal. Live user-flow proof remains required; unit tests alone do not establish that a deployed callback or refresh works. The corresponding open proof gap is recorded in [known gaps](../../reference/known-gaps.md).
