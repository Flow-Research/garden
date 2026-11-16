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

Executor discovers the requested scopes from Workstream's protected-resource metadata: `workstream:access workstream-mcp-audience`. These are access-token scopes; no OpenID identity token is requested. The audience scope binds this credential to MCP. Workstream exchanges it for its internal API credential and enforces existing product authorization. Garden never receives the MCP server's exchange secret and never forwards its primary sign-in credential to Workstream.

## What the member sees

1. Open the connector catalogue and select **Workstream**.
2. Install and connect it as **Personal**. Choosing **Workspace** is refused with an explanation.
3. Authorize at Flow Identity with an invited account. Complete a required temporary-password action there when applicable.
4. Return through Garden's existing `/api/oauth/callback`. Executor saves the personal connection and refresh credential.
5. Cancellation leaves the account disconnected. Missing deployment registration reports that OAuth is not configured. An expired or revoked OAuth session may require signing in again or reconnecting. Revoked Workstream permissions remain denied; reconnecting does not restore a product grant.

## Deployment registration

Configure `WORKSTREAM_MCP_CLIENT_ID` independently for each deployed target. The existing staging registration is `garden-staging`, public, authorization-code enabled, S256 required, and permits only `https://garden-staging.flow-research.workers.dev/api/oauth/callback`. Do not reuse it for `garden-dev`, preview, localhost, or a production origin. Register each intended callback exactly; no wildcard callbacks or automatic dynamic registration are used for Workstream. An unset client ID disables new Workstream authorization even if old client metadata remains in storage.

The deployment binding is optional, so an environment without a registered client can still run other connectors. Register and bind an appropriate client before enabling Workstream there. Merging into `dev` deploys `garden-dev`; staging promotion remains a separate maintainer action. See [deploy targets](../../reference/deploy-targets.md) and [environment and bindings](../../reference/environment-and-bindings.md).

## Implementation and proof

The existing owners are `apps/web/src/lib/server/executor-engine/presets.ts`, `auth-contract.ts`, and `apps/web/src/routes/api/executor/oauth/start.ts`. No schema or storage migration is required. See [connector architecture](../architecture/connectors.md).

Acceptance covers catalogue installation, strict public-client registration and reuse, refusal of foreign resources or issuers, missing configuration, and refusal of Workspace ownership before client writes or authorization. Focused registration, catalogue, installation, and route tests cover these boundaries. Deployment and code-policy checks cover binding propagation. Security review focuses on resource binding, callback/PKCE ownership, and personal credential isolation.

Follow the [Workstream verification scenario](../../../.agents/skills/verify/features/workstream.md) for browser authorization, personal isolation, refresh, cancellation, and a permission refusal. Live user-flow proof remains required; unit tests alone do not establish that a deployed callback or refresh works. The corresponding open proof gap is recorded in [known gaps](../../reference/known-gaps.md).
