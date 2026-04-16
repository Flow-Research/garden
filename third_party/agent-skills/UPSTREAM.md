# Bundled agent-skill provenance

Snapshot: 2026-08-07. This inventory covers source copied into
`.agents/skills`; package-manager dependencies are outside its scope. Source
coordinates and install-time hashes are also retained in `skills-lock.json`.

The files are development instructions, not application runtime code. Local
changes are licensed with Garden, while upstream portions remain under the
licenses named below. Each retained upstream license is bundled beside this
file under a directory named for its repository.

## Retained bundles

| Garden skill                                                                                                                               | Upstream source                                                                                           | License                 | Local treatment                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-browser`                                                                                                                            | [`vercel-labs/agent-browser`](https://github.com/vercel-labs/agent-browser), `skills/agent-browser`       | Apache-2.0              | Installed copy; install-time content hash is in `skills-lock.json`.                                                                  |
| `agents-sdk`, `cloudflare`, `cloudflare-email-service`, `durable-objects`, `sandbox-sdk`, `web-perf`, `workers-best-practices`, `wrangler` | [`cloudflare/skills`](https://github.com/cloudflare/skills), matching `skills/<name>` directories         | Apache-2.0              | Installed copies with Garden-specific updates to platform and Durable Object guidance. The lock records the installed source hashes. |
| `ai-sdk`                                                                                                                                   | [`vercel/ai`](https://github.com/vercel/ai), `skills/ai-sdk`                                              | Apache-2.0              | Installed copy; install-time content hash is in `skills-lock.json`.                                                                  |
| `better-icons`                                                                                                                             | [`better-auth/better-icons`](https://github.com/better-auth/better-icons)                                 | MIT                     | Installed copy; install-time content hash is in `skills-lock.json`.                                                                  |
| `better-result`                                                                                                                            | [`dmmulroy/better-result`](https://github.com/dmmulroy/better-result)                                     | MIT                     | Garden guidance wraps a bundled upstream source snapshot. The source snapshot also retains its own `LICENSE`.                        |
| `effect`                                                                                                                                   | [`kitlangton/skills`](https://github.com/kitlangton/skills) at `30dee8607214c893dd89f6eee65c669ef3dce8c9` | MIT                     | Modified for Garden's Effect version, HTTP API, Worker, and repository conventions; baseline is recorded in the skill itself.        |
| `motion`                                                                                                                                   | [`jezweb/claude-skills`](https://github.com/jezweb/claude-skills), `skills/motion`                        | MIT                     | Installed copy with local updates. The upstream repository and license are also named in the bundled README.                         |
| `neon-postgres`                                                                                                                            | [`neondatabase/agent-skills`](https://github.com/neondatabase/agent-skills)                               | Apache-2.0              | Installed copy; install-time content hash is in `skills-lock.json`.                                                                  |
| `react-useeffect`                                                                                                                          | [`softaworks/agent-toolkit`](https://github.com/softaworks/agent-toolkit), `skills/react-useeffect`       | MIT                     | Installed copy; install-time content hash is in `skills-lock.json`.                                                                  |
| `turborepo`                                                                                                                                | [`vercel/turborepo`](https://github.com/vercel/turborepo), `skills/turborepo`                             | MIT                     | Installed copy; install-time content hash is in `skills-lock.json`.                                                                  |
| `cloudflare-workers-build-env`, `deploy`                                                                                                   | Garden repository history                                                                                 | Garden outbound license | First-party project instructions and scripts.                                                                                        |
| `image-gen`                                                                                                                                | [`Konan69/skills`](https://github.com/Konan69/skills), `skills/image-gen`                                 | Garden outbound license | First-party source owned by Garden's author; source coordinate and install-time hash are in `skills-lock.json`.                      |

## Removed bundles

The OSS preparation removed copied bundles whose exact source did not grant a
redistribution license, or whose generated provenance could not be established:

- `better-auth-best-practices`, `organization-best-practices`, and
  `two-factor-authentication-best-practices`: `better-auth/skills` has no
  repository license as of the snapshot date.
- `tanstack-integration-best-practices`, `tanstack-query-best-practices`,
  `tanstack-router-best-practices`, and `tanstack-start-best-practices`:
  `DeckardGer/tanstack-agent-skills` has no repository license as of the
  snapshot date.
- `bro`: `backnotprop/bro` has no repository license as of the snapshot date.
- `integration-tanstack-start`: the files identify PostHog as author, but the
  exact generated source path and source snapshot were not recoverable.
- `teach-impeccable`: its immediate source was the author's old aggregate
  skill repository, which did not record the original upstream or a license.

Those skills may still be installed locally by contributors directly from
their owners. Garden does not redistribute their source.

## Primary license evidence

- [vercel-labs/agent-browser license](https://github.com/vercel-labs/agent-browser/blob/main/LICENSE)
- [cloudflare/skills license](https://github.com/cloudflare/skills/blob/main/LICENSE)
- [vercel/ai license](https://github.com/vercel/ai/blob/main/LICENSE)
- [better-auth/better-icons license](https://github.com/better-auth/better-icons/blob/main/LICENSE)
- [dmmulroy/better-result license](https://github.com/dmmulroy/better-result/blob/main/LICENSE)
- [kitlangton/skills license](https://github.com/kitlangton/skills/blob/main/LICENSE)
- [neondatabase/agent-skills license](https://github.com/neondatabase/agent-skills/blob/main/LICENSE)
- [softaworks/agent-toolkit license](https://github.com/softaworks/agent-toolkit/blob/main/LICENSE)
- [vercel/turborepo license](https://github.com/vercel/turborepo/blob/main/LICENSE)
- [jezweb/claude-skills license](https://github.com/jezweb/claude-skills/blob/main/LICENSE)
