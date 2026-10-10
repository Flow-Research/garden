# Garden Personal X Research Connector

Technical PRD: https://docs.google.com/document/d/1ku2UCOc76FM_joy4NPx783R36H7u4HaP-XXJxZcFrsU

Status: specification prepared; implementation and live connection not yet verified.

## Delivery requirements

- Work on `feat/personal-x-research`, based on `dev`.
- Do not open a PR until requested; keep testing on this branch.
- Any eventual PR targets `dev` or an explicitly agreed integration branch, never `main`.
- Include the canonical Technical PRD link above in the PR description, along with validation and unresolved limitations.

## Specification snapshot

Purpose: Connect the owner’s personal X account to Garden so Codex and other authorized agents can research topics across projects. LagosLife is the first use case. The developer app has been created by the owner; its OAuth configuration and API entitlements have not yet been verified.

## Outcome and first release

The owner selects Connect X in Garden, authorizes their personal account, then asks Codex to read recent posts from their Following feed or research a topic. Results contain post links, authors, dates, and an explicit coverage statement. The same tools work for other clients connected to Garden’s MCP endpoint.

- Read the chronological home feed, search recent public posts, look up supplied post IDs, and retrieve available replies for a conversation.

- Offer bookmarks as a separate optional read permission. Enable personal use without automatically sharing the account with a workspace.

- Provide a bounded, on-demand research session. Scheduled ingestion and full-archive searches are later increments.

The first release does not post, like, follow, send DMs, reproduce the algorithmic For You feed, or export personal feed data into shared evaluation/training datasets. No promise of complete conversations or all historical posts: report pagination, time windows, missing records, and access limitations.

## Verified Garden baseline

Code inspection is pinned to commit 6526cfdbcaf4e1cf4fe58120896243eb82e6f614. This is a repository snapshot, not a deployment verification. Refresh against dev before implementation.

- Executor already exposes MCP inside the Garden web Worker, with D1/R2 and a session identity containing organizationId and userId. Reuse this host; do not create another MCP proxy service.

- The existing /api/executor/oauth/start route supports Personal and Workspace ownership. /api/oauth/callback completes Executor authorization and mirrors personal connections.

- The Executor plugin stack includes OpenAPI integration, toolkits, and encryptedSecretsPlugin. Reuse its credential lifecycle instead of storing raw tokens in a new table.

- ensureServerManagedOAuthClient currently provisions Google clients. Manual end-user OAuth app registration was removed from this route. Adding personal X app support is a deliberate extension of host configuration.

- The legacy connector registry lists Discord, GitHub, Gmail, Google Drive, and Slack; it has no X entry. Adding an entry there alone will not establish the current Executor integration.

## Architecture and ownership

Codex authenticates to Garden MCP. Garden resolves an authorized personal X connection and calls X using credentials supplied by Executor. These are two separate authorization boundaries: Codex-to-Garden and Garden-to-X. An X API key is not a Garden MCP login credential.

Preferred implementation: curate a read-only X OpenAPI integration and a small research toolkit in the existing Executor plugin stack. First verify the installed SDK handles X’s PKCE, confidential-client token exchange, refresh rotation, and per-call policy controls. If one is absent, implement only the demonstrated missing adapter and document it; do not build a parallel OAuth engine.

The personal app’s client ID/secret will be supplied through deployment secrets for this first owner-operated installation. Proposed configuration names: X_CLIENT_ID and X_CLIENT_SECRET. This does not turn the owner’s X connection into an organization connection. Owner-scoped access and refresh tokens remain separate from the deployment’s client registration.

Personal X access must be limited to the same Garden subject and tenant authorized during connection. Other workspace members, org-owned runs, and unattended shared agents must not discover or use it. Cross-workspace reuse is not assumed. General multi-user bring-your-own-app registration is deferred.

## X application configuration

Enable OAuth 2.0 and configure the app as a confidential Web App for Garden’s server-side exchange. Register the exact callback URL generated from the verified Garden origin plus /api/oauth/callback. Do not invent a production origin or substitute Codex’s local MCP callback: those callbacks serve different authorization flows.

- Base scopes: tweet.read, users.read, offline.access. Use PKCE S256 and the existing owner-bound, single-use OAuth state handling.

- Optional bookmark consent adds bookmark.read. Reauthorize when expanding scopes; do not request bookmark.write or any posting/DM permissions.

- Verify the authorized account through /2/users/me. Display its handle, owner, granted permissions, and reconnect/disconnect state.

- X authorization endpoint: https://x.com/i/oauth2/authorize. Token endpoint: https://api.x.com/2/oauth2/token. Confirm exact SDK metadata and token authentication before configuration.

Implementation must verify refresh tokens remain encrypted, token rotation is atomic under concurrent calls, credentials never enter model context or logs, and revocation stops both new and queued calls. Reuse existing Executor behavior where verified.

## Tool contracts

All tools are reads. Their proposed names describe toolkit contracts, not endpoints that already exist. Every request resolves the signed-in owner’s connection on the server; tools do not accept arbitrary owner IDs or tokens.

- x_read_feed(limit, cursor?, since_id?): GET /2/users/{authenticated_id}/timelines/reverse_chronological. Return posts from followed accounts in time order; label coverage Following, never For You.

- x_search_posts(query, limit, cursor?, start_time?, end_time?): GET /2/tweets/search/recent. Keep the first release within the endpoint’s available recent window; report the actual window.

- x_get_posts(post_ids): GET /2/tweets. Validate IDs and enforce a batch limit. Return partial successes and unavailable IDs without inventing deleted or inaccessible text.

- x_read_thread(root_post_id, limit, cursor?): resolve conversation_id, then search available conversation posts. Deduplicate IDs, preserve reply relationships, and return incomplete coverage when older replies fall outside search access.

- x_read_bookmarks(limit, cursor?): GET /2/users/{authenticated_id}/bookmarks, available only after bookmark.read consent.

Shared result fields: posts with id, text, author, created_at, source_url, conversation_id and reply/reference IDs where available; next_cursor; coverage with endpoint/window/truncation; retrieved_at; and usage metadata. Normalize missing fields and partial provider errors. Return typed outcomes for reconnect_required, insufficient_scope, access_unavailable, rate_limited and budget_exhausted.

## Privacy, cost and reliability

Personal feeds and bookmarks are private research inputs. Do not index them into shared workspace search or retain complete feed snapshots by default. Start with existing transient execution behavior; before live use, verify who can view transcripts and tool logs and whether they retain post bodies. Document that behavior and obtain explicit consent before any durable project export.

Use the existing provider host allowlist and fetch boundary. Validate topic queries and cursors, bound payload size, and treat all post content as untrusted material. Post text must never grant permissions or alter agent instructions.

Proposed initial tool ceiling: 20 posts per call, one page per tool execution. This keeps summaries reviewable and cost bounded; it is a product limit, not an X limit. Additional pages require another explicit tool call. No background polling or automatic credit top-ups.

Before live requests, the owner sets a session/daily spending allowance. Calculate conservative reservations using configured provider prices and requested resources; reconcile observable usage afterward and stop on the ceiling. Label costs as estimates when provider billing is not exposed per response. Do not promise exact cost from response count alone.

Honor provider rate-limit headers. Use existing SDK retry behavior; no independent unbounded retry loop. Disconnect, failed refresh, exhausted credits, or unavailable endpoint access must produce clear errors and stop requests. Partition any request cache by owner, scope, and query; never reuse personal responses across subjects.

## Implementation sequence

- Step 1 — Confirm dev baseline, installed Executor APIs, deployed Garden origin, personal connection isolation, current X scopes and available endpoint access. Record evidence and exact callback before asking the owner to change X settings.

- Step 2 — Extend deployment-managed OAuth configuration for X. Register the curated integration, reuse start/callback routes, and verify account identity and credential lifecycle.

- Step 3 — Add the read-only research toolkit and policy bounds. Follow existing typed SDK/Effect patterns and repository instructions; avoid changing the legacy connector registry unless runtime inspection shows it is required.

- Step 4 — Connect the owner’s personal account, expose the allowed toolkit through Garden MCP, and configure the personal plugin in ChatGPT Work or Garden MCP in Codex CLI.

- Step 5 — Run mocked contract tests, then one bounded live account check and feed read within an approved budget. Run the first LagosLife query and verify source links and coverage.

## Acceptance and test plan

- OAuth: consent success/cancellation, rejected/replayed state, scope expansion, expiry, concurrent refresh rotation, and revoked connection. Secrets do not appear in responses, model context, or logs.

- Isolation: a second subject and an org-owned execution cannot discover or invoke the personal connection. Bookmarks are unavailable without their scope. Cached responses cannot cross users.

- API contracts: pagination, duplicate posts, partial errors, missing/deleted posts, recent-window boundaries, rate limits, exhausted credits and budget stops. No automatic unbounded conversation crawl.

- End to end: Codex discovers authorized tools through Garden, reads a small feed batch, searches LagosLife, returns original links, and reports incomplete thread coverage. Confirm an additional MCP client can discover the same schemas without any client-specific X credentials.

Completion requires verified live behavior, not only a successful OAuth redirect or tool registration. Report account-connected, tool-available and live-read-verified as separate statuses.

## Delivery rules and remaining inputs

Work from a new branch based on dev after confirming the repository state. Keep testing without a PR until requested. Any eventual PR must target dev or the agreed integration branch, never main, and include this PRD’s canonical link under “Technical PRD” together with validation and remaining limitations.

Required before live connection: verified Garden origin, confidential-client OAuth settings for the created X app, client credentials entered through deployment secret management, owner consent, and a collection budget. No secrets should be pasted into chat. No production credential handling, deployment or API purchase has been performed by this PRD task.

## References

Garden source snapshot — https://github.com/Flow-Research/garden/tree/6526cfdbcaf4e1cf4fe58120896243eb82e6f614

Executor MCP host — apps/web/src/lib/server/executor-engine/mcp.ts

Plugin stack — apps/web/src/lib/server/executor-engine/plugins.ts

OAuth provisioning — apps/web/src/lib/server/executor-engine/auth-contract.ts

OAuth start and callback — apps/web/src/routes/api/executor/oauth/start.ts; apps/web/src/routes/api/oauth/callback.ts

X OAuth and scopes — https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code

X timeline coverage — https://docs.x.com/x-api/posts/timelines/introduction

X bookmarks — https://docs.x.com/x-api/posts/bookmarks/introduction

X developer setup — https://docs.x.com/x-api/getting-started/getting-access

Codex MCP connection — https://learn.chatgpt.com/docs/extend/mcp?surface=cli

ChatGPT Work personal plugins — https://developers.openai.com/plugins/quickstart
