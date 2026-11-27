---
name: deploy
description: Use whenever deploying, redeploying, shipping, building for remote deployment, verifying a deployed Garden Worker, or troubleshooting Garden deployment through Alchemy. Covers the persistent staging/dev targets, manual garden-preview target, package-script deployment, teardown, secret safety, and browser verification.
---

# Garden deployment

Garden has three Alchemy deployment targets:

- `staging` → `garden-staging`, automatically deployed from `main`.
- `dev` → `garden-dev`, automatically deployed from `dev`.
- `preview` → `garden-preview`, deployed manually for temporary remote testing.

Two Workers Builds triggers are attached to `garden-staging`: the production
trigger watches `main`; the non-production trigger watches other branches.
Production runs `cd ../.. && pnpm run deploy`; non-production runs
`cd ../.. && pnpm run deploy:ci`. The dispatcher deploys only `main`
and `dev`, skipping other branches before typechecks or migrations. Preview
remains manual. Build secrets must be configured separately on both triggers;
Cloudflare copies plain variables when enabling non-production builds, not secrets.

Staging retains Alchemy's existing `garden-production` stack and `production`
state stage. Those are resource ownership identifiers, not another environment;
do not rename them or adopt the same resources under a new stack.

For any remote deploy or verification where the user does not explicitly request the live target, use **preview**.

## Non-negotiables

- Keep branch ownership explicit: `main` owns staging, `dev` owns dev. Use preview for ad hoc remote verification unless the user requests a persistent target.
- Use repository package scripts. Do not create an ad hoc Wrangler deployment config or run `wrangler deploy`.
- Alchemy owns each target's Garden app Worker, Hyperdrive, D1, R2, Durable Objects, Workflow, Worker Loader, sandbox container, and optional tail consumer.
- Do not echo secrets, write secret values to tracked files, or expose `.env` contents.
- Garden does not bundle or deploy Harnessy. Executor runs from its declared dependencies inside the Garden app Worker; do not create a separate connector or MCP-proxy Worker.
- Preserve unrelated dirty-tree changes. Deployment does not require a commit.
- Dev and preview share staging’s `DATABASE_URL` by explicit user decision. Only staging runs migrations. Use a dedicated preview workspace/account and avoid destructive product actions.

## Validate deployment configuration

When deployment metadata, bindings, or package scripts change, run:

```bash
pnpm run verify:deploy-config
```

## Preview deployment

From the repository root:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm run deploy:preview
```

This selects `GARDEN_DEPLOY_TARGET=preview`. Alchemy v2 uses Cloudflare credentials and remote state; stack/stage and physical resource names keep the targets separately owned. Containers use the pinned prebuilt Sandbox image.

## Staging deployment

Automatic on `main` pushes, or explicitly:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm run deploy
```

This typechecks, applies pending PostgreSQL migrations, then selects
`GARDEN_DEPLOY_TARGET=staging` and updates `garden-staging`. A migration
failure stops the command before Alchemy deploys application code.

`DATABASE_URL` must be available to the process that runs `pnpm deploy`. For
Cloudflare Workers Builds, configure it as a build secret on the Git trigger;
a Worker runtime secret is not available to the build command.

Dev and preview intentionally do not run migrations because they share the
staging PostgreSQL origin. Apply schema changes through staging first.

## Dev deployment

Automatic on `dev` pushes, or explicitly:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm run deploy:dev
```

This typechecks and deploys the `garden-dev` stack at stage `dev`. Dev remains
running after verification. Do not run preview teardown against dev resources.

## Mandatory preview teardown

Preview is temporary. After remote verification, always run:

```bash
pnpm run destroy:preview
```

Confirm successful deletion before reporting completion. If teardown encounters a transient Cloudflare timeout, retry the same command. Leave preview running only when the user explicitly asks.

## Failure handling

- Typecheck or build failures are blockers.
- If the default Node heap is exhausted, use the documented 8 GB `NODE_OPTIONS` command above.
- For transient Cloudflare upload/network failures, retry the same approved package script.
- If Alchemy proposes replacement or deletion of a resource belonging to the other target, stop immediately.
- Missing environment variables should be reported by name only, never by value.

## Post-deploy verification

1. Record the Worker URL printed by Alchemy.
2. Open it with `agent_browser`.
3. Verify the application and authentication surface load.
4. Test the requested feature without putting real credentials into chat or logs.
5. Inspect browser console, page errors, and actionable network failures.
6. Confirm the live `garden-staging` deployment version did not change during a preview task.
7. Destroy preview unless explicitly retained.

## Authenticated preview QA without a password

For an authorized existing user, a short-lived Better Auth-compatible session may be minted instead of requesting the user's password.

1. Use a temporary, untracked script outside the repository.
2. Look up the existing user and verify membership in the intended preview-test workspace.
3. Insert a short-lived Better Auth session for that user with `active_organization_id` set to the intended workspace ID.
4. Sign the session token with the configured `BETTER_AUTH_SECRET` using Better Auth's cookie-signing implementation. Do not invent a cookie format.
5. URL-encode the signed value and import it into the isolated browser profile as `__Secure-better-auth.session_token` for the preview Worker hostname, path `/`, secure, HTTP-only, and same-site lax.
6. Open `/workspace`, verify the expected user/workspace through rendered product state, then perform only non-destructive QA.
7. Delete or expire the temporary session after QA. Remove the temporary script. Never print the token, signed cookie, secret, email-derived credentials, or `.env` values to chat or logs.

The OAuth popup may return to the same preview origin while another workspace is active. Executor OAuth state must carry the originating workspace ID; the callback must verify the signed-in user still belongs to that workspace before completing the connection.

## Reporting

Report the exact command, selected target, Worker URL, verification evidence, teardown result, and which persistent targets changed.
