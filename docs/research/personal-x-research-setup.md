# Personal X research: test setup

[Technical PRD](https://docs.google.com/document/d/1ku2UCOc76FM_joy4NPx783R36H7u4HaP-XXJxZcFrsU)

Branch: `feat/enable-x-connector`, based on `dev` (previously `feat/personal-x-research`). No PR or production deployment was created by this implementation task.

## What was built

Garden's existing Executor API and MCP host now load a curated X research plugin. It exposes five bounded read tools: following feed, recent search, post lookup, partial conversations, and optional bookmarks. No write tools are registered. Every invocation checks personal ownership and actual granted scopes, reserves a worst-case read budget, and resolves the authorized account through `/2/users/me`.

Executor owns PKCE, callback state, encrypted credentials and refresh. A token-endpoint-only fetch adapter translates Executor 1.5.40's confidential client POST credentials into X's required Basic authentication for exchange and refresh. No SDK methods are patched.

The daily reservation uses a conditional PostgreSQL UPSERT. Budget follows the Garden user across workspaces and connections. Reservations remain charged when a request fails, returns fewer results, or returns duplicate posts. This is deliberately conservative.

## Configure the test environment

1. Use the Garden dev origin: `https://garden-dev.flow-research.workers.dev`. It is reachable and shows Garden sign-in. As checked on 10 October 2026, the connector commit is on `feat/enable-x-connector` and its files are absent from the current `dev` branch. Verify the running Worker includes the connector before attempting authorization; reaching the site alone does not establish that.
2. In the created X developer app, enable OAuth 2.0 for a confidential Web App. Register the exact callback: `https://garden-dev.flow-research.workers.dev/api/oauth/callback`.
3. Enter `X_CLIENT_ID` and `X_CLIENT_SECRET` through deployment secret management, or an untracked local `.env`. Never paste secrets into chat or commit them.
4. Configure these integer values after checking the current prices in the X console:

| Variable | Meaning |
| --- | --- |
| `X_RESEARCH_DAILY_BUDGET_MICROUSD` | Per Garden user, per UTC day reservation cap |
| `X_RESEARCH_POST_PRICE_MICROUSD` | Conservative price per returned post |
| `X_RESEARCH_USER_PRICE_MICROUSD` | Conservative price per account/user record |

One USD equals 1,000,000 micro-USD. A request reserves `maxPosts × postPrice + (maxPosts + 1) × userPrice`: one account lookup and up to one expanded author per post. Missing or invalid configuration disables reads. The reservation cap covers these configured estimates; it is not an exact invoice cap. Keep the provider-side spending cap configured and update prices when X changes billing.

5. Verify the dev deployment uses an isolated test database, then apply generated database migration `0051_wonderful_ronan.sql` using the normal Garden migration command. The dev deploy does not automatically run migrations. Do not apply to production for this test.
6. Install **X Personal Research** from Garden's integration catalog. Authorization creates a **personal** connection. The default permission set is `tweet.read users.read offline.access`.
7. For bookmarks, choose **Personal research and bookmarks** in the connection dialog; explicitly authorize `bookmark.read`. Existing research-only grants do not acquire bookmark access automatically.
8. Connect the authorized client's Garden MCP endpoint using Garden's existing OAuth setup. Check that X tools appear for your personal connection and remain absent from organization toolkits.

## Automated validation

All 59 tests across 16 Executor integration test files pass. Full web typechecking and focused lint checks pass. Tests cover PKCE, confidential exchange/refresh, callback replay rejection, concurrent refresh within one executor, personal catalog ownership, bounded requests, bookmark consent, partial thread results, rate limits, and budget stops. The budget suite applies the generated migrations to PGlite PostgreSQL and verifies conditional UPSERT outcomes for overlapping calls. This does not replace multi-connection PostgreSQL or separate MCP-session live checks.

## Live validation

Use the smallest feed request first, then one recent LagosLife query. Confirm the account handle, authors, timestamps, post links, pagination cursor, and reported coverage. Search covers the last seven days; conversation reads are always partial. The Following feed is chronological and does not reproduce For You.

Disconnect the personal connection, then confirm a new invocation cannot resolve its tools or credentials. Verify no token appears in output or application logs. Before enabling prolonged sessions, verify refresh rotation across separate Worker requests/MCP sessions against X; the SDK test for concurrent refresh within one executor does not establish cross-session serialization.

No live OAuth connection or paid X read has been performed by the implementation task. The dev origin is confirmed; connector deployment, migration status, secret configuration, API entitlements, provider billing controls and cross-session refresh rotation remain live checks.

## References

- [X OAuth authorization code and PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [Chronological Following timeline](https://docs.x.com/x-api/users/get-timeline)
- [Recent search](https://docs.x.com/x-api/posts/search-recent-posts)
- [Bookmarks](https://docs.x.com/x-api/users/get-bookmarks)
- [X developer console](https://developer.x.com/)

Every eventual PR must include the Technical PRD link, validation results, and remaining live checks. Target `dev` or the agreed integration branch; do not open a PR until requested.
