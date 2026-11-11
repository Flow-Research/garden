---
title: Deploy Garden
description: Deploy Garden to preview, dev, or staging with the repository scripts, and tear down a preview when you finish.
status: current
owner: "@Umoren"
last_reviewed: 2026-11-10
---

Garden deploys through Alchemy package scripts. Do not run `wrangler deploy` and do not write an ad hoc Wrangler config. For the full list of targets, resources, and triggers, see [Deploy targets](../../reference/deploy-targets.md).

## Choose a target

- To test a change on a remote Worker, deploy `preview`. Use it unless you were asked to deploy dev or staging.
- To update `garden-dev`, merge to `dev`. Workers Builds deploys it.
- To update `garden-staging`, merge `dev` into `main`. Workers Builds deploys it and runs migrations.

Run the manual commands below only when the automatic deploy is not enough.

## Prepare your shell

1. Set Cloudflare credentials in the environment: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Set every variable that `alchemy.run.ts` reads, including `DATABASE_URL`, `BETTER_AUTH_SECRET`, `EXECUTOR_SECRET_KEY`, `HELIX_URL`, `HELIX_API_KEY`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VITE_PUBLIC_POSTHOG_PROJECT_TOKEN`, and `VITE_PUBLIC_POSTHOG_HOST`. [Environment variables and Worker bindings](../../reference/environment-and-bindings.md) lists them all.
3. If you changed deploy metadata, bindings, or deploy scripts, check the configuration:

   ```bash
   pnpm run verify:deploy-config
   ```

Never print secret values or write them to tracked files. If a variable is missing, report it by name only.

## Deploy a preview

1. From the repository root, run:

   ```bash
   NODE_OPTIONS=--max-old-space-size=8192 pnpm run deploy:preview
   ```

   The script typechecks, then deploys `garden-preview`. Alchemy prints the Worker URL when it finishes.

2. Open the Worker URL and test the change. The preview target shares the live Postgres origin, so use a test workspace and avoid destructive actions.
3. Tear down the preview:

   ```bash
   pnpm run destroy:preview
   ```

   Confirm that the command reports the deletion. If a Cloudflare timeout interrupts it, run the same command again.

## Deploy dev manually

Run:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm run deploy:dev
```

Set `DEV_DATABASE_URL` to the dev Neon branch first. The script typechecks, applies pending migrations to that database, and then deploys `garden-dev`. If `DEV_DATABASE_URL` is unset or a migration fails, the script stops before Alchemy deploys code. Leave dev running.

## Deploy staging manually

Run:

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm run deploy
```

The script typechecks, applies pending Postgres migrations with `deploy:migrate`, and then deploys `garden-staging`. If a migration fails, the script stops before Alchemy deploys code.

Dev and staging each migrate their own database. Preview does not run migrations because it shares the staging database.

## Configure an automatic deploy

Workers Builds reads `DATABASE_URL` and the other secrets from build secrets on each Git trigger, not from Worker runtime secrets. Set build secrets on the production trigger and the non-production trigger separately. Turning on non-production builds copies plain variables only.

The `dev` branch builds on the non-production trigger and needs `DEV_DATABASE_URL`. In the Cloudflare dashboard, open Workers & Pages, select the `garden-staging` Worker, go to Settings > Build > Variables and secrets, and add `DEV_DATABASE_URL` as a secret for non-production branches, with the dev Neon branch connection string as its value.

## If the deploy fails

- If typecheck or build fails, fix the error. Do not skip the check.
- If Node runs out of heap memory, use the `NODE_OPTIONS=--max-old-space-size=8192` prefix shown above.
- If a Cloudflare upload or network call fails, run the same script again.
- If Alchemy plans to replace or delete a resource that belongs to a different target, stop and ask a maintainer.

## Check the deployment

1. Run `curl -fsS https://<host>/api/health` against the Worker URL that Alchemy printed. A healthy deploy returns `200` with `{"status":"ok","checks":{"database":"ok"}}`. If the database does not answer, the route returns `503` with `{"status":"degraded","checks":{"database":"error"}}`, and `curl -f` exits with an error. The route needs no session. The error detail is in the Worker logs, not in the response.
2. Open the Worker URL in a browser and confirm that the app and the sign-in page load.
3. Test the feature you changed.
4. Check the browser console and failed network requests.
5. To read Worker errors, see [Find a problem in the Worker logs](./debug-with-logs.md).

## Run the smoke suite

`pnpm smoke` runs read-only checks against a deployed Worker and prints one `PASS`, `FAIL`, or `SKIPPED` line per check with the HTTP status and time. It exits with code `1` if a check fails.

1. Run the public checks against staging:

   ```sh
   pnpm smoke
   ```

   The public checks need no session. They confirm that `GET /api/health` returns `200` with `status: ok`, that `/login` returns HTML, that `POST /api/github/webhook` rejects a bad signature with `401` or `403`, and that `GET /api/me` returns `401` without a session. The webhook probe sends an empty body. The route rejects it before it reads or writes data.

2. To check another Worker, such as a preview, set `SMOKE_BASE_URL`:

   ```sh
   SMOKE_BASE_URL=https://<host> pnpm smoke
   ```

3. To run the authenticated checks, get a session cookie for a test account:
   1. Sign in to the Worker URL in a browser with a test account. Do not use a personal account.
   2. Open the developer tools, go to Application > Cookies, and copy the value of `__Secure-better-auth.session_token`.
   3. Run the suite with the full cookie pair:

      ```sh
      SMOKE_SESSION_COOKIE='__Secure-better-auth.session_token=<value>' SMOKE_REQUIRE_AUTH=1 pnpm smoke
      ```

   The authenticated checks send `GET` requests only, to `/api/me`, `/api/workspaces`, `/api/issues`, `/api/automations`, `/api/brain/files`, and `/api/chat/threads`. The script never prints the cookie. Without `SMOKE_SESSION_COOKIE`, these checks print `SKIPPED`. With `SMOKE_REQUIRE_AUTH=1`, a skipped check makes the run fail.

4. Sign out of the test account when you finish. Signing out ends the session that the cookie belongs to.
