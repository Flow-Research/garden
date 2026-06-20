---
name: cloudflare-workers-build-env
description: Manage Cloudflare Workers Builds build variables and secrets for Git-connected Workers. Use this whenever a deploy runs inside Cloudflare Workers Builds and fails because a variable exists as a Worker runtime secret/var but is missing during the build step, or when the user asks to set build-time env for a Workers Builds trigger. This is different from Wrangler runtime secrets; use this skill before trying wrangler secret put for build-only variables.
---

# Cloudflare Workers Builds env

Use this skill when a Cloudflare Git-connected Worker needs **build variables/secrets**. Workers Builds build env is attached to the CI/CD trigger. It is separate from Worker runtime bindings.

## Key distinction

- Worker runtime vars/secrets are available to deployed Worker code.
- Workers Builds build vars/secrets are available to the build/deploy command that runs in Cloudflare's build container.
- `wrangler secret put`, `wrangler deploy --var`, `--secrets-file`, and `keep_vars` affect runtime Worker configuration, not the Workers Builds trigger env.
- Alchemy `build.env` affects the local build command when `alchemy deploy` is already running. In Cloudflare Workers Builds, values must exist in the trigger env before `alchemy.run.ts` evaluates.

If a build log says `Missing SOME_KEY` from `alchemy.run.ts`, and that key was already set with `wrangler secret put`, this skill is the right workflow.

## Preferred workflow

1. Confirm the variable is needed at build time, not just runtime.
2. Use an Alchemy Cloudflare profile with these scopes:
   - `workers_builds:read`
   - `workers_builds:write`
3. If the profile lacks those scopes, re-run Alchemy login for that profile and approve the updated scope list.
4. Find the Worker script tag from the Worker script list. The Workers Builds trigger lookup needs the script tag, not always the Worker name.
5. List triggers for the script tag.
6. Patch trigger environment variables.
7. Verify by reading trigger environment variables back. Print only names and secret flags, never values.
8. Optionally trigger a manual remote build or push an empty commit. Do not local-deploy just to kick Workers Builds.

## Bundled script

Use `scripts/set-workers-build-env.mjs` from the repo root with `tsx`.

Example shape, with placeholder names only:

```bash
pnpm exec tsx .agents/skills/cloudflare-workers-build-env/scripts/set-workers-build-env.mjs \
  --profile <alchemy-profile> \
  --account-id <cloudflare-account-id> \
  --worker <worker-name> \
  --env-file <local-env-file> \
  --var-from KEY_ONE \
  --secret-from KEY_TWO
```

The script:

- imports Alchemy's stored Cloudflare profile credentials,
- refreshes auth through Alchemy when needed,
- resolves the Worker script tag,
- resolves the Workers Builds trigger,
- patches build variables/secrets,
- verifies presence without printing values.

Do not put real secrets, account ids, worker ids, script tags, trigger UUIDs, or project-specific env names in the skill file. Pass them at runtime or keep them in ignored local env files.

## Troubleshooting

If trigger listing returns empty, check that you used the Worker script `tag` from `/workers/scripts`, not the Worker name.

If API returns authentication errors, the Alchemy profile probably lacks `workers_builds:read/write` or needs re-login.

If Cloudflare build logs still show a missing key after patching, trigger a fresh build; queued builds may have captured old trigger metadata.
